import type { BasicManaColor, ConquestContent, EffectNode, EffectTarget, ManaColor, ResourceType } from '@mageknight/content';
import { evaluateEffect } from '../effect-dsl';
import { terrainCost } from '../hex';
import { moveEntity } from './zones';
import { addResource, appendEvent, commandCapacity, conquestFailure, conquestNextId, detachUnitAttachments, drawCards, randomBasicColor, randomManaColor, spendResource } from './state';
import type { ConquestCommand, ConquestPhase, ConquestResult, ConquestState } from './types';

type RuleResolutionOptions = {
  choiceIndex?: number;
  targetId?: string;
  targetIds?: string[];
  amount?: number;
  manaColors?: BasicManaColor[];
  secondaryIndex?: number;
  secondaryTargetId?: string;
};

export const SUPPORTED_SPECIAL_RULES = new Set([
  'combat-move-to-attack', 'combat-move-to-ranged-attack', 'refreshing-walk-basic', 'refreshing-walk-strong',
  'pay-blue-for-free-lakes', 'choose-one-mana', 'choose-two-mana', 'choose-mana-colors-and-optional-crystal',
  'recruit-reputation-bonus', 'recruit-fame-reputation-bonus', 'forest-heal-bonus', 'forest-heal-ready-bonus',
  'plus-two-per-enemy', 'space-bending-movement', 'time-bending-extra-turn', 'return-random-discard-cards',
  'return-chosen-discard-cards', 'wings-of-wind-movement', 'additional-skip-targets-for-move', 'skip-up-to-three-enemies',
  'double-armor-reduction-if-fortified', 'successful-block-fire-attack', 'successful-block-destroy',
  'use-unit-offer-ability', 'recruit-unit-free', 'underground-travel', 'underground-assault',
  'assign-banner-of-glory', 'all-units-glory-bonus', 'assign-banner-of-fear', 'assign-banner-of-protection', 'assign-banner-of-courage',
  'remove-turn-wounds', 'ready-all-units', 'endless-red-black-mana', 'endless-blue-black-mana',
  'endless-white-black-mana', 'endless-green-black-mana', 'discard-cards-for-attack', 'double-physical-attacks',
  'risk-wound-die', 'risk-wound-dice', 'roll-two-crystals', 'fame-per-heal-spent',
  'draw-per-hand-wound-healed', 'exchange-action-for-advanced', 'exchange-action-for-spell',
  'sun-amulet-night-rules', 'darkness-amulet-day-rules', 'double-against-swiftness',
  'wound-activating-unit', 'all-units-all-resistances', 'convert-all-attacks', 'night-only',
  'ignore-walls-this-turn', 'assign-banner-command', 'assign-banner-fortitude', 'all-units-fortitude-bonus',
  'krang-ruthless-coercion-basic', 'krang-ruthless-coercion-strong', 'krang-savage-harvesting-once', 'krang-savage-harvesting-each',
  'krang-curse', 'krang-arcane-disguise', 'krang-puppet-master', 'krang-battle-hardened', 'krang-regenerate',
  'krang-shamanic-ritual', 'krang-master-of-chaos', 'krang-spirit-guides', 'krang-battle-frenzy',
  'tezla-druidic-paths-basic', 'tezla-one-with-the-land', 'tezla-lightning-storm', 'tezla-elemental-resistance',
  'tezla-thunderstorm', 'tezla-shapeshift', 'tezla-beguile', 'tezla-secret-ways', 'tezla-regenerate',
]);

export function legalResources(phase: ConquestPhase): ResourceType[] {
  if (phase === 'movement') return ['move', 'heal'];
  if (phase === 'interaction') return ['influence', 'heal'];
  if (phase === 'combat-ranged' || phase === 'combat-attack') return ['attack'];
  if (phase === 'combat-block') return ['block', 'move'];
  return [];
}

function rulesTime(state: ConquestState): 'day' | 'night' {
  const overlay = state.overlays[`${state.player.position.q},${state.player.position.r}`];
  return overlay && (overlay.definitionId === 'tezla.overlay.graveyard' || overlay.definitionId === 'tezla.overlay.necropolis')
    ? 'night'
    : state.time;
}

function manaDice(state: ConquestState, color: BasicManaColor, black: boolean): string[] | undefined {
  const time = rulesTime(state);
  if (state.ruleRuntime.endlessMana.includes(color) && (!black || state.ruleRuntime.endlessMana.includes('black'))) return [];
  const colorDie = state.source.find((die) => !die.used && (die.color === color || (die.color === 'gold' && (time === 'day' || state.ruleRuntime.goldAtNight))));
  if (!colorDie) return undefined;
  if (!black) return [colorDie.id];
  if (time !== 'night' && !state.ruleRuntime.blackAtDay) return undefined;
  const blackDie = state.source.find((die) => !die.used && die.color === 'black' && die.id !== colorDie.id);
  return blackDie ? [colorDie.id, blackDie.id] : undefined;
}

export function spendMana(state: ConquestState, color: ManaColor, amount: number): boolean {
  const time = rulesTime(state);
  if (state.ruleRuntime.endlessMana.includes(color)) return true;
  let remaining = amount;
  const accepted = (candidate: ManaColor) => candidate === color
    || (candidate === 'gold' && (time === 'day' || state.ruleRuntime.goldAtNight) && color !== 'black')
    || (candidate === 'black' && state.ruleRuntime.blackAtDay && time === 'day' && color === 'black');
  for (const die of state.source) {
    if (remaining === 0) break;
    if (!die.used && accepted(die.color)) { die.used = true; remaining -= 1; }
  }
  for (const candidate of [color, ...(time === 'day' && color !== 'black' ? ['gold' as const] : [])]) {
    const used = Math.min(remaining, state.player.manaTokens[candidate]);
    state.player.manaTokens[candidate] -= used;
    remaining -= used;
  }
  if (remaining > 0 && ['red', 'blue', 'white', 'green'].includes(color)) {
    const basic = color as BasicManaColor;
    const used = Math.min(remaining, state.player.crystals[basic]);
    state.player.crystals[basic] -= used;
    remaining -= used;
  }
  return remaining === 0;
}

function addWoundsToHand(state: ConquestState, amount: number): void {
  for (let index = 0; index < amount; index += 1) {
    const id = conquestNextId(state, 'card');
    state.player.cardInstances[id] = { id, definitionId: 'core.card.wound' };
    state.player.zones.hand.push(id);
    state.turnWoundIds.push(id);
  }
}

function targetCandidates(state: ConquestState, target: EffectTarget, sourceId?: string): string[] {
  if (target === 'enemy') return state.encounter?.enemyIds.filter((id) => !state.enemies[id]?.defeated) ?? [];
  if (target === 'unit') return state.player.units.filter((unit) => !unit.destroyed).map((unit) => unit.id);
  return [...state.player.zones.hand, ...state.player.zones.discard].filter((id) => id !== sourceId && state.player.cardInstances[id]?.definitionId !== 'core.card.wound');
}

