import type { AttackElement, ConquestContent, EnemyAbility, EnemyDefinition } from '@mageknight/content';
import { coordKey } from '../hex';
import { shuffleWithState } from '../rng';
import { addCardToZone, applyConquestEffect, unitAttachmentBonus } from './cards';
import { addResource, appendEvent, conquestFailure, detachUnitAttachments, randomBasicColor, spendResource } from './state';
import type { ConquestAttackState, ConquestCommand, ConquestEncounter, ConquestResult, ConquestState } from './types';

function definition(state: ConquestState, content: ConquestContent, enemyId: string): EnemyDefinition | undefined {
  const enemy = state.enemies[enemyId];
  return enemy ? content.enemies[enemy.definitionId] : undefined;
}

export function enemyAllowsEffect(enemy: EnemyDefinition, effect: 'attack' | 'block' | 'modifier'): boolean {
  return effect === 'attack' || effect === 'block' || !enemy.abilities.includes('arcane-immunity');
}

export function startConquestCombat(state: ConquestState, content: ConquestContent, enemyIds: string[], origin: { q: number; r: number }, events: ConquestState['eventLog'], crossedWall = false): ConquestResult | undefined {
  if (enemyIds.length === 0 || enemyIds.some((id) => !state.enemies[id] || state.enemies[id]?.defeated)) return conquestFailure(state, 'INVALID_TARGET', '所选敌人不可用于战斗。');
  const firstEnemyId = enemyIds[0];
  if (!firstEnemyId) return conquestFailure(state, 'INVALID_TARGET', '所选敌人不可用于战斗。');
  const siteId = state.map[coordKey(state.enemies[firstEnemyId]?.position ?? state.player.position)]?.siteId;
  const encounter: ConquestEncounter = { enemyIds: [...enemyIds], origin: { ...origin }, phase: 'ranged', incoming: [], defeatedThisCombat: [], heroWoundsGained: 0, fullyBlockedEnemyIds: [], defendAssignments: {}, ...(siteId ? { siteId } : {}), ...(crossedWall ? { crossedWall: true } : {}) };
  state.encounter = encounter;
  state.phase = 'combat-ranged';
  appendEvent(state, events, 'CombatStarted', `与 ${enemyIds.length} 名敌人开始战斗。`, { enemyIds, siteId });
  return undefined;
}

export function startFactionLeaderCombat(state: ConquestState, content: ConquestContent, leaderId: string, events: ConquestState['eventLog']): ConquestResult | undefined {
  const leader = state.factionLeaders[leaderId];
  const definition = content.factionLeaders[leaderId];
  if (!leader || !definition || leader.defeated || !leader.position || coordKey(leader.position) !== coordKey(state.player.position)) return conquestFailure(state, 'INVALID_TARGET', '当前空间没有可挑战的阵营首领。');
  const guards = leader.guardEnemyIds.filter((id) => !state.enemies[id]?.defeated);
  const result = guards.length > 0
    ? startConquestCombat(state, content, guards, state.player.position, events)
    : undefined;
  if (!state.encounter) state.encounter = { enemyIds: [], origin: { ...state.player.position }, phase: 'ranged', incoming: [], defeatedThisCombat: [], heroWoundsGained: 0, fullyBlockedEnemyIds: [], defendAssignments: {} };
  state.encounter.leaderId = leaderId;
  const siteId = state.map[coordKey(leader.position)]?.siteId;
  if (siteId) state.encounter.siteId = siteId;
  state.phase = 'combat-ranged';
  appendEvent(state, events, 'FactionLeaderCombatStarted', `挑战${definition.name}（等级 ${leader.level}）。`, { leaderId, level: leader.level, guards });
  return result;
}

function enemyArmor(state: ConquestState, content: ConquestContent, enemyId: string): number {
  const enemy = definition(state, content, enemyId);
  if (!enemy) return Number.POSITIVE_INFINITY;
  const base = enemy.abilities.includes('elusive') && !state.encounter?.fullyBlockedEnemyIds.includes(enemyId) ? (enemy.elusiveArmor ?? enemy.armor + 2) : enemy.armor;
  const defend = Object.entries(state.encounter?.defendAssignments ?? {}).reduce((sum, [defenderId, targetId]) => {
    if (targetId !== enemyId) return sum;
    const defender = definition(state, content, defenderId);
    return sum + (defender?.defend ?? 0);
  }, 0);
  return Math.max(1, base + (state.enemyModifiers[enemyId]?.armor ?? 0) + defend);
}

