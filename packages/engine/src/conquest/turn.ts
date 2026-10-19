import type { BasicManaColor, ConquestContent } from '@mageknight/content';
import { shuffleWithState } from '../rng';
import { coordKey, hexDistance, neighbors } from '../hex';
import { addCardToZone } from './cards';
import { applyRecruitBonuses, refreshMarket } from './market';
import { resolveScenario } from './scenario';
import { addResource, appendEvent, conquestFailure, conquestNextId, createRuleRuntime, detachUnitAttachments, drawCards, randomBasicColor } from './state';
import type { ConquestDecision, ConquestResult, ConquestState } from './types';

function shuffleState<T>(state: ConquestState, values: readonly T[]): T[] {
  const result = shuffleWithState(values, state.rngState);
  state.rngState = result.state;
  return result.items;
}

function applyTactic(state: ConquestState, effect: string): void {
  if (effect === 'draw-one') {
    const cardId = state.player.zones.deck.shift();
    if (cardId) state.player.zones.hand.push(cardId);
  }
  if (effect === 'move-one') addResource(state, 'tactic', 'move', 1);
  if (effect === 'influence-one') addResource(state, 'tactic', 'influence', 1);
  if (effect === 'heal-one') addResource(state, 'tactic', 'heal', 1);
  if (effect === 'reroll-source') state.source = state.source.map((die) => ({ ...die, color: randomBasicColor(state), used: false }));
}

export function selectTactic(state: ConquestState, content: ConquestContent, tacticId: string, events: ConquestState['eventLog']): ConquestResult | undefined {
  if (state.phase !== 'tactics') return conquestFailure(state, 'WRONG_PHASE', '当前不在战术选择阶段。');
  const tactic = content.tactics[tacticId];
  if (!tactic || tactic.time !== state.time) return conquestFailure(state, 'INVALID_TARGET', '该战术本轮不可选。');
  const remaining = Object.values(content.tactics).filter((candidate) => candidate.time === state.time && candidate.id !== tacticId).sort((a, b) => a.initiative - b.initiative);
  const dummyTacticId = state.scenario.objectiveKind === 'volkare' ? undefined : remaining[0]?.id;
  if (dummyTacticId) state.dummy.tacticId = dummyTacticId;
  else delete state.dummy.tacticId;
  applyTactic(state, tactic.effect);
  state.phase = 'movement';
  appendEvent(state, events, 'TacticSelected', state.scenario.objectiveKind === 'volkare'
    ? `选择战术“${tactic.name}”。Volkare 场景不使用 Dummy 战术。`
    : `选择战术“${tactic.name}”，Dummy 选择“${content.tactics[state.dummy.tacticId ?? '']?.name ?? '无'}”。`, { tacticId, dummyTacticId: state.dummy.tacticId });
  return undefined;
}

export function runDummyTurn(state: ConquestState, events: ConquestState['eventLog']): void {
  if (state.dummy.exhausted) return;
  const first = state.dummy.deck.shift();
  if (!first) {
    state.dummy.exhausted = true;
    state.roundEndAnnounced = true;
    state.finalTurnsRemaining = Math.max(state.finalTurnsRemaining, 1);
    appendEvent(state, events, 'DummyExhausted', 'Dummy 牌库耗尽，玩家还有最后一回合。');
    return;
  }
  const drawCount = 3 + state.dummy.crystals[first];
  const drawn: BasicManaColor[] = [first];
  while (drawn.length < drawCount) {
    const card = state.dummy.deck.shift();
    if (!card) break;
    drawn.push(card);
  }
  state.dummy.discard.push(...drawn);
  state.dummy.lastCardsDrawn = drawn.length;
  const finalColor = drawn.at(-1);
  if (finalColor) state.dummy.crystals[finalColor] = Math.min(3, state.dummy.crystals[finalColor] + 1);
  if (state.dummy.deck.length === 0) {
    state.dummy.exhausted = true;
    state.roundEndAnnounced = true;
    state.finalTurnsRemaining = 1;
  }
  appendEvent(state, events, 'DummyTurn', `Dummy 翻开 ${drawn.length} 张牌。`, { colors: drawn, exhausted: state.dummy.exhausted });
}

function moveVolkareArmy(state: ConquestState, to: { q: number; r: number }): void {
  const volkare = state.volkare;
  if (!volkare) return;
  const fromSpace = state.map[coordKey(volkare.position)];
  const toSpace = state.map[coordKey(to)];
  if (!toSpace) return;
  if (fromSpace) fromSpace.enemyIds = fromSpace.enemyIds.filter((id) => !volkare.armyEnemyIds.includes(id));
  for (const enemyId of volkare.armyEnemyIds) {
    const enemy = state.enemies[enemyId];
    if (!enemy || enemy.defeated) continue;
    enemy.position = { ...to };
    if (!toSpace.enemyIds.includes(enemyId)) toSpace.enemyIds.push(enemyId);
  }
  volkare.position = { ...to };
}

