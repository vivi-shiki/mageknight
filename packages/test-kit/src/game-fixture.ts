import { tutorialContent } from '@mageknight/content';
import { createGame, executeIntent } from '@mageknight/engine';
import type { GameCommand, GameState, ResourceContribution } from '@mageknight/engine';

export const tutorialDeckOrder = [
  'core.card.march-1',
  'core.card.march-2',
  'core.card.promise',
  'core.card.rage-1',
  'core.card.determination-1',
  'core.card.stamina-1',
  'core.card.swiftness-1',
  'core.card.rage-2',
  'core.card.threaten',
  'core.card.stamina-2',
  'core.card.determination-2',
  'core.card.swiftness-2',
  'core.card.tranquility',
  'core.card.crystallize',
  'core.card.mana-draw',
  'core.card.concentration',
];

export function createTutorialFixture(): GameState {
  return createGame(
    {
      seed: 'mageknight-v0.1-tutorial',
      deckOrder: tutorialDeckOrder,
      sourceColors: ['green', 'blue', 'white'],
    },
    tutorialContent,
  );
}

export function mustExecute(state: GameState, command: GameCommand): GameState {
  const result = executeIntent(state, command, tutorialContent);
  if (!result.ok) {
    throw new Error(`${command.type} failed: ${result.error.code} ${result.error.message}`);
  }
  return result.state;
}

export function cardId(state: GameState, definitionId: string): string {
  const card = state.player.hand.find((candidate) => candidate.definitionId === definitionId);
  if (!card) throw new Error(`Card ${definitionId} not found in hand.`);
  return card.id;
}

export function addResource(state: GameState, contribution: Omit<ResourceContribution, 'id' | 'sourceId'>): void {
  state.player.resources.push({
    id: `fixture-resource-${state.player.resources.length + 1}`,
    sourceId: 'fixture',
    ...contribution,
  });
}
