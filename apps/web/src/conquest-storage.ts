import { createConquestContent } from '@mageknight/content';
import type { ConquestModuleId } from '@mageknight/content';
import { parseConquestSaveEnvelope } from '@mageknight/content-schema';
import type { ConquestCommand, ConquestHistory, ConquestReplayInput, ConquestState } from '@mageknight/engine';
import { conquestStateHash, createRuleRuntime, replayConquest } from '@mageknight/engine';

export type ConquestSaveSlot = 'conquest-auto' | 'conquest-manual-1';
export type ConquestSession = { state: ConquestState; history: ConquestHistory };

const DB_NAME = 'mageknight-web';
const STORE_NAME = 'saves';
const LEGACY_MODULES: ConquestModuleId[] = ['lost-legion.official-v0.6'];
const legacyContent = createConquestContent(LEGACY_MODULES);

export function modulesFromEnabled(enabledModules: readonly string[]): ConquestModuleId[] {
  return (['lost-legion.official-v0.6', 'krang.character-v0.7', 'shades-of-tezla.official-v0.8'] as const).filter((id) => enabledModules.includes(id));
}

export function contentForEnabled(enabledModules: readonly string[]) {
  return createConquestContent(modulesFromEnabled(enabledModules));
}

export function migrateConquestV2State(input: unknown): ConquestState {
  const state = structuredClone(input) as Record<string, unknown>;
  const scenario = state.scenario as Record<string, unknown>;
  const cityLevel = typeof scenario.cityLevel === 'number' ? scenario.cityLevel : 2;
  const cityConquered = scenario.cityConquered === true;
  scenario.cityLevels = [cityLevel];
  scenario.citiesRequired = 1;
  scenario.citiesConquered = cityConquered ? 1 : 0;
  scenario.finalTurnAfterObjective = false;
  scenario.objectiveCompleted = cityConquered;
  delete scenario.cityLevel;
  delete scenario.cityConquered;
  return migrateConquestV3State(state);
}

export function migrateConquestV3State(input: unknown): ConquestState {
  const state = structuredClone(input) as Record<string, unknown>;
  state.schemaVersion = 4;
  state.appVersion = '0.4.0';
  state.contentVersion = '0.4.0';
  state.contentHash = legacyContent.contentHash;
  state.enabledModules = [...legacyContent.enabledModules];
  state.enemyModifiers = {};
  const player = state.player as Record<string, unknown>;
  player.manaTokens = { red: 0, blue: 0, white: 0, green: 0, gold: 0, black: 0 };
  return migrateConquestV4State(state);
}

export function migrateConquestV4State(input: unknown): ConquestState {
  const state = structuredClone(input) as Record<string, unknown>;
  state.schemaVersion = 5;
  state.appVersion = '0.5.0';
  state.contentVersion = '0.5.0';
  state.contentHash = legacyContent.contentHash;
  state.enabledModules = [...legacyContent.enabledModules];
  state.attachments = [];
  state.ruleRuntime = createRuleRuntime();
  state.turnWoundIds = [];
  return migrateConquestV5State(state);
}

export function migrateConquestV5State(input: unknown): ConquestState {
  const state = structuredClone(input) as Record<string, unknown>;
  state.schemaVersion = 6;
  state.appVersion = '0.6.0';
  state.contentVersion = '0.6.0';
  state.contentHash = legacyContent.contentHash;
  state.enabledModules = [...legacyContent.enabledModules];
  state.walls = Array.isArray(state.walls) ? state.walls : [];
  state.adventureClaims = typeof state.adventureClaims === 'object' && state.adventureClaims ? state.adventureClaims : {};
  state.ruleRuntime = { ...createRuleRuntime(), ...((state.ruleRuntime as Record<string, unknown> | undefined) ?? {}) };
  const scenario = state.scenario as Record<string, unknown>;
  scenario.objectiveKind = scenario.objectiveKind === 'volkare' ? 'volkare' : 'cities';
  scenario.volkareArmySize = typeof scenario.volkareArmySize === 'number' ? scenario.volkareArmySize : 0;
  const pools = state.enemyPools as Record<string, unknown> | undefined;
  if (pools) {
    pools.red = Array.isArray(pools.red) ? pools.red : [...legacyContent.enemyPools.red];
    pools.white = Array.isArray(pools.white) ? pools.white : [...legacyContent.enemyPools.white];
  }
  return migrateConquestV6State(state);
}

