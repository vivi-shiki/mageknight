import type { EnemyDefinition } from '@mageknight/content';
import { contributionFromEffect, legalResourcesForPhase } from './cards';
import { coordKey } from './hex';
import { appendEvent, failure, nextId, resourceLabel } from './state-operations';
import type { AttackKind, DomainEvent, EncounterState, ExecutionFailure, GameCommand, GameState, ResourceContribution, TutorialContent } from './types';

function enemyDefinition(state: GameState, content: TutorialContent, enemyId: string): EnemyDefinition | undefined {
  const enemy = state.enemies[enemyId];
  return enemy ? content.enemies[enemy.definitionId] : undefined;
}

export function startEncounter(state: GameState, enemyIds: string[], events: DomainEvent[]): ExecutionFailure | undefined {
  const enemies = enemyIds.map((id) => state.enemies[id]);
  if (enemies.length === 0 || enemies.some((enemy) => !enemy || enemy.defeated)) {
    return failure(state, 'ENEMY_NOT_AVAILABLE', '所选敌人不可用于战斗。');
  }
  const encounter: EncounterState = {
    enemyIds: [...enemyIds],
    origin: { ...state.player.position },
    phase: 'ranged',
    incoming: [],
    defeatedThisCombat: [],
    heroWoundsGained: 0,
  };
  state.encounter = encounter;
  state.phase = 'combat-ranged';
  appendEvent(state, events, 'CombatStarted', `与 ${enemyIds.length} 名敌人开始战斗。`, { enemyIds });
  return undefined;
}

function attackContributions(state: GameState, kind: AttackKind): ResourceContribution[] {
  const attacks = state.player.resources.filter((candidate) => candidate.resource === 'attack');
  if (state.phase === 'combat-attack') return attacks;
  if (kind === 'siege') return attacks.filter((candidate) => candidate.attackKind === 'siege');
  if (kind === 'ranged') return attacks.filter((candidate) => candidate.attackKind === 'ranged' || candidate.attackKind === 'siege');
  return [];
}

function effectiveAttack(contributions: ResourceContribution[], targets: EnemyDefinition[]): number {
  let full = 0;
  let resistedTotal = 0;
  for (const contribution of contributions) {
    if (targets.some((target) => target.resistances.includes(contribution.element))) resistedTotal += contribution.amount;
    else full += contribution.amount;
  }
  return full + Math.floor(resistedTotal / 2);
}

function consumeContributions(state: GameState, contributions: ResourceContribution[]): void {
  const ids = new Set(contributions.map((contribution) => contribution.id));
  state.player.resources = state.player.resources.filter((contribution) => !ids.has(contribution.id));
}

export function declareAttack(state: GameState, command: Extract<GameCommand, { type: 'DECLARE_ATTACK' }>, content: TutorialContent, events: DomainEvent[]): ExecutionFailure | undefined {
  if (!state.encounter || !['combat-ranged', 'combat-attack'].includes(state.phase)) return failure(state, 'WRONG_PHASE', '当前不在攻击阶段。');
  const targets = command.enemyIds
    .filter((id) => state.encounter?.enemyIds.includes(id) && !state.enemies[id]?.defeated)
    .map((id) => enemyDefinition(state, content, id));
  if (targets.length !== command.enemyIds.length || targets.some((target) => !target)) return failure(state, 'INVALID_TARGET', '攻击目标不在当前遭遇中。');
  const definitions = targets as EnemyDefinition[];
  if (state.phase === 'combat-ranged' && command.kind !== 'siege' && definitions.some((target) => target.abilities.includes('fortified'))) {
    return failure(state, 'ATTACK_NOT_EFFECTIVE', '工事中的敌人在此阶段只能被攻城攻击命中。');
  }
  const contributions = attackContributions(state, command.kind);
  const effective = effectiveAttack(contributions, definitions);
  const required = definitions.reduce((sum, target) => sum + target.armor, 0);
  if (effective < required) return failure(state, 'INSUFFICIENT_RESOURCE', `有效攻击 ${effective}，需要 ${required}。`);
  consumeContributions(state, contributions);
  for (const enemyId of command.enemyIds) {
    const enemy = state.enemies[enemyId];
    if (!enemy) continue;
    enemy.defeated = true;
    const space = state.map[coordKey(enemy.position)];
    if (space) space.enemyIds = space.enemyIds.filter((id) => id !== enemyId);
    state.encounter.defeatedThisCombat.push(enemyId);
  }
  appendEvent(state, events, 'AttackDeclared', `有效攻击 ${effective}，击败 ${command.enemyIds.length} 名敌人。`, { enemyIds: command.enemyIds, kind: command.kind, effective, required });
  return undefined;
}