function effectiveAttack(state: ConquestState, content: ConquestContent, enemyIds: string[], kind: 'normal' | 'ranged' | 'siege', extraResistances: AttackElement[] = []): { value: number; usedIds: string[] } {
  const contributions = state.player.resources.filter((item) => {
    if (item.resource === 'move') return state.ruleRuntime.moveToAttack && (state.phase === 'combat-attack' || (state.ruleRuntime.moveToAttack === 'ranged' && kind === 'ranged'));
    return item.resource === 'attack' && (state.phase === 'combat-attack' || (kind === 'siege' ? item.attackKind === 'siege' : item.attackKind === 'ranged' || item.attackKind === 'siege'));
  });
  let value = 0;
  for (const item of contributions) {
    const element = state.ruleRuntime.convertAttacks === 'cold-fire' ? 'cold-fire' : item.element;
    if (state.ruleRuntime.convertAttacks === 'siege' && state.phase === 'combat-ranged' && kind !== 'siege') continue;
    const resisted = extraResistances.includes(element) || enemyIds.some((id) => !(state.enemyModifiers[id]?.removeResistance || (element === 'physical' && state.ruleRuntime.removePhysicalResistance)) && definition(state, content, id)?.resistances.includes(element));
    const amount = item.amount * (element === 'physical' && state.ruleRuntime.doublePhysicalAttacks ? 2 : 1);
    value += resisted ? Math.floor(amount / 2) : amount;
  }
  return { value, usedIds: contributions.map((item) => item.id) };
}

export function conquestDeclareAttack(state: ConquestState, content: ConquestContent, command: Extract<ConquestCommand, { type: 'DECLARE_ATTACK' }>, events: ConquestState['eventLog']): ConquestResult | undefined {
  if (!state.encounter || !['combat-ranged', 'combat-attack'].includes(state.phase)) return conquestFailure(state, 'WRONG_PHASE', '当前不在攻击阶段。');
  if (command.enemyIds.some((id) => !state.encounter?.enemyIds.includes(id) || state.enemies[id]?.defeated)) return conquestFailure(state, 'INVALID_TARGET', '攻击目标不在当前遭遇中。');
  if (state.phase === 'combat-ranged') {
    const fortificationLevels = command.enemyIds.map((id) => {
      const enemy = definition(state, content, id);
      if (!enemy || enemy.abilities.includes('unfortified') || state.enemyModifiers[id]?.removeFortification || state.ruleRuntime.ignoreFortification) return 0;
      const position = state.enemies[id]?.position;
      const space = position ? state.map[coordKey(position)] : undefined;
      const baseFortified = Boolean(space?.siteId && content.sites[space.siteId]?.fortified) || enemy.abilities.includes('fortified');
      return Number(baseFortified) + Number(Boolean(state.encounter?.crossedWall));
    });
    if (fortificationLevels.some((level) => level >= 2)) return conquestFailure(state, 'INVALID_COMMAND', '目标具有双重工事，不能在远程阶段攻击。');
    if (fortificationLevels.some((level) => level === 1) && command.kind !== 'siege') return conquestFailure(state, 'INVALID_COMMAND', '该目标处于工事中，只能使用攻城攻击。');
  }
  const assignments = state.encounter.defendAssignments ?? (state.encounter.defendAssignments = {});
  const alreadyDefended = new Set(Object.values(assignments));
  const defenders = state.encounter.enemyIds.filter((id) => !state.enemies[id]?.defeated && definition(state, content, id)?.abilities.includes('defend') && !assignments[id]);
  for (const defenderId of defenders) {
    const targetId = command.enemyIds.find((id) => !alreadyDefended.has(id));
    if (!targetId) break;
    assignments[defenderId] = targetId;
    alreadyDefended.add(targetId);
  }
  const attack = effectiveAttack(state, content, command.enemyIds, command.kind);
  const required = command.enemyIds.reduce((sum, id) => sum + enemyArmor(state, content, id), 0);
  if (attack.value < required) return conquestFailure(state, 'INSUFFICIENT_RESOURCE', `有效攻击 ${attack.value}，需要 ${required}。`);
  state.player.resources = state.player.resources.filter((item) => !attack.usedIds.includes(item.id));
  for (const id of command.enemyIds) {
    const enemy = state.enemies[id];
    if (!enemy) continue;
    enemy.defeated = true;
    state.encounter.defeatedThisCombat.push(id);
    const space = state.map[coordKey(enemy.position)];
    if (space) space.enemyIds = space.enemyIds.filter((candidate) => candidate !== id);
  }
  appendEvent(state, events, 'AttackDeclared', `有效攻击 ${attack.value}，击败 ${command.enemyIds.length} 名敌人。`, { enemyIds: command.enemyIds, kind: command.kind, effective: attack.value, required });
  return undefined;
}