export function effectTargets(state: ConquestState, node: EffectNode, choiceIndex?: number, sourceId?: string): { kind?: EffectTarget; ids: string[] } {
  const evaluation = evaluateEffect(node, { time: rulesTime(state), ...(choiceIndex === undefined ? {} : { choiceIndex }) });
  return evaluation.targetRequired ? { kind: evaluation.targetRequired, ids: targetCandidates(state, evaluation.targetRequired, sourceId) } : { ids: [] };
}

function applySpecialRule(state: ConquestState, content: ConquestContent, sourceId: string, rule: string, options: RuleResolutionOptions, events: ConquestState['eventLog']): ConquestResult | undefined {
  if (!SUPPORTED_SPECIAL_RULES.has(rule)) return conquestFailure(state, 'INVALID_COMMAND', `未实现的规则操作：${rule}。`);
  const targetId = options.targetId;
  const targetIds = options.targetIds ?? (targetId ? [targetId] : []);
  const sourceSkill = state.player.skills.find((skill) => skill.definitionId === sourceId);
  if (rule === 'tezla-druidic-paths-basic') {
    const terrain = state.map[`${state.player.position.q},${state.player.position.r}`]?.terrain;
    if (terrain) state.lastingEffects.push({ id: conquestNextId(state, 'effect'), kind: 'terrain', amount: 1, expires: 'end-turn', terrains: [terrain], mode: 'reduce', minimum: 2 });
  }
  if (rule === 'tezla-one-with-the-land') {
    if (state.phase !== 'combat-block') return conquestFailure(state, 'WRONG_PHASE', '地形格挡只能在格挡阶段使用。');
    const terrain = state.map[`${state.player.position.q},${state.player.position.r}`]?.terrain ?? 'plains';
    const time = rulesTime(state);
    addResource(state, sourceId, 'block', terrainCost(terrain, time), 'normal', time === 'day' ? 'fire' : 'ice');
  }
  if (rule === 'tezla-lightning-storm' || rule === 'tezla-thunderstorm') {
    const colors = options.manaColors ?? [];
    const legal = rule === 'tezla-lightning-storm'
      ? colors.length === 2 && ['blue', 'green'].includes(colors[0] ?? '') && ['blue', 'red'].includes(colors[1] ?? '')
      : colors.length === 2 && ['green', 'blue'].includes(colors[0] ?? '') && ['green', 'white'].includes(colors[1] ?? '');
    if (!legal) return conquestFailure(state, 'INVALID_COMMAND', '必须按技能允许的颜色选择两枚法力。');
    for (const color of colors) state.player.manaTokens[color] += 1;
    if (sourceSkill) sourceSkill.flipped = true;
  }
  if (rule === 'tezla-elemental-resistance') state.ruleRuntime.heroDamageReduction = { physical: 1, elemental: 2 };
  if (rule === 'tezla-shapeshift') {
    const resources = ['move', 'attack', 'block'] as const;
    const selected = resources[options.choiceIndex ?? -1];
    if (!selected) return conquestFailure(state, 'DECISION_REQUIRED', '变形必须选择移动、攻击或格挡。');
    state.ruleRuntime.shapeshiftResource = selected;
  }
  if (rule === 'tezla-beguile') {
    const space = state.map[`${state.player.position.q},${state.player.position.r}`];
    const site = space?.siteId ? content.sites[space.siteId] : undefined;
    const overlay = state.overlays[`${state.player.position.q},${state.player.position.r}`];
    const magicalGlade = site?.kind === 'magical-glade' || overlay?.definitionId === 'tezla.overlay.hidden-valley';
    addResource(state, sourceId, 'influence', magicalGlade ? 4 : site?.fortified ? 2 : 3);
  }
  if (rule === 'tezla-secret-ways') {
    if (state.phase !== 'movement') return conquestFailure(state, 'WRONG_PHASE', '隐秘之路只能在移动阶段使用。');
    addResource(state, sourceId, 'move', 1);
    state.lastingEffects.push({ id: conquestNextId(state, 'effect'), kind: 'terrain', amount: 5, expires: 'end-turn', terrains: ['mountain'], mode: 'set' });
    if (options.manaColors?.includes('blue')) {
      if (!spendMana(state, 'blue', 1)) return conquestFailure(state, 'MANA_UNAVAILABLE', '进入湖泊需要蓝色法力。');
      state.lastingEffects.push({ id: conquestNextId(state, 'effect'), kind: 'terrain', amount: 2, expires: 'end-turn', terrains: ['lake'], mode: 'set', allowLake: true });
    }
  }
  if (rule === 'tezla-regenerate') {
    if (!targetId || !state.player.zones.hand.includes(targetId) || state.player.cardInstances[targetId]?.definitionId !== 'core.card.wound') return conquestFailure(state, 'INVALID_TARGET', '再生必须选择一张手牌伤牌。');
    const color = options.manaColors?.[0];
    if (!color || !spendMana(state, color, 1)) return conquestFailure(state, 'MANA_UNAVAILABLE', '再生需要支付一枚法力。');
    moveEntity(state.player.zones, targetId, 'hand', 'removed');
    if (color === 'green') drawCards(state, 1);
  }
  if (rule === 'krang-ruthless-coercion-basic') {
    state.ruleRuntime.recruitDiscount = 2;
    state.ruleRuntime.recruitReputationPenalty = 1;
  }
  if (rule === 'krang-ruthless-coercion-strong') state.ruleRuntime.ruthlessReadyUnits = true;
  if (rule === 'krang-savage-harvesting-once') state.ruleRuntime.savageHarvesting = 'once';
  if (rule === 'krang-savage-harvesting-each') state.ruleRuntime.savageHarvesting = 'each';
  if (rule === 'krang-curse') {
    if (!targetId || !state.encounter?.enemyIds.includes(targetId)) return conquestFailure(state, 'INVALID_TARGET', '诅咒必须选择当前战斗中的敌人。');
    const enemy = state.enemies[targetId];
    const definition = enemy ? content.enemies[enemy.definitionId] : undefined;
    const fortified = definition?.abilities.includes('fortified') || Boolean(enemy && state.map[`${enemy.position.q},${enemy.position.r}`]?.siteId && content.sites[state.map[`${enemy.position.q},${enemy.position.r}`]!.siteId!]?.fortified);
    if (state.phase === 'combat-ranged' && fortified) return conquestFailure(state, 'INVALID_TARGET', '远程阶段不能诅咒工事敌人。');
    const current = state.enemyModifiers[targetId] ?? { armor: 0, attack: 0, skipAttack: false, removeFortification: false, removeResistance: false, destroy: false, expires: 'end-combat' as const };
    if (options.choiceIndex === 1) current.armor = Math.max(1 - (definition?.armor ?? 1), current.armor - 1);
    else {
      const attackIndex = Math.max(0, Math.min((definition?.attack.length ?? 1) - 1, options.amount ?? 0));
      current.attackByIndex = { ...(current.attackByIndex ?? {}), [attackIndex]: (current.attackByIndex?.[attackIndex] ?? 0) - 1 };
    }
    state.enemyModifiers[targetId] = current;
  }
  if (rule === 'krang-arcane-disguise') {
    if (!sourceSkill) return conquestFailure(state, 'INVALID_TARGET', '找不到奥术伪装技能。');
    sourceSkill.flipped = true;
    state.ruleRuntime.ignoreReputation = true;
  }
  if (rule === 'krang-puppet-master') {
    if (!sourceSkill) return conquestFailure(state, 'INVALID_TARGET', '找不到傀儡大师技能。');
    const stored = sourceSkill.storedEnemyDefinitionIds ?? [];
    if (options.choiceIndex === 0) {
      if (!targetId || !state.defeatedThisTurn.includes(targetId)) return conquestFailure(state, 'INVALID_TARGET', '只能保留本回合击败的敌人。');
      sourceSkill.storedEnemyDefinitionIds = [...stored, targetId];
    } else {
      if (!targetId || !stored.includes(targetId)) return conquestFailure(state, 'INVALID_TARGET', '没有保留这个敌人。');
      const enemy = content.enemies[targetId];
      if (!enemy) return conquestFailure(state, 'INVALID_TARGET', '保留的敌人定义不存在。');
      const resource = options.choiceIndex === 2 ? 'block' : 'attack';
      if (!legalResources(state.phase).includes(resource)) return conquestFailure(state, 'WRONG_PHASE', `当前阶段不能释放${resource === 'block' ? '格挡' : '攻击'}。`);
      sourceSkill.storedEnemyDefinitionIds = stored.filter((id, index) => id !== targetId || index !== stored.indexOf(targetId));
      if (options.choiceIndex === 2) {
        const element = enemy.resistances.includes('fire') ? 'ice' : enemy.resistances.includes('ice') ? 'fire' : 'physical';
        addResource(state, sourceId, 'block', Math.ceil(enemy.armor / 2), 'normal', element);
      } else {
        for (const attack of enemy.attack) addResource(state, sourceId, 'attack', Math.ceil(attack / 2), 'normal', enemy.attackElement === 'cold-fire' ? 'fire' : enemy.attackElement);
      }
    }
  }
  if (rule === 'krang-battle-hardened') {
    if (state.phase !== 'combat-damage') return conquestFailure(state, 'WRONG_PHASE', '身经百战只能在分配伤害前使用。');
    state.ruleRuntime.heroDamageReduction = { physical: 2, elemental: 1 };
  }
  if (rule === 'krang-regenerate') {
    const color = options.manaColors?.[0];
    if (!targetId || !state.player.zones.hand.includes(targetId) || state.player.cardInstances[targetId]?.definitionId !== 'core.card.wound') return conquestFailure(state, 'INVALID_TARGET', '再生必须选择手牌中的伤牌。');
    if (!color || !spendMana(state, color, 1)) return conquestFailure(state, 'MANA_UNAVAILABLE', '再生需要支付一枚所选颜色法力。');
    moveEntity(state.player.zones, targetId, 'hand', 'removed');
    if (color === 'red') drawCards(state, 1);
  }
  if (rule === 'krang-shamanic-ritual') {
    const color = options.manaColors?.[0];
    if (!sourceSkill || !color) return conquestFailure(state, 'INVALID_COMMAND', '萨满仪式需要选择一种法力颜色。');
    sourceSkill.flipped = true;
    state.player.manaTokens[color] += 1;
  }
  if (rule === 'krang-master-of-chaos') {
    if (!sourceSkill) return conquestFailure(state, 'INVALID_TARGET', '找不到混乱大师技能。');
    const next = ((sourceSkill.value ?? 0) + 1) % 6;
    sourceSkill.value = next;
    const resources = [
      ['block', 3, 'normal', 'physical'], ['move', 1, 'normal', 'physical'], ['influence', 2, 'normal', 'physical'],
      ['attack', 2, 'normal', 'physical'], ['attack', 1, 'ranged', 'cold-fire'],
    ] as const;
    const selected = next === 5 ? resources[Math.max(0, Math.min(4, options.choiceIndex ?? 0))] : resources[next];
    if (!selected) return conquestFailure(state, 'INVALID_COMMAND', '混乱大师颜色状态无效。');
    if (!legalResources(state.phase).includes(selected[0])) return conquestFailure(state, 'WRONG_PHASE', `当前阶段不能产生 ${selected[0]}。`);
    addResource(state, sourceId, selected[0], selected[1], selected[2], selected[3]);
  }
  if (rule === 'krang-spirit-guides') {
    if (state.phase === 'movement') addResource(state, sourceId, 'move', 1);
    else if (state.phase === 'combat-block') addResource(state, sourceId, 'block', 1, 'normal', 'physical');
    else return conquestFailure(state, 'WRONG_PHASE', '灵魂向导只能在移动或格挡阶段使用。');
  }
  if (rule === 'krang-battle-frenzy') {
    if (!sourceSkill) return conquestFailure(state, 'INVALID_TARGET', '找不到战斗狂乱技能。');
    if (!legalResources(state.phase).includes('attack')) return conquestFailure(state, 'WRONG_PHASE', '战斗狂乱只能在攻击阶段使用。');
    sourceSkill.flipped = true;
    addResource(state, sourceId, 'attack', 4);
  }
  if (rule === 'combat-move-to-attack') state.ruleRuntime.moveToAttack = 'normal';
  if (rule === 'combat-move-to-ranged-attack') state.ruleRuntime.moveToAttack = 'ranged';
  if (rule === 'ignore-walls-this-turn') state.ruleRuntime.ignoreWalls = true;
  if (rule === 'refreshing-walk-basic' || rule === 'refreshing-walk-strong') {
    if (state.phase !== 'movement' && !state.phase.startsWith('combat')) return conquestFailure(state, 'WRONG_PHASE', '该牌只能在移动或战斗阶段使用。');
    const strong = rule === 'refreshing-walk-strong';
    addResource(state, sourceId, 'move', strong ? 4 : 2);
    if (!state.phase.startsWith('combat')) addResource(state, sourceId, 'heal', strong ? 2 : 1);
  }
  if (rule === 'pay-blue-for-free-lakes') {
    if (!spendMana(state, 'blue', 1)) return conquestFailure(state, 'MANA_UNAVAILABLE', '穿越湖泊需要额外支付 1 蓝色法力。');
    state.lastingEffects.push({ id: conquestNextId(state, 'effect'), kind: 'terrain', amount: 0, expires: 'end-turn', terrains: ['lake'], mode: 'set', allowLake: true });
  }
  if (rule === 'choose-mana-colors-and-optional-crystal') {
    const colors = options.manaColors ?? [];
    if (colors.length !== 3) return conquestFailure(state, 'INVALID_COMMAND', '必须选择三枚基础法力令牌。');
    state.player.manaTokens.red = Math.max(0, state.player.manaTokens.red - 3);
    for (const color of colors) state.player.manaTokens[color] += 1;
    if (options.amount === 1) {
      const color = colors.at(-1);
      if (color && state.player.manaTokens[color] > 0) {
        state.player.manaTokens[color] -= 1;
        state.player.crystals[color] = Math.min(3, state.player.crystals[color] + 1);
      }
    }
  }
  if (rule === 'choose-one-mana' || rule === 'choose-two-mana') {
    const count = rule === 'choose-two-mana' ? 2 : 1;
    const colors = options.manaColors?.length === count ? options.manaColors : Array.from({ length: count }, () => 'red' as const);
    for (const color of colors) state.player.manaTokens[color] += 1;
  }
  if (rule === 'recruit-reputation-bonus') state.ruleRuntime.recruitReputation += 1;
  if (rule === 'recruit-fame-reputation-bonus') { state.ruleRuntime.recruitReputation += 1; state.ruleRuntime.recruitFame += 1; }
  if (rule === 'forest-heal-bonus' || rule === 'forest-heal-ready-bonus') {
    const terrain = state.map[`${state.player.position.q},${state.player.position.r}`]?.terrain;
    if (terrain === 'forest') addResource(state, sourceId, 'heal', 2);
  }
  if (rule === 'plus-two-per-enemy') {
    const amount = (state.encounter?.enemyIds.filter((id) => !state.enemies[id]?.defeated).length ?? 0) * 2;
    const resource = [...state.player.resources].reverse().find((candidate) => candidate.sourceId === sourceId && (candidate.resource === 'attack' || candidate.resource === 'block'));
    if (resource) resource.amount += amount;
  }
  if (rule === 'space-bending-movement') {
    if (state.phase !== 'movement') return conquestFailure(state, 'WRONG_PHASE', '空间弯曲只能在移动阶段使用。');
    state.ruleRuntime.movementMode = { kind: 'space-bending', maxDistance: 2, ignoreEnemies: true, allowFortified: false };
  }
  if (rule === 'time-bending-extra-turn') state.ruleRuntime.extraTurn = true;
  if (rule === 'return-random-discard-cards') {
    for (let index = 0; index < 2 && state.player.zones.discard.length > 0; index += 1) {
      const pick = state.rngState % state.player.zones.discard.length;
      const id = state.player.zones.discard[pick];
      randomBasicColor(state);
      if (!id) continue;
      state.player.zones.discard.splice(pick, 1);
      if (index === 0) state.player.zones.deck.unshift(id); else state.player.zones.deck.push(id);
    }
  }
  if (rule === 'return-chosen-discard-cards') {
    if (targetIds.length !== 2 || targetIds.some((id) => !state.player.zones.discard.includes(id))) return conquestFailure(state, 'INVALID_TARGET', '必须选择弃牌堆中的两张牌。');
    for (const [index, id] of targetIds.entries()) {
      state.player.zones.discard = state.player.zones.discard.filter((candidate) => candidate !== id);
      if (index === 0) state.player.zones.deck.unshift(id); else state.player.zones.deck.push(id);
    }
  }
  if (rule === 'wings-of-wind-movement') {
    if (state.phase !== 'movement') return conquestFailure(state, 'WRONG_PHASE', '风之翼只能在移动阶段使用。');
    state.ruleRuntime.movementMode = { kind: 'wings-of-wind', maxDistance: 5, ignoreEnemies: true, allowFortified: false };
  }
  if (rule === 'additional-skip-targets-for-move') {
    const extra = Math.max(0, targetIds.length - 1);
    const cost = extra * (extra + 3) / 2;
    if (!spendResource(state, 'move', cost)) return conquestFailure(state, 'INSUFFICIENT_RESOURCE', `额外目标需要 ${cost} 移动。`);
    for (const id of targetIds) {
      const modifier = state.enemyModifiers[id] ?? { armor: 0, attack: 0, skipAttack: false, removeFortification: false, removeResistance: false, destroy: false, expires: 'end-combat' as const };
      modifier.skipAttack = true;
      state.enemyModifiers[id] = modifier;
    }
  }
  if (rule === 'skip-up-to-three-enemies') {
    const ids = targetIds.length > 0 ? targetIds : (state.encounter?.enemyIds.filter((id) => !state.enemies[id]?.defeated).slice(0, 3) ?? []);
    if (ids.length < 1 || ids.length > 3 || ids.some((id) => !state.encounter?.enemyIds.includes(id))) return conquestFailure(state, 'INVALID_TARGET', '必须选择一至三个当前敌人。');
    for (const id of ids) {
      const current = state.enemyModifiers[id] ?? { armor: 0, attack: 0, skipAttack: false, removeFortification: false, removeResistance: false, destroy: false, expires: 'end-combat' as const };
      current.skipAttack = true;
      state.enemyModifiers[id] = current;
    }
  }
  if (rule === 'double-armor-reduction-if-fortified') {
    const ids = options.choiceIndex === 0 && targetId ? [targetId] : state.encounter?.enemyIds ?? [];
    const reduction = options.choiceIndex === 0 ? 3 : 2;
    for (const id of ids) {
      const enemy = state.enemies[id];
      const definition = enemy ? content.enemies[enemy.definitionId] : undefined;
      const space = enemy ? state.map[`${enemy.position.q},${enemy.position.r}`] : undefined;
      if (definition?.abilities.includes('fortified') || (space?.siteId && content.sites[space.siteId]?.fortified)) state.enemyModifiers[id]!.armor -= reduction;
    }
  }
  if (rule === 'successful-block-fire-attack') state.ruleRuntime.pendingBlockEffect = 'fire-attack';
  if (rule === 'successful-block-destroy') state.ruleRuntime.pendingBlockEffect = 'destroy';
  if (rule === 'use-unit-offer-ability') {
    const unit = targetId ? content.units[targetId] : undefined;
    const ability = unit?.abilities?.[options.secondaryIndex ?? 0];
    if (!unit || unit.id === 'lost-legion.unit.elite.delphana-masters' || !state.market.unit.offer.includes(unit.id) || !ability) return conquestFailure(state, 'INVALID_TARGET', '必须选择单位市场中允许借用的一项能力。');
    const { targetId: _targetId, ...nestedOptions } = options;
    void _targetId;
    return applyConquestEffect(state, content, sourceId, ability.effect, { ...nestedOptions, ...(options.secondaryTargetId ? { targetId: options.secondaryTargetId } : {}) }, events);
  }
  if (rule === 'ready-all-units') {
    if (state.phase.startsWith('combat')) return conquestFailure(state, 'WRONG_PHASE', '该效果只能在战斗外使用。');
    state.player.units.forEach((unit) => { if (!unit.destroyed && unit.wounds === 0) unit.ready = true; });
  }
  if (rule === 'roll-two-crystals') {
    for (let index = 0; index < 2; index += 1) {
      const color = randomManaColor(state);
      if (color === 'black') state.player.fame += 1;
      else {
        const crystal = color === 'gold' ? randomBasicColor(state) : color;
        state.player.crystals[crystal] = Math.min(3, state.player.crystals[crystal] + 1);
      }
    }
  }
  if (rule.startsWith('endless-')) {
    const color = rule.split('-')[1] as ManaColor | undefined;
    if (color && color in state.player.manaTokens) state.ruleRuntime.endlessMana.push(color, 'black');
    if (color && ['red', 'blue', 'white', 'green'].includes(color)) state.ruleRuntime.spellFameColor = color as BasicManaColor;
  }
  if (rule === 'sun-amulet-night-rules') {
    if (state.time === 'night') {
      state.ruleRuntime.goldAtNight = true;
      state.lastingEffects.push({ id: conquestNextId(state, 'effect'), kind: 'terrain', amount: 3, expires: 'end-turn', terrains: ['forest'], mode: 'set' });
    }
  }
  if (rule === 'darkness-amulet-day-rules') {
    if (state.time === 'day') {
      state.ruleRuntime.blackAtDay = true;
      state.lastingEffects.push({ id: conquestNextId(state, 'effect'), kind: 'terrain', amount: 3, expires: 'end-turn', terrains: ['desert'], mode: 'set' });
    }
    if (options.manaColors?.length) {
      const count = options.manaColors.length;
      state.player.manaTokens.black = Math.max(0, state.player.manaTokens.black - count);
      for (const color of options.manaColors) state.player.manaTokens[color] += 1;
    }
  }
  if (rule === 'double-against-swiftness') {
    for (const resource of state.player.resources.filter((candidate) => candidate.sourceId === sourceId && candidate.resource === 'block')) resource.tags = [...(resource.tags ?? []), 'double-against-swiftness'];
  }
  if (rule === 'wound-activating-unit') {
    const unit = state.player.units.find((candidate) => candidate.id === sourceId);
    if (unit) {
      unit.wounds += 1;
      unit.ready = false;
      if (unit.wounds >= 2) {
        unit.destroyed = true;
        detachUnitAttachments(state, unit.id);
      }
    }
  }
  if (rule === 'all-units-all-resistances') state.ruleRuntime.allUnitsAllResistances = true;
  if (rule === 'convert-all-attacks') state.ruleRuntime.convertAttacks = options.choiceIndex === 1 ? 'siege' : 'cold-fire';
  if (rule === 'assign-banner-of-glory' || rule === 'assign-banner-of-fear' || rule === 'assign-banner-of-protection' || rule === 'assign-banner-of-courage' || rule === 'assign-banner-command' || rule === 'assign-banner-fortitude') {
    if (!targetId || !state.player.units.some((unit) => unit.id === targetId && !unit.destroyed)) return conquestFailure(state, 'INVALID_TARGET', '必须选择一个现有单位。');
    state.attachments.push({ id: conquestNextId(state, 'attachment'), cardId: sourceId, definitionId: state.player.cardInstances[sourceId]?.definitionId ?? '', unitId: targetId, used: false });
  }
  if (rule === 'all-units-glory-bonus') state.ruleRuntime.allUnitsBonus += 1;
  if (rule === 'all-units-fortitude-bonus') state.ruleRuntime.allUnitsArmorBonus += 1;
  if (rule === 'remove-turn-wounds') state.ruleRuntime.removeTurnWounds = true;
  if (rule === 'discard-cards-for-attack' && targetId && state.player.zones.hand.includes(targetId)) {
    const ids = targetIds.length ? targetIds : [targetId];
    if (ids.some((id) => !state.player.zones.hand.includes(id) || id === sourceId)) return conquestFailure(state, 'INVALID_TARGET', '只能弃置手中的其他牌。');
    for (const id of ids) moveEntity(state.player.zones, id, 'hand', 'discard');
    addResource(state, rule, 'attack', 3 * ids.length);
    state.ruleRuntime.famePerDefeated += 1;
  }
  if (rule === 'double-physical-attacks') {
    state.ruleRuntime.doublePhysicalAttacks = true;
    state.ruleRuntime.removePhysicalResistance = true;
    for (const id of state.encounter?.enemyIds ?? []) {
      const current = state.enemyModifiers[id];
      if (current) current.removeResistance = true;
    }
    state.ruleRuntime.famePerDefeated += 1;
  }
  if (rule === 'risk-wound-die' || rule === 'risk-wound-dice') {
    const rolls = rule === 'risk-wound-die' ? 1 : Math.max(0, Math.min(5, options.amount ?? 5));
    const attack = state.player.resources.find((candidate) => candidate.sourceId === sourceId && candidate.resource === 'attack');
    if (rule === 'risk-wound-dice' && attack) attack.amount = 5 + rolls;
    for (let index = 0; index < rolls; index += 1) if (['red', 'black'].includes(randomManaColor(state))) addWoundsToHand(state, 1);
  }
  if (rule === 'fame-per-heal-spent') state.ruleRuntime.healFamePerPoint += 1;
  if (rule === 'draw-per-hand-wound-healed') state.ruleRuntime.drawPerHandWound = true;
  if (rule === 'recruit-unit-free') {
    const eligible = state.market.unit.offer.filter((id) => id !== 'lost-legion.unit.elite.delphana-masters');
    const definitionId = targetId && eligible.includes(targetId) ? targetId : eligible[0];
    if (definitionId && state.player.units.filter((unit) => !unit.destroyed).length < commandCapacity(state)) {
      state.market.unit.offer = state.market.unit.offer.filter((id) => id !== definitionId);
      state.player.units.push({ id: conquestNextId(state, 'unit'), definitionId, ready: true, wounds: 0, destroyed: false });
      state.player.reputation = Math.max(-7, Math.min(7, state.player.reputation + state.ruleRuntime.recruitReputation));
      state.player.fame += state.ruleRuntime.recruitFame;
    } else if (definitionId) {
      const activeUnits = state.player.units.filter((unit) => !unit.destroyed);
      state.pendingDecision = {
        id: conquestNextId(state, 'decision'), kind: 'replace-unit', prompt: '指挥槽已满，选择要解散的单位或放弃免费招募。', returnPhase: state.phase,
        options: [...activeUnits.map((unit) => ({ id: unit.id, label: `解散 ${content.units[unit.definitionId]?.name ?? unit.id}` })), { id: 'cancel', label: '放弃招募' }],
        context: { definitionId, cost: 0 },
      };
      state.phase = 'decision';
    }
  }
  if (rule === 'underground-travel' || rule === 'underground-assault') {
    if (state.phase !== 'movement') return conquestFailure(state, 'WRONG_PHASE', '地下移动只能在移动阶段使用。');
    state.ruleRuntime.movementMode = { kind: rule === 'underground-travel' ? 'underground' : 'underground-assault', maxDistance: 3, ignoreEnemies: true, allowFortified: rule === 'underground-assault' };
  }
  if ((rule === 'exchange-action-for-advanced' || rule === 'exchange-action-for-spell') && targetId) {
    const instance = state.player.cardInstances[targetId];
    const target = rule.endsWith('advanced') ? state.market.advanced : state.market.spell;
    const color = content.cards[instance?.definitionId ?? '']?.color;
    const definitionId = target.offer.find((id) => content.cards[id]?.color === color);
    const zone = state.player.zones.hand.includes(targetId) ? 'hand' : state.player.zones.discard.includes(targetId) ? 'discard' : undefined;
    if (zone && definitionId) {
      moveEntity(state.player.zones, targetId, zone, 'removed');
      target.offer = target.offer.filter((id) => id !== definitionId);
      const gained = addCardToZone(state, definitionId, 'discard');
      moveEntity(state.player.zones, gained, 'discard', 'hand');
      if (rule.endsWith('spell') && color) state.player.crystals[color] = Math.min(3, state.player.crystals[color] + 1);
    }
  }
  return undefined;
}