function blockValue(state: GameState, enemy: EnemyDefinition): number {
  return state.player.resources.filter((candidate) => candidate.resource === 'block').reduce((sum, contribution) => {
    if (enemy.attackElement === 'physical') return sum + contribution.amount;
    const opposite = enemy.attackElement === 'fire' ? 'ice' : 'fire';
    return sum + (contribution.element === opposite ? contribution.amount : Math.floor(contribution.amount / 2));
  }, 0);
}

function enterBlockPhase(state: GameState, content: TutorialContent, events: DomainEvent[]): void {
  if (!state.encounter) return;
  state.encounter.phase = 'block';
  state.phase = 'combat-block';
  state.encounter.incoming = state.encounter.enemyIds.flatMap((enemyId) => {
    const enemyState = state.enemies[enemyId];
    const definition = enemyDefinition(state, content, enemyId);
    if (!enemyState || enemyState.defeated || !definition) return [];
    return definition.attack.map((_, attackIndex) => ({ enemyId, attackIndex, blocked: false, resolved: false }));
  });
  appendEvent(state, events, 'CombatPhaseChanged', '进入格挡阶段。', { phase: 'block' });
}

export function declareBlock(state: GameState, command: Extract<GameCommand, { type: 'DECLARE_BLOCK' }>, content: TutorialContent, events: DomainEvent[]): ExecutionFailure | undefined {
  if (!state.encounter || state.phase !== 'combat-block') return failure(state, 'WRONG_PHASE', '当前不在格挡阶段。');
  const attack = state.encounter.incoming.find((candidate) => candidate.enemyId === command.enemyId && candidate.attackIndex === command.attackIndex);
  if (!attack || attack.blocked) return failure(state, 'ATTACK_ALREADY_RESOLVED', '该次攻击已处理或不存在。');
  const enemy = enemyDefinition(state, content, command.enemyId);
  if (!enemy) return failure(state, 'INVALID_TARGET', '找不到敌人。');
  const baseAttack = enemy.attack[command.attackIndex];
  if (baseAttack === undefined) return failure(state, 'INVALID_TARGET', '找不到该段攻击。');
  const required = baseAttack * (enemy.abilities.includes('swift') ? 2 : 1);
  const available = blockValue(state, enemy);
  if (available < required) return failure(state, 'INSUFFICIENT_RESOURCE', `有效格挡 ${available}，需要 ${required}。`);
  consumeContributions(state, state.player.resources.filter((candidate) => candidate.resource === 'block'));
  attack.blocked = true;
  attack.resolved = true;
  appendEvent(state, events, 'AttackBlocked', `以 ${available} 点有效格挡挡住攻击。`, { enemyId: command.enemyId, attackIndex: command.attackIndex, required, available });
  return undefined;
}

function addWound(state: GameState, zone: 'hand' | 'discard', events: DomainEvent[]): void {
  const wound = { id: nextId(state, 'wound'), definitionId: 'core.card.wound' };
  state.player[zone].push(wound);
  appendEvent(state, events, 'WoundGained', `获得一张伤牌，进入${zone === 'hand' ? '手牌' : '弃牌堆'}。`, { cardId: wound.id, zone });
}