export function conquestDeclareLeaderAttack(state: ConquestState, content: ConquestContent, command: Extract<ConquestCommand, { type: 'DECLARE_LEADER_ATTACK' }>, events: ConquestState['eventLog']): ConquestResult | undefined {
  if (!state.encounter || state.encounter.leaderId !== command.leaderId || !['combat-ranged', 'combat-attack'].includes(state.phase)) return conquestFailure(state, 'WRONG_PHASE', '当前不能攻击该阵营首领。');
  if (state.encounter.leaderLevelsHit) return conquestFailure(state, 'INVALID_COMMAND', '本次战斗对首领的攻击已经结算。');
  const leader = state.factionLeaders[command.leaderId];
  const definition = content.factionLeaders[command.leaderId];
  const level = definition?.levels.find((candidate) => candidate.level === leader?.level);
  if (!leader || !definition || !level || leader.defeated) return conquestFailure(state, 'INVALID_TARGET', '阵营首领不存在或已被击败。');
  if (state.phase === 'combat-ranged') {
    const fortified = !level.abilities.includes('unfortified') && !state.ruleRuntime.ignoreFortification;
    if (fortified && command.kind !== 'siege') return conquestFailure(state, 'INVALID_COMMAND', '阵营首领位于工事地点，只能使用攻城攻击。');
  }
  const attack = effectiveAttack(state, content, [], command.kind, level.resistances);
  const levelsHit = Math.min(leader.level, Math.floor(attack.value / level.armor));
  if (levelsHit < 1) return conquestFailure(state, 'INSUFFICIENT_RESOURCE', `有效攻击 ${attack.value}，至少需要 ${level.armor}。`);
  state.player.resources = state.player.resources.filter((item) => !attack.usedIds.includes(item.id));
  state.encounter.leaderLevelsHit = levelsHit;
  appendEvent(state, events, 'FactionLeaderAttacked', `有效攻击 ${attack.value}，将使${definition.name}降低 ${levelsHit} 级。`, { leaderId: command.leaderId, effective: attack.value, armor: level.armor, levelsHit });
  return undefined;
}

function summonAttack(state: ConquestState, content: ConquestContent, ownerId: string): ConquestAttackState {
  const owner = definition(state, content, ownerId);
  const factionPool = owner?.factionId ? content.factionEnemyPools[owner.factionId].green ?? [] : [];
  const definitionId = factionPool[state.nextEntityId % Math.max(1, factionPool.length)] ?? state.enemyPools.green.shift() ?? Object.keys(content.enemies)[0] ?? '';
  if (definitionId && !owner?.factionId) state.enemyPools.green.push(definitionId);
  const summoned = content.enemies[definitionId];
  return { enemyId: ownerId, attackIndex: 1000, attack: summoned?.attack[0] ?? 3, element: summoned?.attackElement ?? 'physical', blocked: false, resolved: false, summoned: true };
}

function summonFactionAttack(state: ConquestState, content: ConquestContent, ownerId: string, factionId: 'elementalist' | 'dark-crusader'): ConquestAttackState {
  const factionPool = content.factionEnemyPools[factionId].green ?? [];
  const definitionId = factionPool[state.nextEntityId % Math.max(1, factionPool.length)] ?? '';
  const summoned = content.enemies[definitionId];
  return { enemyId: ownerId, attackIndex: 1000, attack: summoned?.attack[0] ?? 3, element: summoned?.attackElement ?? 'physical', blocked: false, resolved: false, summoned: true };
}