export function runVolkareTurn(state: ConquestState, events: ConquestState['eventLog']): void {
  const volkare = state.volkare;
  if (!volkare || volkare.defeated || volkare.reachedPortal || !volkare.revealed) return;
  const card = volkare.deck.shift();
  if (!card) {
    volkare.deck = shuffleState(state, volkare.discard);
    volkare.discard = [];
    return runVolkareTurn(state, events);
  }
  volkare.discard.push(card);
  if (card.color === 'wound') {
    const pool = volkare.armyEnemyIds.length % 2 === 0 ? state.enemyPools.white : state.enemyPools.red;
    const definitionId = pool.shift();
    if (definitionId) {
      pool.push(definitionId);
      const enemyId = conquestNextId(state, 'volkare-army');
      state.enemies[enemyId] = { id: enemyId, definitionId, position: { ...volkare.position }, defeated: false, summoned: false };
      volkare.armyEnemyIds.push(enemyId);
      state.map[coordKey(volkare.position)]?.enemyIds.push(enemyId);
    }
    volkare.lastAction = 'reinforce';
    appendEvent(state, events, 'VolkareReinforced', 'Volkare 翻出伤牌，军队获得一名增援。', { armySize: volkare.armyEnemyIds.length });
    return;
  }
  let moved = 0;
  for (let step = 0; step < card.steps; step += 1) {
    const next = neighbors(volkare.position)
      .filter((coord) => state.map[coordKey(coord)])
      .sort((left, right) => hexDistance(left, { q: 0, r: 0 }) - hexDistance(right, { q: 0, r: 0 }))[0];
    if (!next || hexDistance(next, { q: 0, r: 0 }) >= hexDistance(volkare.position, { q: 0, r: 0 })) break;
    moveVolkareArmy(state, next);
    moved += 1;
    if (coordKey(next) === coordKey(state.player.position)) addCardToZone(state, 'core.card.wound', 'discard');
    if (coordKey(next) === '0,0') { volkare.reachedPortal = true; break; }
  }
  volkare.lastAction = `move-${moved}`;
  appendEvent(state, events, 'VolkareTurn', `Volkare 翻出${card.color}牌并移动 ${moved} 格。`, { color: card.color, steps: card.steps, moved, position: volkare.position });
}

function expireEffects(state: ConquestState, timing: 'end-turn' | 'start-next-turn' | 'end-round'): void {
  const expired = state.lastingEffects.filter((effect) => effect.expires === timing);
  for (const effect of expired) {
    if (effect.kind === 'armor') state.player.armor -= effect.amount;
    if (effect.kind === 'hand-limit') state.player.handLimit -= effect.amount;
    if (effect.kind === 'reputation') state.player.reputation -= effect.amount;
  }
  state.lastingEffects = state.lastingEffects.filter((effect) => effect.expires !== timing);
  if (timing === 'end-turn') state.enemyModifiers = Object.fromEntries(Object.entries(state.enemyModifiers).filter(([, modifier]) => modifier.expires !== 'end-turn'));
}

function applySiteEndBenefit(state: ConquestState, content: ConquestContent, events: ConquestState['eventLog']): void {
  const space = state.map[`${state.player.position.q},${state.player.position.r}`];
  const site = space?.siteId ? content.sites[space.siteId] : undefined;
  const overlay = state.overlays[coordKey(state.player.position)];
  if (site?.kind === 'crystal-mine') {
    const color = randomBasicColor(state);
    state.player.crystals[color] = Math.min(3, state.player.crystals[color] + 1);
    appendEvent(state, events, 'CrystalMined', `在水晶矿获得一枚${color}水晶。`, { color });
  }
  if (site?.kind === 'magical-glade' || (overlay?.definitionId === 'tezla.overlay.hidden-valley' && overlay.liberated)) {
    const woundId = state.player.zones.hand.find((id) => state.player.cardInstances[id]?.definitionId === 'core.card.wound');
    if (woundId) {
      state.player.zones.hand = state.player.zones.hand.filter((id) => id !== woundId);
      state.player.zones.removed.push(woundId);
      appendEvent(state, events, 'GladeHealed', '魔法林地治疗一张手牌伤牌。', { cardId: woundId });
    }
  }
}

const LEVEL_THRESHOLDS = [0, 3, 8, 15, 24, 35, 48, 63, 80, 99];