export function applyConquestEffect(state: ConquestState, content: ConquestContent, sourceId: string, node: EffectNode, options: RuleResolutionOptions, events: ConquestState['eventLog']): ConquestResult | undefined {
  const { choiceIndex, targetId } = options;
  const evaluation = evaluateEffect(node, { time: rulesTime(state), ...(choiceIndex === undefined ? {} : { choiceIndex }), ...(targetId === undefined ? {} : { targetId }) });
  if (evaluation.choiceRequired) return conquestFailure(state, 'DECISION_REQUIRED', '必须选择一个效果选项。');
  const regenerateWound = (sourceId === 'krang.skill.regenerate' || sourceId === 'tezla.skill.regenerate') && targetId && state.player.zones.hand.includes(targetId) && state.player.cardInstances[targetId]?.definitionId === 'core.card.wound';
  if (evaluation.targetRequired && !regenerateWound && (!targetId || !targetCandidates(state, evaluation.targetRequired, sourceId).includes(targetId))) return conquestFailure(state, 'INVALID_TARGET', '必须选择一个合法效果目标。');
  for (const gain of evaluation.gains) {
    if (!legalResources(state.phase).includes(gain.resource)) return conquestFailure(state, 'WRONG_PHASE', `当前阶段不能产生 ${gain.resource}。`);
    if (state.phase === 'combat-ranged' && gain.resource === 'attack' && (gain.attackKind ?? 'normal') === 'normal') return conquestFailure(state, 'WRONG_PHASE', '远程阶段不能使用普通攻击。');
  }
  for (const operation of evaluation.operations ?? []) {
    if (operation.type === 'special' && operation.rule === 'night-only' && rulesTime(state) !== 'night') return conquestFailure(state, 'WRONG_PHASE', '该效果只能在夜间使用。');
    if (operation.type !== 'refresh-unit' || (!targetId && !options.targetIds?.length)) continue;
    const units = (options.targetIds ?? (targetId ? [targetId] : [])).map((id) => state.player.units.find((candidate) => candidate.id === id && !candidate.destroyed && candidate.wounds === 0));
    if (units.some((unit) => !unit)) return conquestFailure(state, 'INVALID_TARGET', '该单位不符合整备条件。');
    const definitions = units.map((unit) => content.units[unit!.definitionId]);
    const forestBonus = state.player.cardInstances[sourceId]?.definitionId === 'core.card.spell.restoration' && state.map[`${state.player.position.q},${state.player.position.r}`]?.terrain === 'forest' ? 2 : 0;
    if (definitions.some((definition) => !definition || (operation.maxLevel && definition.level > operation.maxLevel)) || (operation.totalLevels && definitions.reduce((sum, definition) => sum + (definition?.level ?? 99), 0) > operation.totalLevels + forestBonus)) return conquestFailure(state, 'INVALID_TARGET', '所选单位总等级超过整备上限。');
  }
  const paymentState = structuredClone(state) as ConquestState;
  for (const cost of evaluation.manaCosts) if (!spendMana(paymentState, cost.color, cost.amount)) return conquestFailure(state, 'MANA_UNAVAILABLE', `没有足够的 ${cost.color} 法力。`);
  state.source = paymentState.source;
  state.player.manaTokens = paymentState.player.manaTokens;
  state.player.crystals = paymentState.player.crystals;
  for (const gain of evaluation.gains) addResource(state, sourceId, gain.resource, gain.amount, gain.attackKind ?? 'normal', gain.element ?? 'physical');
  if (evaluation.draws) drawCards(state, evaluation.draws);
  for (const discard of evaluation.discards ?? []) {
    for (let index = 0; index < discard.amount; index += 1) {
      const id = targetId && state.player.zones.hand.includes(targetId) ? targetId : state.player.zones.hand.find((candidate) => {
        const wound = state.player.cardInstances[candidate]?.definitionId === 'core.card.wound';
        return candidate !== sourceId && (discard.filter === 'any' || (discard.filter === 'wound' ? wound : !wound));
      });
      if (id) moveEntity(state.player.zones, id, 'hand', 'discard');
    }
  }
  for (const conversion of evaluation.conversions ?? []) if (spendResource(state, conversion.from, conversion.amount)) addResource(state, sourceId, conversion.to, conversion.amount);
  for (const effect of evaluation.lastingEffects ?? []) {
    state.lastingEffects.push({ id: conquestNextId(state, 'effect'), kind: effect.effect, amount: effect.amount, expires: effect.expires });
    if (effect.effect === 'armor') state.player.armor += effect.amount;
    if (effect.effect === 'hand-limit') state.player.handLimit += effect.amount;
    if (effect.effect === 'reputation') state.player.reputation = Math.max(-7, Math.min(7, state.player.reputation + effect.amount));
  }
  for (const operation of evaluation.operations ?? []) {
    if (operation.type === 'gain-crystal') state.player.crystals[operation.color] = Math.min(3, state.player.crystals[operation.color] + operation.amount);
    if (operation.type === 'gain-mana') state.player.manaTokens[operation.color] += operation.amount;
    if (operation.type === 'take-wound') addWoundsToHand(state, operation.amount);
    if (operation.type === 'adjust-track') {
      if (operation.track === 'fame') state.player.fame = Math.max(0, state.player.fame + operation.amount);
      else state.player.reputation = Math.max(-7, Math.min(7, state.player.reputation + operation.amount));
    }
    if (operation.type === 'refresh-unit' && targetId) {
      for (const id of options.targetIds ?? [targetId]) {
        const unit = state.player.units.find((candidate) => candidate.id === id);
        if (!unit) return conquestFailure(state, 'INVALID_TARGET', '该单位不符合整备条件。');
        unit.ready = true;
      }
    }
    if (operation.type === 'modify-enemy') {
      const ids = operation.scope === 'all' ? state.encounter?.enemyIds ?? [] : options.targetIds?.length ? options.targetIds : targetId ? [targetId] : [];
      for (const id of ids) {
        const current = state.enemyModifiers[id] ?? { armor: 0, attack: 0, skipAttack: false, removeFortification: false, removeResistance: false, destroy: false, expires: operation.expires };
        if (operation.modifier === 'armor') current.armor += operation.amount ?? 0;
        if (operation.modifier === 'attack') current.attack += operation.amount ?? 0;
        if (operation.modifier === 'skip-attack') current.skipAttack = true;
        if (operation.modifier === 'remove-fortification') current.removeFortification = true;
        if (operation.modifier === 'remove-resistance') current.removeResistance = true;
        if (operation.modifier === 'destroy') {
          current.destroy = true;
          const enemy = state.enemies[id];
          if (enemy) enemy.defeated = true;
          if (state.encounter && !state.encounter.defeatedThisCombat.includes(id)) state.encounter.defeatedThisCombat.push(id);
          const space = enemy ? state.map[`${enemy.position.q},${enemy.position.r}`] : undefined;
          if (space) space.enemyIds = space.enemyIds.filter((candidate) => candidate !== id);
        }
        current.expires = operation.expires;
        state.enemyModifiers[id] = current;
      }
    }
    if (operation.type === 'terrain-cost') state.lastingEffects.push({ id: conquestNextId(state, 'effect'), kind: 'terrain', amount: operation.amount, expires: operation.expires, terrains: [...operation.terrains], mode: operation.mode, ...(operation.minimum === undefined ? {} : { minimum: operation.minimum }), ...(operation.allowLake === undefined ? {} : { allowLake: operation.allowLake }) });
    if (operation.type === 'special') {
      const failed = applySpecialRule(state, content, sourceId, operation.rule, options, events);
      if (failed) return failed;
    }
  }
  appendEvent(state, events, 'EffectResolved', '结算规则效果。', { sourceId, choiceIndex, targetId, evaluation });
  return undefined;
}

