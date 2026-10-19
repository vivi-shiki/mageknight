import type { BasicManaColor, ConquestContent, EffectNode, MarketKind } from '@mageknight/content';
import { areAdjacent, coordKey, hexDistance } from '../hex';
import { evaluateEffect } from '../effect-dsl';
import { activateConquestUnit, advanceConquestCombat, conquestAssignDamage, conquestDeclareAttack, conquestDeclareBlock, conquestDeclareLeaderAttack, reduceCumbersome, startConquestCombat, startFactionLeaderCombat } from './combat';
import { activateConquestAttachment, activateSkill, effectTargets, flipBackSkill, healConquestWound, legalResources, playConquestCard } from './cards';
import { allowedMarkets, buyMarket, marketCost } from './market';
import { canExplore, explorationDistance, hasWall, isSafeSpace, revealNextTile } from './map';
import { assertConquestInvariants, cloneConquestState, conquestFailure, conquestTerrainCost, resourceTotals, spendResource, appendEvent } from './state';
import { declareConquestRoundEnd, endConquestTurn, resolveConquestDecision, selectTactic } from './turn';
import { activateFactionToken, ambushingEnemies, resolvePursuit, sealGraveyard } from './tezla';
import type { ConquestCommand, ConquestIntent, ConquestResult, ConquestState, ConquestView } from './types';

function currentSite(state: ConquestState, content: ConquestContent) {
  const space = state.map[coordKey(state.player.position)];
  const site = space?.siteId ? content.sites[space.siteId] : undefined;
  return { space, site };
}

function movementCost(state: ConquestState, content: ConquestContent, to: { q: number; r: number }): number {
  const space = state.map[coordKey(to)];
  if (!space) return Number.POSITIVE_INFINITY;
  const distance = hexDistance(state.player.position, to);
  const mode = state.ruleRuntime.movementMode;
  if (!mode && distance !== 1) return Number.POSITIVE_INFINITY;
  if (mode && (distance < 1 || distance > mode.maxDistance)) return Number.POSITIVE_INFINITY;
  if (mode?.kind === 'wings-of-wind') return distance;
  if (mode?.kind === 'underground' || mode?.kind === 'underground-assault') {
    if (space.terrain === 'wasteland' || space.terrain === 'lake') return Number.POSITIVE_INFINITY;
    if (!mode.allowFortified && space.siteId && content.sites[space.siteId]?.fortified && !space.conquered) return Number.POSITIVE_INFINITY;
    if (!mode.allowFortified && !isSafeSpace(state, to)) return Number.POSITIVE_INFINITY;
    return 0;
  }
  const overlay = state.overlays[coordKey(to)];
  const terrain = overlay && content.siteOverlays[overlay.definitionId]?.moveCost !== undefined
    ? content.siteOverlays[overlay.definitionId]!.moveCost!
    : conquestTerrainCost(state, space.terrain);
  return terrain + (!mode && !state.ruleRuntime.ignoreWalls && hasWall(state, state.player.position, to) ? 1 : 0);
}

function handleInteraction(state: ConquestState, content: ConquestContent, command: ConquestCommand, events: ConquestState['eventLog']): ConquestResult | undefined {
  const { space, site } = currentSite(state, content);
  if (!space || !site) return conquestFailure(state, 'INVALID_TARGET', '当前位置没有地点。');
  if (command.type === 'START_INTERACTION') {
    if (state.phase !== 'action' || state.actionTaken) return conquestFailure(state, 'WRONG_PHASE', '本回合不能再互动。');
    if (site.fortified && !space.conquered) return conquestFailure(state, 'INVALID_TARGET', '必须先征服该地点。');
    state.phase = 'interaction';
    appendEvent(state, events, 'InteractionStarted', `开始与${site.name}互动。`, { siteId: site.id });
    return undefined;
  }
  if (state.phase !== 'interaction') return conquestFailure(state, 'WRONG_PHASE', '当前不在互动阶段。');
  if (command.type === 'BUY_MARKET' || command.type === 'RECRUIT_UNIT') {
    const kind: MarketKind = command.type === 'RECRUIT_UNIT' ? 'unit' : command.market;
    const definitionId = command.definitionId;
    if (!allowedMarkets(site.kind, space.conquered || !site.fortified).includes(kind)) return conquestFailure(state, 'INVALID_TARGET', '该地点不提供这类购买。');
    const result = buyMarket(state, content, kind, definitionId, site.kind, events);
    if (typeof result === 'string') return conquestFailure(state, result.includes('需要') ? 'INSUFFICIENT_RESOURCE' : 'INVALID_TARGET', result);
    if (result) { state.pendingDecision = result; state.phase = 'decision'; appendEvent(state, events, 'DecisionOpened', result.prompt, { decisionId: result.id }); }
    return undefined;
  }
  if (command.type === 'HEAL') {
    const cost = site.healCost ?? 2;
    if (!spendResource(state, 'influence', cost)) return conquestFailure(state, 'INSUFFICIENT_RESOURCE', `治疗需要 ${cost} 影响。`);
    if (command.target === 'hero') {
      const woundId = state.player.zones.hand.concat(state.player.zones.discard).find((id) => state.player.cardInstances[id]?.definitionId === 'core.card.wound');
      if (!woundId) return conquestFailure(state, 'INVALID_TARGET', '没有可治疗的英雄伤牌。');
      for (const zone of ['hand', 'discard'] as const) state.player.zones[zone] = state.player.zones[zone].filter((id) => id !== woundId);
      state.player.zones.removed.push(woundId);
    } else {
      const unit = state.player.units.find((item) => item.id === command.target && !item.destroyed && item.wounds > 0);
      if (!unit) return conquestFailure(state, 'INVALID_TARGET', '该单位无需治疗。');
      const unitCost = content.units[unit.definitionId]?.level ?? 1;
      if (cost < unitCost) return conquestFailure(state, 'INSUFFICIENT_RESOURCE', `治疗该单位需要 ${unitCost} 影响。`);
      unit.wounds -= 1;
    }
    appendEvent(state, events, 'Healed', '完成一次治疗。', { target: command.target, cost });
    return undefined;
  }
  if (command.type === 'BURN_MONASTERY') {
    if (site.kind !== 'monastery' || space.burned) return conquestFailure(state, 'INVALID_TARGET', '当前位置不能焚烧修道院。');
    space.burned = true;
    state.player.reputation = Math.max(-7, state.player.reputation - 3);
    const definitionId = state.enemyPools.brown.shift();
    if (!definitionId) return conquestFailure(state, 'INVALID_TARGET', '棕色敌人池为空。');
    const enemyId = `enemy-${state.nextEntityId++}`;
    state.enemies[enemyId] = { id: enemyId, definitionId, position: { ...state.player.position }, defeated: false, summoned: false };
    space.enemyIds.push(enemyId);
    return startConquestCombat(state, content, [enemyId], state.player.position, events);
  }
  if (command.type === 'FINISH_INTERACTION') {
    state.phase = 'action'; state.actionTaken = true;
    appendEvent(state, events, 'InteractionFinished', `结束与${site.name}互动。`, { siteId: site.id });
    return undefined;
  }
  return conquestFailure(state, 'INVALID_COMMAND', '该命令不是地点互动。');
}

