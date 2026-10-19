import { conquestContent } from '@mageknight/content';
import { conquestStateHash, conquestTerrainCost, createConquestGame, executeConquestIntent, getConquestLegalIntents } from '../index';
import type { ConquestCommand, ConquestState } from '../index';
import { describe, expect, it } from 'vitest';

function run(state: ConquestState, command: ConquestCommand): ConquestState {
  const result = executeConquestIntent(state, command, conquestContent);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.state;
}

function readyState(seed: string, phase: ConquestState['phase'] = 'movement'): ConquestState {
  const state = createConquestGame({ seed, difficulty: 'standard' }, conquestContent);
  state.phase = phase;
  return state;
}

function giveCard(state: ConquestState, definitionId: string): string {
  const id = `fixture-card-${state.nextEntityId++}`;
  state.player.cardInstances[id] = { id, definitionId };
  state.player.zones.hand.push(id);
  return id;
}

describe('v0.4 executable rule coverage', () => {
  it('CT-410 resolves full crystal and ranged attack card effects', () => {
    let state = readyState('fire-bolt-basic');
    const cardId = giveCard(state, 'core.card.advanced.fire-bolt');
    state = run(state, { type: 'PLAY_CARD', cardId, mode: 'basic' });
    expect(state.player.crystals.red).toBe(1);

    state = readyState('fire-bolt-strong', 'combat-ranged');
    const strongId = giveCard(state, 'core.card.advanced.fire-bolt');
    state.source = [{ id: 'red-source', color: 'red', used: false }];
    state = run(state, { type: 'PLAY_CARD', cardId: strongId, mode: 'strong' });
    expect(state.player.resources).toEqual(expect.arrayContaining([expect.objectContaining({ resource: 'attack', amount: 3, attackKind: 'ranged', element: 'fire' })]));
    expect(state.source[0]?.used).toBe(true);
  });

  it('CT-411 expands choices and applies Blood Rage wound branch', () => {
    let state = readyState('blood-rage', 'combat-attack');
    const cardId = giveCard(state, 'core.card.advanced.blood-rage');
    const intents = getConquestLegalIntents(state, conquestContent).filter((intent) => intent.command.type === 'PLAY_CARD' && intent.command.cardId === cardId && intent.command.mode === 'basic');
    expect(intents.map((intent) => intent.label)).toEqual(expect.arrayContaining([expect.stringContaining('Attack 2'), expect.stringContaining('Take a Wound: Attack 5')]));
    state = run(state, { type: 'PLAY_CARD', cardId, mode: 'basic', choiceIndex: 1 });
    expect(state.player.resources.some((resource) => resource.resource === 'attack' && resource.amount === 5)).toBe(true);
    expect(Object.values(state.player.cardInstances).filter((card) => card.definitionId === 'core.card.wound')).toHaveLength(1);
  });

  it('CT-412 requires and validates targets before mutating state', () => {
    const state = readyState('regeneration');
    const cardId = giveCard(state, 'core.card.advanced.regeneration');
    state.player.units.push({ id: 'unit-1', definitionId: 'core.unit.regular.foresters', ready: false, wounds: 0, destroyed: false });
    const before = conquestStateHash(state);
    const invalid = executeConquestIntent(state, { type: 'PLAY_CARD', cardId, mode: 'basic' }, conquestContent);
    expect(invalid.ok).toBe(false);
    expect(conquestStateHash(state)).toBe(before);
    const resolved = run(state, { type: 'PLAY_CARD', cardId, mode: 'basic', targetId: 'unit-1' });
    expect(resolved.player.units[0]?.ready).toBe(true);
    expect(resolved.player.resources.some((resource) => resource.resource === 'heal' && resource.amount === 1)).toBe(true);
  });

  it('CT-413 applies modeled enemy armor modifiers during combat', () => {
    let state = readyState('ice-shield', 'combat-block');
    const cardId = giveCard(state, 'core.card.advanced.ice-shield');
    state.source = [{ id: 'blue-source', color: 'blue', used: false }];
    state.enemies['enemy-1'] = { id: 'enemy-1', definitionId: 'core.enemy.green.wolf-riders', position: { q: 0, r: 0 }, defeated: false, summoned: false };
    state.encounter = { enemyIds: ['enemy-1'], origin: { q: 0, r: 0 }, phase: 'block', incoming: [], defeatedThisCombat: [], heroWoundsGained: 0, fullyBlockedEnemyIds: [] };
    state = run(state, { type: 'PLAY_CARD', cardId, mode: 'strong', targetId: 'enemy-1' });
    expect(state.enemyModifiers['enemy-1']?.armor).toBe(-3);
    expect(state.player.resources.some((resource) => resource.resource === 'block' && resource.amount === 3 && resource.element === 'ice')).toBe(true);
  });

  it('CT-414 activates one of several unit abilities and modifies terrain cost', () => {
    let state = readyState('foresters');
    state.player.units.push({ id: 'unit-1', definitionId: 'core.unit.regular.foresters', ready: true, wounds: 0, destroyed: false });
    state = run(state, { type: 'ACTIVATE_UNIT', unitId: 'unit-1', abilityIndex: 0 });
    expect(state.player.resources.some((resource) => resource.resource === 'move' && resource.amount === 2)).toBe(true);
    expect(conquestTerrainCost(state, 'forest')).toBe(2);
    expect(state.player.units[0]?.ready).toBe(false);
  });

  it('CT-415 executes hero skill nodes and enforces once-per-round use', () => {
    let state = readyState('skill');
    state.player.skills.push({ definitionId: 'core.skill.tovak.motivation', used: false });
    const removed = state.player.zones.hand.pop();
    if (removed) state.player.zones.discard.push(removed);
    const before = state.player.zones.hand.length;
    state = run(state, { type: 'USE_SKILL', skillId: 'core.skill.tovak.motivation' });
    expect(state.player.zones.hand).toHaveLength(before + 1);
    expect(state.player.skills[0]?.used).toBe(true);
    expect(executeConquestIntent(state, { type: 'USE_SKILL', skillId: 'core.skill.tovak.motivation' }, conquestContent).ok).toBe(false);
  });

  it('CT-416 enforces full unit self-wound and night-only skill rules', () => {
    let state = readyState('swordsmen', 'combat-attack');
    state.player.units.push({ id: 'unit-1', definitionId: 'core.unit.regular.swordsmen', ready: true, wounds: 0, destroyed: false });
    state = run(state, { type: 'ACTIVATE_UNIT', unitId: 'unit-1', abilityIndex: 1, choiceIndex: 0 });
    expect(state.player.units[0]).toMatchObject({ ready: false, wounds: 1, destroyed: false });
    expect(state.player.resources.some((resource) => resource.resource === 'attack' && resource.amount === 6)).toBe(true);

    state = readyState('night-vision');
    state.player.skills.push({ definitionId: 'core.skill.tovak.night-vision', used: false });
    expect(executeConquestIntent(state, { type: 'USE_SKILL', skillId: 'core.skill.tovak.night-vision' }, conquestContent).ok).toBe(false);
    state.time = 'night';
    state = run(state, { type: 'USE_SKILL', skillId: 'core.skill.tovak.night-vision' });
    expect(state.player.resources.some((resource) => resource.resource === 'move' && resource.amount === 2)).toBe(true);
  });
});
