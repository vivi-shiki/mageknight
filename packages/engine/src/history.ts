import { cloneState } from './state-utils';
import type { DomainEvent, GameCommand, GameState } from './types';

export type HistorySnapshot = {
  state: GameState;
  commandCount: number;
};

export type GameHistory = {
  undoStack: HistorySnapshot[];
  commandLog: GameCommand[];
  barrierReason?: string;
};

const INFORMATION_EVENTS = new Set(['TileRevealed', 'CardDrawn', 'RoundPrepared', 'DeckShuffled']);
const MAX_UNDO_DEPTH = 50;

export function createHistory(): GameHistory {
  return { undoStack: [], commandLog: [] };
}

export function recordSuccessfulCommand(
  history: GameHistory,
  previousState: GameState,
  command: GameCommand,
  events: DomainEvent[],
): GameHistory {
  const commandLog = [...history.commandLog, structuredClone(command)];
  const barrier = events.find((event) => INFORMATION_EVENTS.has(event.type));
  if (barrier) return { undoStack: [], commandLog, barrierReason: barrier.message };
  return {
    undoStack: [...history.undoStack, { state: cloneState(previousState), commandCount: history.commandLog.length }].slice(-MAX_UNDO_DEPTH),
    commandLog,
    ...(history.barrierReason ? { barrierReason: history.barrierReason } : {}),
  };
}

export function undoHistory(history: GameHistory):
  | { ok: true; state: GameState; history: GameHistory }
  | { ok: false; code: 'NOTHING_TO_UNDO' | 'INFORMATION_BARRIER'; message: string } {
  const snapshot = history.undoStack.at(-1);
  if (!snapshot) {
    if (history.barrierReason) return { ok: false, code: 'INFORMATION_BARRIER', message: '不能撤销到已揭示信息之前。' };
    return { ok: false, code: 'NOTHING_TO_UNDO', message: '没有可撤销的操作。' };
  }
  return {
    ok: true,
    state: cloneState(snapshot.state),
    history: {
      undoStack: history.undoStack.slice(0, -1),
      commandLog: history.commandLog.slice(0, snapshot.commandCount),
      ...(history.barrierReason ? { barrierReason: history.barrierReason } : {}),
    },
  };
}