export function executeConquestIntent(state: ConquestState, command: ConquestCommand, content: ConquestContent): ConquestResult {
  if (state.scenario.status !== 'playing') return conquestFailure(state, 'GAME_ALREADY_OVER', '场景已经结束。');
  if (state.pendingDecision && command.type !== 'RESOLVE_DECISION') return conquestFailure(state, 'DECISION_REQUIRED', '必须先完成当前选择。');
  const next = cloneConquestState(state);
  const events: ConquestState['eventLog'] = [];
  let failed: ConquestResult | undefined;

  switch (command.type) {
    case 'SELECT_TACTIC': failed = selectTactic(next, content, command.tacticId, events); break;
    case 'PLAY_CARD': failed = playConquestCard(next, content, command, events); break;
    case 'USE_SKILL': failed = activateSkill(next, content, command, events); break;
    case 'FLIP_BACK_SKILL': failed = flipBackSkill(next, content, command, events); break;
    case 'REST': {
      if (next.phase !== 'movement') { failed = conquestFailure(state, 'WRONG_PHASE', '只能在回合开始选择休息。'); break; }
      const discard = next.player.cardInstances[command.discardCardId];
      if (!discard || !next.player.zones.hand.includes(command.discardCardId)) { failed = conquestFailure(state, 'CARD_NOT_IN_HAND', '弃置牌不在手牌中。'); break; }
      const allWounds = next.player.zones.hand.every((id) => next.player.cardInstances[id]?.definitionId === 'core.card.wound');
      if (discard.definitionId === 'core.card.wound' && !allWounds) { failed = conquestFailure(state, 'INVALID_COMMAND', '标准休息必须弃置一张非伤牌。'); break; }
      const ids = [...new Set([command.discardCardId, ...command.woundCardIds])];
      if (ids.some((id) => !next.player.zones.hand.includes(id)) || command.woundCardIds.some((id) => next.player.cardInstances[id]?.definitionId !== 'core.card.wound')) { failed = conquestFailure(state, 'INVALID_TARGET', '休息弃置包含非法牌。'); break; }
      next.player.zones.hand = next.player.zones.hand.filter((id) => !ids.includes(id));
      next.player.zones.discard.push(...ids);
      for (const skillState of next.player.skills) {
        const definition = content.skills[skillState.definitionId];
        if (skillState.flipped && definition?.flipBackCondition === 'rest') { skillState.flipped = false; skillState.used = false; }
      }
      next.phase = 'action'; next.actionTaken = true;
      appendEvent(next, events, 'PlayerRested', '完成休息并翻回满足条件的技能。', { cardIds: ids });
      break;
    }
    case 'HARVEST_CRYSTAL': {
      const card = next.player.cardInstances[command.cardId];
      const definition = card ? content.cards[card.definitionId] : undefined;
      if (next.ruleRuntime.harvestOpportunities <= 0 || !card || !definition || !next.player.zones.hand.includes(command.cardId) || definition.kind === 'wound') { failed = conquestFailure(state, 'INVALID_TARGET', '当前不能收割这张牌。'); break; }
      const color = content.artifactDeck.includes(definition.id) ? command.color : definition.color;
      if (!color) { failed = conquestFailure(state, 'INVALID_COMMAND', '神器收割必须选择水晶颜色。'); break; }
      next.player.zones.hand = next.player.zones.hand.filter((id) => id !== command.cardId);
      next.player.zones.discard.push(command.cardId);
      next.player.crystals[color] = Math.min(3, next.player.crystals[color] + 1);
      next.ruleRuntime.harvestOpportunities -= 1;
      if (next.ruleRuntime.savageHarvesting === 'once') delete next.ruleRuntime.savageHarvesting;
      appendEvent(next, events, 'CrystalHarvested', `弃牌获得一枚 ${color} 水晶。`, { cardId: command.cardId, color });
      break;
    }
    case 'READY_UNIT_WITH_INFLUENCE': {
      const unit = next.player.units.find((candidate) => candidate.id === command.unitId && !candidate.destroyed && !candidate.ready && candidate.wounds === 0);
      const level = unit ? content.units[unit.definitionId]?.level : undefined;
      if (!next.ruleRuntime.ruthlessReadyUnits || !unit || !level || level > 2) { failed = conquestFailure(state, 'INVALID_TARGET', '该单位不能由无情胁迫整备。'); break; }
      const cost = level * 2;
      if (!spendResource(next, 'influence', cost)) { failed = conquestFailure(state, 'INSUFFICIENT_RESOURCE', `整备该单位需要 ${cost} 影响。`); break; }
      unit.ready = true;
      appendEvent(next, events, 'UnitReadied', `支付 ${cost} 影响整备${content.units[unit.definitionId]?.name ?? unit.id}。`, { unitId: unit.id, cost });
      break;
    }
    case 'MOVE_HERO': {
      if (next.phase !== 'movement') { failed = conquestFailure(state, 'WRONG_PHASE', '当前不能移动。'); break; }
      const space = next.map[coordKey(command.to)];
      const cost = movementCost(next, content, command.to);
      if (!space || !Number.isFinite(cost)) { failed = conquestFailure(state, 'INVALID_TARGET', '该位置不符合当前移动规则。'); break; }
      if (!Number.isFinite(cost) || !spendResource(next, 'move', cost)) { failed = conquestFailure(state, 'INSUFFICIENT_RESOURCE', `进入该地形需要 ${Number.isFinite(cost) ? cost : '无限'} 移动。`); break; }
      const origin = { ...next.player.position };
      next.player.position = { ...command.to };
      if (next.ruleRuntime.savageHarvesting) next.ruleRuntime.harvestOpportunities += 1;
      appendEvent(next, events, 'HeroMoved', `移动到 ${coordKey(command.to)}。`, { from: origin, to: command.to, cost });
      const mode = next.ruleRuntime.movementMode;
      if (mode?.kind !== 'space-bending') delete next.ruleRuntime.movementMode;
      const ambushers = ambushingEnemies(next, content, origin, command.to).filter((id) => !space.enemyIds.includes(id));
      const combatants = [...space.enemyIds, ...ambushers];
      const leaderEntry = Object.entries(next.factionLeaders).find(([, leader]) => !leader.defeated && leader.position && coordKey(leader.position) === coordKey(command.to));
      if (leaderEntry && (!mode?.ignoreEnemies || mode.allowFortified)) {
        failed = startFactionLeaderCombat(next, content, leaderEntry[0], events);
        if (!failed && next.encounter) next.encounter.origin = origin;
      } else if (combatants.length > 0 && (!mode?.ignoreEnemies || mode.allowFortified)) {
        next.ruleRuntime.ignoreFortification = Boolean(mode?.allowFortified);
        failed = startConquestCombat(next, content, combatants, origin, events, hasWall(next, origin, command.to));
        if (ambushers.length > 0 && !failed) appendEvent(next, events, 'AmbushTriggered', `${ambushers.length} 名敌人从两格内发动伏击。`, { enemyIds: ambushers });
      }
      break;
    }
    case 'EXPLORE_TILE':
      if (next.phase !== 'movement' || (!canExplore(next) && !(next.ruleRuntime.movementMode?.kind === 'space-bending' && explorationDistance(next, next.player.position) <= 2))) failed = conquestFailure(state, 'INVALID_TARGET', '只能在下一个楔形板块的相邻边界探索。');
      else if (!spendResource(next, 'move', Math.max(1, 2 - next.ruleRuntime.explorationDiscount))) failed = conquestFailure(state, 'INSUFFICIENT_RESOURCE', `探索需要 ${Math.max(1, 2 - next.ruleRuntime.explorationDiscount)} 移动。`);
      else revealNextTile(next, content, events);
      break;
    case 'FINISH_MOVEMENT':
      if (next.phase !== 'movement') failed = conquestFailure(state, 'WRONG_PHASE', '当前不在移动阶段。');
      else {
        const attackers = resolvePursuit(next, content, events);
        if (attackers.length > 0) failed = startConquestCombat(next, content, attackers, next.player.position, events);
        else { next.phase = 'action'; appendEvent(next, events, 'MovementFinished', '结束移动阶段。'); }
      }
      break;
    case 'START_COMBAT': {
      if (next.phase !== 'action' || next.actionTaken) { failed = conquestFailure(state, 'WRONG_PHASE', '本回合不能再开始战斗。'); break; }
      const valid = command.enemyIds.every((id) => {
        const enemy = next.enemies[id];
        return enemy && !enemy.defeated && (areAdjacent(next.player.position, enemy.position) || coordKey(next.player.position) === coordKey(enemy.position));
      });
      if (!valid) failed = conquestFailure(state, 'INVALID_TARGET', '只能挑战当前格或相邻格敌人。');
      else {
        const target = next.enemies[command.enemyIds[0] ?? '']?.position ?? next.player.position;
        failed = startConquestCombat(next, content, command.enemyIds, next.player.position, events, hasWall(next, next.player.position, target));
      }
      break;
    }
    case 'START_LEADER_COMBAT':
      if (next.phase !== 'action' || next.actionTaken) failed = conquestFailure(state, 'WRONG_PHASE', '本回合不能再挑战首领。');
      else failed = startFactionLeaderCombat(next, content, command.leaderId, events);
      break;
    case 'DECLARE_ATTACK': failed = conquestDeclareAttack(next, content, command, events); break;
    case 'DECLARE_LEADER_ATTACK': failed = conquestDeclareLeaderAttack(next, content, command, events); break;
    case 'DECLARE_BLOCK': failed = conquestDeclareBlock(next, content, command, events); break;
    case 'REDUCE_CUMBERSOME': failed = reduceCumbersome(next, content, command, events); break;
    case 'ASSIGN_DAMAGE': failed = conquestAssignDamage(next, content, command, events); break;
    case 'ADVANCE_COMBAT_PHASE': failed = advanceConquestCombat(next, content, events); break;
    case 'ACTIVATE_UNIT': failed = activateConquestUnit(next, content, command, events); break;
    case 'USE_ATTACHMENT': failed = activateConquestAttachment(next, content, command, events); break;
    case 'HEAL_WOUND': failed = healConquestWound(next, content, command, events); break;
    case 'START_INTERACTION':
    case 'BUY_MARKET':
    case 'RECRUIT_UNIT':
    case 'HEAL':
    case 'BURN_MONASTERY':
    case 'FINISH_INTERACTION': failed = handleInteraction(next, content, command, events); break;
    case 'ENTER_ADVENTURE_SITE': {
      const { space, site } = currentSite(next, content);
      const key = coordKey(next.player.position);
      if (next.phase !== 'action' || next.actionTaken || !space || (site?.kind !== 'maze' && site?.kind !== 'labyrinth')) failed = conquestFailure(state, 'WRONG_PHASE', '当前位置不能进入迷宫。');
      else if (next.adventureClaims[key]?.includes(command.amount)) failed = conquestFailure(state, 'INVALID_TARGET', '这条迷宫路径已经完成。');
      else if (command.amount === 2 && (command.crystalColors?.length !== 2 || command.crystalColors.some((color) => !['red', 'blue', 'white', 'green'].includes(color)))) failed = conquestFailure(state, 'INVALID_TARGET', '两点路径必须预先选择两枚基础颜色水晶。');
      else if (!spendResource(next, 'move', command.amount)) failed = conquestFailure(state, 'INSUFFICIENT_RESOURCE', `进入迷宫需要 ${command.amount} 移动。`);
      else {
        let enemyIds = space.enemyIds.filter((id) => !next.enemies[id]?.defeated);
        if (enemyIds.length === 0) {
          const pool = site.kind === 'maze' ? 'brown' : 'red';
          const definitionId = next.enemyPools[pool].shift();
          if (definitionId) {
            next.enemyPools[pool].push(definitionId);
            const enemyId = `enemy-${next.nextEntityId++}`;
            next.enemies[enemyId] = { id: enemyId, definitionId, position: { ...next.player.position }, defeated: false, summoned: false };
            space.enemyIds.push(enemyId);
            enemyIds = [enemyId];
          }
        }
        if (enemyIds.length === 0) failed = conquestFailure(state, 'INVALID_TARGET', '迷宫敌人池为空。');
        else {
          failed = startConquestCombat(next, content, enemyIds, next.player.position, events);
          if (!failed && next.encounter) {
            next.encounter.adventureMove = command.amount;
            if (command.crystalColors) next.encounter.adventureCrystalColors = [...command.crystalColors];
          }
        }
      }
      break;
    }
    case 'CLAIM_DEEP_MINE': {
      const { site } = currentSite(next, content);
      if (next.phase !== 'action' || site?.kind !== 'deep-mine' || next.ruleRuntime.deepMineClaimed) failed = conquestFailure(state, 'WRONG_PHASE', '当前不能从深层矿井取得水晶。');
      else {
        next.player.crystals[command.color] = Math.min(3, next.player.crystals[command.color] + 1);
        next.ruleRuntime.deepMineClaimed = true;
        appendEvent(next, events, 'DeepMineCrystalClaimed', `从深层矿井取得一枚${command.color}水晶。`, { color: command.color });
      }
      break;
    }
    case 'USE_FACTION_TOKEN': failed = activateFactionToken(next, content, command, events); break;
    case 'SEAL_GRAVEYARD': failed = sealGraveyard(next, events); break;
    case 'END_TURN': failed = endConquestTurn(next, content, events); break;
    case 'DECLARE_END_ROUND': failed = declareConquestRoundEnd(next, content, events); break;
    case 'RESOLVE_DECISION': failed = resolveConquestDecision(next, content, command.optionId, events); break;
    default: { const exhaustive: never = command; failed = conquestFailure(state, 'INVALID_COMMAND', `未知命令 ${String(exhaustive)}`); }
  }
  if (failed && !failed.ok) return conquestFailure(state, failed.error.code, failed.error.message);
  next.eventLog.push(...events);
  assertConquestInvariants(next);
  return { ok: true, state: next, events };
}