export function playConquestCard(state: ConquestState, content: ConquestContent, command: Extract<ConquestCommand, { type: 'PLAY_CARD' }>, events: ConquestState['eventLog']): ConquestResult | undefined {
  if (!state.player.zones.hand.includes(command.cardId)) return conquestFailure(state, 'CARD_NOT_IN_HAND', '这张牌不在手牌中。');
  const instance = state.player.cardInstances[command.cardId];
  const card = instance ? content.cards[instance.definitionId] : undefined;
  if (!card || card.kind === 'wound') return conquestFailure(state, 'INVALID_TARGET', '该牌不能打出。');
  let effect: EffectNode | undefined;
  let dice: string[] = [];
  const isArtifact = content.artifactDeck.includes(card.id);
  if (command.mode === 'sideways') {
    if (!command.sidewaysResource || !['move', 'influence', 'attack', 'block'].includes(command.sidewaysResource)) return conquestFailure(state, 'INVALID_COMMAND', '横置时必须选择基础资源。');
    effect = { resource: command.sidewaysResource, amount: 1 };
  } else {
    effect = command.mode === 'basic' ? card.basicEffect ?? card.basic : card.strongEffect ?? card.strong;
    if (!effect) return conquestFailure(state, 'INVALID_TARGET', '该牌没有所选效果。');
    if ((command.mode === 'strong' && !isArtifact) || card.kind === 'spell') {
      const found = manaDice(state, card.color, card.kind === 'spell' && command.mode === 'strong');
      if (!found) return conquestFailure(state, 'MANA_UNAVAILABLE', 'Source 中没有所需法力。');
      dice = found;
    }
  }
  const shapeshift = state.ruleRuntime.shapeshiftResource;
  if (shapeshift && card.kind === 'basic' && 'resource' in effect && ['move', 'attack', 'block'].includes(effect.resource)) {
    effect = { ...effect, resource: shapeshift };
  }
  const failed = applyConquestEffect(state, content, command.cardId, effect, command, events);
  if (failed) return failed;
  if (shapeshift && card.kind === 'basic') delete state.ruleRuntime.shapeshiftResource;
  for (const dieId of dice) {
    const die = state.source.find((candidate) => candidate.id === dieId);
    if (die) die.used = true;
  }
  const attached = state.attachments.some((attachment) => attachment.cardId === command.cardId);
  if (state.ruleRuntime.extraTurn && card.id === 'core.card.spell.space-bending' && command.mode === 'strong') {
    const played = [...state.player.zones.play];
    state.player.zones.play = [];
    state.player.zones.hand.push(...played);
    moveEntity(state.player.zones, command.cardId, 'hand', 'set-aside');
    state.player.resources = [];
    state.phase = 'movement';
    state.turn += 1;
    state.actionTaken = false;
    state.ruleRuntime.extraTurn = false;
    state.ruleRuntime.noDrawNextTurn = true;
  } else if (attached) moveEntity(state.player.zones, command.cardId, 'hand', 'set-aside');
  else if (isArtifact && command.mode === 'strong') moveEntity(state.player.zones, command.cardId, 'hand', 'removed');
  else moveEntity(state.player.zones, command.cardId, 'hand', 'play');
  if (card.kind === 'spell' && card.color === state.ruleRuntime.spellFameColor) state.player.fame += 1;
  appendEvent(state, events, 'CardPlayed', `打出“${card.name}”并结算${command.mode === 'basic' ? '基础' : command.mode === 'strong' ? '强化' : '横置'}效果。`, { cardId: command.cardId, mode: command.mode, choiceIndex: command.choiceIndex, targetId: command.targetId });
  return undefined;
}

