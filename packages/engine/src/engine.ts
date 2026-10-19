import { defaultAttackKind, findManaDice, legalResourcesForPhase, playCard } from './cards';
import { activateUnit, advanceCombat, assignDamage, declareAttack, declareBlock, startEncounter } from './combat';
import { areAdjacent, coordKey, terrainCost } from './hex';
import { assertInvariants, cloneState, resourceTotals } from './state-utils';
import { addMapTemplates, appendEvent, commitEvents, failure, nextId, resourceLabel, spendResource } from './state-operations';
import { endTurn, prepareNextRound, resolveDecision, rest } from './turn';
import type {
  DomainEvent,
  AttackKind,
  ExecutionFailure,
  ExecutionResult,
  GameCommand,
  GameState,
  GameView,
  LegalIntent,
  TutorialContent,
} from './types';

export function executeIntent(state: GameState, command: GameCommand, content: TutorialContent): ExecutionResult {
  if (state.scenario.status !== 'playing') return failure(state, 'GAME_ALREADY_OVER', '场景已经结束。');
  if (state.pendingDecision && command.type !== 'RESOLVE_DECISION') return failure(state, 'DECISION_REQUIRED', '必须先完成当前选择。');

  const next = cloneState(state);
  const events: DomainEvent[] = [];
  let failed: ExecutionFailure | undefined;

  switch (command.type) {
    case 'PLAY_CARD':
      failed = playCard(next, command, content, events);
      break;
    case 'MOVE_HERO': {
      if (next.phase !== 'movement') { failed = failure(state, 'WRONG_PHASE', '当前不能移动。'); break; }
      const space = next.map[coordKey(command.to)];
      if (!space) { failed = failure(state, 'SPACE_NOT_FOUND', '目标空间尚未揭示。'); break; }
      if (!areAdjacent(next.player.position, command.to)) { failed = failure(state, 'SPACE_NOT_ADJACENT', '只能移动到相邻空间。'); break; }
      const cost = terrainCost(space.terrain, next.time);
      if (!Number.isFinite(cost)) { failed = failure(state, 'TERRAIN_IMPASSABLE', '该地形不能进入。'); break; }
      if (!spendResource(next, 'move', cost)) { failed = failure(state, 'INSUFFICIENT_RESOURCE', `进入该地形需要 ${cost} 移动。`); break; }
      const origin = { ...next.player.position };
      next.player.position = { ...command.to };
      appendEvent(next, events, 'HeroMoved', `Tovak 移动到 ${coordKey(command.to)}，消耗 ${cost} 移动。`, { from: origin, to: command.to, cost });
      if (space.enemyIds.length > 0) {
        const encounterFailure = startEncounter(next, [...space.enemyIds], events);
        if (encounterFailure) failed = failure(state, encounterFailure.error.code, encounterFailure.error.message);
        if (next.encounter) next.encounter.origin = origin;
      }
      break;
    }
    case 'EXPLORE_TILE': {
      if (next.phase !== 'movement') { failed = failure(state, 'WRONG_PHASE', '当前不能探索。'); break; }
      if (next.explored || coordKey(next.player.position) !== '1,0') { failed = failure(state, 'INVALID_TARGET', '只能从村庄东侧边界探索一次。'); break; }
      if (!spendResource(next, 'move', 2)) { failed = failure(state, 'INSUFFICIENT_RESOURCE', '探索需要 2 移动。'); break; }
      addMapTemplates(next, content.explorationMap);
      next.explored = true;
      next.checkpoints.push({ eventIndex: next.eventLog.length + events.length, barrier: true, reason: '揭示地图板块' });
      appendEvent(next, events, 'TileRevealed', '揭示新的地图板块，这是一个信息屏障。', { spaces: content.explorationMap.map(coordKey) });
      break;
    }
    case 'FINISH_MOVEMENT':
      if (next.phase !== 'movement') failed = failure(state, 'WRONG_PHASE', '当前不在移动阶段。');
      else { next.phase = 'action'; appendEvent(next, events, 'MovementFinished', '结束移动阶段。'); }
      break;
    case 'REST':
      failed = rest(next, command, content, events);
      break;
    case 'START_COMBAT': {
      if (next.phase !== 'action' || next.actionTaken) { failed = failure(state, 'ACTION_ALREADY_TAKEN', '本回合不能再开始战斗。'); break; }
      const valid = command.enemyIds.every((id) => {
        const enemy = next.enemies[id];
        return enemy && !enemy.defeated && (areAdjacent(next.player.position, enemy.position) || coordKey(next.player.position) === coordKey(enemy.position));
      });
      if (!valid) { failed = failure(state, 'ENEMY_NOT_AVAILABLE', '只能挑战当前格或相邻格的敌人。'); break; }
      failed = startEncounter(next, command.enemyIds, events);
      break;
    }
    case 'DECLARE_ATTACK':
      failed = declareAttack(next, command, content, events);
      break;
    case 'DECLARE_BLOCK':
      failed = declareBlock(next, command, content, events);
      break;
    case 'ASSIGN_DAMAGE':
      failed = assignDamage(next, command, content, events);
      break;
    case 'ADVANCE_COMBAT_PHASE':
      failed = advanceCombat(next, content, events);
      break;
    case 'ACTIVATE_UNIT':
      failed = activateUnit(next, content, events);
      break;
    case 'START_INTERACTION': {
      const space = next.map[coordKey(next.player.position)];
      if (next.phase !== 'action' || next.actionTaken) failed = failure(state, 'ACTION_ALREADY_TAKEN', '本回合不能再互动。');
      else if (space?.site !== 'village') failed = failure(state, 'INVALID_TARGET', '当前位置没有可互动村庄。');
      else { next.phase = 'interaction'; appendEvent(next, events, 'InteractionStarted', '开始与村庄互动。'); }
      break;
    }
    case 'RECRUIT_UNIT': {
      if (next.phase !== 'interaction') { failed = failure(state, 'WRONG_PHASE', '当前不能招募。'); break; }
      const unit = content.units[command.definitionId];
      if (!unit) { failed = failure(state, 'INVALID_TARGET', '单位不存在。'); break; }
      if (next.player.units.length >= next.player.commandSlots) { failed = failure(state, 'COMMAND_LIMIT_REACHED', '指挥槽已满。'); break; }
      if (!spendResource(next, 'influence', unit.influenceCost)) { failed = failure(state, 'INSUFFICIENT_RESOURCE', `招募需要 ${unit.influenceCost} 影响。`); break; }
      const unitState = { id: nextId(next, 'unit'), definitionId: unit.id, ready: true, wounded: false };
      next.player.units.push(unitState);
      appendEvent(next, events, 'UnitRecruited', `招募${unit.name}。`, { unitId: unitState.id, definitionId: unit.id });
      break;
    }
    case 'HEAL_WOUND': {
      if (!['movement', 'interaction'].includes(next.phase)) { failed = failure(state, 'WRONG_PHASE', '战斗期间不能治疗。'); break; }
      const wound = next.player.hand.find((card) => card.id === command.cardId && content.cards[card.definitionId]?.kind === 'wound');
      if (!wound) { failed = failure(state, 'INVALID_TARGET', '所选牌不是手牌中的伤牌。'); break; }
      if (!spendResource(next, 'heal', 1)) { failed = failure(state, 'INSUFFICIENT_RESOURCE', '治疗一张伤牌需要 1 治疗。'); break; }
      next.player.hand = next.player.hand.filter((card) => card.id !== wound.id);
      next.player.removed.push(wound);
      appendEvent(next, events, 'WoundHealed', '治疗一张英雄伤牌。', { cardId: wound.id });
      break;
    }
    case 'FINISH_INTERACTION':
      if (next.phase !== 'interaction') failed = failure(state, 'WRONG_PHASE', '当前不在互动阶段。');
      else { next.phase = 'action'; next.actionTaken = true; appendEvent(next, events, 'InteractionFinished', '结束地点互动。'); }
      break;
    case 'END_TURN':
      failed = endTurn(next, events);
      break;
    case 'DECLARE_END_ROUND':
      if (next.phase !== 'movement' || next.player.deck.length > 0) failed = failure(state, 'ROUND_END_NOT_AVAILABLE', '只有牌库为空且位于回合开始时才能宣布轮末。');
      else prepareNextRound(next, events);
      break;
    case 'RESOLVE_DECISION':
      failed = resolveDecision(next, command, content, events);
      break;
    default: {
      const exhaustive: never = command;
      failed = failure(state, 'INVALID_COMMAND', `未知命令：${String(exhaustive)}`);
    }
  }

  if (failed) return failure(state, failed.error.code, failed.error.message);
  commitEvents(next, events);
  assertInvariants(next);
  return { ok: true, state: next, events };
}