function targetName(state: ConquestState, content: ConquestContent, id: string): string {
  const enemy = state.enemies[id];
  if (enemy) return content.enemies[enemy.definitionId]?.name ?? id;
  const unit = state.player.units.find((candidate) => candidate.id === id);
  if (unit) return content.units[unit.definitionId]?.name ?? id;
  const card = state.player.cardInstances[id];
  return card ? content.cards[card.definitionId]?.name ?? id : content.units[id]?.name ?? id;
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  return items.flatMap((item, index) => combinations(items.slice(index + 1), size - 1).map((rest) => [item, ...rest]));
}

function colorSelections(count: number, start = 0): BasicManaColor[][] {
  const colors: BasicManaColor[] = ['red', 'blue', 'white', 'green'];
  if (count === 0) return [[]];
  return colors.slice(start).flatMap((color, offset) => colorSelections(count - 1, start + offset).map((rest) => [color, ...rest]));
}

function effectIntents(
  state: ConquestState,
  content: ConquestContent,
  sourceId: string,
  node: EffectNode,
  idPrefix: string,
  label: string,
  group: ConquestIntent['group'],
  makeCommand: (choiceIndex?: number, targetId?: string) => ConquestCommand,
): ConquestIntent[] {
  const preview = evaluateEffect(node, { time: state.time });
  const choices: Array<number | undefined> = preview.choiceRequired
    ? (preview.choiceLabels ?? []).map((_, index) => index)
    : [undefined];
  const intents: ConquestIntent[] = [];
  for (const choiceIndex of choices) {
    const targets = effectTargets(state, node, choiceIndex, sourceId);
    const targetIds: Array<string | undefined> = targets.kind ? targets.ids : [undefined];
    for (const targetId of targetIds) {
      const choiceLabel = choiceIndex === undefined ? '' : `：${preview.choiceLabels?.[choiceIndex] ?? `选项 ${choiceIndex + 1}`}`;
      const targetLabel = targetId ? ` → ${targetName(state, content, targetId)}` : '';
      const command = makeCommand(choiceIndex, targetId);
      const intent: ConquestIntent = { id: `${idPrefix}:${choiceIndex ?? 'direct'}:${targetId ?? 'none'}`, label: `${label}${choiceLabel}${targetLabel}`, command, group };
      if (executeConquestIntent(state, command, content).ok) intents.push(intent);
    }
  }
  return intents;
}