export function activateSkill(state: ConquestState, content: ConquestContent, command: Extract<ConquestCommand, { type: 'USE_SKILL' }>, events: ConquestState['eventLog']): ConquestResult | undefined {
  const skillState = state.player.skills.find((skill) => skill.definitionId === command.skillId);
  const skill = content.skills[command.skillId];
  if (!skillState || !skill || skillState.used || skillState.usedThisTurn || skillState.flipped) return conquestFailure(state, 'INVALID_TARGET', '该技能不可用。');
  if (state.phase === 'tactics' || state.phase === 'decision' || state.phase === 'game-over') return conquestFailure(state, 'WRONG_PHASE', '当前阶段不能使用技能。');
  const effect: EffectNode | undefined = skill.effect ?? (skill.resource && skill.amount ? { resource: skill.resource, amount: skill.amount } : skill.id.endsWith('.motivation') ? { type: 'draw', amount: 1 } : undefined);
  if (!effect) return conquestFailure(state, 'INVALID_TARGET', '该技能没有可执行效果。');
  const failed = applyConquestEffect(state, content, command.skillId, effect, command, events);
  if (failed) return failed;
  skillState.used = skill.oncePerRound && !skill.flipBackCondition;
  skillState.usedThisTurn = true;
  appendEvent(state, events, 'SkillUsed', `使用技能“${skill.name}”。`, { skillId: command.skillId, choiceIndex: command.choiceIndex, targetId: command.targetId });
  return undefined;
}

