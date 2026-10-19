import { conquestContent, v06LostLegionManifest } from '@mageknight/content';
import { lintLostLegionContentManifestV6 } from '@mageknight/content-schema';
import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_SPECIAL_RULES,
  commandCapacity,
  createConquestGame,
  executeConquestIntent,
  marketCost,
  placeTile,
  resolveScenario,
  runVolkareTurn,
} from '../index';
import { addResource } from '../conquest/state';
import type { ConquestCommand, ConquestState } from '../index';

function run(state: ConquestState, command: ConquestCommand): ConquestState {
  const result = executeConquestIntent(state, command, conquestContent);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.state;
}

function specialRules(value: unknown, output = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => specialRules(item, output));
  else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.type === 'special' && typeof record.rule === 'string') output.add(record.rule);
    Object.values(record).forEach((item) => specialRules(item, output));
  }
  return output;
}

describe('v0.6 Lost Legion', () => {
  it('ST-600 validates the complete expansion manifest and executable special rules', () => {
    expect(lintLostLegionContentManifestV6(v06LostLegionManifest)).toEqual([]);
    expect(v06LostLegionManifest.cards).toHaveLength(26);
    expect(v06LostLegionManifest.units.reduce((sum, unit) => sum + unit.copies, 0)).toBe(16);
    expect(v06LostLegionManifest.enemies.length).toBeGreaterThanOrEqual(15);
    expect([...specialRules(v06LostLegionManifest)].filter((rule) => !SUPPORTED_SPECIAL_RULES.has(rule))).toEqual([]);
  });

  it('ST-601 creates Wolfhawk and Volkare setup deterministically', () => {
    const state = createConquestGame({ seed: 'lost-legion', difficulty: 'standard', heroId: 'lost-legion.hero.wolfhawk', scenarioId: 'lost-legion.scenario.volkares-quest' }, conquestContent);
    expect(state).toMatchObject({ schemaVersion: 8, appVersion: '0.8.0', contentVersion: '0.8.0' });
    expect(state.enabledModules).toContain('lost-legion.official-v0.6');
    expect(state.player.heroId).toBe('lost-legion.hero.wolfhawk');
    expect(Object.values(state.player.cardInstances).map((card) => card.definitionId)).toContain('lost-legion.card.hero.tirelessness');
    expect(state.volkare?.deck).toHaveLength(14);
    expect(state.scenario).toMatchObject({ objectiveKind: 'volkare', volkareArmySize: 6, citiesRequired: 0 });
  });

  it('CT-600 charges one extra move for a wall and supports ignoring it', () => {
    const makeState = () => {
      const state = createConquestGame({ seed: 'walls', difficulty: 'standard' }, conquestContent);
      placeTile(state, conquestContent, 'lost-legion.tile.countryside-12', { q: 3, r: 0 });
      state.player.position = { q: 3, r: 0 };
      state.phase = 'movement';
      return state;
    };
    const blocked = makeState();
    addResource(blocked, 'test', 'move', 3);
    expect(executeConquestIntent(blocked, { type: 'MOVE_HERO', to: { q: 4, r: 0 } }, conquestContent).ok).toBe(false);
    let ignored = makeState();
    ignored.ruleRuntime.ignoreWalls = true;
    addResource(ignored, 'test', 'move', 3);
    ignored = run(ignored, { type: 'MOVE_HERO', to: { q: 4, r: 0 } });
    expect(ignored.player.position).toEqual({ q: 4, r: 0 });
  });

  it('CT-601 applies command and fortitude banners', () => {
    const state = createConquestGame({ seed: 'banners', difficulty: 'standard' }, conquestContent);
    state.player.units.push({ id: 'unit-1', definitionId: 'core.unit.regular.peasants', ready: true, wounds: 0, destroyed: false });
    state.attachments.push({ id: 'banner-command', cardId: 'banner-card', definitionId: 'lost-legion.card.artifact.banner-command', unitId: 'unit-1', used: false });
    expect(commandCapacity(state)).toBe(2);

    state.attachments.push({ id: 'banner-fortitude', cardId: 'fortitude-card', definitionId: 'lost-legion.card.artifact.banner-fortitude', unitId: 'unit-1', used: false });
    state.enemies.fixture = { id: 'fixture', definitionId: 'core.enemy.green.prowlers', position: { q: 0, r: 0 }, defeated: false, summoned: false };
    state.encounter = { enemyIds: ['fixture'], origin: { q: 0, r: 0 }, phase: 'damage', incoming: [{ enemyId: 'fixture', attackIndex: 0, attack: 4, element: 'physical', blocked: false, resolved: false, summoned: false }], defeatedThisCombat: [], heroWoundsGained: 0, fullyBlockedEnemyIds: [] };
    state.phase = 'combat-damage';
    const next = run(state, { type: 'ASSIGN_DAMAGE', enemyId: 'fixture', attackIndex: 0, target: 'unit-1' });
    expect(next.player.units[0]).toMatchObject({ wounds: 0, ready: false });
    expect(next.attachments.find((attachment) => attachment.id === 'banner-fortitude')?.used).toBe(true);
  });

  it('CT-602 uses refugee-camp and special reputation recruitment costs', () => {
    expect(marketCost('unit', 'lost-legion.unit.regular.thugs', conquestContent, 5, 'refugee-camp')).toBe(6);
    expect(marketCost('unit', 'lost-legion.unit.elite.heroes', conquestContent, 5, 'refugee-camp')).toBe(7);
    expect(marketCost('unit', 'lost-legion.unit.elite.sorcerers', conquestContent, 0, 'refugee-camp')).toBe(12);
  });

  it('CT-603 uses the printed Elusive armor until the enemy is fully blocked', () => {
    const state = createConquestGame({ seed: 'elusive', difficulty: 'standard' }, conquestContent);
    state.enemies.fixture = { id: 'fixture', definitionId: 'lost-legion.enemy.green.orc-skirmishers', position: { q: 0, r: 0 }, defeated: false, summoned: false };
    state.encounter = { enemyIds: ['fixture'], origin: { q: 0, r: 0 }, phase: 'attack', incoming: [], defeatedThisCombat: [], heroWoundsGained: 0, fullyBlockedEnemyIds: [] };
    state.phase = 'combat-attack';
    addResource(state, 'test', 'attack', 4);
    expect(executeConquestIntent(state, { type: 'DECLARE_ATTACK', enemyIds: ['fixture'], kind: 'normal' }, conquestContent).ok).toBe(false);
    state.player.resources = [];
    addResource(state, 'test', 'attack', 5);
    expect(run(state, { type: 'DECLARE_ATTACK', enemyIds: ['fixture'], kind: 'normal' }).enemies.fixture?.defeated).toBe(true);
  });

  it('CT-604 exposes chosen deep-mine and maze crystal rewards', () => {
    let mine = createConquestGame({ seed: 'deep-mine', difficulty: 'standard' }, conquestContent);
    placeTile(mine, conquestContent, 'lost-legion.tile.countryside-13', { q: 3, r: 0 });
    mine.player.position = { q: 2, r: 1 };
    mine.phase = 'action';
    mine = run(mine, { type: 'CLAIM_DEEP_MINE', color: 'green' });
    expect(mine.player.crystals.green).toBe(1);
    expect(mine.ruleRuntime.deepMineClaimed).toBe(true);

    let maze = createConquestGame({ seed: 'maze', difficulty: 'standard' }, conquestContent);
    placeTile(maze, conquestContent, 'lost-legion.tile.countryside-14', { q: 3, r: 0 });
    maze.player.position = { q: 4, r: 0 };
    maze.phase = 'action';
    addResource(maze, 'test', 'move', 2);
    maze = run(maze, { type: 'ENTER_ADVENTURE_SITE', amount: 2, crystalColors: ['red', 'red'] });
    expect(maze.encounter).toMatchObject({ adventureMove: 2, adventureCrystalColors: ['red', 'red'] });
  });

  it('IT-600 reveals, moves and resolves Volkare', () => {
    const state = createConquestGame({ seed: 'volkare-turn', difficulty: 'explorer', scenarioId: 'lost-legion.scenario.volkares-quest' }, conquestContent);
    placeTile(state, conquestContent, 'lost-legion.tile.countryside-12', { q: 3, r: 0 });
    placeTile(state, conquestContent, 'lost-legion.tile.volkare-camp', { q: 6, r: 0 });
    expect(state.volkare).toMatchObject({ revealed: true, position: { q: 6, r: 0 } });
    expect(state.volkare?.armyEnemyIds).toHaveLength(4);
    state.volkare!.deck = [{ color: 'red', steps: 1 }];
    runVolkareTurn(state, []);
    expect(state.volkare?.position).toEqual({ q: 5, r: 0 });
    state.volkare!.defeated = true;
    expect(resolveScenario(state, conquestContent, [])).toBe(true);
    expect(state.scenario.status).toBe('won');
  });
});
