// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { conquestContent, createConquestContent, tutorialContent } from '@mageknight/content';
import { parseConquestSaveEnvelope } from '@mageknight/content-schema';
import { conquestStateHash, createConquestGame, createConquestHistory, createGame, executeConquestIntent, recordConquestCommand } from '@mageknight/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { createConquestSaveEnvelope, exportConquestReplay, importConquestReplay, loadConquestSession, migrateConquestV2State, migrateConquestV3State, migrateConquestV4State, migrateConquestV5State, migrateConquestV7State, saveConquestSession } from './conquest-storage';
import { createSaveEnvelope } from './game-storage';

describe('v0.8 persistence', () => {
  beforeEach(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('mageknight-web');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  });

  it('ST-800 validates and restores a schema v8 save', async () => {
    const session = { state: createConquestGame({ seed: 'save-v5', difficulty: 'explorer' }, conquestContent), history: createConquestHistory() };
    expect(parseConquestSaveEnvelope(createConquestSaveEnvelope('conquest-auto', session)).saveSchemaVersion).toBe(8);
    await saveConquestSession('conquest-auto', session);
    const restored = await loadConquestSession('conquest-auto');
    expect(restored?.state).toEqual(session.state);
  });

  it('ST-605 validates and restores a zero-city Volkare save', async () => {
    const session = { state: createConquestGame({ seed: 'save-volkare', difficulty: 'standard', scenarioId: 'lost-legion.scenario.volkares-quest' }, conquestContent), history: createConquestHistory() };
    expect(() => parseConquestSaveEnvelope(createConquestSaveEnvelope('conquest-auto', session))).not.toThrow();
    await saveConquestSession('conquest-auto', session);
    expect((await loadConquestSession('conquest-auto'))?.state.scenario.objectiveKind).toBe('volkare');
  });

  it('ST-311 explicitly rejects importing a v0.1 tutorial save as conquest', () => {
    const legacy = { state: createGame({ seed: 'legacy' }, tutorialContent), history: { undoStack: [], commandLog: [] } };
    expect(() => parseConquestSaveEnvelope(createSaveEnvelope('auto', legacy))).toThrow(/v0.1 教学存档不能迁移/);
  });

  it('ST-501 migrates v0.2 single-city state into schema v5', () => {
    const current = createConquestGame({ seed: 'legacy-v2', difficulty: 'standard', scenarioId: 'core.scenario.single-city-development' }, conquestContent);
    const legacy = structuredClone(current) as unknown as Record<string, unknown>;
    legacy.schemaVersion = 2;
    legacy.appVersion = '0.2.0';
    legacy.contentVersion = '0.2.0';
    const scenario = legacy.scenario as Record<string, unknown>;
    scenario.cityLevel = 2;
    scenario.cityConquered = false;
    const migrated = migrateConquestV2State(legacy);
    expect(migrated).toMatchObject({ schemaVersion: 8, appVersion: '0.8.0', contentVersion: '0.8.0', enemyModifiers: {}, attachments: [], turnWoundIds: [], defeatedThisTurn: [], walls: [], adventureClaims: {}, overlays: {}, factionLeaders: {} });
    expect(migrated.scenario).toMatchObject({ cityLevels: [2], citiesRequired: 1, citiesConquered: 0, finalTurnAfterObjective: false });
    expect(migrated.player.manaTokens).toEqual({ red: 0, blue: 0, white: 0, green: 0, gold: 0, black: 0 });
  });

  it('ST-502 migrates v0.3 state into schema v5', () => {
    const legacy = structuredClone(createConquestGame({ seed: 'legacy-v3', difficulty: 'standard' }, conquestContent)) as unknown as Record<string, unknown>;
    legacy.schemaVersion = 3;
    legacy.appVersion = '0.3.0';
    legacy.contentVersion = '0.3.0';
    const player = legacy.player as Record<string, unknown>;
    delete player.manaTokens;
    delete legacy.enemyModifiers;
    const migrated = migrateConquestV3State(legacy);
    expect(migrated.schemaVersion).toBe(8);
    expect(migrated.player.manaTokens.black).toBe(0);
    expect(migrated.enemyModifiers).toEqual({});
  });

  it('ST-503 migrates v0.4 runtime state into schema v5', () => {
    const legacy = structuredClone(createConquestGame({ seed: 'legacy-v4', difficulty: 'standard' }, conquestContent)) as unknown as Record<string, unknown>;
    legacy.schemaVersion = 4;
    legacy.appVersion = '0.4.0';
    legacy.contentVersion = '0.4.0';
    delete legacy.attachments;
    delete legacy.ruleRuntime;
    delete legacy.turnWoundIds;
    const migrated = migrateConquestV4State(legacy);
    expect(migrated).toMatchObject({ schemaVersion: 8, attachments: [], turnWoundIds: [], defeatedThisTurn: [], walls: [], adventureClaims: {}, overlays: {}, factionLeaders: {} });
    expect(migrated.ruleRuntime.endlessMana).toEqual([]);
  });

  it('ST-604 migrates a v0.5 save into schema v6', () => {
    const legacy = structuredClone(createConquestGame({ seed: 'legacy-v5', difficulty: 'standard' }, conquestContent)) as unknown as Record<string, unknown>;
    legacy.schemaVersion = 5;
    legacy.appVersion = '0.5.0';
    legacy.contentVersion = '0.5.0';
    delete legacy.walls;
    delete legacy.adventureClaims;
    const migrated = migrateConquestV5State(legacy);
    expect(migrated).toMatchObject({ schemaVersion: 8, walls: [], adventureClaims: {}, defeatedThisTurn: [], overlays: {}, factionLeaders: {} });
    expect(migrated.ruleRuntime).toMatchObject({ ignoreWalls: false, allUnitsArmorBonus: 0 });
  });

  it('ST-803 migrates a core-only v0.7 save without enabling an expansion', () => {
    const coreContent = createConquestContent([]);
    const legacy = structuredClone(createConquestGame({ seed: 'legacy-v7', difficulty: 'standard' }, coreContent)) as unknown as Record<string, unknown>;
    legacy.schemaVersion = 7;
    legacy.appVersion = '0.7.1';
    legacy.contentVersion = '0.7.0';
    delete legacy.overlays;
    delete legacy.factionLeaders;
    delete legacy.factionTokens;
    const scenario = legacy.scenario as Record<string, unknown>;
    for (const key of ['leadersRequired', 'leadersDefeated', 'graveyardsRequired', 'graveyardsSealed', 'relicsRequired', 'relicsFound']) delete scenario[key];
    const migrated = migrateConquestV7State(legacy);
    expect(migrated).toMatchObject({ schemaVersion: 8, overlays: {}, factionLeaders: {}, factionTokens: { inventory: [], usedNamesThisTurn: [] } });
    expect(migrated.enabledModules).toEqual(coreContent.enabledModules);
    expect(migrated.contentHash).toBe(createConquestContent([]).contentHash);
  });

  it('ST-504 reports a concise error for a damaged conquest save', async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('mageknight-web', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('saves', { keyPath: 'slot' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction('saves', 'readwrite').objectStore('saves').put({ slot: 'conquest-auto', broken: true });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    db.close();
    await expect(loadConquestSession('conquest-auto')).rejects.toThrow('征服存档格式损坏或版本不受支持。');
  });

  it('GR-310 exports replay identity and content metadata', () => {
    const session = { state: createConquestGame({ seed: 'replay-v5', difficulty: 'veteran', heroId: 'core.hero.goldyx' }, conquestContent), history: createConquestHistory() };
    const replay = JSON.parse(exportConquestReplay(session)) as Record<string, unknown>;
    expect(replay).toMatchObject({ replayVersion: 8, seed: 'replay-v5', difficulty: 'veteran', scenarioId: conquestContent.defaultScenarioId, heroId: 'core.hero.goldyx', contentHash: conquestContent.contentHash, enabledModules: conquestContent.enabledModules });
    expect(replay.finalStateHash).toBe(conquestStateHash(session.state));
  });

  it('GR-716 imports an export by replaying commands and rejects a forged terminal hash', () => {
    const initial = createConquestGame({ seed: 'replay-import', difficulty: 'standard' }, conquestContent);
    const command = { type: 'SELECT_TACTIC', tacticId: 'core.tactic.day.early-bird' } as const;
    const result = executeConquestIntent(initial, command, conquestContent);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const session = { state: result.state, history: recordConquestCommand(createConquestHistory(), initial, command, result.events) };
    const exported = exportConquestReplay(session);
    const imported = importConquestReplay(exported);
    expect(imported.state).toEqual(session.state);
    expect(imported.history.commandLog).toEqual([command]);

    const forged = JSON.parse(exported) as Record<string, unknown>;
    forged.finalStateHash = '00000000';
    expect(() => importConquestReplay(JSON.stringify(forged))).toThrow('回放终局哈希不一致');
  });
});