export function flipBackSkill(state: ConquestState, content: ConquestContent, command: Extract<ConquestCommand, { type: 'FLIP_BACK_SKILL' }>, events: ConquestState['eventLog']): ConquestResult | undefined {
  const skillState = state.player.skills.find((skill) => skill.definitionId === command.skillId);
  const skill = content.skills[command.skillId];
  if (!skillState?.flipped || !skill?.flipBackCondition || skill.flipBackCondition === 'rest') return conquestFailure(state, 'INVALID_TARGET', '该技能当前不能翻回。');
  if (skill.flipBackCondition === 'action') {
    if (state.phase !== 'action' || state.actionTaken) return conquestFailure(state, 'WRONG_PHASE', '翻回该技能需要消耗本回合行动。');
    state.actionTaken = true;
  }
  if (skill.flipBackCondition === 'pay-green' && !spendMana(state, 'green', 1)) return conquestFailure(state, 'MANA_UNAVAILABLE', '翻回该技能需要支付绿色法力。');
  skillState.flipped = false;
  skillState.used = false;
  appendEvent(state, events, 'SkillFlippedBack', `翻回技能“${skill.name}”。`, { skillId: skill.id, condition: skill.flipBackCondition });
  return undefined;
}

export function healConquestWound(state: ConquestState, content: ConquestContent, command: Extract<ConquestCommand, { type: 'HEAL_WOUND' }>, events: ConquestState['eventLog']): ConquestResult | undefined {
  if (!legalResources(state.phase).includes('heal')) return conquestFailure(state, 'WRONG_PHASE', '当前阶段不能治疗。');
  if (command.target === 'hero') {
    const woundId = command.woundId ?? state.player.zones.hand.find((id) => state.player.cardInstances[id]?.definitionId === 'core.card.wound');
    if (!woundId || !state.player.zones.hand.includes(woundId) || state.player.cardInstances[woundId]?.definitionId !== 'core.card.wound') return conquestFailure(state, 'INVALID_TARGET', '手牌中没有这张伤牌。');
    if (!spendResource(state, 'heal', 1)) return conquestFailure(state, 'INSUFFICIENT_RESOURCE', '治疗英雄伤牌需要 1 治疗。');
    moveEntity(state.player.zones, woundId, 'hand', 'removed');
    state.player.fame += state.ruleRuntime.healFamePerPoint;
    if (state.ruleRuntime.drawPerHandWound) drawCards(state, 1);
    appendEvent(state, events, 'WoundHealed', '治疗并移除一张手牌伤牌。', { woundId, target: 'hero' });
    return undefined;
  }
  const unit = state.player.units.find((candidate) => candidate.id === command.target && !candidate.destroyed && candidate.wounds > 0);
  const level = unit ? content.units[unit.definitionId]?.level : undefined;
  if (!unit || !level) return conquestFailure(state, 'INVALID_TARGET', '该单位不需要治疗。');
  if (!spendResource(state, 'heal', level)) return conquestFailure(state, 'INSUFFICIENT_RESOURCE', `治疗该单位需要 ${level} 治疗。`);
  unit.wounds = Math.max(0, unit.wounds - 1);
  state.player.fame += level * state.ruleRuntime.healFamePerPoint;
  appendEvent(state, events, 'WoundHealed', `治疗${content.units[unit.definitionId]?.name ?? unit.id}。`, { target: unit.id, cost: level });
  return undefined;
}

