import { tutorialContent } from '@mageknight/content';
import { cardId, createTutorialFixture, mustExecute } from '@mageknight/test-kit';
import { createGame, executeIntent, projectView, stateHash } from '../index';
import { describe, expect, it } from 'vitest';

describe('M1 engine', () => {
  it('CT-020 creates identical state for identical seeds and round-trips JSON', () => {
    const first = createGame({ seed: 'same' }, tutorialContent);
    const second = createGame({ seed: 'same' }, tutorialContent);
    expect(stateHash(first)).toBe(stateHash(second));
    expect(stateHash(JSON.parse(JSON.stringify(first)))).toBe(stateHash(first));
  });

  it('CT-021 keeps internal RNG state out of the projected view', () => {
    const state = createTutorialFixture();
    const view = projectView(state, tutorialContent);
    expect('rngState' in view).toBe(false);
  });

  it('CT-040 allows gold mana during day and rejects it during night', () => {
    const day = createGame({ seed: 'mana', deckOrder: [
      'core.card.march-1', 'core.card.rage-1', 'core.card.promise', 'core.card.determination-1', 'core.card.stamina-1',
      ...tutorialContent.basicDeck.slice(5),
    ], sourceColors: ['gold'] }, tutorialContent);
    const march = cardId(day, 'core.card.march-1');
    const powered = executeIntent(day, { type: 'PLAY_CARD', cardId: march, mode: 'strong' }, tutorialContent);
    expect(powered.ok).toBe(true);
    if (powered.ok) expect(powered.state.player.resources[0]?.amount).toBe(4);

    const night = structuredClone(day);
    night.time = 'night';
    const rejected = executeIntent(night, { type: 'PLAY_CARD', cardId: march, mode: 'strong' }, tutorialContent);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe('MANA_COLOR_UNAVAILABLE');
    expect(stateHash(rejected.state)).toBe(stateHash(night));
  });

  it('CT-060 rejects insufficient movement atomically', () => {
    const state = createTutorialFixture();
    const before = stateHash(state);
    const result = executeIntent(state, { type: 'MOVE_HERO', to: { q: 1, r: 0 } }, tutorialContent);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INSUFFICIENT_RESOURCE');
    expect(stateHash(state)).toBe(before);
  });

  it('CT-061 rejects impassable terrain and supports an actionless turn', () => {
    let state = createTutorialFixture();
    state.map['0,-1']!.terrain = 'mountain';
    state.player.resources.push({ id: 'move-fixture', sourceId: 'fixture', resource: 'move', amount: 20, attackKind: 'normal', element: 'physical' });
    const rejected = executeIntent(state, { type: 'MOVE_HERO', to: { q: 0, r: -1 } }, tutorialContent);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe('TERRAIN_IMPASSABLE');
    state = mustExecute(state, { type: 'FINISH_MOVEMENT' });
    state = mustExecute(state, { type: 'END_TURN' });
    expect(state.turn).toBe(2);
  });

  it('CT-051 supports standard rest and discards selected wounds', () => {
    let state = createTutorialFixture();
    const nonWound = state.player.hand[0];
    if (!nonWound) throw new Error('Fixture hand missing.');
    state.player.hand.push({ id: 'wound-fixture', definitionId: 'core.card.wound' });
    state = mustExecute(state, { type: 'REST', discardCardId: nonWound.id, woundCardIds: ['wound-fixture'] });
    expect(state.phase).toBe('action');
    expect(state.player.discard.map((card) => card.id)).toEqual(expect.arrayContaining([nonWound.id, 'wound-fixture']));
  });

  it('CT-071 moves and explores through commands, creating an information barrier', () => {
    let state = createTutorialFixture();
    state = mustExecute(state, { type: 'PLAY_CARD', cardId: cardId(state, 'core.card.march-1'), mode: 'basic' });
    state = mustExecute(state, { type: 'PLAY_CARD', cardId: cardId(state, 'core.card.march-2'), mode: 'basic' });
    state = mustExecute(state, { type: 'MOVE_HERO', to: { q: 1, r: 0 } });
    state = mustExecute(state, { type: 'EXPLORE_TILE' });
    expect(state.explored).toBe(true);
    expect(Object.keys(state.map)).toHaveLength(14);
    expect(tutorialContent.explorationMap).toHaveLength(7);
    expect(state.map['2,-1']?.enemyIds).toHaveLength(1);
    expect(state.checkpoints.at(-1)).toMatchObject({ barrier: true, reason: '揭示地图板块' });
    expect(state.eventLog.at(-1)?.type).toBe('TileRevealed');
  });
});
