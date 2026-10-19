import { createConquestContent, v08ShadesOfTezlaManifest } from '@mageknight/content';
import { lintShadesOfTezlaContentManifestV8 } from '@mageknight/content-schema';
import { describe, expect, it } from 'vitest';
import { createConquestGame, executeConquestIntent, placeTile } from '../index';
import { addResource } from '../conquest/state';
import type { ConquestCommand, ConquestState } from '../index';

const content = createConquestContent(['shades-of-tezla.official-v0.8']);

function run(state: ConquestState, command: ConquestCommand): ConquestState {
  const result = executeConquestIntent(state, command, content);
  if (!result.ok) throw new Error(`${command.type}: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function encounter(state: ConquestState, enemyIds: string[], phase: 'ranged' | 'block' | 'damage' | 'attack') {
  state.encounter = { enemyIds, origin: { ...state.player.position }, phase, incoming: [], defeatedThisCombat: [], heroWoundsGained: 0, fullyBlockedEnemyIds: [], defendAssignments: {} };
  state.phase = `combat-${phase}`;
}

describe('v0.8 Shades of Tezla rules closure', () => {
  it('ST-802 creates Braevalar, faction decks and all solo scenarios deterministically', () => {
    expect(lintShadesOfTezlaContentManifestV8(v08ShadesOfTezlaManifest)).toEqual([]);
    const state = createConquestGame({ seed: 'tezla-setup', difficulty: 'standard', heroId: 'tezla.hero.braevalar', scenarioId: 'tezla.scenario.life-and-death' }, content);
    expect(state).toMatchObject({ schemaVersion: 8, appVersion: '0.8.0', contentVersion: '0.8.0' });
    expect(state.player.crystals).toMatchObject({ blue: 2, green: 1 });
    expect(state.ruleRuntime.explorationDiscount).toBe(1);
    expect(state.factionTokens.decks.elementalist).toHaveLength(12);
    expect(state.factionTokens.decks['dark-crusader']).toHaveLength(12);
    expect(Object.keys(state.factionLeaders)).toHaveLength(2);
  });

  it('CT-800 applies Defend once to a distinct attacked enemy', () => {
    const state = createConquestGame({ seed: 'defend', difficulty: 'standard' }, content);
    state.enemies.defender = { id: 'defender', definitionId: 'tezla.enemy.elementalist.elven-protectors', position: { q: 0, r: 0 }, defeated: false, summoned: false };
    state.enemies.target = { id: 'target', definitionId: 'tezla.enemy.elementalist.crystal-sprites', position: { q: 0, r: 0 }, defeated: false, summoned: false };
    encounter(state, ['defender', 'target'], 'ranged');
    addResource(state, 'test-attack', 'attack', 3, 'ranged', 'physical');
    expect(executeConquestIntent(state, { type: 'DECLARE_ATTACK', enemyIds: ['target'], kind: 'ranged' }, content)).toMatchObject({ ok: false, error: { code: 'INSUFFICIENT_RESOURCE' } });
    addResource(state, 'test-attack-extra', 'attack', 1, 'ranged', 'physical');
    const next = run(state, { type: 'DECLARE_ATTACK', enemyIds: ['target'], kind: 'ranged' });
    expect(next.enemies.target?.defeated).toBe(true);
    expect(next.encounter?.defendAssignments).toEqual({ defender: 'target' });
  });

  it('CT-801 increases Vampiric armor for every hero wound caused', () => {
    const state = createConquestGame({ seed: 'vampiric', difficulty: 'standard' }, content);
    state.enemies.vampire = { id: 'vampire', definitionId: 'tezla.enemy.dark-crusader.vampire', position: { q: 0, r: 0 }, defeated: false, summoned: false };
    encounter(state, ['vampire'], 'damage');
    state.encounter!.incoming = [{ enemyId: 'vampire', attackIndex: 0, attack: 5, element: 'physical', blocked: false, resolved: false, summoned: false }];
    const next = run(state, { type: 'ASSIGN_DAMAGE', enemyId: 'vampire', attackIndex: 0, target: 'hero' });
    expect(next.encounter?.heroWoundsGained).toBe(3);
    expect(next.enemyModifiers.vampire?.armor).toBe(3);
  });

  it('CT-802 triggers Ambush from a nearby revealed space', () => {
    const state = createConquestGame({ seed: 'ambush', difficulty: 'standard' }, content);
    state.phase = 'movement';
    state.enemies.ambusher = { id: 'ambusher', definitionId: 'tezla.enemy.elementalist.centaur-outriders', position: { q: 0, r: 1 }, defeated: false, summoned: false, ambushing: true };
    state.map['0,1']!.enemyIds.push('ambusher');
    addResource(state, 'move', 'move', 2);
    const next = run(state, { type: 'MOVE_HERO', to: { q: 1, r: 0 } });
    expect(next.encounter?.enemyIds).toContain('ambusher');
    expect(next.eventLog.some((event) => event.type === 'AmbushTriggered')).toBe(true);
  });

  it('CT-803 moves Pursuit one space, but skips an adjacent attack at an interaction site', () => {
    let state = createConquestGame({ seed: 'pursuit-move', difficulty: 'standard' }, content);
    state.phase = 'movement';
    state.map['2,0'] = { coord: { q: 2, r: 0 }, terrain: 'plains', tileId: 'test', revealed: true, conquered: false, burned: false, enemyIds: ['pursuer'] };
    state.enemies.pursuer = { id: 'pursuer', definitionId: 'tezla.enemy.dark-crusader.skeletal-warriors', position: { q: 2, r: 0 }, defeated: false, summoned: false, pursuing: true };
    state = run(state, { type: 'FINISH_MOVEMENT' });
    expect(state.enemies.pursuer?.position).toEqual({ q: 1, r: 0 });
    expect(state.phase).toBe('action');

    state.phase = 'movement';
    state.map['1,0']!.enemyIds = state.map['1,0']!.enemyIds.filter((id) => id !== 'pursuer');
    state.map['0,1']!.enemyIds.push('pursuer');
    state.enemies.pursuer!.position = { q: 0, r: 1 };
    state = run(state, { type: 'FINISH_MOVEMENT' });
    expect(state.encounter).toBeUndefined();
    expect(state.enemies.pursuer).toMatchObject({ position: { q: 0, r: 1 }, pursuitExhausted: true });
  });

  it('CT-804 resolves faction rewards, one-use tokens and next-draw hand limit', () => {
    let state = createConquestGame({ seed: 'faction-token', difficulty: 'standard' }, content);
    const tokenId = 'tezla.token.dark-crusader.amulet-of-reawakening';
    state.factionTokens.inventory.push(tokenId, tokenId);
    const discardId = state.player.zones.hand.pop()!;
    state.player.zones.discard.push(discardId);
    state.phase = 'movement';
    const initialLimit = state.player.handLimit;
    state = run(state, { type: 'USE_FACTION_TOKEN', tokenId });
    expect(state.player.handLimit).toBe(initialLimit + 1);
    expect(state.factionTokens.discards['dark-crusader']).toContain(tokenId);
    expect(executeConquestIntent(state, { type: 'USE_FACTION_TOKEN', tokenId }, content)).toMatchObject({ ok: false, error: { code: 'INVALID_COMMAND' } });
  });

  it('CT-805 places overlays and reduces a leader by multiple dial levels', () => {
    let state = createConquestGame({ seed: 'leader', difficulty: 'standard', scenarioId: 'tezla.scenario.hidden-valley' }, content);
    const cityTile = state.coreTileDeck.find((id) => content.tiles[id]?.site?.definitionId === 'core.site.city')!;
    placeTile(state, content, cityTile, { q: 3, r: 0 });
    const leader = state.factionLeaders['tezla.leader.elementalist']!;
    expect(leader.position).toBeDefined();
    expect(state.overlays[`${leader.position!.q},${leader.position!.r}`]?.definitionId).toBe('tezla.overlay.hidden-valley');

    leader.position = { ...state.player.position };
    leader.guardEnemyIds = [];
    state.phase = 'action';
    state = run(state, { type: 'START_LEADER_COMBAT', leaderId: 'tezla.leader.elementalist' });
    state.phase = 'combat-attack';
    state.encounter!.phase = 'attack';
    addResource(state, 'leader-attack', 'attack', 24, 'normal', 'physical');
    state = run(state, { type: 'DECLARE_LEADER_ATTACK', leaderId: 'tezla.leader.elementalist', kind: 'normal' });
    expect(state.encounter?.leaderLevelsHit).toBe(4);
    state = run(state, { type: 'ADVANCE_COMBAT_PHASE' });
    expect(state.factionLeaders['tezla.leader.elementalist']).toMatchObject({ level: 0, defeated: true });
    expect(state.scenario.leadersDefeated).toBe(1);
  });
});
