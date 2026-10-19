import type { DomainEvent } from '../types';
import type { ConquestCommand, ConquestState } from './types';

export type ConquestHistory = {
  undoStack: Array<{ state: ConquestState; commandCount: number }>;
  commandLog: ConquestCommand[];
  barrierReason?: string;
};

const BARRIERS = new Set(['TileRevealed', 'MarketRefreshed', 'DummyTurn', 'RoundPrepared']);

export function createConquestHistory(): ConquestHistory { return { undoStack: [], commandLog: [] }; }

export function recordConquestCommand(history: ConquestHistory, before: ConquestState, command: ConquestCommand, events: DomainEvent[]): ConquestHistory {
  const barrier = events.find((event) => BARRIERS.has(event.type));
  if (barrier) return { undoStack: [], commandLog: [...history.commandLog, structuredClone(command)], barrierReason: barrier.message };
  return {
    undoStack: [...history.undoStack, { state: structuredClone(before), commandCount: history.commandLog.length }].slice(-50),
    commandLog: [...history.commandLog, structuredClone(command)],
  };
}

export function undoConquestHistory(history: ConquestHistory): { ok: true; state: ConquestState; history: ConquestHistory } | { ok: false; code: 'NO_HISTORY' | 'INFORMATION_BARRIER'; message: string } {
  const snapshot = history.undoStack.at(-1);
  if (!snapshot) return history.barrierReason ? { ok: false, code: 'INFORMATION_BARRIER', message: history.barrierReason } : { ok: false, code: 'NO_HISTORY', message: '没有可撤销操作。' };
  return {
    ok: true,
    state: structuredClone(snapshot.state),
    history: { undoStack: history.undoStack.slice(0, -1), commandLog: history.commandLog.slice(0, snapshot.commandCount) },
  };
}
