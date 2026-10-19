import { conquestContent } from '@mageknight/content';
import {
  assertConquestInvariants,
  conquestStateHash,
  createConquestGame,
  enemyAllowsEffect,
  executeConquestIntent,
  frontierCoords,
  getConquestLegalIntents,
  plannedWedgeCenters,
  projectConquestView,
  reputationModifier,
} from '../index';
import type { ConquestCommand, ConquestState } from '../index';
import { describe, expect, it } from 'vitest';

function run(state: ConquestState, command: ConquestCommand): ConquestState {
  const result = executeConquestIntent(state, command, conquestContent);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.state;
}

function addResource(state: ConquestState, resource: 'move' | 'influence' | 'attack' | 'block' | 'heal', amount: number, attackKind: 'normal' | 'ranged' | 'siege' = 'normal', element: 'physical' | 'fire' | 'ice' | 'cold-fire' = 'physical') {
  state.player.resources.push({ id: `fixture-${resource}-${state.player.resources.length}`, sourceId: 'fixture', resource, amount, attackKind, element });
}

function revealCity(state: ConquestState): ConquestState {
  state = run(state, { type: 'SELECT_TACTIC', tacticId: 'core.tactic.day.early-bird' });
  while (!Object.values(state.map).some((space) => space.siteId === 'core.site.city') && state.countrysideTileDeck.length + state.coreTileDeck.length > 0) {
    state.player.position = frontierCoords(state)[0]!;
    state.player.resources = [];
    addResource(state, 'move', 2);
    state = run(state, { type: 'EXPLORE_TILE' });
  }
  return state;
}

function revealAllTiles(state: ConquestState): ConquestState {
  state = run(state, { type: 'SELECT_TACTIC', tacticId: 'core.tactic.day.early-bird' });
  while (state.countrysideTileDeck.length + state.coreTileDeck.length > 0) {
    state.player.position = frontierCoords(state)[0]!;
    state.player.resources = [];
    addResource(state, 'move', 2);
    state = run(state, { type: 'EXPLORE_TILE' });
  }
  return state;
}

