import type { EffectNode } from '@mageknight/content';
import { evaluateEffect } from '../index';
import { describe, expect, it } from 'vitest';

describe('minimal effect DSL', () => {
  it('evaluates gain, spend-mana and sequence in order', () => {
    const node: EffectNode = {
      type: 'sequence',
      effects: [
        { type: 'spend-mana', color: 'red', amount: 1 },
        { resource: 'attack', amount: 4, element: 'fire' },
      ],
    };
    expect(evaluateEffect(node, { time: 'day' })).toEqual({
      gains: [{ resource: 'attack', amount: 4, element: 'fire' }],
      manaCosts: [{ color: 'red', amount: 1 }],
      choiceRequired: false,
    });
  });

  it('reports an unresolved choice and evaluates a selected branch', () => {
    const node: EffectNode = {
      type: 'choose-one',
      options: [{ resource: 'move', amount: 2 }, { resource: 'influence', amount: 2 }],
    };
    expect(evaluateEffect(node, { time: 'day' }).choiceRequired).toBe(true);
    expect(evaluateEffect(node, { time: 'day', choiceIndex: 1 }).gains).toEqual([{ resource: 'influence', amount: 2 }]);
  });

  it('selects a conditional branch from day/night context', () => {
    const node: EffectNode = {
      type: 'conditional',
      when: 'night',
      then: { resource: 'attack', amount: 5 },
      otherwise: { resource: 'attack', amount: 2 },
    };
    expect(evaluateEffect(node, { time: 'day' }).gains[0]?.amount).toBe(2);
    expect(evaluateEffect(node, { time: 'night' }).gains[0]?.amount).toBe(5);
  });

  it('CT-220 evaluates repeat, draw, discard, convert and lasting effects', () => {
    const node: EffectNode = {
      type: 'sequence',
      effects: [
        { type: 'repeat', times: 2, effect: { resource: 'move', amount: 1 } },
        { type: 'draw', amount: 2 },
        { type: 'discard', amount: 1, filter: 'wound' },
        { type: 'convert', from: 'move', to: 'attack', amount: 2 },
        { type: 'create-lasting-effect', effect: 'armor', amount: 1, expires: 'end-turn' },
      ],
    };
    expect(evaluateEffect(node, { time: 'day' })).toMatchObject({
      gains: [{ resource: 'move', amount: 1 }, { resource: 'move', amount: 1 }],
      draws: 2,
      discards: [{ amount: 1, filter: 'wound' }],
      conversions: [{ from: 'move', to: 'attack', amount: 2 }],
      lastingEffects: [{ effect: 'armor', amount: 1, expires: 'end-turn' }],
    });
  });
});