function enterBlock(state: ConquestState, content: ConquestContent, events: ConquestState['eventLog']): void {
  if (!state.encounter) return;
  state.encounter.phase = 'block';
  state.phase = 'combat-block';
  state.encounter.incoming = state.encounter.enemyIds.flatMap((enemyId) => {
    const enemy = definition(state, content, enemyId);
    if (!enemy || state.enemies[enemyId]?.defeated || state.enemyModifiers[enemyId]?.skipAttack) return [];
    const modifier = state.enemyModifiers[enemyId];
    const attackModifier = modifier?.attack ?? 0;
    const base = enemy.attack.map((attack, attackIndex) => ({ enemyId, attackIndex, attack: Math.max(0, attack + attackModifier + (modifier?.attackByIndex?.[attackIndex] ?? 0)), element: enemy.attackElements?.[attackIndex] ?? enemy.attackElement, blocked: false, resolved: false, summoned: false }));
    return enemy.abilities.includes('summon') ? [summonAttack(state, content, enemyId)] : base;
  });
  if (state.encounter.leaderId) {
    const leader = state.factionLeaders[state.encounter.leaderId];
    const leaderDefinition = content.factionLeaders[state.encounter.leaderId];
    const level = leaderDefinition?.levels.find((candidate) => candidate.level === leader?.level);
    if (leader && level && !(leader.level === 1 && (state.encounter.leaderLevelsHit ?? 0) > 0)) {
      state.encounter.incoming.push(...level.attacks.filter((attack) => attack > 0).map((attack, attackIndex) => ({ enemyId: `leader:${state.encounter!.leaderId}`, attackIndex, attack, element: level.attackElements[attackIndex] ?? 'physical', blocked: false, resolved: false, summoned: false })));
      if (level.abilities.includes('summon') && leaderDefinition) state.encounter.incoming.push(summonFactionAttack(state, content, `leader:${state.encounter.leaderId}`, leaderDefinition.factionId));
    }
  }
  appendEvent(state, events, 'CombatPhaseChanged', '进入格挡阶段；召唤攻击已确定。', { phase: 'block', attacks: state.encounter.incoming.length });
}

function blockEfficiency(block: AttackElement, attack: AttackElement): number {
  if (attack === 'physical') return 1;
  if (attack === 'fire') return block === 'ice' || block === 'cold-fire' ? 1 : 0.5;
  if (attack === 'ice') return block === 'fire' || block === 'cold-fire' ? 1 : 0.5;
  return block === 'cold-fire' ? 1 : 0.5;
}

function availableBlock(state: ConquestState, content: ConquestContent, attack: ConquestAttackState): { value: number; ids: string[] } {
  const blocks = state.player.resources.filter((item) => item.resource === 'block');
  const swift = attackAbilities(state, content, attack.enemyId).includes('swift');
  return { value: blocks.reduce((sum, block) => sum + Math.floor(block.amount * blockEfficiency(block.element, attack.element) * (swift && block.tags?.includes('double-against-swiftness') ? 2 : 1)), 0), ids: blocks.map((block) => block.id) };
}

function attackAbilities(state: ConquestState, content: ConquestContent, enemyId: string): EnemyAbility[] {
  if (enemyId.startsWith('leader:')) {
    const leaderId = enemyId.slice('leader:'.length);
    const leader = state.factionLeaders[leaderId];
    return content.factionLeaders[leaderId]?.levels.find((candidate) => candidate.level === leader?.level)?.abilities ?? [];
  }
  return definition(state, content, enemyId)?.abilities ?? [];
}

export function conquestDeclareBlock(state: ConquestState, content: ConquestContent, command: Extract<ConquestCommand, { type: 'DECLARE_BLOCK' }>, events: ConquestState['eventLog']): ConquestResult | undefined {
  if (!state.encounter || state.phase !== 'combat-block') return conquestFailure(state, 'WRONG_PHASE', '当前不在格挡阶段。');
  const attack = state.encounter.incoming.find((item) => item.enemyId === command.enemyId && item.attackIndex === command.attackIndex && !item.resolved);
  if (!attack) return conquestFailure(state, 'INVALID_TARGET', '该攻击已经处理或不存在。');
  const abilities = attackAbilities(state, content, command.enemyId);
  const required = attack.attack * (abilities.includes('swift') ? 2 : 1);
  const block = availableBlock(state, content, attack);
  if (block.value < required) return conquestFailure(state, 'INSUFFICIENT_RESOURCE', `有效格挡 ${block.value}，需要 ${required}。`);
  state.player.resources = state.player.resources.filter((item) => !block.ids.includes(item.id));
  attack.blocked = true;
  attack.resolved = true;
  if (state.encounter.incoming.filter((item) => item.enemyId === command.enemyId).every((item) => item.blocked)) state.encounter.fullyBlockedEnemyIds.push(command.enemyId);
  if (state.ruleRuntime.pendingBlockEffect === 'fire-attack') addResource(state, 'burning-shield', 'attack', 4, 'normal', 'fire');
  if (state.ruleRuntime.pendingBlockEffect === 'destroy') {
    const target = state.enemies[command.enemyId];
    if (target) {
      target.defeated = true;
      if (!state.encounter.defeatedThisCombat.includes(command.enemyId)) state.encounter.defeatedThisCombat.push(command.enemyId);
      const space = state.map[coordKey(target.position)];
      if (space) space.enemyIds = space.enemyIds.filter((id) => id !== command.enemyId);
    }
  }
  delete state.ruleRuntime.pendingBlockEffect;
  appendEvent(state, events, 'AttackBlocked', `以 ${block.value} 点有效格挡挡住攻击。`, { enemyId: command.enemyId, attackIndex: command.attackIndex, required, effective: block.value, element: attack.element });
  return undefined;
}