function cardIntents(state: GameState, content: TutorialContent): LegalIntent[] {
  const legalResources = legalResourcesForPhase(state.phase);
  const intents: LegalIntent[] = [];
  for (const instance of state.player.hand) {
    const card = content.cards[instance.definitionId];
    if (!card || card.kind === 'wound') continue;
    if (card.basic && legalResources.includes(card.basic.resource) && !(state.phase === 'combat-ranged' && defaultAttackKind(card.basic) === 'normal')) {
      intents.push({ id: `play:${instance.id}:basic`, label: `${card.name}：基础效果`, command: { type: 'PLAY_CARD', cardId: instance.id, mode: 'basic' }, group: 'card' });
    }
    if (card.strong && legalResources.includes(card.strong.resource) && !(state.phase === 'combat-ranged' && defaultAttackKind(card.strong) === 'normal')) {
      const requiresBlack = card.kind === 'spell';
      if (findManaDice(state, card.color, requiresBlack)) {
        intents.push({ id: `play:${instance.id}:strong`, label: `${card.name}：强化效果`, command: { type: 'PLAY_CARD', cardId: instance.id, mode: 'strong' }, group: 'card' });
      }
    }
    for (const resource of legalResources.filter((candidate) => candidate !== 'heal')) {
      if (state.phase === 'combat-ranged' && resource === 'attack') continue;
      intents.push({ id: `play:${instance.id}:sideways:${resource}`, label: `${card.name}：横置为${resourceLabel(resource)} 1`, command: { type: 'PLAY_CARD', cardId: instance.id, mode: 'sideways', sidewaysResource: resource }, group: 'card' });
    }
  }
  return intents;
}