function cardIntents(state: ConquestState, content: ConquestContent): ConquestIntent[] {
  const resources = legalResources(state.phase);
  const intents: ConquestIntent[] = [];
  for (const cardId of state.player.zones.hand) {
    const definition = content.cards[state.player.cardInstances[cardId]?.definitionId ?? ''];
    if (!definition || definition.kind === 'wound') continue;
    for (const mode of ['basic', 'strong'] as const) {
      const effect = mode === 'basic' ? definition.basicEffect ?? definition.basic : definition.strongEffect ?? definition.strong;
      if (effect) intents.push(...effectIntents(state, content, cardId, effect, `card:${cardId}:${mode}`, `${definition.name}：${mode === 'basic' ? '基础' : '强化'}`, 'card', (choiceIndex, targetId) => ({ type: 'PLAY_CARD', cardId, mode, ...(choiceIndex === undefined ? {} : { choiceIndex }), ...(targetId === undefined ? {} : { targetId }) })));
    }
    for (const resource of resources.filter((item) => item !== 'heal')) {
      const intent: ConquestIntent = { id: `card:${cardId}:sideways:${resource}`, label: `${definition.name}：横置为 ${resource} 1`, command: { type: 'PLAY_CARD', cardId, mode: 'sideways', sidewaysResource: resource }, group: 'card' };
      if (executeConquestIntent(state, intent.command, content).ok) intents.push(intent);
    }
    if (definition.id === 'core.card.advanced.blood-ritual') {
      for (const colors of colorSelections(1)) {
        const basicCommand: ConquestCommand = { type: 'PLAY_CARD', cardId, mode: 'basic', manaColors: colors };
        if (executeConquestIntent(state, basicCommand, content).ok) intents.push({ id: `card:${cardId}:blood-basic:${colors.join('-')}`, label: `${definition.name}：基础 → ${colors.join('/')}`, command: basicCommand, group: 'card' });
      }
      for (const colors of colorSelections(3)) {
        for (const crystal of [0, 1] as const) {
          const command: ConquestCommand = { type: 'PLAY_CARD', cardId, mode: 'strong', manaColors: colors, amount: crystal };
          const suffix = crystal ? `，${colors.at(-1)} 转水晶` : '';
          if (executeConquestIntent(state, command, content).ok) intents.push({ id: `card:${cardId}:blood:${colors.join('-')}:${crystal}`, label: `${definition.name}：强化 → ${colors.join('/')}${suffix}`, command, group: 'card' });
        }
      }
    }
    if (definition.id === 'core.card.spell.meditation') {
      const candidates = state.player.zones.discard.filter((id) => state.player.cardInstances[id]?.definitionId !== 'core.card.wound');
      for (const ids of combinations(candidates, 2).slice(0, 20)) {
        const command: ConquestCommand = { type: 'PLAY_CARD', cardId, mode: 'strong', targetIds: ids, ...(ids[0] ? { targetId: ids[0] } : {}) };
        if (executeConquestIntent(state, command, content).ok) intents.push({ id: `card:${cardId}:meditation:${ids.join(':')}`, label: `${definition.name}：选择 ${ids.map((id) => targetName(state, content, id)).join('、')}`, command, group: 'card' });
      }
    }
    if (definition.id === 'core.card.spell.call-to-arms') {
      for (const unitId of state.market.unit.offer) {
        const unit = content.units[unitId];
        unit?.abilities?.forEach((ability, secondaryIndex) => {
          const preview = evaluateEffect(ability.effect, { time: state.time });
          const choices: Array<number | undefined> = preview.choiceRequired ? (preview.choiceLabels ?? []).map((_, index) => index) : [undefined];
          for (const choiceIndex of choices) {
            const targets = effectTargets(state, ability.effect, choiceIndex, cardId);
            const ids: Array<string | undefined> = targets.kind ? targets.ids : [undefined];
            for (const secondaryTargetId of ids) {
              const command: ConquestCommand = { type: 'PLAY_CARD', cardId, mode: 'basic', targetId: unitId, secondaryIndex, ...(choiceIndex === undefined ? {} : { choiceIndex }), ...(secondaryTargetId ? { secondaryTargetId } : {}) };
              if (executeConquestIntent(state, command, content).ok) intents.push({ id: `card:${cardId}:call:${unitId}:${secondaryIndex}:${choiceIndex ?? 'direct'}:${secondaryTargetId ?? 'none'}`, label: `${definition.name}：${unit.name} → ${ability.label}${choiceIndex === undefined ? '' : `：${preview.choiceLabels?.[choiceIndex]}`}`, command, group: 'card' });
            }
          }
        });
        const command: ConquestCommand = { type: 'PLAY_CARD', cardId, mode: 'strong', targetId: unitId };
        if (executeConquestIntent(state, command, content).ok) intents.push({ id: `card:${cardId}:recruit:${unitId}`, label: `${definition.name}：免费招募 ${unit?.name ?? unitId}`, command, group: 'card' });
      }
    }
    if (definition.id === 'core.card.spell.wings-of-wind' || definition.id === 'core.card.artifact.banner-fear') {
      const enemies = state.encounter?.enemyIds.filter((id) => !state.enemies[id]?.defeated) ?? [];
      for (let size = 1; size <= Math.min(3, enemies.length); size += 1) for (const ids of combinations(enemies, size)) {
        const command: ConquestCommand = { type: 'PLAY_CARD', cardId, mode: 'strong', targetId: ids[0]!, targetIds: ids };
        if (executeConquestIntent(state, command, content).ok) intents.push({ id: `card:${cardId}:skip:${ids.join(':')}`, label: `${definition.name}：跳过 ${ids.map((id) => targetName(state, content, id)).join('、')}`, command, group: 'card' });
      }
    }
    if (definition.id === 'core.card.artifact.amulet-darkness') {
      for (const mode of ['basic', 'strong'] as const) for (const colors of colorSelections(mode === 'strong' ? 3 : 1)) {
        const count = mode === 'strong' ? 3 : 1;
        const command: ConquestCommand = { type: 'PLAY_CARD', cardId, mode, manaColors: colors };
        if (executeConquestIntent(state, command, content).ok) intents.push({ id: `card:${cardId}:dark:${mode}:${colors.join('-')}`, label: `${definition.name}：${mode === 'strong' ? '强化' : '基础'} → ${colors.join('/')}（${count}）`, command, group: 'card' });
      }
    }
    if (definition.id === 'core.card.spell.restoration') {
      const units = state.player.units.filter((unit) => !unit.destroyed && unit.wounds === 0 && !unit.ready);
      const limit = state.map[coordKey(state.player.position)]?.terrain === 'forest' ? 5 : 3;
      for (let size = 1; size <= units.length; size += 1) for (const selected of combinations(units, size).filter((items) => items.reduce((sum, unit) => sum + (content.units[unit.definitionId]?.level ?? 99), 0) <= limit).slice(0, 20)) {
        const ids = selected.map((unit) => unit.id);
        const command: ConquestCommand = { type: 'PLAY_CARD', cardId, mode: 'strong', targetId: ids[0]!, targetIds: ids };
        if (executeConquestIntent(state, command, content).ok) intents.push({ id: `card:${cardId}:restore:${ids.join(':')}`, label: `${definition.name}：整备 ${selected.map((unit) => content.units[unit.definitionId]?.name).join('、')}`, command, group: 'card' });
      }
    }
    if (definition.id === 'core.card.artifact.horn') {
      for (let amount = 0; amount <= 5; amount += 1) {
        const command: ConquestCommand = { type: 'PLAY_CARD', cardId, mode: 'strong', amount };
        if (executeConquestIntent(state, command, content).ok) intents.push({ id: `card:${cardId}:horn:${amount}`, label: `${definition.name}：攻城 ${5 + amount}（掷骰 ${amount}）`, command, group: 'card' });
      }
    }
  }
  return intents;
}

