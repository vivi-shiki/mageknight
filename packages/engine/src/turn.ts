import { shuffleWithState } from './rng';
import { appendEvent, drawToHand, failure, nextId, rollSource } from './state-operations';
import type { CardInstance, DomainEvent, ExecutionFailure, GameCommand, GameState, TutorialContent } from './types';

function removeCardFromHand(state: GameState, cardId: string): CardInstance | undefined {
  const index = state.player.hand.findIndex((card) => card.id === cardId);
  if (index < 0) return undefined;
  const [card] = state.player.hand.splice(index, 1);
  return card;
}

export function rest(state: GameState, command: Extract<GameCommand, { type: 'REST' }>, content: TutorialContent, events: DomainEvent[]): ExecutionFailure | undefined {
  if (state.phase !== 'movement') return failure(state, 'WRONG_PHASE', '只能在回合开始选择休息。');
  const discard = state.player.hand.find((card) => card.id === command.discardCardId);
  if (!discard) return failure(state, 'CARD_NOT_IN_HAND', '弃置牌不在手牌中。');
  const definition = content.cards[discard.definitionId];
  const allWounds = state.player.hand.every((card) => content.cards[card.definitionId]?.kind === 'wound');
  if (definition?.kind === 'wound' && !allWounds) return failure(state, 'INVALID_COMMAND', '标准休息必须弃置一张非伤牌。');
  const ids = new Set([command.discardCardId, ...command.woundCardIds]);
  for (const id of ids) {
    const card = removeCardFromHand(state, id);
    if (!card) return failure(state, 'CARD_NOT_IN_HAND', '要弃置的牌不在手牌中。');
    if (id !== command.discardCardId && content.cards[card.definitionId]?.kind !== 'wound') return failure(state, 'INVALID_COMMAND', '额外弃置的牌必须是伤牌。');
    state.player.discard.push(card);
  }
  state.actionTaken = true;
  state.phase = 'action';
  appendEvent(state, events, 'PlayerRested', '完成休息。', { cardIds: [...ids] });
  return undefined;
}

function applyPendingRewards(state: GameState, events: DomainEvent[]): boolean {
  const fame = state.pendingRewards.fame;
  if (fame <= 0) return false;
  state.player.fame += fame;
  state.pendingRewards.fame = 0;
  appendEvent(state, events, 'RewardGranted', `获得 ${fame} 名望，当前名望 ${state.player.fame}。`, { fame, total: state.player.fame });
  return state.player.level === 1 && state.player.fame >= 3;
}

function cleanTurn(state: GameState, events: DomainEvent[]): void {
  state.player.discard.push(...state.player.playArea);
  state.player.playArea = [];
  state.player.resources = [];
  state.player.knockedOut = false;
  rollSource(state, state.source.length);
  drawToHand(state, events);
  state.turn += 1;
  state.actionTaken = false;
  state.phase = 'movement';
  state.checkpoints.push({ eventIndex: state.eventLog.length + events.length, barrier: false, reason: '新回合' });
}

export function endTurn(state: GameState, events: DomainEvent[]): ExecutionFailure | undefined {
  if (state.phase !== 'action') return failure(state, 'WRONG_PHASE', '只有结束移动或完成行动后才能结束回合。');
  const shouldLevel = applyPendingRewards(state, events);
  cleanTurn(state, events);
  if (state.scenario.enemiesDefeated >= 2) {
    state.scenario.status = 'won';
    state.phase = 'game-over';
    appendEvent(state, events, 'ScenarioWon', '完成侦察目标：已探索并击败两名敌人。', {});
    return undefined;
  }
  if (shouldLevel) {
    state.pendingDecision = {
      id: nextId(state, 'decision'),
      kind: 'level-up',
      prompt: '选择 Tovak 的升级奖励。',
      options: [
        { id: 'armor', label: '战斗纪律：护甲 +1' },
        { id: 'training', label: '战技训练：获得高级行动牌' },
      ],
      returnPhase: 'movement',
    };
    state.phase = 'decision';
    appendEvent(state, events, 'DecisionOpened', '名望越过升级线，等待选择升级奖励。', { decisionId: state.pendingDecision.id });
  }
  return undefined;
}

export function prepareNextRound(state: GameState, events: DomainEvent[]): void {
  state.round += 1;
  if (state.round > state.scenario.roundLimit) {
    state.scenario.status = 'lost';
    state.phase = 'game-over';
    appendEvent(state, events, 'ScenarioLost', '超过场景轮数限制。', {});
    return;
  }
  state.time = state.time === 'day' ? 'night' : 'day';
  const allCards = [...state.player.deck, ...state.player.hand, ...state.player.playArea, ...state.player.discard];
  const shuffled = shuffleWithState(allCards, state.rngState);
  state.rngState = shuffled.state;
  state.player.deck = shuffled.items;
  state.player.hand = [];
  state.player.playArea = [];
  state.player.discard = [];
  state.player.resources = [];
  state.player.units.forEach((unit) => { unit.ready = true; });
  rollSource(state, state.source.length);
  drawToHand(state, events);
  state.turn += 1;
  state.actionTaken = false;
  state.phase = 'movement';
  state.checkpoints.push({ eventIndex: state.eventLog.length + events.length, barrier: true, reason: '新一轮洗牌' });
  appendEvent(state, events, 'RoundPrepared', `进入第 ${state.round} 轮（${state.time === 'day' ? '白天' : '夜晚'}）。`, { round: state.round, time: state.time });
}

export function resolveDecision(state: GameState, command: Extract<GameCommand, { type: 'RESOLVE_DECISION' }>, content: TutorialContent, events: DomainEvent[]): ExecutionFailure | undefined {
  const decision = state.pendingDecision;
  if (!decision) return failure(state, 'INVALID_DECISION', '当前没有待处理选择。');
  if (!decision.options.some((option) => option.id === command.optionId)) return failure(state, 'INVALID_DECISION', '选择不在可用选项中。');
  if (command.optionId === 'armor') state.player.armor += 1;
  else {
    const card = content.cards['core.card.training'];
    if (!card) return failure(state, 'INVALID_DECISION', '高级行动牌内容缺失。');
    state.player.discard.push({ id: nextId(state, 'card'), definitionId: card.id });
  }
  state.player.level = 2;
  state.player.commandSlots += 1;
  delete state.pendingDecision;
  state.phase = decision.returnPhase;
  appendEvent(state, events, 'DecisionResolved', `完成升级选择：${command.optionId}。`, { optionId: command.optionId });
  return undefined;
}