export function assignDamage(state: GameState, command: Extract<GameCommand, { type: 'ASSIGN_DAMAGE' }>, content: TutorialContent, events: DomainEvent[]): ExecutionFailure | undefined {
  if (!state.encounter || state.phase !== 'combat-damage') return failure(state, 'WRONG_PHASE', '当前不在伤害分配阶段。');
  const attack = state.encounter.incoming.find((candidate) => candidate.enemyId === command.enemyId && candidate.attackIndex === command.attackIndex);
  if (!attack || attack.resolved || attack.blocked) return failure(state, 'ATTACK_ALREADY_RESOLVED', '该次攻击已处理或不存在。');
  const enemy = enemyDefinition(state, content, command.enemyId);
  if (!enemy) return failure(state, 'INVALID_TARGET', '找不到敌人。');
  const baseAttack = enemy.attack[command.attackIndex];
  if (baseAttack === undefined) return failure(state, 'INVALID_TARGET', '找不到该段攻击。');
  const damage = baseAttack * (enemy.abilities.includes('brutal') ? 2 : 1);
  if (command.target === 'hero') {
    const wounds = Math.max(1, Math.ceil(damage / state.player.armor));
    for (let index = 0; index < wounds; index += 1) addWound(state, 'hand', events);
    state.encounter.heroWoundsGained += wounds;
    if (state.encounter.heroWoundsGained >= state.player.handLimit) {
      state.player.knockedOut = true;
      appendEvent(state, events, 'HeroKnockedOut', '本次战斗获得的伤牌达到手牌上限，英雄被击倒。', { wounds: state.encounter.heroWoundsGained });
    }
    if (enemy.abilities.includes('poison')) addWound(state, 'discard', events);
    appendEvent(state, events, 'DamageAssigned', `${damage} 点伤害由英雄承受，共获得 ${wounds} 张手牌伤牌。`, { target: 'hero', damage, wounds });
  } else {
    const unit = state.player.units.find((candidate) => candidate.id === command.target);
    if (!unit || unit.wounded) return failure(state, 'UNIT_NOT_AVAILABLE', '该单位不能承受伤害。');
    unit.wounded = true;
    unit.ready = false;
    appendEvent(state, events, 'DamageAssigned', `${damage} 点伤害由单位承受，单位受伤。`, { target: unit.id, damage });
  }
  attack.resolved = true;
  return undefined;
}

function resolveCombat(state: GameState, content: TutorialContent, events: DomainEvent[]): void {
  if (!state.encounter) return;
  const defeatedIds = state.encounter.enemyIds.filter((id) => state.enemies[id]?.defeated);
  const remainingIds = state.encounter.enemyIds.filter((id) => !state.enemies[id]?.defeated);
  const fame = defeatedIds.reduce((sum, id) => sum + (enemyDefinition(state, content, id)?.fame ?? 0), 0);
  state.pendingRewards.fame += fame;
  state.scenario.enemiesDefeated += defeatedIds.length;
  if (remainingIds.length > 0) {
    state.player.position = { ...state.encounter.origin };
    addWound(state, 'hand', events);
    appendEvent(state, events, 'CombatLost', '未能击败全部敌人，撤回战斗前位置并获得一张伤牌。', { remainingIds });
  } else appendEvent(state, events, 'CombatWon', `战斗胜利，回合结束时获得 ${fame} 名望。`, { fame, defeatedIds });
  delete state.encounter;
  state.phase = 'action';
  state.actionTaken = true;
}

export function advanceCombat(state: GameState, content: TutorialContent, events: DomainEvent[]): ExecutionFailure | undefined {
  if (!state.encounter) return failure(state, 'WRONG_PHASE', '当前没有战斗。');
  if (state.phase === 'combat-ranged') { enterBlockPhase(state, content, events); return undefined; }
  if (state.phase === 'combat-block') {
    state.encounter.phase = 'damage';
    state.phase = 'combat-damage';
    for (const attack of state.encounter.incoming) if (state.enemies[attack.enemyId]?.defeated || attack.blocked) attack.resolved = true;
    appendEvent(state, events, 'CombatPhaseChanged', '进入伤害分配阶段。', { phase: 'damage' });
    return undefined;
  }
  if (state.phase === 'combat-damage') {
    if (state.encounter.incoming.some((attack) => !attack.resolved)) return failure(state, 'INVALID_COMMAND', '仍有未处理的伤害。');
    state.encounter.phase = 'attack';
    state.phase = 'combat-attack';
    appendEvent(state, events, 'CombatPhaseChanged', '进入普通攻击阶段。', { phase: 'attack' });
    return undefined;
  }
  if (state.phase === 'combat-attack') { resolveCombat(state, content, events); return undefined; }
  return failure(state, 'WRONG_PHASE', '当前不能推进战斗。');
}

export function activateUnit(state: GameState, content: TutorialContent, events: DomainEvent[]): ExecutionFailure | undefined {
  const unit = state.player.units.find((candidate) => candidate.ready && !candidate.wounded);
  if (!unit) return failure(state, 'UNIT_NOT_AVAILABLE', '没有可用单位。');
  const definition = content.units[unit.definitionId];
  if (!definition || !legalResourcesForPhase(state.phase).includes(definition.ability.resource)) return failure(state, 'UNIT_NOT_AVAILABLE', '该单位能力不能在当前阶段使用。');
  unit.ready = false;
  state.player.resources.push(contributionFromEffect(state, unit.id, definition.ability));
  appendEvent(state, events, 'UnitActivated', `${definition.name}产生 ${definition.ability.amount} 点${resourceLabel(definition.ability.resource)}。`, { unitId: unit.id });
  return undefined;
}
