import { isCompleteSevenHexTile } from './hex';
import { createRngState, shuffleWithState } from './rng';
import { assertInvariants } from './state-utils';
import { addMapTemplates, rollSource } from './state-operations';
import type { CardInstance, GameConfig, GameState, TutorialContent } from './types';

function makeCardInstances(definitionIds: string[], startAt = 1): CardInstance[] {
  return definitionIds.map((definitionId, index) => ({ id: `card-${startAt + index}`, definitionId }));
}

export function createGame(config: GameConfig, content: TutorialContent): GameState {
  if (content.basicDeck.length !== 16) throw new Error(`v0.1 requires exactly 16 basic cards, received ${content.basicDeck.length}.`);
  if (!isCompleteSevenHexTile(content.startingMap) || !isCompleteSevenHexTile(content.explorationMap)) {
    throw new Error('Every map tile must contain one center hex and its six neighboring hexes.');
  }
  const initialRng = createRngState(config.seed);
  const shuffled = config.deckOrder ? { items: [...config.deckOrder], state: initialRng } : shuffleWithState(content.basicDeck, initialRng);
  const cardInstances = makeCardInstances(shuffled.items);
  const state: GameState = {
    schemaVersion: 1,
    contentVersion: content.version,
    seed: config.seed,
    rngState: shuffled.state,
    nextEntityId: cardInstances.length + 1,
    round: 1,
    turn: 1,
    time: 'day',
    phase: 'movement',
    actionTaken: false,
    player: {
      id: 'player-1', heroId: 'core.hero.tovak', position: { q: 0, r: 0 }, armor: 2, fame: 0, level: 1,
      handLimit: 5, commandSlots: 1, knockedOut: false,
      deck: cardInstances.slice(5), hand: cardInstances.slice(0, 5), playArea: [], discard: [], removed: [], units: [],
      crystals: { red: 0, blue: 0, white: 0, green: 0 }, resources: [],
    },
    source: [], map: {}, enemies: {}, explored: false,
    scenario: {
      id: 'core.scenario.first-reconnaissance-lite', status: 'playing', roundLimit: 4,
      enemiesDefeated: 0, objective: '探索新板块并击败两名敌人。',
    },
    pendingRewards: { fame: 0 }, eventLog: [], checkpoints: [{ eventIndex: 0, barrier: false, reason: '游戏开始' }],
  };
  addMapTemplates(state, content.startingMap);
  if (config.sourceColors) state.source = config.sourceColors.map((color, index) => ({ id: `source-${index + 1}`, color, used: false }));
  else rollSource(state, 3);
  assertInvariants(state);
  return state;
}