describe('v0.5 conquest core', () => {
  it('CT-320 creates each core hero with its own complete starting deck', () => {
    for (const hero of Object.values(conquestContent.heroes)) {
      const state = createConquestGame({ seed: `hero-${hero.id}`, difficulty: 'standard', heroId: hero.id }, conquestContent);
      expect(state.player.heroId).toBe(hero.id);
      expect(Object.values(state.player.cardInstances).map((card) => card.definitionId).sort()).toEqual([...hero.basicDeck].sort());
      expect(state.player.zones.deck.length + state.player.zones.hand.length).toBe(16);
    }
  });

  it('IT-321 configures the official solo map and city levels', () => {
    const state = revealAllTiles(createConquestGame({ seed: 'solo-map-v03', difficulty: 'standard' }, conquestContent));
    expect(state.placedTiles).toHaveLength(12);
    expect(state.placedTiles.filter((tile) => conquestContent.tiles[tile.definitionId]?.kind === 'countryside')).toHaveLength(7);
    const cities = Object.values(state.map).filter((space) => space.siteId === 'core.site.city');
    expect(cities).toHaveLength(2);
    expect(cities.map((city) => city.enemyIds.length).sort((a, b) => a - b)).toEqual([5, 8]);
    expect(state.placedTiles.map((tile) => `${tile.center.q},${tile.center.r}`)).toEqual([
      '0,0',
      '3,-2', '2,1',
      '6,-4', '4,2', '5,-1',
      '9,-6', '6,3',
      '8,-3', '7,0',
      '11,-5', '9,1',
    ]);
      expect(plannedWedgeCenters(7, 4)).toEqual(state.placedTiles.map((tile) => tile.center));
    for (const tile of state.placedTiles.filter((placed) => conquestContent.tiles[placed.definitionId]?.kind === 'core')) {
      expect(['8,-3', '7,0', '11,-5', '9,1']).toContain(`${tile.center.q},${tile.center.r}`);
    }
  });

  it('IT-322 grants exactly one last turn after the second city', () => {
    let state = createConquestGame({ seed: 'solo-final-turn', difficulty: 'standard' }, conquestContent);
    state = run(state, { type: 'SELECT_TACTIC', tacticId: 'core.tactic.day.early-bird' });
    state.phase = 'action';
    state.scenario.citiesConquered = 2;
    state = run(state, { type: 'END_TURN' });
    expect(state.scenario.status).toBe('playing');
    expect(state.scenario.objectiveCompleted).toBe(true);
    expect(state.finalTurnsRemaining).toBe(1);
    state.phase = 'action';
    state = run(state, { type: 'END_TURN' });
    expect(state.scenario.status).toBe('won');
  });

  it('CT-210 routes commands atomically and preserves the input on failure', () => {
    const state = createConquestGame({ seed: 'atomic', difficulty: 'standard' }, conquestContent);
    const before = conquestStateHash(state);
    const result = executeConquestIntent(state, { type: 'MOVE_HERO', to: { q: 1, r: 0 } }, conquestContent);
    expect(result.ok).toBe(false);
    expect(conquestStateHash(state)).toBe(before);
  });

  it('CT-220 enforces unique card zones', () => {
    const state = createConquestGame({ seed: 'zones', difficulty: 'standard' }, conquestContent);
    expect(() => assertConquestInvariants(state)).not.toThrow();
    const cardId = state.player.zones.hand[0]!;
    state.player.zones.discard.push(cardId);
    expect(() => assertConquestInvariants(state)).toThrow(/multiple zones/);
  });

  it('CT-231 selects tactics and gives Dummy a different tactic', () => {
    let state = createConquestGame({ seed: 'tactic', difficulty: 'standard' }, conquestContent);
    state = run(state, { type: 'SELECT_TACTIC', tacticId: 'core.tactic.day.great-start' });
    expect(state.phase).toBe('movement');
    expect(state.dummy.tacticId).not.toBe('core.tactic.day.great-start');
    expect(state.player.zones.hand).toHaveLength(6);
  });

  it('CT-232 Dummy exhaustion announces round end and grants one final turn', () => {
    let state = createConquestGame({ seed: 'dummy', difficulty: 'standard' }, conquestContent);
    state = run(state, { type: 'SELECT_TACTIC', tacticId: 'core.tactic.day.early-bird' });
    for (let index = 0; index < 8 && state.round === 1; index += 1) {
      state.phase = 'action';
      state = run(state, { type: 'END_TURN' });
    }
    expect(state.round).toBe(2);
    expect(state.phase).toBe('tactics');
    expect(state.time).toBe('night');
  });

  it('PT-240 generates non-overlapping complete seven-space tiles for 200 seeds', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const state = revealCity(createConquestGame({ seed: `map-${seed}`, difficulty: 'standard' }, conquestContent));
      expect(Object.keys(state.map)).toHaveLength(state.placedTiles.length * 7);
      for (const tile of state.placedTiles) expect(Object.values(state.map).filter((space) => space.tileId === tile.definitionId)).toHaveLength(7);
      expect(Object.values(state.map).some((space) => space.siteId === 'core.site.city')).toBe(true);
      expect(() => assertConquestInvariants(state)).not.toThrow();
    }
  });

  it('CT-242 exposes every shared edge beside the next staggered tile as a legal frontier', () => {
    const state = createConquestGame({ seed: 'wedge-frontier', difficulty: 'standard' }, conquestContent);
    expect(frontierCoords(state).map((coord) => `${coord.q},${coord.r}`).sort()).toEqual(['1,-1', '1,0']);
  });

  it('CT-241 hides tile and marker order from projected views', () => {
    const state = createConquestGame({ seed: 'hidden', difficulty: 'standard' }, conquestContent);
    const view = projectConquestView(state, conquestContent) as unknown as Record<string, unknown>;
    expect(view.rngState).toBeUndefined();
    expect(view.enemyPools).toBeUndefined();
    expect(view.countrysideTileDeck).toBeUndefined();
    expect(view.hidden).toMatchObject({ countrysideTiles: 7, coreTiles: 4 });
  });

  it('CT-251 applies the reputation track to market costs', () => {
    expect(reputationModifier(-7)).toBe(-5);
    expect(reputationModifier(0)).toBe(0);
    expect(reputationModifier(7)).toBe(3);
  });

  it('IT-250 recruits, opens replacement choice at the command limit, and resolves it', () => {
    let state = createConquestGame({ seed: 'market', difficulty: 'standard' }, conquestContent);
    state = run(state, { type: 'SELECT_TACTIC', tacticId: 'core.tactic.day.early-bird' });
    state = run(state, { type: 'FINISH_MOVEMENT' });
    state = run(state, { type: 'START_INTERACTION' });
    state.market.unit.offer = ['core.unit.regular.peasants', 'core.unit.regular.foresters'];
    addResource(state, 'influence', 20);
    state = run(state, { type: 'RECRUIT_UNIT', definitionId: 'core.unit.regular.peasants' });
    state = run(state, { type: 'RECRUIT_UNIT', definitionId: 'core.unit.regular.foresters' });
    expect(state.pendingDecision?.kind).toBe('replace-unit');
    state = run(state, { type: 'RESOLVE_DECISION', optionId: state.player.units[0]!.id });
    expect(state.player.units.filter((unit) => !unit.destroyed)).toHaveLength(1);
    expect(state.player.units.find((unit) => !unit.destroyed)?.definitionId).toBe('core.unit.regular.foresters');
  });

  it('CT-260 applies crystal mine and magical glade end-turn benefits', () => {
    let state = createConquestGame({ seed: 'sites', difficulty: 'standard' }, conquestContent);
    state = run(state, { type: 'SELECT_TACTIC', tacticId: 'core.tactic.day.early-bird' });
    const start = state.map['0,0']!;
    start.siteId = 'core.site.crystal-mine';
    state.phase = 'action';
    state = run(state, { type: 'END_TURN' });
    expect(Object.values(state.player.crystals).reduce((sum, value) => sum + value, 0)).toBe(1);
    const woundId = `wound-${state.nextEntityId++}`;
    state.player.cardInstances[woundId] = { id: woundId, definitionId: 'core.card.wound' };
    state.player.zones.hand.push(woundId);
    state.map['0,0']!.siteId = 'core.site.magical-glade';
    state.phase = 'action';
    state = run(state, { type: 'END_TURN' });
    expect(state.player.zones.removed).toContain(woundId);
  });

  it('CT-270 handles elemental block, Swift and Cumbersome', () => {
    let state = createConquestGame({ seed: 'combat-elements', difficulty: 'standard' }, conquestContent);
    state.phase = 'action';
    const enemyId = 'fixture-golem';
    state.enemies[enemyId] = { id: enemyId, definitionId: 'core.enemy.gray.golems', position: { q: 0, r: 0 }, defeated: false, summoned: false };
    state.map['0,0']!.enemyIds = [enemyId];
    state = run(state, { type: 'START_COMBAT', enemyIds: [enemyId] });
    state = run(state, { type: 'ADVANCE_COMBAT_PHASE' });
    addResource(state, 'move', 1);
    state = run(state, { type: 'REDUCE_CUMBERSOME', enemyId, attackIndex: 0 });
    addResource(state, 'block', 3, 'normal', 'ice');
    state = run(state, { type: 'DECLARE_BLOCK', enemyId, attackIndex: 0 });
    expect(state.encounter?.incoming[0]).toMatchObject({ attack: 3, blocked: true });
  });

  it('CT-271 applies Poison and Paralyze to hero and units', () => {
    let state = createConquestGame({ seed: 'poison', difficulty: 'standard' }, conquestContent);
    state.phase = 'action';
    const enemyId = 'fixture-medusa';
    state.enemies[enemyId] = { id: enemyId, definitionId: 'core.enemy.brown.medusa', position: { q: 0, r: 0 }, defeated: false, summoned: false };
    state.map['0,0']!.enemyIds = [enemyId];
    state = run(state, { type: 'START_COMBAT', enemyIds: [enemyId] });
    state = run(state, { type: 'ADVANCE_COMBAT_PHASE' });
    state = run(state, { type: 'ADVANCE_COMBAT_PHASE' });
    state = run(state, { type: 'ASSIGN_DAMAGE', enemyId, attackIndex: 0, target: 'hero' });
    expect(state.player.zones.hand.every((id) => state.player.cardInstances[id]?.definitionId === 'core.card.wound')).toBe(true);
  });

  it('CT-272 creates a deterministic Summon attack and enforces Assassination targets', () => {
    let state = createConquestGame({ seed: 'abilities', difficulty: 'standard' }, conquestContent);
    state.phase = 'action';
    const enemyId = 'fixture-summoner';
    state.enemies[enemyId] = { id: enemyId, definitionId: 'core.enemy.brown.summoners', position: { q: 0, r: 0 }, defeated: false, summoned: false };
    state.map['0,0']!.enemyIds = [enemyId];
    state = run(state, { type: 'START_COMBAT', enemyIds: [enemyId] });
    state = run(state, { type: 'ADVANCE_COMBAT_PHASE' });
    expect(state.encounter?.incoming).toHaveLength(1);
    expect(state.encounter?.incoming[0]?.summoned).toBe(true);
  });

  it('CT-275 handles Cold Fire block efficiency and Arcane Immunity by ability tag', () => {
    let state = createConquestGame({ seed: 'cold-fire', difficulty: 'standard' }, conquestContent);
    state.phase = 'action';
    const enemyId = 'fixture-dragon';
    state.enemies[enemyId] = { id: enemyId, definitionId: 'core.enemy.city.dragon', position: { q: 0, r: 0 }, defeated: false, summoned: false };
    state.map['0,0']!.enemyIds = [enemyId];
    state = run(state, { type: 'START_COMBAT', enemyIds: [enemyId] });
    state = run(state, { type: 'ADVANCE_COMBAT_PHASE' });
    addResource(state, 'block', 6, 'normal', 'ice');
    expect(executeConquestIntent(state, { type: 'DECLARE_BLOCK', enemyId, attackIndex: 0 }, conquestContent).ok).toBe(false);
    addResource(state, 'block', 6, 'normal', 'ice');
    state = run(state, { type: 'DECLARE_BLOCK', enemyId, attackIndex: 0 });
    expect(state.encounter?.incoming[0]?.blocked).toBe(true);
    const immune = conquestContent.enemies['core.enemy.violet.ice-mages']!;
    expect(enemyAllowsEffect(immune, 'modifier')).toBe(false);
    expect(enemyAllowsEffect(immune, 'attack')).toBe(true);
  });

  it('CT-276 applies Poison twice to a unit and destroys it', () => {
    let state = createConquestGame({ seed: 'poison-unit', difficulty: 'standard' }, conquestContent);
    state.player.units.push({ id: 'unit-poison', definitionId: 'core.unit.regular.peasants', ready: true, wounds: 0, destroyed: false });
    state.phase = 'action';
    const enemyId = 'fixture-hag';
    state.enemies[enemyId] = { id: enemyId, definitionId: 'core.enemy.green.cursed-hags', position: { q: 0, r: 0 }, defeated: false, summoned: false };
    state.map['0,0']!.enemyIds = [enemyId];
    state = run(state, { type: 'START_COMBAT', enemyIds: [enemyId] });
    state = run(state, { type: 'ADVANCE_COMBAT_PHASE' });
    state = run(state, { type: 'ADVANCE_COMBAT_PHASE' });
    state = run(state, { type: 'ASSIGN_DAMAGE', enemyId, attackIndex: 0, target: 'unit-poison' });
    expect(state.player.units[0]).toMatchObject({ wounds: 2, destroyed: true });
  });

  it('IT-290 conquers a multi-guard city and calculates final score', () => {
    let state = revealCity(createConquestGame({ seed: 'victory', difficulty: 'standard', scenarioId: 'core.scenario.single-city-development' }, conquestContent));
    const city = Object.values(state.map).find((space) => space.siteId === 'core.site.city')!;
    state.player.position = { ...city.coord };
    state.phase = 'action';
    state = run(state, { type: 'START_COMBAT', enemyIds: [...city.enemyIds] });
    addResource(state, 'attack', 100, 'siege');
    state = run(state, { type: 'DECLARE_ATTACK', enemyIds: [...state.encounter!.enemyIds], kind: 'siege' });
    state = run(state, { type: 'ADVANCE_COMBAT_PHASE' });
    state = run(state, { type: 'ADVANCE_COMBAT_PHASE' });
    state = run(state, { type: 'ADVANCE_COMBAT_PHASE' });
    state = run(state, { type: 'ADVANCE_COMBAT_PHASE' });
    expect(state.scenario.citiesConquered).toBe(1);
    state = run(state, { type: 'END_TURN' });
    expect(state.scenario.status).toBe('won');
    expect(state.scenario.score?.total).toBeTypeOf('number');
  });

  it('GR-290 remains deterministic for setup, map and city marker order', () => {
    const first = revealCity(createConquestGame({ seed: 'golden-v02', difficulty: 'veteran' }, conquestContent));
    const second = revealCity(createConquestGame({ seed: 'golden-v02', difficulty: 'veteran' }, conquestContent));
    expect(conquestStateHash(first)).toBe(conquestStateHash(second));
    expect(conquestStateHash(first)).toBe('72f65a2b');
  });

  it('CT-273 lets Unfortified ignore site fortification and applies Elusive armor', () => {
    let state = createConquestGame({ seed: 'fortification', difficulty: 'standard' }, conquestContent);
    state.phase = 'action';
    state.map['0,0']!.siteId = 'core.site.keep';
    const enemyId = 'fixture-unfortified';
    state.enemies[enemyId] = { id: enemyId, definitionId: 'core.enemy.violet.fire-mages', position: { q: 0, r: 0 }, defeated: false, summoned: false };
    state.map['0,0']!.enemyIds = [enemyId];
    state = run(state, { type: 'START_COMBAT', enemyIds: [enemyId] });
    addResource(state, 'attack', 5, 'ranged');
    const ranged = executeConquestIntent(state, { type: 'DECLARE_ATTACK', enemyIds: [enemyId], kind: 'ranged' }, conquestContent);
    expect(ranged.ok).toBe(true);

    state = createConquestGame({ seed: 'elusive', difficulty: 'standard' }, conquestContent);
    state.phase = 'action';
    state.enemies[enemyId] = { id: enemyId, definitionId: 'core.enemy.green.wolf-riders', position: { q: 0, r: 0 }, defeated: false, summoned: false };
    state.map['0,0']!.enemyIds = [enemyId];
    state = run(state, { type: 'START_COMBAT', enemyIds: [enemyId] });
    addResource(state, 'attack', 5, 'ranged');
    expect(executeConquestIntent(state, { type: 'DECLARE_ATTACK', enemyIds: [enemyId], kind: 'ranged' }, conquestContent).ok).toBe(false);
  });

  it('CT-274 prevents assigning Assassination damage to a unit', () => {
    let state = createConquestGame({ seed: 'assassination', difficulty: 'standard' }, conquestContent);
    state.player.units.push({ id: 'unit-fixture', definitionId: 'core.unit.regular.guardsmen', ready: true, wounds: 0, destroyed: false });
    state.phase = 'action';
    const enemyId = 'fixture-assassin';
    state.enemies[enemyId] = { id: enemyId, definitionId: 'core.enemy.gray.assassins', position: { q: 0, r: 0 }, defeated: false, summoned: false };
    state.map['0,0']!.enemyIds = [enemyId];
    state = run(state, { type: 'START_COMBAT', enemyIds: [enemyId] });
    state = run(state, { type: 'ADVANCE_COMBAT_PHASE' });
    state = run(state, { type: 'ADVANCE_COMBAT_PHASE' });
    const result = executeConquestIntent(state, { type: 'ASSIGN_DAMAGE', enemyId, attackIndex: 0, target: 'unit-fixture' }, conquestContent);
    expect(result.ok).toBe(false);
  });

  it('IT-261 burns a monastery, changes reputation and awards an artifact after victory', () => {
    let state = createConquestGame({ seed: 'burn', difficulty: 'standard' }, conquestContent);
    state = run(state, { type: 'SELECT_TACTIC', tacticId: 'core.tactic.day.early-bird' });
    state.map['0,0']!.siteId = 'core.site.monastery';
    state = run(state, { type: 'FINISH_MOVEMENT' });
    state = run(state, { type: 'START_INTERACTION' });
    state = run(state, { type: 'BURN_MONASTERY' });
    expect(state.player.reputation).toBe(-3);
    addResource(state, 'attack', 100, 'siege');
    state = run(state, { type: 'DECLARE_ATTACK', enemyIds: [...state.encounter!.enemyIds], kind: 'siege' });
    for (let index = 0; index < 4; index += 1) state = run(state, { type: 'ADVANCE_COMBAT_PHASE' });
    expect(state.map['0,0']?.burned).toBe(true);
    expect(state.player.zones.inventory).toHaveLength(1);
  });

  it('IT-262 conquers a mage tower and awards a spell', () => {
    let state = createConquestGame({ seed: 'tower', difficulty: 'standard' }, conquestContent);
    state.phase = 'action';
    state.map['0,0']!.siteId = 'core.site.mage-tower';
    const enemyId = 'tower-enemy';
    state.enemies[enemyId] = { id: enemyId, definitionId: 'core.enemy.violet.fire-mages', position: { q: 0, r: 0 }, defeated: false, summoned: false };
    state.map['0,0']!.enemyIds = [enemyId];
    state = run(state, { type: 'START_COMBAT', enemyIds: [enemyId] });
    addResource(state, 'attack', 100, 'siege');
    state = run(state, { type: 'DECLARE_ATTACK', enemyIds: [enemyId], kind: 'siege' });
    for (let index = 0; index < 4; index += 1) state = run(state, { type: 'ADVANCE_COMBAT_PHASE' });
    const acquired = state.player.zones.discard.map((id) => conquestContent.cards[state.player.cardInstances[id]?.definitionId ?? '']).filter((card) => card?.kind === 'spell');
    expect(acquired).toHaveLength(1);
  });

  it('IT-291 loses when the configured round limit is exceeded', () => {
    let state = createConquestGame({ seed: 'round-loss', difficulty: 'standard' }, conquestContent);
    state.round = state.scenario.roundLimit;
    state.phase = 'movement';
    state.player.zones.discard.push(...state.player.zones.deck);
    state.player.zones.deck = [];
    state = run(state, { type: 'DECLARE_END_ROUND' });
    expect(state.scenario.status).toBe('lost');
    expect(state.scenario.score).toBeDefined();
  });

  it('GR-310 produces the same result after a JSON save/restore boundary', () => {
    const initial = createConquestGame({ seed: 'resume', difficulty: 'standard' }, conquestContent);
    const first = run(initial, { type: 'SELECT_TACTIC', tacticId: 'core.tactic.day.early-bird' });
    const restored = JSON.parse(JSON.stringify(first)) as ConquestState;
    first.phase = 'action';
    restored.phase = 'action';
    const continuous = run(first, { type: 'END_TURN' });
    const resumed = run(restored, { type: 'END_TURN' });
    expect(conquestStateHash(resumed)).toBe(conquestStateHash(continuous));
  });

  it('PT-310 preserves invariants for 200 seeds and legal command sequences', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      let state = createConquestGame({ seed: `rules-${seed}`, difficulty: (['explorer', 'standard', 'veteran'] as const)[seed % 3]! }, conquestContent);
      for (let step = 0; step < 40 && state.scenario.status === 'playing'; step += 1) {
        const intents = getConquestLegalIntents(state, conquestContent);
        if (intents.length === 0) break;
        const intent = intents[(seed * 17 + step * 7) % intents.length]!;
        const result = executeConquestIntent(state, intent.command, conquestContent);
        expect(result.ok).toBe(true);
        if (!result.ok) break;
        state = result.state;
        expect(() => assertConquestInvariants(state)).not.toThrow();
      }
    }
  }, 60_000);
});