export function reduceCumbersome(state: ConquestState, content: ConquestContent, command: Extract<ConquestCommand, { type: 'REDUCE_CUMBERSOME' }>, events: ConquestState['eventLog']): ConquestResult | undefined {
  if (!state.encounter || state.phase !== 'combat-block') return conquestFailure(state, 'WRONG_PHASE', '只能在格挡阶段降低笨重攻击。');
  const abilities = attackAbilities(state, content, command.enemyId);
  const attack = state.encounter.incoming.find((item) => item.enemyId === command.enemyId && item.attackIndex === command.attackIndex && !item.resolved);
  if (!abilities.includes('cumbersome') || !attack) return conquestFailure(state, 'INVALID_TARGET', '该攻击没有 Cumbersome。');
  if (!spendResource(state, 'move', 1)) return conquestFailure(state, 'INSUFFICIENT_RESOURCE', '降低攻击需要 1 移动。');
  attack.attack = Math.max(0, attack.attack - 1);
  appendEvent(state, events, 'CumbersomeReduced', '支付 1 移动，使笨重攻击降低 1。', { enemyId: command.enemyId, attackIndex: command.attackIndex, attack: attack.attack });
  return undefined;
}

function addHeroWound(state: ConquestState): string {
  const id = addCardToZone(state, 'core.card.wound', 'discard');
  state.turnWoundIds.push(id);
  return id;
}

export function conquestAssignDamage(state: ConquestState, content: ConquestContent, command: Extract<ConquestCommand, { type: 'ASSIGN_DAMAGE' }>, events: ConquestState['eventLog']): ConquestResult | undefined {
  if (!state.encounter || state.phase !== 'combat-damage') return conquestFailure(state, 'WRONG_PHASE', '当前不在伤害分配阶段。');
  const attack = state.encounter.incoming.find((item) => item.enemyId === command.enemyId && item.attackIndex === command.attackIndex && !item.resolved);
  const enemy = definition(state, content, command.enemyId);
  const abilities = attackAbilities(state, content, command.enemyId);
  if (!attack || (!enemy && !command.enemyId.startsWith('leader:'))) return conquestFailure(state, 'INVALID_TARGET', '该攻击已经处理或不存在。');
  let damage = attack.attack * (abilities.includes('brutal') ? 2 : 1);
  let vampiricGain = 0;
  if (command.target === 'hero') {
    if (state.ruleRuntime.heroDamageReduction) {
      damage = Math.max(0, damage - (attack.element === 'physical' ? state.ruleRuntime.heroDamageReduction.physical : state.ruleRuntime.heroDamageReduction.elemental));
      delete state.ruleRuntime.heroDamageReduction;
    }
    if (damage === 0) {
      attack.resolved = true;
      appendEvent(state, events, 'DamagePrevented', '身经百战避免了这次伤害。', { target: 'hero' });
      return undefined;
    }
    let wounds = Math.max(1, Math.ceil(damage / state.player.armor));
    if (state.ruleRuntime.preventNextHeroWound && wounds > 0) { wounds -= 1; state.ruleRuntime.preventNextHeroWound = false; }
    for (let index = 0; index < wounds; index += 1) addHeroWound(state);
    if (abilities.includes('poison') && wounds > 0) addHeroWound(state);
    if (abilities.includes('paralyze')) {
      const nonWounds = state.player.zones.hand.filter((id) => state.player.cardInstances[id]?.definitionId !== 'core.card.wound');
      state.player.zones.hand = state.player.zones.hand.filter((id) => !nonWounds.includes(id));
      state.player.zones.discard.push(...nonWounds);
    }
    state.encounter.heroWoundsGained += wounds;
    vampiricGain = wounds;
    state.player.knockedOut = state.encounter.heroWoundsGained >= state.player.handLimit;
    appendEvent(state, events, 'DamageAssigned', `英雄承受 ${damage} 伤害并获得伤牌。`, { target: 'hero', wounds, poison: abilities.includes('poison'), paralyze: abilities.includes('paralyze') });
  } else {
    if (abilities.includes('assassination')) return conquestFailure(state, 'INVALID_TARGET', 'Assassination 攻击只能由英雄承受。');
    const unit = state.player.units.find((item) => item.id === command.target && !item.destroyed && item.wounds === 0);
    const unitDefinition = unit ? content.units[unit.definitionId] : undefined;
    if (!unit || !unitDefinition) return conquestFailure(state, 'INVALID_TARGET', '该单位不能承受伤害。');
    if (unitDefinition.id === 'lost-legion.unit.regular.thugs' && !spendResource(state, 'influence', 2)) return conquestFailure(state, 'INSUFFICIENT_RESOURCE', '暴徒承受伤害前需要支付 2 影响。');
    const resisted = unitDefinition.resistances.includes(attack.element);
    const attachment = unitAttachmentBonus(state, unit.id);
    const allResistant = state.ruleRuntime.allUnitsAllResistances || (attachment.fireIceResistance && (attack.element === 'fire' || attack.element === 'ice'));
    const effectiveResistance = resisted || allResistant;
    const armor = unitDefinition.armor + attachment.armor + state.ruleRuntime.allUnitsBonus + state.ruleRuntime.allUnitsArmorBonus;
    const wound = effectiveResistance ? damage > armor : damage >= armor;
    const fortitude = state.attachments.find((candidate) => candidate.unitId === unit.id && candidate.definitionId === 'lost-legion.card.artifact.banner-fortitude' && !candidate.used);
    if (wound && fortitude) {
      fortitude.used = true;
      unit.ready = false;
      attack.resolved = true;
      appendEvent(state, events, 'FortitudePreventedWound', `${unitDefinition.name}以坚毅旗帜避免受伤。`, { unitId: unit.id, attachmentId: fortitude.id, damage, armor });
      return undefined;
    }
    if (wound) {
      unit.wounds += abilities.includes('poison') ? 2 : 1;
      vampiricGain = 1;
    }
    unit.ready = false;
    if (abilities.includes('paralyze') || unit.wounds >= 2) unit.destroyed = true;
    if (unit.destroyed) detachUnitAttachments(state, unit.id);
    appendEvent(state, events, 'DamageAssigned', `${unitDefinition.name}承受 ${damage} 伤害。`, { target: unit.id, resisted: effectiveResistance, armor, wounds: unit.wounds, destroyed: unit.destroyed });
  }
  if (abilities.includes('vampiric') && vampiricGain > 0) {
    const gained = vampiricGain;
    if (!command.enemyId.startsWith('leader:')) {
      const modifier = state.enemyModifiers[command.enemyId] ?? { armor: 0, attack: 0, skipAttack: false, removeFortification: false, removeResistance: false, destroy: false, expires: 'end-combat' as const };
      modifier.armor += gained;
      state.enemyModifiers[command.enemyId] = modifier;
    }
  }
  attack.resolved = true;
  return undefined;
}