function marketIntents(state: ConquestState, content: ConquestContent): ConquestIntent[] {
  const { space, site } = currentSite(state, content);
  if (state.phase !== 'interaction' || !space || !site) return [];
  const totals = resourceTotals(state);
  const intents: ConquestIntent[] = [];
  for (const kind of allowedMarkets(site.kind, space.conquered || !site.fortified)) {
    const offer = kind === 'unit' ? state.market.unit.offer : state.market[kind].offer;
    for (const definitionId of offer) {
      const cost = marketCost(kind, definitionId, content, state.ruleRuntime.ignoreReputation ? 0 : state.player.reputation, site.kind, state.ruleRuntime.recruitDiscount);
      if (totals.influence >= cost && (kind !== 'unit' || content.units[definitionId]?.siteKinds.includes(site.kind))) {
        const name = kind === 'unit' ? content.units[definitionId]?.name : content.cards[definitionId]?.name;
        intents.push({ id: `buy:${kind}:${definitionId}`, label: `${kind === 'unit' ? '招募' : '获得'}${name ?? definitionId}（影响 ${cost}）`, command: { type: 'BUY_MARKET', market: kind, definitionId }, group: 'market' });
      }
    }
  }
  return intents;
}

export function getConquestLegalIntents(state: ConquestState, content: ConquestContent): ConquestIntent[] {
  if (state.scenario.status !== 'playing') return [];
  if (state.pendingDecision) return state.pendingDecision.options.map((option) => ({ id: `decision:${option.id}`, label: option.label, command: { type: 'RESOLVE_DECISION', optionId: option.id }, group: 'decision' }));
  if (state.phase === 'tactics') return Object.values(content.tactics).filter((tactic) => tactic.time === state.time).sort((a, b) => a.initiative - b.initiative).map((tactic) => ({ id: `tactic:${tactic.id}`, label: `${tactic.initiative} · ${tactic.name}`, command: { type: 'SELECT_TACTIC', tacticId: tactic.id }, group: 'tactic' }));
  const intents = cardIntents(state, content);
  const totals = resourceTotals(state);
  for (const skill of state.player.skills.filter((skill) => !skill.used && !skill.usedThisTurn && !skill.flipped)) {
    const definition = content.skills[skill.definitionId];
    const effect = definition?.effect ?? (definition?.resource && definition.amount ? { resource: definition.resource, amount: definition.amount } as EffectNode : undefined);
    if (!definition || !effect) continue;
    const addSkillIntent = (suffix: string, label: string, command: Extract<ConquestCommand, { type: 'USE_SKILL' }>) => {
      if (executeConquestIntent(state, command, content).ok) intents.push({ id: `skill:${skill.definitionId}:${suffix}`, label, command, group: 'action' });
    };
    if (skill.definitionId === 'krang.skill.curse') {
      for (const enemyId of state.encounter?.enemyIds.filter((id) => !state.enemies[id]?.defeated) ?? []) {
        const enemy = content.enemies[state.enemies[enemyId]?.definitionId ?? ''];
        enemy?.attack.forEach((_, attackIndex) => addSkillIntent(`${enemyId}:attack:${attackIndex}`, `${definition.name}：${targetName(state, content, enemyId)}攻击 ${attackIndex + 1} -1`, { type: 'USE_SKILL', skillId: skill.definitionId, targetId: enemyId, choiceIndex: 0, amount: attackIndex }));
        addSkillIntent(`${enemyId}:armor`, `${definition.name}：${targetName(state, content, enemyId)}护甲 -1`, { type: 'USE_SKILL', skillId: skill.definitionId, targetId: enemyId, choiceIndex: 1 });
      }
    } else if (skill.definitionId === 'krang.skill.puppet-master') {
      for (const enemyId of [...new Set(state.defeatedThisTurn)]) addSkillIntent(`store:${enemyId}`, `${definition.name}：保留${content.enemies[enemyId]?.name ?? enemyId}`, { type: 'USE_SKILL', skillId: skill.definitionId, targetId: enemyId, choiceIndex: 0 });
      for (const enemyId of skill.storedEnemyDefinitionIds ?? []) {
        addSkillIntent(`attack:${enemyId}`, `${definition.name}：释放${content.enemies[enemyId]?.name ?? enemyId}的攻击`, { type: 'USE_SKILL', skillId: skill.definitionId, targetId: enemyId, choiceIndex: 1 });
        addSkillIntent(`block:${enemyId}`, `${definition.name}：释放${content.enemies[enemyId]?.name ?? enemyId}的格挡`, { type: 'USE_SKILL', skillId: skill.definitionId, targetId: enemyId, choiceIndex: 2 });
      }
    } else if (skill.definitionId === 'krang.skill.regenerate') {
      for (const woundId of state.player.zones.hand.filter((id) => state.player.cardInstances[id]?.definitionId === 'core.card.wound')) for (const color of ['red', 'blue', 'white', 'green', 'gold', 'black'] as const) addSkillIntent(`${woundId}:${color}`, `${definition.name}：支付 ${color} 移除伤牌`, { type: 'USE_SKILL', skillId: skill.definitionId, targetId: woundId, manaColors: [color as BasicManaColor] });
    } else if (skill.definitionId === 'krang.skill.shamanic-ritual') {
      for (const color of ['red', 'blue', 'white', 'green', 'gold', 'black'] as const) addSkillIntent(color, `${definition.name}：获得 ${color} 法力`, { type: 'USE_SKILL', skillId: skill.definitionId, manaColors: [color as BasicManaColor] });
    } else if (skill.definitionId === 'krang.skill.master-of-chaos') {
      const next = ((skill.value ?? 0) + 1) % 6;
      if (next === 5) for (let choiceIndex = 0; choiceIndex < 5; choiceIndex += 1) addSkillIntent(`gold:${choiceIndex}`, `${definition.name}：金色选项 ${choiceIndex + 1}`, { type: 'USE_SKILL', skillId: skill.definitionId, choiceIndex });
      else addSkillIntent(`color:${next}`, `使用技能：${definition.name}`, { type: 'USE_SKILL', skillId: skill.definitionId });
    } else if (skill.definitionId === 'tezla.skill.lightning-storm') {
      for (const first of ['blue', 'green'] as const) for (const second of ['blue', 'red'] as const) addSkillIntent(`${first}:${second}`, `${definition.name}：${first}/${second} 法力`, { type: 'USE_SKILL', skillId: skill.definitionId, manaColors: [first, second] });
    } else if (skill.definitionId === 'tezla.skill.thunderstorm') {
      for (const first of ['green', 'blue'] as const) for (const second of ['green', 'white'] as const) addSkillIntent(`${first}:${second}`, `${definition.name}：${first}/${second} 法力`, { type: 'USE_SKILL', skillId: skill.definitionId, manaColors: [first, second] });
    } else if (skill.definitionId === 'tezla.skill.shapeshift') {
      for (const [choiceIndex, label] of ['移动', '攻击', '格挡'].entries()) addSkillIntent(String(choiceIndex), `${definition.name}：下一张基础行动牌改为${label}`, { type: 'USE_SKILL', skillId: skill.definitionId, choiceIndex });
    } else if (skill.definitionId === 'tezla.skill.regenerate') {
      for (const woundId of state.player.zones.hand.filter((id) => state.player.cardInstances[id]?.definitionId === 'core.card.wound')) for (const color of ['red', 'blue', 'white', 'green', 'gold', 'black'] as const) addSkillIntent(`${woundId}:${color}`, `${definition.name}：支付 ${color} 移除伤牌`, { type: 'USE_SKILL', skillId: skill.definitionId, targetId: woundId, manaColors: [color as BasicManaColor] });
    } else if (skill.definitionId === 'tezla.skill.secret-ways') {
      addSkillIntent('basic', `使用技能：${definition.name}`, { type: 'USE_SKILL', skillId: skill.definitionId });
      addSkillIntent('lake', `${definition.name}：支付蓝色法力开放湖泊`, { type: 'USE_SKILL', skillId: skill.definitionId, manaColors: ['blue'] });
    } else intents.push(...effectIntents(state, content, skill.definitionId, effect, `skill:${skill.definitionId}`, `使用技能：${definition.name}`, 'action', (choiceIndex, targetId) => ({ type: 'USE_SKILL', skillId: skill.definitionId, ...(choiceIndex === undefined ? {} : { choiceIndex }), ...(targetId === undefined ? {} : { targetId }) })));
  }
  for (const skill of state.player.skills.filter((candidate) => candidate.flipped)) {
    const definition = content.skills[skill.definitionId];
    if (!definition || definition.flipBackCondition === 'rest' || !definition.flipBackCondition) continue;
    const command: ConquestCommand = { type: 'FLIP_BACK_SKILL', skillId: skill.definitionId };
    if (executeConquestIntent(state, command, content).ok) intents.push({ id: `skill:${skill.definitionId}:flip-back`, label: `翻回技能：${definition.name}`, command, group: 'action' });
  }
  if (state.phase === 'movement') {
    for (const space of Object.values(state.map)) {
      const cost = movementCost(state, content, space.coord);
      if (Number.isFinite(cost) && totals.move >= cost) intents.push({ id: `move:${coordKey(space.coord)}`, label: `移动到 ${coordKey(space.coord)}（${cost}）`, command: { type: 'MOVE_HERO', to: space.coord }, group: 'map' });
    }
    const canBendExplore = state.ruleRuntime.movementMode?.kind === 'space-bending' && explorationDistance(state, state.player.position) <= 2;
    const explorationCost = Math.max(1, 2 - state.ruleRuntime.explorationDiscount);
    if ((canExplore(state) || canBendExplore) && totals.move >= explorationCost) intents.push({ id: 'explore', label: `探索完整七格板块（移动 ${explorationCost}）`, command: { type: 'EXPLORE_TILE' }, group: 'map' });
    intents.push({ id: 'finish-movement', label: '结束移动', command: { type: 'FINISH_MOVEMENT' }, group: 'action' });
    const wounds = state.player.zones.hand.filter((id) => state.player.cardInstances[id]?.definitionId === 'core.card.wound');
    const discards = state.player.zones.hand.filter((id) => state.player.cardInstances[id]?.definitionId !== 'core.card.wound');
    for (const cardId of discards.length > 0 ? discards : wounds.slice(0, 1)) intents.push({ id: `rest:${cardId}`, label: `休息并弃置${content.cards[state.player.cardInstances[cardId]?.definitionId ?? '']?.name ?? cardId}`, command: { type: 'REST', discardCardId: cardId, woundCardIds: wounds.filter((id) => id !== cardId) }, group: 'action' });
    if (state.player.zones.deck.length === 0) intents.push({ id: 'end-round', label: '宣布轮末', command: { type: 'DECLARE_END_ROUND' }, group: 'action' });
  }
  if (state.ruleRuntime.harvestOpportunities > 0) for (const cardId of state.player.zones.hand) {
    const card = content.cards[state.player.cardInstances[cardId]?.definitionId ?? ''];
    if (!card || card.kind === 'wound') continue;
    if (content.artifactDeck.includes(card.id)) for (const color of ['red', 'blue', 'white', 'green'] as const) intents.push({ id: `harvest:${cardId}:${color}`, label: `收割${card.name}为 ${color} 水晶`, command: { type: 'HARVEST_CRYSTAL', cardId, color }, group: 'action' });
    else intents.push({ id: `harvest:${cardId}`, label: `收割${card.name}为 ${card.color} 水晶`, command: { type: 'HARVEST_CRYSTAL', cardId }, group: 'action' });
  }
  if (state.ruleRuntime.ruthlessReadyUnits) for (const unit of state.player.units.filter((candidate) => !candidate.destroyed && !candidate.ready && candidate.wounds === 0 && (content.units[candidate.definitionId]?.level ?? 99) <= 2)) {
    const command: ConquestCommand = { type: 'READY_UNIT_WITH_INFLUENCE', unitId: unit.id };
    if (executeConquestIntent(state, command, content).ok) intents.push({ id: `ruthless-ready:${unit.id}`, label: `无情胁迫：整备${content.units[unit.definitionId]?.name ?? unit.id}`, command, group: 'action' });
  }
  if (state.phase === 'action') {
    const { space, site } = currentSite(state, content);
    if (!state.actionTaken && site && (!site.fortified || space?.conquered)) intents.push({ id: 'interact', label: `与${site.name}互动`, command: { type: 'START_INTERACTION' }, group: 'action' });
    if (!state.actionTaken) for (const enemy of Object.values(state.enemies)) if (!enemy.defeated && (areAdjacent(state.player.position, enemy.position) || coordKey(state.player.position) === coordKey(enemy.position))) intents.push({ id: `combat:${enemy.id}`, label: `挑战${content.enemies[enemy.definitionId]?.name ?? enemy.id}`, command: { type: 'START_COMBAT', enemyIds: [enemy.id] }, group: 'combat' });
    if (!state.actionTaken) for (const [leaderId, leader] of Object.entries(state.factionLeaders)) if (!leader.defeated && leader.position && coordKey(leader.position) === coordKey(state.player.position)) intents.push({ id: `leader:${leaderId}`, label: `挑战${content.factionLeaders[leaderId]?.name ?? leaderId}（等级 ${leader.level}）`, command: { type: 'START_LEADER_COMBAT', leaderId }, group: 'combat' });
    const overlay = state.overlays[coordKey(state.player.position)];
    if (overlay?.definitionId === 'tezla.overlay.graveyard' && overlay.liberated && !overlay.sealed) intents.push({ id: 'seal-graveyard', label: '支付法力封印墓地', command: { type: 'SEAL_GRAVEYARD' }, group: 'action' });
    if (!state.actionTaken && (site?.kind === 'maze' || site?.kind === 'labyrinth')) for (const amount of [2, 4, 6] as const) if (totals.move >= amount && !state.adventureClaims[coordKey(state.player.position)]?.includes(amount)) {
      if (amount === 2) for (const first of ['red', 'blue', 'white', 'green'] as const) for (const second of ['red', 'blue', 'white', 'green'] as const) intents.push({ id: `adventure:${amount}:${first}:${second}`, label: `进入${site.name}路径（移动 2，${first}+${second}水晶）`, command: { type: 'ENTER_ADVENTURE_SITE', amount, crystalColors: [first, second] }, group: 'combat' });
      else intents.push({ id: `adventure:${amount}`, label: `进入${site.name}路径（移动 ${amount}）`, command: { type: 'ENTER_ADVENTURE_SITE', amount }, group: 'combat' });
    }
    if (site?.kind === 'deep-mine' && !state.ruleRuntime.deepMineClaimed) for (const color of ['red', 'blue', 'white', 'green'] as const) intents.push({ id: `deep-mine:${color}`, label: `取得${color}水晶`, command: { type: 'CLAIM_DEEP_MINE', color }, group: 'action' });
    intents.push({ id: 'end-turn', label: '结束回合', command: { type: 'END_TURN' }, group: 'action' });
  }
  if (state.phase === 'interaction') {
    intents.push(...marketIntents(state, content));
    const { space, site } = currentSite(state, content);
    if (site?.healCost && totals.influence >= site.healCost && Object.values(state.player.cardInstances).some((card) => card.definitionId === 'core.card.wound')) intents.push({ id: 'heal:hero', label: `治疗英雄（影响 ${site.healCost}）`, command: { type: 'HEAL', target: 'hero' }, group: 'market' });
    if (site?.kind === 'monastery' && !space?.burned) intents.push({ id: 'burn-monastery', label: '焚烧修道院', command: { type: 'BURN_MONASTERY' }, group: 'combat' });
    intents.push({ id: 'finish-interaction', label: '结束互动', command: { type: 'FINISH_INTERACTION' }, group: 'action' });
  }
  if (legalResources(state.phase).includes('heal') && totals.heal > 0) {
    for (const woundId of state.player.zones.hand.filter((id) => state.player.cardInstances[id]?.definitionId === 'core.card.wound')) intents.push({ id: `heal-wound:${woundId}`, label: '治疗一张手牌伤牌（治疗 1）', command: { type: 'HEAL_WOUND', target: 'hero', woundId }, group: 'action' });
    for (const unit of state.player.units.filter((candidate) => !candidate.destroyed && candidate.wounds > 0)) {
      const cost = content.units[unit.definitionId]?.level ?? 99;
      if (totals.heal >= cost) intents.push({ id: `heal-unit:${unit.id}`, label: `治疗${content.units[unit.definitionId]?.name ?? unit.id}（治疗 ${cost}）`, command: { type: 'HEAL_WOUND', target: unit.id }, group: 'action' });
    }
  }
  for (const attachment of state.attachments.filter((candidate) => !candidate.used)) {
    const card = content.cards[attachment.definitionId];
    const unit = state.player.units.find((candidate) => candidate.id === attachment.unitId);
    if (attachment.definitionId === 'core.card.artifact.banner-courage' && !state.phase.startsWith('combat') && unit && !unit.ready && unit.wounds === 0) intents.push({ id: `attachment:${attachment.id}`, label: `使用${card?.name ?? '勇气旗帜'}整备${content.units[unit.definitionId]?.name ?? unit.id}`, command: { type: 'USE_ATTACHMENT', attachmentId: attachment.id }, group: 'action' });
    if (attachment.definitionId === 'core.card.artifact.banner-fear' && state.phase === 'combat-block') for (const enemyId of [...new Set(state.encounter?.incoming.filter((attack) => !attack.resolved).map((attack) => attack.enemyId) ?? [])]) intents.push({ id: `attachment:${attachment.id}:${enemyId}`, label: `使用${card?.name ?? '恐惧旗帜'}取消攻击`, command: { type: 'USE_ATTACHMENT', attachmentId: attachment.id, targetId: enemyId }, group: 'combat' });
  }
  if (state.phase === 'combat-ranged' || state.phase === 'combat-attack') {
    const targets = state.encounter?.enemyIds.filter((id) => !state.enemies[id]?.defeated) ?? [];
    for (const enemyId of targets) for (const kind of (state.phase === 'combat-ranged' ? ['ranged', 'siege'] : ['normal']) as Array<'normal' | 'ranged' | 'siege'>) {
      const intent: ConquestIntent = { id: `attack:${enemyId}:${kind}`, label: `${kind === 'normal' ? '普通' : kind === 'ranged' ? '远程' : '攻城'}攻击`, command: { type: 'DECLARE_ATTACK', enemyIds: [enemyId], kind }, group: 'combat' };
      if (executeConquestIntent(state, intent.command, content).ok) intents.push(intent);
    }
    if (state.encounter?.leaderId && !state.factionLeaders[state.encounter.leaderId]?.defeated && !state.encounter.leaderLevelsHit) for (const kind of (state.phase === 'combat-ranged' ? ['ranged', 'siege'] : ['normal']) as Array<'normal' | 'ranged' | 'siege'>) {
      const command: ConquestCommand = { type: 'DECLARE_LEADER_ATTACK', leaderId: state.encounter.leaderId, kind };
      if (executeConquestIntent(state, command, content).ok) intents.push({ id: `leader-attack:${kind}`, label: `${kind === 'normal' ? '普通' : kind === 'ranged' ? '远程' : '攻城'}攻击首领`, command, group: 'combat' });
    }
    intents.push({ id: 'advance-combat', label: state.phase === 'combat-ranged' ? '结束远程阶段' : '结束普通攻击阶段', command: { type: 'ADVANCE_COMBAT_PHASE' }, group: 'combat' });
  }
  if (state.phase === 'combat-block') {
    for (const attack of state.encounter?.incoming.filter((item) => !item.resolved) ?? []) {
      const leaderId = attack.enemyId.startsWith('leader:') ? attack.enemyId.slice('leader:'.length) : undefined;
      const abilities = leaderId ? content.factionLeaders[leaderId]?.levels.find((level) => level.level === state.factionLeaders[leaderId]?.level)?.abilities : content.enemies[state.enemies[attack.enemyId]?.definitionId ?? '']?.abilities;
      if (abilities?.includes('cumbersome') && totals.move > 0) intents.push({ id: `cumbersome:${attack.enemyId}:${attack.attackIndex}`, label: '支付移动降低 Cumbersome 攻击', command: { type: 'REDUCE_CUMBERSOME', enemyId: attack.enemyId, attackIndex: attack.attackIndex }, group: 'combat' });
      const blockIntent: ConquestIntent = { id: `block:${attack.enemyId}:${attack.attackIndex}`, label: `格挡攻击 ${attack.attackIndex + 1}`, command: { type: 'DECLARE_BLOCK', enemyId: attack.enemyId, attackIndex: attack.attackIndex }, group: 'combat' };
      if (executeConquestIntent(state, blockIntent.command, content).ok) intents.push(blockIntent);
    }
    intents.push({ id: 'advance-combat', label: '结束格挡阶段', command: { type: 'ADVANCE_COMBAT_PHASE' }, group: 'combat' });
  }
  if (state.phase === 'combat-damage') {
    for (const attack of state.encounter?.incoming.filter((item) => !item.resolved) ?? []) {
      intents.push({ id: `damage:${attack.enemyId}:${attack.attackIndex}:hero`, label: '由英雄承受伤害', command: { type: 'ASSIGN_DAMAGE', enemyId: attack.enemyId, attackIndex: attack.attackIndex, target: 'hero' }, group: 'combat' });
      const leaderId = attack.enemyId.startsWith('leader:') ? attack.enemyId.slice('leader:'.length) : undefined;
      const abilities = leaderId ? content.factionLeaders[leaderId]?.levels.find((level) => level.level === state.factionLeaders[leaderId]?.level)?.abilities : content.enemies[state.enemies[attack.enemyId]?.definitionId ?? '']?.abilities;
      if (!abilities?.includes('assassination')) for (const unit of state.player.units.filter((item) => !item.destroyed && item.wounds === 0)) intents.push({ id: `damage:${attack.enemyId}:${attack.attackIndex}:${unit.id}`, label: `由${content.units[unit.definitionId]?.name ?? '单位'}承受伤害`, command: { type: 'ASSIGN_DAMAGE', enemyId: attack.enemyId, attackIndex: attack.attackIndex, target: unit.id }, group: 'combat' });
    }
    if (state.encounter?.incoming.every((attack) => attack.resolved)) intents.push({ id: 'advance-combat', label: '进入普通攻击阶段', command: { type: 'ADVANCE_COMBAT_PHASE' }, group: 'combat' });
  }
  for (const tokenId of new Set(state.factionTokens.inventory)) {
    const token = content.factionTokens[tokenId];
    if (!token || state.factionTokens.usedNamesThisTurn.includes(token.name)) continue;
    if (state.phase === 'interaction') {
      intents.push({ id: `faction-token:${tokenId}:fame`, label: `弃置${token.name}：获得 1 名望`, command: { type: 'USE_FACTION_TOKEN', tokenId, choice: 'fame' }, group: 'action' });
      intents.push({ id: `faction-token:${tokenId}:influence`, label: `弃置${token.name}：获得 3 影响`, command: { type: 'USE_FACTION_TOKEN', tokenId, choice: 'influence' }, group: 'action' });
    }
    if (token.kind === 'add-element' || token.kind === 'physical-attack-bonus' || token.kind === 'make-ranged') for (const resource of state.player.resources.filter((item) => item.resource === 'attack' || (token.kind === 'add-element' && item.resource === 'block'))) {
      const command: ConquestCommand = { type: 'USE_FACTION_TOKEN', tokenId, targetId: resource.id };
      if (executeConquestIntent(state, command, content).ok) intents.push({ id: `faction-token:${tokenId}:${resource.id}`, label: `使用${token.name}到资源 ${resource.amount}`, command, group: 'action' });
    } else if (token.kind === 'swap-source-mana') for (const die of state.source.filter((item) => item.color === 'gold' || item.color === 'black')) intents.push({ id: `faction-token:${tokenId}:${die.id}`, label: `使用${token.name}改变 ${die.color} 骰`, command: { type: 'USE_FACTION_TOKEN', tokenId, targetId: die.id }, group: 'action' });
    else if (token.kind === 'heal-or-remove-wound') {
      intents.push({ id: `faction-token:${tokenId}:heal`, label: `使用${token.name}：治疗 1`, command: { type: 'USE_FACTION_TOKEN', tokenId, choice: 'heal' }, group: 'action' });
      if (state.player.zones.discard.some((id) => state.player.cardInstances[id]?.definitionId === 'core.card.wound')) intents.push({ id: `faction-token:${tokenId}:remove`, label: `使用${token.name}：移除弃牌堆伤牌`, command: { type: 'USE_FACTION_TOKEN', tokenId, choice: 'remove' }, group: 'action' });
    } else if (token.kind === 'swap-skill') for (const skill of state.player.skills) intents.push({ id: `faction-token:${tokenId}:${skill.definitionId}`, label: `使用${token.name}交换${content.skills[skill.definitionId]?.name ?? skill.definitionId}`, command: { type: 'USE_FACTION_TOKEN', tokenId, targetId: skill.definitionId }, group: 'action' });
    else {
      const command: ConquestCommand = { type: 'USE_FACTION_TOKEN', tokenId };
      if (executeConquestIntent(state, command, content).ok) intents.push({ id: `faction-token:${tokenId}:use`, label: `使用${token.name}`, command, group: 'action' });
    }
  }
  if (legalResources(state.phase).length > 0) for (const unit of state.player.units.filter((item) => item.wounds === 0 && !item.destroyed && (item.ready || item.definitionId === 'lost-legion.unit.elite.delphana-masters'))) {
    const definition = content.units[unit.definitionId];
    if (!definition) continue;
    const abilities = definition.abilities ?? [{ label: definition.name, text: '', effect: definition.ability }];
    abilities.forEach((ability, abilityIndex) => {
      if (unit.usedAbilityIndexes?.includes(abilityIndex)) return;
      intents.push(...effectIntents(state, content, unit.id, ability.effect, `unit:${unit.id}:${abilityIndex}`, `激活${definition.name}：${ability.label}`, 'action', (choiceIndex, targetId) => ({ type: 'ACTIVATE_UNIT', unitId: unit.id, abilityIndex, ...(choiceIndex === undefined ? {} : { choiceIndex }), ...(targetId === undefined ? {} : { targetId }) })));
      if (definition.id === 'core.unit.elite.altem-mages' && ability.label === '法力') for (const colors of colorSelections(2)) {
        const command: ConquestCommand = { type: 'ACTIVATE_UNIT', unitId: unit.id, abilityIndex, manaColors: colors };
        if (executeConquestIntent(state, command, content).ok) intents.push({ id: `unit:${unit.id}:${abilityIndex}:mana:${colors.join('-')}`, label: `激活${definition.name}：${colors.join('/')} 法力`, command, group: 'action' });
      }
    });
  }
  return intents;
}

export function projectConquestView(state: ConquestState, content: ConquestContent): ConquestView {
  const projected = cloneConquestState(state);
  const { rngState: _rng, enemyPools, countrysideTileDeck, coreTileDeck, ...visible } = projected;
  void _rng;
  return {
    ...visible,
    legalIntents: getConquestLegalIntents(state, content),
    resourceTotals: resourceTotals(state),
    hidden: { countrysideTiles: countrysideTileDeck.length, coreTiles: coreTileDeck.length, enemyMarkers: Object.fromEntries(Object.entries(enemyPools).map(([key, value]) => [key, value.length])) },
  };
}

export function conquestStateHash(state: ConquestState): string {
  const sortValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortValue);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, sortValue(nested)]));
    return value;
  };
  const json = JSON.stringify(sortValue(state));
  let hash = 2166136261;
  for (let index = 0; index < json.length; index += 1) { hash ^= json.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
