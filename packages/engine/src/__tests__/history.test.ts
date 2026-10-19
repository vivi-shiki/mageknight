import { tutorialContent } from '@mageknight/content';
import { cardId, createTutorialFixture } from '@mageknight/test-kit';
import { createHistory, executeIntent, recordSuccessfulCommand, stateHash, undoHistory } from '../index';
import { describe, expect, it } from 'vitest';

describe('checkpoint history', () => {
  it('IT-150 restores cards and resources for an ordinary command', () => {
    const before = createTutorialFixture();
    const command = { type: 'PLAY_CARD', cardId: cardId(before, 'core.card.march-1'), mode: 'basic' } as const;
    const result = executeIntent(before, command, tutorialContent);
    if (!result.ok) throw new Error(result.error.message);
    const history = recordSuccessfulCommand(createHistory(), before, command, result.events);
    const undone = undoHistory(history);
    expect(undone.ok).toBe(true);
    if (undone.ok) expect(stateHash(undone.state)).toBe(stateHash(before));
  });

  it('IT-151 refuses to cross a tile reveal information barrier', () => {
    let state = createTutorialFixture();
    let history = createHistory();
    for (const command of [
      { type: 'PLAY_CARD', cardId: cardId(state, 'core.card.march-1'), mode: 'basic' } as const,
      { type: 'PLAY_CARD', cardId: cardId(state, 'core.card.march-2'), mode: 'basic' } as const,
      { type: 'MOVE_HERO', to: { q: 1, r: 0 } } as const,
      { type: 'EXPLORE_TILE' } as const,
    ]) {
      const previous = state;
      const result = executeIntent(state, command, tutorialContent);
      if (!result.ok) throw new Error(result.error.message);
      state = result.state;
      history = recordSuccessfulCommand(history, previous, command, result.events);
    }
    expect(history.undoStack).toHaveLength(0);
    expect(undoHistory(history)).toMatchObject({ ok: false, code: 'INFORMATION_BARRIER' });
    expect(state.explored).toBe(true);
  });
});
