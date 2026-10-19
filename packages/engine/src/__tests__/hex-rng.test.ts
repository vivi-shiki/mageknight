import { describe, expect, it } from 'vitest';
import { areAdjacent, createRngState, hexDistance, isCompleteSevenHexTile, neighbors, shuffleWithState, terrainCost } from '../index';

describe('hex grid', () => {
  it('UT-060 computes six neighbors and symmetric distance', () => {
    const origin = { q: 0, r: 0 };
    expect(neighbors(origin)).toHaveLength(6);
    expect(hexDistance(origin, { q: 3, r: -2 })).toBe(3);
    expect(hexDistance(origin, { q: 3, r: -2 })).toBe(hexDistance({ q: 3, r: -2 }, origin));
    expect(areAdjacent(origin, { q: 1, r: -1 })).toBe(true);
  });

  it('UT-061 applies day and night terrain costs', () => {
    expect(terrainCost('forest', 'day')).toBe(3);
    expect(terrainCost('forest', 'night')).toBe(5);
    expect(terrainCost('desert', 'day')).toBe(5);
    expect(terrainCost('desert', 'night')).toBe(3);
    expect(terrainCost('mountain', 'day')).toBe(Number.POSITIVE_INFINITY);
  });

  it('requires a center and all six neighbors for a board tile', () => {
    const complete = [{ q: 0, r: 0 }, ...neighbors({ q: 0, r: 0 })];
    expect(isCompleteSevenHexTile(complete)).toBe(true);
    expect(isCompleteSevenHexTile(complete.slice(0, 6))).toBe(false);
  });
});

describe('deterministic random source', () => {
  it('UT-030 keeps shuffles stable for the same seed', () => {
    const values = ['a', 'b', 'c', 'd', 'e', 'f'];
    const first = shuffleWithState(values, createRngState('fixed-seed'));
    const second = shuffleWithState(values, createRngState('fixed-seed'));
    const different = shuffleWithState(values, createRngState('different-seed'));
    expect(first).toEqual(second);
    expect(first.items).not.toEqual(different.items);
  });
});