function levelDecision(state: ConquestState, content: ConquestContent): ConquestDecision | undefined {
  const nextThreshold = LEVEL_THRESHOLDS[state.player.level];
  if (nextThreshold === undefined || state.player.fame < nextThreshold) return undefined;
  const hero = content.heroes[state.player.heroId];
  const owned = new Set(state.player.skills.map((skill) => skill.definitionId));
  const options = (hero?.skillIds ?? []).flatMap((id) => {
    const skill = content.skills[id];
    return skill && !owned.has(skill.id) ? [{ id: skill.id, label: `${skill.name}：${skill.description}` }] : [];
  }).slice(0, 2);
  if (options.length === 0) return undefined;
  return { id: conquestNextId(state, 'decision'), kind: 'level-up', prompt: `选择一个${hero?.name ?? '英雄'}技能；同时获得市场底部高级行动。`, options, returnPhase: 'movement', context: {} };
}

export function prepareConquestRound(state: ConquestState, content: ConquestContent, events: ConquestState['eventLog']): void {
  expireEffects(state, 'end-round');
  state.round += 1;
  if (resolveScenario(state, content, events)) return;
  state.time = state.time === 'day' ? 'night' : 'day';
  const attachedCards = new Set(state.attachments.map((attachment) => attachment.cardId));
  const returningSetAside = state.player.zones['set-aside'].filter((id) => !attachedCards.has(id));
  const reusable = [...state.player.zones.deck, ...state.player.zones.hand, ...state.player.zones.play, ...state.player.zones.discard, ...returningSetAside];
  state.player.zones.deck = shuffleState(state, reusable);
  state.player.zones.hand = [];
  state.player.zones.play = [];
  state.player.zones.discard = [];
  state.player.zones['set-aside'] = state.player.zones['set-aside'].filter((id) => attachedCards.has(id));
  drawCards(state, state.player.handLimit);
  state.player.resources = [];
  state.player.manaTokens = { red: 0, blue: 0, white: 0, green: 0, gold: 0, black: 0 };
  state.player.units.forEach((unit) => { if (!unit.destroyed) unit.ready = true; delete unit.usedAbilityIndexes; });
  state.player.skills.forEach((skill) => { skill.used = false; skill.usedThisTurn = false; });
  state.attachments.forEach((attachment) => { attachment.used = false; });
  state.ruleRuntime = createRuleRuntime();
  if (state.player.heroId === 'tezla.hero.braevalar') state.ruleRuntime.explorationDiscount = 1;
  state.turnWoundIds = [];
  state.defeatedThisTurn = [];
  state.source = state.source.map((die) => ({ ...die, color: randomBasicColor(state), used: false }));
  if (state.scenario.objectiveKind !== 'volkare') {
    state.dummy.deck = shuffleState(state, [...state.dummy.deck, ...state.dummy.discard]);
    state.dummy.discard = [];
    state.dummy.exhausted = false;
    state.dummy.lastCardsDrawn = 0;
    delete state.dummy.tacticId;
  }
  state.roundEndAnnounced = false;
  state.finalTurnsRemaining = 0;
  const coreRevealed = state.placedTiles.some((tile) => content.tiles[tile.definitionId]?.kind === 'core');
  const monasteries = Object.values(state.map).filter((space) => space.siteId && content.sites[space.siteId]?.kind === 'monastery' && !space.burned).length;
  refreshMarket(state, coreRevealed, monasteries, events);
  state.phase = 'tactics';
  state.actionTaken = false;
  state.checkpoints.push({ eventIndex: state.eventLog.length + events.length, barrier: true, reason: '新一轮洗牌和市场刷新' });
  appendEvent(state, events, 'RoundPrepared', `进入第 ${state.round} 轮（${state.time === 'day' ? '白天' : '夜晚'}）。`, { round: state.round, time: state.time });
}