export function activateConquestAttachment(state: ConquestState, content: ConquestContent, command: Extract<ConquestCommand, { type: 'USE_ATTACHMENT' }>, events: ConquestState['eventLog']): ConquestResult | undefined {
  const attachment = state.attachments.find((candidate) => candidate.id === command.attachmentId && !candidate.used);
  const unit = attachment ? state.player.units.find((candidate) => candidate.id === attachment.unitId && !candidate.destroyed) : undefined;
  if (!attachment || !unit) return conquestFailure(state, 'INVALID_TARGET', '该附着物不可使用。');
  if (attachment.definitionId === 'core.card.artifact.banner-courage') {
    if (state.phase.startsWith('combat')) return conquestFailure(state, 'WRONG_PHASE', '勇气旗帜只能在战斗外使用。');
    if (unit.wounds > 0) return conquestFailure(state, 'INVALID_TARGET', '受伤单位不能整备。');
    unit.ready = true;
    attachment.used = true;
  } else if (attachment.definitionId === 'core.card.artifact.banner-fear') {
    if (state.phase !== 'combat-block' || !state.encounter || !command.targetId) return conquestFailure(state, 'WRONG_PHASE', '恐惧旗帜只能取消当前敌人的攻击。');
    const attacks = state.encounter.incoming.filter((attack) => attack.enemyId === command.targetId && !attack.resolved);
    if (attacks.length === 0) return conquestFailure(state, 'INVALID_TARGET', '该敌人没有待处理攻击。');
    for (const attack of attacks) { attack.blocked = true; attack.resolved = true; }
    attachment.used = true;
    state.player.fame += 1;
  } else return conquestFailure(state, 'INVALID_TARGET', '该旗帜只有被动效果。');
  appendEvent(state, events, 'AttachmentUsed', `使用${content.cards[attachment.definitionId]?.name ?? attachment.definitionId}。`, { attachmentId: attachment.id, unitId: unit.id, targetId: command.targetId });
  return undefined;
}

export function unitAttachmentBonus(state: ConquestState, unitId: string): { armor: number; resource: number; fireIceResistance: boolean; gloryFame: number } {
  const attachments = state.attachments.filter((attachment) => attachment.unitId === unitId);
  return {
    armor: attachments.filter((attachment) => attachment.definitionId === 'core.card.artifact.banner' || attachment.definitionId === 'core.card.artifact.banner-protection').length,
    resource: attachments.filter((attachment) => attachment.definitionId === 'core.card.artifact.banner').length,
    fireIceResistance: attachments.some((attachment) => attachment.definitionId === 'core.card.artifact.banner-protection'),
    gloryFame: attachments.filter((attachment) => attachment.definitionId === 'core.card.artifact.banner').length,
  };
}

export function addCardToZone(state: ConquestState, definitionId: string, zone: 'discard' | 'inventory'): string {
  const id = conquestNextId(state, 'card');
  state.player.cardInstances[id] = { id, definitionId };
  state.player.zones[zone].push(id);
  return id;
}
