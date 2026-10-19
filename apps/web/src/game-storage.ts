import { parseSaveEnvelope } from '@mageknight/content-schema';
import { tutorialContent } from '@mageknight/content';
import type { GameCommand, GameHistory, GameState } from '@mageknight/engine';

export type SaveSlot = 'auto' | 'manual-1';
export type GameSession = { state: GameState; history: GameHistory };

const DB_NAME = 'mageknight-web';
const STORE_NAME = 'saves';
const LEGACY_KEY = 'mageknight-web:v0.1:autosave';

export class SaveDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveDataError';
  }
}

function migrateExploredTile(state: GameState): GameState {
  if (!state.explored) return state;
  for (const template of tutorialContent.explorationMap) {
    const key = `${template.q},${template.r}`;
    if (state.map[key]) continue;
    const enemyIds: string[] = [];
    if (template.enemyId) {
      const enemyId = `enemy-${state.nextEntityId}`;
      state.nextEntityId += 1;
      state.enemies[enemyId] = { id: enemyId, definitionId: template.enemyId, position: { q: template.q, r: template.r }, defeated: false };
      enemyIds.push(enemyId);
    }
    state.map[key] = {
      coord: { q: template.q, r: template.r }, terrain: template.terrain, revealed: true, enemyIds,
      ...(template.site ? { site: template.site } : {}),
    };
  }
  return state;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'slot' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开 IndexedDB。'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 操作失败。'));
  });
}

export function createSaveEnvelope(slot: SaveSlot, session: GameSession) {
  return {
    saveSchemaVersion: 1 as const,
    appVersion: '0.1.0' as const,
    slot,
    savedAt: Date.now(),
    state: structuredClone(session.state),
    history: structuredClone(session.history),
  };
}

export async function saveSession(slot: SaveSlot, session: GameSession): Promise<void> {
  const envelope = createSaveEnvelope(slot, session);
  parseSaveEnvelope(envelope);
  const db = await openDatabase();
  try {
    await requestResult(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(envelope));
  } finally {
    db.close();
  }
}

async function loadLegacySession(): Promise<GameSession | undefined> {
  const serialized = window.localStorage.getItem(LEGACY_KEY);
  if (!serialized) return undefined;
  try {
    const state = migrateExploredTile(JSON.parse(serialized) as GameState);
    if (state.schemaVersion !== 1 || state.contentVersion !== tutorialContent.version) return undefined;
    const session: GameSession = { state, history: { undoStack: [], commandLog: [] as GameCommand[], barrierReason: '旧版存档迁移后不能撤销。' } };
    await saveSession('auto', session);
    window.localStorage.removeItem(LEGACY_KEY);
    return session;
  } catch {
    throw new SaveDataError('旧版自动存档损坏，无法恢复。');
  }
}

export async function loadSession(slot: SaveSlot): Promise<GameSession | undefined> {
  const db = await openDatabase();
  let raw: unknown;
  try {
    raw = await requestResult(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(slot));
  } finally {
    db.close();
  }
  if (!raw) return slot === 'auto' ? loadLegacySession() : undefined;
  try {
    const parsed = parseSaveEnvelope(raw);
    if (parsed.state.contentVersion !== tutorialContent.version) throw new SaveDataError(`存档内容版本 ${parsed.state.contentVersion} 与当前版本 ${tutorialContent.version} 不兼容。`);
    return { state: parsed.state as GameState, history: parsed.history as GameHistory };
  } catch (error) {
    if (error instanceof SaveDataError) throw error;
    throw new SaveDataError('存档格式损坏或版本不受支持。');
  }
}

export async function clearSaves(): Promise<void> {
  const db = await openDatabase();
  try {
    await requestResult(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).clear());
    window.localStorage.removeItem(LEGACY_KEY);
  } finally {
    db.close();
  }
}

export function exportSession(session: GameSession): string {
  return JSON.stringify({
    exportVersion: 1,
    seed: session.state.seed,
    contentVersion: session.state.contentVersion,
    commandSequence: session.history.commandLog,
    eventLog: session.state.eventLog,
    state: session.state,
  }, null, 2);
}