function rewardForSite(state: ConquestState, content: ConquestContent, siteId: string | undefined, events: ConquestState['eventLog']): void {
  if (!siteId) return;
  const site = content.sites[siteId];
  const space = state.map[coordKey(state.player.position)];
  if (!site || !space || space.enemyIds.length > 0) return;
  const newlyConquered = !space.conquered;
  space.conquered = true;
  const overlay = state.overlays[coordKey(state.player.position)];
  if (overlay && !overlay.liberated) {
    overlay.liberated = true;
    appendEvent(state, events, 'SiteOverlayLiberated', `解放${content.siteOverlays[overlay.definitionId]?.name ?? '覆盖地点'}。`, { overlayId: overlay.definitionId });
  }
  if ((site.kind === 'maze' || site.kind === 'labyrinth') && state.encounter?.adventureMove) {
    const amount = state.encounter.adventureMove;
    const key = coordKey(state.player.position);
    state.adventureClaims[key] = [...(state.adventureClaims[key] ?? []), amount];
    if (amount === 2) for (const color of state.encounter.adventureCrystalColors ?? [randomBasicColor(state), randomBasicColor(state)]) {
      state.player.crystals[color] = Math.min(3, state.player.crystals[color] + 1);
    }
    if (amount === 4) {
      const definitionId = state.market.spell.deck.shift() ?? state.market.spell.offer[0];
      if (definitionId) addCardToZone(state, definitionId, 'discard');
    }
    if (amount === 6) {
      const definitionId = state.market.artifact.deck.shift() ?? state.market.artifact.offer[0];
      if (definitionId) addCardToZone(state, definitionId, 'inventory');
    }
    appendEvent(state, events, 'AdventurePathCompleted', `完成${site.name}的 ${amount} 移动路径。`, { siteId, amount });
    return;
  }
  if (site.kind === 'city' && newlyConquered) state.scenario.citiesConquered += 1;
  if (site.kind === 'city' && newlyConquered && state.scenario.objectiveKind === 'relics') state.scenario.relicsFound += 1;
  if (site.reward === 'spell') {
    const definitionId = state.market.spell.deck.shift() ?? state.market.spell.offer[0];
    if (definitionId) addCardToZone(state, definitionId, 'discard');
  }
  if (site.reward === 'artifact') {
    const definitionId = state.market.artifact.deck.shift() ?? state.market.artifact.offer[0];
    if (definitionId) addCardToZone(state, definitionId, 'inventory');
  }
  if (site.kind === 'monastery' && space.burned) {
    const definitionId = state.market.artifact.deck.shift() ?? state.market.artifact.offer[0];
    if (definitionId) addCardToZone(state, definitionId, 'inventory');
  }
  appendEvent(state, events, 'SiteConquered', `征服${site.name}。`, { siteId, city: site.kind === 'city' });
}