export function endConquestTurn(state: ConquestState, content: ConquestContent, events: ConquestState['eventLog']): ConquestResult | undefined {
  if (state.phase !== 'action') return conquestFailure(state, 'WRONG_PHASE', '只能在行动阶段结束回合。');
  if (state.pendingFame > 0) {
    state.player.fame += state.pendingFame;
    appendEvent(state, events, 'FameGranted', `获得 ${state.pendingFame} 名望。`, { amount: state.pendingFame, total: state.player.fame });
    state.pendingFame = 0;
  }
  applySiteEndBenefit(state, content, events);
  if (state.ruleRuntime.removeTurnWounds) {
    for (const id of state.turnWoundIds) {
      for (const zone of ['hand', 'discard'] as const) state.player.zones[zone] = state.player.zones[zone].filter((candidate) => candidate !== id);
      if (state.player.cardInstances[id] && !state.player.zones.removed.includes(id)) state.player.zones.removed.push(id);
    }
  }
  expireEffects(state, 'end-turn');
  state.player.zones.discard.push(...state.player.zones.play);
  state.player.zones.play = [];
  state.player.resources = [];
  state.player.manaTokens = { red: 0, blue: 0, white: 0, green: 0, gold: 0, black: 0 };
  for (const skill of state.player.skills) {
    if (skill.definitionId === 'krang.skill.master-of-chaos' && !skill.usedThisTurn) skill.value = ((skill.value ?? 0) + 1) % 6;
    skill.usedThisTurn = false;
  }
  state.player.knockedOut = false;
  if (!state.ruleRuntime.noDrawNextTurn) drawCards(state, state.player.handLimit - state.player.zones.hand.length);
  state.turn += 1;
  state.actionTaken = false;
  state.ruleRuntime = createRuleRuntime();
  if (state.player.heroId === 'tezla.hero.braevalar') state.ruleRuntime.explorationDiscount = 1;
  state.factionTokens.usedNamesThisTurn = [];
  state.turnWoundIds = [];
  state.defeatedThisTurn = [];
  if (resolveScenario(state, content, events)) return undefined;
  if (state.roundEndAnnounced) {
    state.finalTurnsRemaining -= 1;
    if (state.finalTurnsRemaining <= 0) {
      if (resolveScenario(state, content, events)) return undefined;
      prepareConquestRound(state, content, events);
      return undefined;
    }
  } else if (state.scenario.objectiveKind === 'volkare') runVolkareTurn(state, events);
  else runDummyTurn(state, events);
  state.phase = 'movement';
  const overlay = state.overlays[coordKey(state.player.position)];
  if (state.time === 'night' && overlay?.liberated && (overlay.definitionId === 'tezla.overlay.graveyard' || overlay.definitionId === 'tezla.overlay.necropolis')) {
    state.player.manaTokens.black += 1;
    appendEvent(state, events, 'DarkManaGranted', '在亡灵地点开始夜间回合，获得一枚黑色法力令牌。');
  }
  expireEffects(state, 'start-next-turn');
  const decision = levelDecision(state, content);
  if (decision) {
    state.pendingDecision = decision;
    state.phase = 'decision';
    appendEvent(state, events, 'DecisionOpened', decision.prompt, { decisionId: decision.id, kind: decision.kind });
  }
  state.checkpoints.push({ eventIndex: state.eventLog.length + events.length, barrier: false, reason: '新回合' });
  return undefined;
}

export function declareConquestRoundEnd(state: ConquestState, content: ConquestContent, events: ConquestState['eventLog']): ConquestResult | undefined {
  if (state.phase !== 'movement' || state.player.zones.deck.length > 0) return conquestFailure(state, 'ROUND_END_NOT_AVAILABLE', '只有牌库为空且在回合开始时才能宣布轮末。');
  if (state.scenario.objectiveKind === 'volkare') runVolkareTurn(state, events);
  else runDummyTurn(state, events);
  prepareConquestRound(state, content, events);
  return undefined;
}

export function resolveConquestDecision(state: ConquestState, content: ConquestContent, optionId: string, events: ConquestState['eventLog']): ConquestResult | undefined {
  const decision = state.pendingDecision;
  if (!decision || !decision.options.some((option) => option.id === optionId)) return conquestFailure(state, 'INVALID_TARGET', '当前没有这个选择。');
  if (decision.kind === 'level-up') {
    state.player.skills.push({ definitionId: optionId, used: false, usedThisTurn: false, flipped: false, ...(optionId === 'krang.skill.master-of-chaos' ? { value: state.rngState % 6 } : {}) });
    const advancedId = state.market.advanced.offer.shift();
    if (advancedId) addCardToZone(state, advancedId, 'discard');
    state.player.level += 1;
    if (state.player.level % 2 === 0) { state.player.armor += 1; state.player.commandSlots += 1; }
    else state.player.handLimit += 1;
  }
  if (decision.kind === 'replace-unit') {
    const definitionId = String(decision.context.definitionId ?? '');
    if (optionId !== 'cancel') {
      const old = state.player.units.find((unit) => unit.id === optionId);
      if (old) {
        old.destroyed = true;
        detachUnitAttachments(state, old.id);
      }
      const id = conquestNextId(state, 'unit');
      state.player.units.push({ id, definitionId, ready: true, wounds: 0, destroyed: false });
      state.market.unit.offer = state.market.unit.offer.filter((id) => id !== definitionId);
      applyRecruitBonuses(state);
    } else addResource(state, 'refund', 'influence', Number(decision.context.cost ?? 0));
  }
  delete state.pendingDecision;
  state.phase = decision.returnPhase;
  appendEvent(state, events, 'DecisionResolved', `完成选择：${optionId}。`, { decisionId: decision.id, optionId });
  return undefined;
}
