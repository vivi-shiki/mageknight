import 'fake-indexeddb/auto';
import { tutorialContent } from '@mageknight/content';
import { createGame, createHistory, stateHash } from '@mageknight/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSaveEnvelope, exportSession, loadSession, saveSession } from './game-storage';

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('mageknight-web');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function putRaw(value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('mageknight-web', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('saves', { keyPath: 'slot' });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const put = db.transaction('saves', 'readwrite').objectStore('saves').put(value);
      put.onsuccess = () => { db.close(); resolve(); };
      put.onerror = () => reject(put.error);
    };
  });
}

describe('IndexedDB saves', () => {
  beforeEach(deleteDatabase);

  it('ST-150 round-trips full state, history and an unfinished decision', async () => {
    const state = createGame({ seed: 'save-round-trip' }, tutorialContent);
    state.phase = 'decision';
    state.pendingDecision = { id: 'level-up-1', kind: 'level-up', prompt: '选择升级', options: [{ id: 'armor', label: '护甲 +1' }], returnPhase: 'movement' };
    const session = { state, history: createHistory() };
    await saveSession('manual-1', session);
    const restored = await loadSession('manual-1');
    expect(restored).toBeDefined();
    expect(stateHash(restored!.state)).toBe(stateHash(state));
    expect(restored!.state.pendingDecision).toEqual(state.pendingDecision);
  });

  it('reports corrupt and incompatible saves clearly', async () => {
    await putRaw({ slot: 'manual-1', bad: true });
    await expect(loadSession('manual-1')).rejects.toThrow('存档格式损坏');
    await deleteDatabase();
    const state = createGame({ seed: 'old' }, tutorialContent);
    state.contentVersion = '0.0.9';
    await putRaw(createSaveEnvelope('manual-1', { state, history: createHistory() }));
    await expect(loadSession('manual-1')).rejects.toThrow('不兼容');
  });

  it('exports the deterministic replay inputs and event log', () => {
    const session = { state: createGame({ seed: 'export' }, tutorialContent), history: createHistory() };
    const exported = JSON.parse(exportSession(session));
    expect(exported).toMatchObject({ exportVersion: 1, seed: 'export', contentVersion: '0.1.0', commandSequence: [], eventLog: [] });
  });
});