export function migrateConquestV6State(input: unknown): ConquestState {
  const state = structuredClone(input) as Record<string, unknown>;
  const hasEnabledModules = Array.isArray(state.enabledModules);
  const modules = modulesFromEnabled(hasEnabledModules ? state.enabledModules as string[] : legacyContent.enabledModules);
  const content = createConquestContent(hasEnabledModules ? modules : LEGACY_MODULES);
  state.schemaVersion = 7;
  state.appVersion = '0.7.0';
  state.contentVersion = '0.7.0';
  state.contentHash = content.contentHash;
  state.enabledModules = [...content.enabledModules];
  state.defeatedThisTurn = Array.isArray(state.defeatedThisTurn) ? state.defeatedThisTurn : [];
  state.ruleRuntime = { ...createRuleRuntime(), ...((state.ruleRuntime as Record<string, unknown> | undefined) ?? {}) };
  const player = state.player as Record<string, unknown>;
  player.skills = Array.isArray(player.skills) ? player.skills.map((value) => {
    const skill = value as Record<string, unknown>;
    return { ...skill, used: skill.used === true, usedThisTurn: skill.usedThisTurn === true, flipped: skill.flipped === true };
  }) : [];
  return migrateConquestV7State(state);
}

export function migrateConquestV7State(input: unknown): ConquestState {
  const state = structuredClone(input) as Record<string, unknown>;
  const hasEnabledModules = Array.isArray(state.enabledModules);
  const modules = modulesFromEnabled(hasEnabledModules ? state.enabledModules as string[] : legacyContent.enabledModules);
  const content = createConquestContent(hasEnabledModules ? modules : LEGACY_MODULES);
  state.schemaVersion = 8;
  state.appVersion = '0.8.0';
  state.contentVersion = '0.8.0';
  state.contentHash = content.contentHash;
  state.enabledModules = [...content.enabledModules];
  state.overlays = typeof state.overlays === 'object' && state.overlays ? state.overlays : {};
  state.factionLeaders = typeof state.factionLeaders === 'object' && state.factionLeaders ? state.factionLeaders : {};
  state.factionTokens = typeof state.factionTokens === 'object' && state.factionTokens ? state.factionTokens : {
    decks: { elementalist: [], 'dark-crusader': [] }, discards: { elementalist: [], 'dark-crusader': [] }, inventory: [], usedNamesThisTurn: [],
  };
  state.ruleRuntime = { ...createRuleRuntime(), ...((state.ruleRuntime as Record<string, unknown> | undefined) ?? {}) };
  const scenario = state.scenario as Record<string, unknown>;
  scenario.leadersRequired = typeof scenario.leadersRequired === 'number' ? scenario.leadersRequired : 0;
  scenario.leadersDefeated = typeof scenario.leadersDefeated === 'number' ? scenario.leadersDefeated : 0;
  scenario.graveyardsRequired = typeof scenario.graveyardsRequired === 'number' ? scenario.graveyardsRequired : 0;
  scenario.graveyardsSealed = typeof scenario.graveyardsSealed === 'number' ? scenario.graveyardsSealed : 0;
  scenario.relicsRequired = typeof scenario.relicsRequired === 'number' ? scenario.relicsRequired : 0;
  scenario.relicsFound = typeof scenario.relicsFound === 'number' ? scenario.relicsFound : 0;
  return state as unknown as ConquestState;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'slot' });
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

export function createConquestSaveEnvelope(slot: ConquestSaveSlot, session: ConquestSession) {
  return {
    saveSchemaVersion: 8 as const,
    appVersion: '0.8.0' as const,
    slot,
    savedAt: Date.now(),
    contentHash: session.state.contentHash,
    enabledModules: [...session.state.enabledModules],
    scenarioId: session.state.scenario.id,
    heroId: session.state.player.heroId,
    difficulty: session.state.scenario.difficulty,
    state: structuredClone(session.state),
    history: structuredClone(session.history),
  };
}

export async function saveConquestSession(slot: ConquestSaveSlot, session: ConquestSession): Promise<void> {
  const envelope = createConquestSaveEnvelope(slot, session);
  parseConquestSaveEnvelope(envelope);
  const db = await openDatabase();
  try { await requestResult(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(envelope)); }
  finally { db.close(); }
}