function finishCombat(state: ConquestState, content: ConquestContent, events: ConquestState['eventLog']): void {
  if (!state.encounter) return;
  const defeated = state.encounter.enemyIds.filter((id) => state.enemies[id]?.defeated);
  state.defeatedThisTurn.push(...defeated.flatMap((id) => {
    const definitionId = state.enemies[id]?.definitionId;
    return definitionId ? [definitionId] : [];
  }));
  const remaining = state.encounter.enemyIds.filter((id) => !state.enemies[id]?.defeated);
  state.pendingFame += defeated.reduce((sum, id) => sum + (definition(state, content, id)?.fame ?? 0), 0);
  for (const id of defeated) {
    const factionId = definition(state, content, id)?.factionId;
    if (!factionId) continue;
    if (state.factionTokens.decks[factionId].length === 0 && state.factionTokens.discards[factionId].length > 0) {
      const shuffled = shuffleWithState(state.factionTokens.discards[factionId], state.rngState);
      state.factionTokens.decks[factionId] = shuffled.items;
      state.rngState = shuffled.state;
      state.factionTokens.discards[factionId] = [];
    }
    const tokenId = state.factionTokens.decks[factionId].shift();
    if (tokenId) state.factionTokens.inventory.push(tokenId);
  }
  state.player.fame += defeated.length * state.ruleRuntime.famePerDefeated;
  if (remaining.length > 0) {
    for (const id of remaining) if (state.enemies[id]?.pursuing || definition(state, content, id)?.abilities.includes('pursuit')) state.enemies[id]!.pursuitExhausted = true;
    state.player.position = { ...state.encounter.origin };
    addHeroWound(state);
    appendEvent(state, events, 'CombatLost', '未击败全部敌人，撤退并获得一张伤牌。', { remaining });
  } else {
    rewardForSite(state, content, state.encounter.siteId, events);
    appendEvent(state, events, 'CombatWon', '战斗胜利，名望将在回合结束时结算。', { defeated, fame: state.pendingFame });
  }
  if (state.encounter.leaderId && (state.encounter.leaderLevelsHit ?? 0) > 0) {
    const leader = state.factionLeaders[state.encounter.leaderId];
    const leaderDefinition = content.factionLeaders[state.encounter.leaderId];
    if (leader && leaderDefinition) {
      const fromLevel = leader.level;
      const hit = Math.min(fromLevel, state.encounter.leaderLevelsHit ?? 0);
      for (let level = fromLevel; level > fromLevel - hit; level -= 1) state.pendingFame += leaderDefinition.levels.find((candidate) => candidate.level === level)?.fame ?? 0;
      leader.level = Math.max(0, fromLevel - hit);
      if (leader.level === 0) {
        leader.defeated = true;
        state.scenario.leadersDefeated += 1;
      }
      const overlay = leader.position ? state.overlays[coordKey(leader.position)] : undefined;
      if (overlay && leader.defeated && leader.guardEnemyIds.every((id) => state.enemies[id]?.defeated)) overlay.liberated = true;
      appendEvent(state, events, 'FactionLeaderLevelChanged', leader.defeated ? `${leaderDefinition.name}已被击败。` : `${leaderDefinition.name}降至等级 ${leader.level}。`, { leaderId: leaderDefinition.id, fromLevel, toLevel: leader.level });
    }
  }
  if (state.ruleRuntime.discardCombatWounds) {
    let remainingDiscards = Math.min(4, defeated.length);
    for (const zone of ['hand', 'discard'] as const) while (remainingDiscards > 0) {
      const woundId = state.player.zones[zone].find((id) => state.player.cardInstances[id]?.definitionId === 'core.card.wound');
      if (!woundId) break;
      state.player.zones[zone] = state.player.zones[zone].filter((id) => id !== woundId);
      state.player.zones.removed.push(woundId);
      remainingDiscards -= 1;
    }
    state.ruleRuntime.discardCombatWounds = false;
  }
  if (state.volkare && state.volkare.armyEnemyIds.length > 0 && state.volkare.armyEnemyIds.every((id) => state.enemies[id]?.defeated)) state.volkare.defeated = true;
  delete state.encounter;
  state.enemyModifiers = Object.fromEntries(Object.entries(state.enemyModifiers).filter(([, modifier]) => modifier.expires !== 'end-combat'));
  state.phase = 'action';
  state.actionTaken = true;
  delete state.ruleRuntime.pendingBlockEffect;
  delete state.ruleRuntime.convertAttacks;
  state.ruleRuntime.ignoreFortification = false;
  state.ruleRuntime.famePerDefeated = 0;
}

