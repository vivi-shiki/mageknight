import type { CardDefinition, CardEffect } from '@mageknight/content';
import { evaluateEffect } from './effect-dsl';
import { appendEvent, failure, nextId, resourceLabel } from './state-operations';
import type {
  AttackKind,
  BasicManaColor,
  CardInstance,
  DomainEvent,
  ExecutionFailure,
  GameCommand,
  GamePhase,
  GameState,
  ResourceContribution,
  ResourceType,
  TutorialContent,
} from './types';

export function legalResourcesForPhase(phase: GamePhase): ResourceType[] {
  if (phase === 'movement') return ['move', 'heal'];
  if (phase === 'interaction') return ['influence', 'heal'];
  if (phase === 'combat-ranged' || phase === 'combat-attack') return ['attack'];
  if (phase === 'combat-block') return ['block'];
  return [];
}

export function contributionFromEffect(state: GameState, sourceId: string, effect: CardEffect): ResourceContribution {
  return {
    id: nextId(state, 'resource'),
    sourceId,
    resource: effect.resource,
    amount: effect.amount,
    attackKind: effect.attackKind ?? 'normal',
    element: effect.element ?? 'physical',
  };
}

function cardByInstance(state: GameState, content: TutorialContent, cardId: string): { instance: CardInstance; definition: CardDefinition } | undefined {
  const instance = state.player.hand.find((card) => card.id === cardId);
  if (!instance) return undefined;
  const definition = content.cards[instance.definitionId];
  return definition ? { instance, definition } : undefined;
}

export function defaultAttackKind(effect: CardEffect): AttackKind {
  return effect.attackKind ?? 'normal';
}

export function findManaDice(state: GameState, color: BasicManaColor, requiresBlack: boolean): string[] | undefined {
  const matching = state.source.find((die) => !die.used && (die.color === color || (die.color === 'gold' && state.time === 'day')));
  if (!matching) return undefined;
  if (!requiresBlack) return [matching.id];
  if (state.time !== 'night') return undefined;
  const black = state.source.find((die) => !die.used && die.color === 'black' && die.id !== matching.id);
  return black ? [matching.id, black.id] : undefined;
}

function consumeMana(state: GameState, dieIds: string[]): void {
  for (const id of dieIds) {
    const die = state.source.find((candidate) => candidate.id === id);
    if (die) die.used = true;
  }
}

function moveHandCardToPlayArea(state: GameState, cardId: string): CardInstance | undefined {
  const index = state.player.hand.findIndex((card) => card.id === cardId);
  if (index < 0) return undefined;
  const [card] = state.player.hand.splice(index, 1);
  if (!card) return undefined;
  state.player.playArea.push(card);
  return card;
}

export function playCard(state: GameState, command: Extract<GameCommand, { type: 'PLAY_CARD' }>, content: TutorialContent, events: DomainEvent[]): ExecutionFailure | undefined {
  const card = cardByInstance(state, content, command.cardId);
  if (!card) return failure(state, 'CARD_NOT_IN_HAND', '这张牌不在手牌中。');
  if (card.definition.kind === 'wound') return failure(state, 'CARD_CANNOT_BE_PLAYED', '伤牌不能作为行动牌使用。');

  let effect: CardEffect | undefined;
  let manaDice: string[] = [];
  if (command.mode === 'sideways') {
    if (!command.sidewaysResource || !['move', 'influence', 'attack', 'block'].includes(command.sidewaysResource)) {
      return failure(state, 'INVALID_COMMAND', '横置时必须选择一种基础资源。');
    }
    effect = { resource: command.sidewaysResource, amount: 1 };
  } else {
    effect = command.mode === 'basic' ? card.definition.basic : card.definition.strong;
    if (!effect) return failure(state, 'CARD_CANNOT_BE_PLAYED', '该牌没有所选效果。');
    if (card.definition.kind === 'spell' || command.mode === 'strong') {
      const requiresBlack = card.definition.kind === 'spell' && command.mode === 'strong';
      const found = findManaDice(state, card.definition.color, requiresBlack);
      if (!found) return failure(state, 'MANA_COLOR_UNAVAILABLE', 'Source 中没有可用于该效果的法力。');
      manaDice = found;
    }
  }

  if (!legalResourcesForPhase(state.phase).includes(effect.resource)) {
    return failure(state, 'CARD_CANNOT_BE_PLAYED', '当前阶段不能产生这种资源。');
  }

  const evaluated = evaluateEffect(effect, { time: state.time });
  if (evaluated.choiceRequired || evaluated.gains.length !== 1) {
    return failure(state, 'CARD_CANNOT_BE_PLAYED', '该效果需要通过选择请求解析。');
  }
  effect = evaluated.gains[0];
  if (!effect) return failure(state, 'CARD_CANNOT_BE_PLAYED', '该效果没有产生可用资源。');
  if (state.phase === 'combat-ranged' && effect.resource === 'attack' && defaultAttackKind(effect) === 'normal') {
    return failure(state, 'CARD_CANNOT_BE_PLAYED', '远程/攻城阶段不能使用普通攻击。');
  }

  consumeMana(state, manaDice);
  const moved = moveHandCardToPlayArea(state, command.cardId);
  if (!moved) return failure(state, 'CARD_NOT_IN_HAND', '这张牌不在手牌中。');
  const contribution = contributionFromEffect(state, moved.id, effect);
  state.player.resources.push(contribution);
  appendEvent(state, events, 'CardPlayed', `${card.definition.name}产生 ${effect.amount} 点${resourceLabel(effect.resource)}。`, {
    cardId: moved.id,
    definitionId: moved.definitionId,
    mode: command.mode,
    contribution,
  });
  return undefined;
}
