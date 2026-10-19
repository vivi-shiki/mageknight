import { tutorialContent } from '@mageknight/content';
import { assertInvariants, createGame, executeIntent, getLegalIntents, nextRandom } from '../index';
import { describe, expect, it } from 'vitest';

describe('legal command properties', () => {
  it('PT-160 preserves invariants for 100 seeds and up to 300 legal commands each', () => {
    let executed = 0;
    for (let seedIndex = 0; seedIndex < 100; seedIndex += 1) {
      let state = createGame({ seed: `property-${seedIndex}` }, tutorialContent);
      for (let step = 0; step < 300 && state.scenario.status === 'playing'; step += 1) {
        assertInvariants(state);
        const intents = getLegalIntents(state, tutorialContent);
        if (intents.length === 0) break;
        const random = nextRandom(state.rngState ^ (step + 1));
        const progress = intents.filter((intent) => ['end-round', 'finish-movement', 'end-turn', 'advance-combat'].includes(intent.id) || intent.id.startsWith('damage:') || intent.id.startsWith('decision:'));
        const candidates = progress.length > 0 ? progress : intents;
        const intent = candidates[Math.floor(random.value * candidates.length)];
        if (!intent) throw new Error('Legal intent selection failed.');
        const result = executeIntent(state, intent.command, tutorialContent);
        expect(result.ok, `${seedIndex}:${step}:${intent.id}`).toBe(true);
        if (!result.ok) break;
        state = result.state;
        executed += 1;
      }
      assertInvariants(state);
    }
    expect(executed).toBeGreaterThan(1000);
  }, 60_000);
});