export function advanceConquestCombat(state: ConquestState, content: ConquestContent, events: ConquestState['eventLog']): ConquestResult | undefined {
  if (!state.encounter) return conquestFailure(state, 'WRONG_PHASE', '当前没有战斗。');
  if (state.phase === 'combat-ranged') { enterBlock(state, content, events); return undefined; }
  if (state.phase === 'combat-block') {
    state.encounter.phase = 'damage'; state.phase = 'combat-damage';
    for (const attack of state.encounter.incoming) if (state.enemies[attack.enemyId]?.defeated || attack.blocked) attack.resolved = true;
    appendEvent(state, events, 'CombatPhaseChanged', '进入伤害分配阶段。', { phase: 'damage' });
    return undefined;
  }
  if (state.phase === 'combat-damage') {
    if (state.encounter.incoming.some((attack) => !attack.resolved)) return conquestFailure(state, 'INVALID_COMMAND', '仍有未处理攻击。');
    state.encounter.phase = 'attack'; state.phase = 'combat-attack';
    appendEvent(state, events, 'CombatPhaseChanged', '进入普通攻击阶段。', { phase: 'attack' });
    return undefined;
  }
  if (state.phase === 'combat-attack') { finishCombat(state, content, events); return undefined; }
  return conquestFailure(state, 'WRONG_PHASE', '当前不能推进战斗。');
}

export function activateConquestUnit(state: ConquestState, content: ConquestContent, command: Extract<ConquestCommand, { type: 'ACTIVATE_UNIT' }>, events: ConquestState['eventLog']): ConquestResult | undefined {
  const abilityIndex = command.abilityIndex ?? 0;
  const unit = state.player.units.find((item) => item.id === command.unitId && item.wounds === 0 && !item.destroyed
    && (item.ready || (item.definitionId === 'lost-legion.unit.elite.delphana-masters' && !item.usedAbilityIndexes?.includes(abilityIndex))));
  const definition = unit ? content.units[unit.definitionId] : undefined;
  if (!unit || !definition) return conquestFailure(state, 'INVALID_TARGET', '该单位不可用。');
  const abilities = definition.abilities ?? [{ label: definition.name, text: '', effect: definition.ability }];
  const ability = abilities[abilityIndex];
  if (!ability) return conquestFailure(state, 'INVALID_TARGET', '该单位没有这个能力。');
  if (definition.id === 'lost-legion.unit.elite.heroes' && state.encounter) {
    const siteFortified = state.encounter.siteId ? content.sites[state.encounter.siteId]?.fortified : false;
    if ((siteFortified || state.encounter.crossedWall) && !spendResource(state, 'influence', 2)) return conquestFailure(state, 'INSUFFICIENT_RESOURCE', '英雄团参与工事突袭需要支付 2 影响。');
  }
  const failed = applyConquestEffect(state, content, unit.id, ability.effect, command, events);
  if (failed) return failed;
  unit.ready = false;
  if (definition.id === 'lost-legion.unit.elite.delphana-masters') unit.usedAbilityIndexes = [...(unit.usedAbilityIndexes ?? []), abilityIndex];
  const bonus = unitAttachmentBonus(state, unit.id);
  for (const resource of state.player.resources.filter((candidate) => candidate.sourceId === unit.id && (candidate.resource === 'attack' || candidate.resource === 'block'))) resource.amount += bonus.resource + state.ruleRuntime.allUnitsBonus;
  if (state.player.resources.some((candidate) => candidate.sourceId === unit.id && (candidate.resource === 'attack' || candidate.resource === 'block'))) state.player.fame += bonus.gloryFame + (state.ruleRuntime.allUnitsBonus > 0 ? 1 : 0);
  appendEvent(state, events, 'UnitActivated', `激活${definition.name}：${ability.label}。`, { unitId: command.unitId, abilityIndex, choiceIndex: command.choiceIndex, targetId: command.targetId });
  return undefined;
}