export function getLegalIntents(state: GameState, content: TutorialContent): LegalIntent[] {
  if (state.scenario.status !== 'playing') return [];
  if (state.pendingDecision) {
    return state.pendingDecision.options.map((option) => ({
      id: `decision:${option.id}`,
      label: option.label,
      command: { type: 'RESOLVE_DECISION', optionId: option.id },
      group: 'decision',
    }));
  }
  const intents = cardIntents(state, content);
  const totals = resourceTotals(state);
  if (state.phase === 'movement') {
    for (const space of Object.values(state.map)) {
      const cost = terrainCost(space.terrain, state.time);
      if (areAdjacent(state.player.position, space.coord) && Number.isFinite(cost) && totals.move >= cost) {
        intents.push({ id: `move:${coordKey(space.coord)}`, label: `移动到 ${coordKey(space.coord)}（${cost}）`, command: { type: 'MOVE_HERO', to: space.coord }, group: 'map' });
      }
    }
    if (!state.explored && coordKey(state.player.position) === '1,0' && totals.move >= 2) {
      intents.push({ id: 'explore', label: '探索新板块（移动 2）', command: { type: 'EXPLORE_TILE' }, group: 'map' });
    }
    intents.push({ id: 'finish-movement', label: '结束移动', command: { type: 'FINISH_MOVEMENT' }, group: 'action' });
    const woundIds = state.player.hand.filter((card) => content.cards[card.definitionId]?.kind === 'wound').map((card) => card.id);
    const nonWounds = state.player.hand.filter((card) => content.cards[card.definitionId]?.kind !== 'wound');
    if (nonWounds.length > 0) {
      for (const card of nonWounds) {
        intents.push({ id: `rest:${card.id}`, label: `休息并弃置${content.cards[card.definitionId]?.name ?? card.id}`, command: { type: 'REST', discardCardId: card.id, woundCardIds: woundIds }, group: 'action' });
      }
    } else if (woundIds[0]) {
      intents.push({ id: `rest:${woundIds[0]}`, label: '慢速恢复并弃置一张伤牌', command: { type: 'REST', discardCardId: woundIds[0], woundCardIds: [] }, group: 'action' });
    }
    if (state.player.deck.length === 0) intents.push({ id: 'end-round', label: '宣布轮末', command: { type: 'DECLARE_END_ROUND' }, group: 'action' });
  }
  if (state.phase === 'action') {
    const space = state.map[coordKey(state.player.position)];
    if (!state.actionTaken && space?.site === 'village') intents.push({ id: 'interact', label: '与村庄互动', command: { type: 'START_INTERACTION' }, group: 'action' });
    if (!state.actionTaken) {
      for (const enemy of Object.values(state.enemies)) {
        if (!enemy.defeated && (areAdjacent(state.player.position, enemy.position) || coordKey(state.player.position) === coordKey(enemy.position))) {
          intents.push({ id: `combat:${enemy.id}`, label: `挑战 ${content.enemies[enemy.definitionId]?.name ?? enemy.id}`, command: { type: 'START_COMBAT', enemyIds: [enemy.id] }, group: 'combat' });
        }
      }
    }
    intents.push({ id: 'end-turn', label: '结束回合', command: { type: 'END_TURN' }, group: 'action' });
  }
  if (state.phase === 'interaction') {
    const unit = content.units['core.unit.peasants'];
    if (unit && state.player.units.length < state.player.commandSlots && totals.influence >= unit.influenceCost) {
      intents.push({ id: 'recruit', label: `招募${unit.name}（影响 ${unit.influenceCost}）`, command: { type: 'RECRUIT_UNIT', definitionId: unit.id }, group: 'action' });
    }
    for (const card of state.player.hand) {
      if (content.cards[card.definitionId]?.kind === 'wound' && totals.heal >= 1) intents.push({ id: `heal:${card.id}`, label: '治疗一张伤牌', command: { type: 'HEAL_WOUND', cardId: card.id }, group: 'action' });
    }
    intents.push({ id: 'finish-interaction', label: '结束互动', command: { type: 'FINISH_INTERACTION' }, group: 'action' });
  }
  if (state.phase === 'combat-ranged' || state.phase === 'combat-attack') {
    const availableEnemies = state.encounter?.enemyIds.filter((id) => !state.enemies[id]?.defeated) ?? [];
    if (availableEnemies.length > 0 && totals.attack > 0) {
      for (const enemyId of availableEnemies) {
        for (const kind of (state.phase === 'combat-ranged' ? ['ranged', 'siege'] : ['normal']) as AttackKind[]) {
          const intent: LegalIntent = { id: `attack:${enemyId}:${kind}`, label: `以${kind === 'siege' ? '攻城' : kind === 'ranged' ? '远程' : '普通'}攻击目标`, command: { type: 'DECLARE_ATTACK', enemyIds: [enemyId], kind }, group: 'combat' };
          if (executeIntent(state, intent.command, content).ok) intents.push(intent);
        }
      }
    }
    intents.push({ id: 'advance-combat', label: state.phase === 'combat-ranged' ? '结束远程/攻城阶段' : '结束普通攻击阶段', command: { type: 'ADVANCE_COMBAT_PHASE' }, group: 'combat' });
  }
  if (state.phase === 'combat-block') {
    for (const attack of state.encounter?.incoming.filter((candidate) => !candidate.resolved) ?? []) {
      const intent: LegalIntent = { id: `block:${attack.enemyId}:${attack.attackIndex}`, label: `格挡攻击 ${attack.attackIndex + 1}`, command: { type: 'DECLARE_BLOCK', enemyId: attack.enemyId, attackIndex: attack.attackIndex }, group: 'combat' };
      if (executeIntent(state, intent.command, content).ok) intents.push(intent);
    }
    intents.push({ id: 'advance-combat', label: '结束格挡阶段', command: { type: 'ADVANCE_COMBAT_PHASE' }, group: 'combat' });
  }
  if (state.phase === 'combat-damage') {
    for (const attack of state.encounter?.incoming.filter((candidate) => !candidate.resolved) ?? []) {
      intents.push({ id: `damage:${attack.enemyId}:${attack.attackIndex}:hero`, label: '由英雄承受伤害', command: { type: 'ASSIGN_DAMAGE', enemyId: attack.enemyId, attackIndex: attack.attackIndex, target: 'hero' }, group: 'combat' });
      for (const unit of state.player.units.filter((candidate) => !candidate.wounded)) {
        intents.push({ id: `damage:${attack.enemyId}:${attack.attackIndex}:${unit.id}`, label: `由单位承受伤害`, command: { type: 'ASSIGN_DAMAGE', enemyId: attack.enemyId, attackIndex: attack.attackIndex, target: unit.id }, group: 'combat' });
      }
    }
    if (state.encounter?.incoming.every((attack) => attack.resolved)) intents.push({ id: 'advance-combat', label: '进入普通攻击阶段', command: { type: 'ADVANCE_COMBAT_PHASE' }, group: 'combat' });
  }
  if (legalResourcesForPhase(state.phase).includes('attack') && state.player.units.some((unit) => unit.ready && !unit.wounded)) {
    const intent: LegalIntent = { id: 'activate-unit', label: '激活单位', command: { type: 'ACTIVATE_UNIT' }, group: 'action' };
    if (executeIntent(state, intent.command, content).ok) intents.push(intent);
  }
  return intents;
}

export function projectView(state: GameState, content: TutorialContent): GameView {
  const projected = cloneState(state);
  const { rngState: _rngState, ...visibleState } = projected;
  void _rngState;
  return {
    ...visibleState,
    legalIntents: getLegalIntents(state, content),
    resourceTotals: resourceTotals(state),
  };
}