export async function loadConquestSession(slot: ConquestSaveSlot): Promise<ConquestSession | undefined> {
  const db = await openDatabase();
  let value: unknown;
  try { value = await requestResult(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(slot)); }
  finally { db.close(); }
  if (!value) return undefined;
  let parsed: ReturnType<typeof parseConquestSaveEnvelope>;
  try {
    parsed = parseConquestSaveEnvelope(value);
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('v0.1 教学存档')) throw cause;
    throw new Error('征服存档格式损坏或版本不受支持。', { cause });
  }
  if (parsed.saveSchemaVersion === 2) {
    return {
      state: migrateConquestV2State(parsed.state),
      history: {
        ...parsed.history,
        undoStack: parsed.history.undoStack.map((entry) => ({ state: migrateConquestV2State(entry.state), commandCount: entry.commandCount })),
      } as unknown as ConquestHistory,
    };
  }
  if (parsed.saveSchemaVersion === 3) {
    return {
      state: migrateConquestV3State(parsed.state),
      history: {
        ...parsed.history,
        undoStack: parsed.history.undoStack.map((entry) => ({ state: migrateConquestV3State(entry.state), commandCount: entry.commandCount })),
      } as unknown as ConquestHistory,
    };
  }
  if (parsed.saveSchemaVersion === 4) {
    return {
      state: migrateConquestV4State(parsed.state),
      history: {
        ...parsed.history,
        undoStack: parsed.history.undoStack.map((entry) => ({ state: migrateConquestV4State(entry.state), commandCount: entry.commandCount })),
      } as unknown as ConquestHistory,
    };
  }
  if (parsed.saveSchemaVersion === 5) {
    return {
      state: migrateConquestV5State(parsed.state),
      history: {
        ...parsed.history,
        undoStack: parsed.history.undoStack.map((entry) => ({ state: migrateConquestV5State(entry.state), commandCount: entry.commandCount })),
      } as unknown as ConquestHistory,
    };
  }
  if (parsed.saveSchemaVersion === 6) {
    return {
      state: migrateConquestV6State(parsed.state),
      history: {
        ...parsed.history,
        undoStack: parsed.history.undoStack.map((entry) => ({ state: migrateConquestV6State(entry.state), commandCount: entry.commandCount })),
      } as unknown as ConquestHistory,
    };
  }
  if (parsed.saveSchemaVersion === 7) {
    return {
      state: migrateConquestV7State(parsed.state),
      history: {
        ...parsed.history,
        undoStack: parsed.history.undoStack.map((entry) => ({ state: migrateConquestV7State(entry.state), commandCount: entry.commandCount })),
      } as unknown as ConquestHistory,
    };
  }
  const content = contentForEnabled(parsed.enabledModules);
  if (parsed.contentHash !== content.contentHash || parsed.enabledModules.join('|') !== content.enabledModules.join('|')) throw new Error('征服存档的内容模块与当前版本不兼容。');
  return { state: parsed.state as unknown as ConquestState, history: parsed.history as unknown as ConquestHistory };
}

export async function clearConquestSaves(): Promise<void> {
  const db = await openDatabase();
  try {
    const store = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME);
    await Promise.all([requestResult(store.delete('conquest-auto')), requestResult(store.delete('conquest-manual-1'))]);
  } finally { db.close(); }
}

export function exportConquestReplay(session: ConquestSession): string {
  return JSON.stringify({
    replayVersion: 8,
    appVersion: '0.8.0',
    seed: session.state.seed,
    scenarioId: session.state.scenario.id,
    heroId: session.state.player.heroId,
    difficulty: session.state.scenario.difficulty,
    enabledModules: session.state.enabledModules,
    contentHash: session.state.contentHash,
    commandSequence: session.history.commandLog as ConquestCommand[],
    finalStateHash: conquestStateHash(session.state),
    eventLog: session.state.eventLog,
    finalState: session.state,
  }, null, 2);
}

function parseReplayInput(value: unknown): ConquestReplayInput & { finalStateHash?: string } {
  if (!value || typeof value !== 'object') throw new Error('回放文件不是 JSON 对象。');
  const replay = value as Record<string, unknown>;
  if (replay.replayVersion !== 8) throw new Error('只支持 replayVersion 8 的征服回放。');
  if (typeof replay.seed !== 'string' || typeof replay.scenarioId !== 'string' || typeof replay.heroId !== 'string') throw new Error('回放缺少新游戏身份信息。');
  if (!['explorer', 'standard', 'veteran'].includes(String(replay.difficulty))) throw new Error('回放难度无效。');
  if (!Array.isArray(replay.enabledModules) || replay.enabledModules.some((id) => typeof id !== 'string')) throw new Error('回放模块列表无效。');
  if (typeof replay.contentHash !== 'string' || !Array.isArray(replay.commandSequence)) throw new Error('回放缺少内容哈希或命令序列。');
  if (replay.commandSequence.some((command) => !command || typeof command !== 'object' || typeof (command as Record<string, unknown>).type !== 'string')) throw new Error('回放包含无效命令。');
  return replay as unknown as ConquestReplayInput & { finalStateHash?: string };
}

export function importConquestReplay(serialized: string): ConquestSession {
  let raw: unknown;
  try { raw = JSON.parse(serialized); }
  catch (cause) { throw new Error('回放文件不是有效 JSON。', { cause }); }
  const replay = parseReplayInput(raw);
  const content = contentForEnabled(replay.enabledModules);
  const result = replayConquest(replay, content);
  const actualHash = conquestStateHash(result.state);
  if (replay.finalStateHash && replay.finalStateHash !== actualHash) throw new Error(`回放终局哈希不一致：期望 ${replay.finalStateHash}，实际 ${actualHash}。`);
  return { state: result.state, history: { undoStack: [], commandLog: structuredClone(replay.commandSequence), barrierReason: '已验证并载入确定性回放。' } };
}
