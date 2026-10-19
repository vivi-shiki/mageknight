import { tutorialContent } from '@mageknight/content';
import { addResource, createTutorialFixture, mustExecute } from '@mageknight/test-kit';
import { executeIntent, stateHash } from '../index';
import { describe, expect, it } from 'vitest';

function startOrcCombat() {
  let state = createTutorialFixture();
  state = mustExecute(state, { type: 'FINISH_MOVEMENT' });
  const enemyId = state.map['1,-1']?.enemyIds[0];
  if (!enemyId) throw new Error('Orc enemy fixture missing.');
  state = mustExecute(state, { type: 'START_COMBAT', enemyIds: [enemyId] });
  return { state, enemyId };
}

describe('combat state machine', () => {
  it('CT-080 rejects ranged attacks against fortified enemies unless attack is siege', () => {
    let state = createTutorialFixture();
    state.explored = true;
    const template = tutorialContent.explorationMap.find((space) => space.enemyId);
    if (!template?.enemyId) throw new Error('Keep guard fixture missing.');
    const enemyId = 'fixture-keep';
    state.enemies[enemyId] = { id: enemyId, definitionId: template.enemyId, position: { q: 1, r: -1 }, defeated: false };
    state.map['1,-1']!.enemyIds = [enemyId];
    state = mustExecute(state, { type: 'FINISH_MOVEMENT' });
    state = mustExecute(state, { type: 'START_COMBAT', enemyIds: [enemyId] });
    addResource(state, { resource: 'attack', amount: 8, attackKind: 'ranged', element: 'physical' });
    const before = stateHash(state);
    const result = executeIntent(state, { type: 'DECLARE_ATTACK', enemyIds: [enemyId], kind: 'ranged' }, tutorialContent);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ATTACK_NOT_EFFECTIVE');
    expect(stateHash(result.state)).toBe(before);
  });

  it('CT-081 halves a resisted elemental attack before armor comparison', () => {
    let state = createTutorialFixture();
    const enemyId = 'fixture-resistant-guard';
    state.enemies[enemyId] = { id: enemyId, definitionId: 'core.enemy.keep-guards', position: { q: 1, r: -1 }, defeated: false };
    state.map['1,-1']!.enemyIds = [enemyId];
    state = mustExecute(state, { type: 'FINISH_MOVEMENT' });
    state = mustExecute(state, { type: 'START_COMBAT', enemyIds: [enemyId] });
    addResource(state, { resource: 'attack', amount: 7, attackKind: 'siege', element: 'fire' });
    const failed = executeIntent(state, { type: 'DECLARE_ATTACK', enemyIds: [enemyId], kind: 'siege' }, tutorialContent);
    expect(failed.ok).toBe(false);
    addResource(state, { resource: 'attack', amount: 1, attackKind: 'siege', element: 'fire' });
    state = mustExecute(state, { type: 'DECLARE_ATTACK', enemyIds: [enemyId], kind: 'siege' });
    expect(state.enemies[enemyId]?.defeated).toBe(true);
  });

  it('CT-082 doubles the block requirement for Swift', () => {
    const started = startOrcCombat();
    let state = mustExecute(started.state, { type: 'ADVANCE_COMBAT_PHASE' });
    addResource(state, { resource: 'block', amount: 3, attackKind: 'normal', element: 'physical' });
    const failed = executeIntent(state, { type: 'DECLARE_BLOCK', enemyId: started.enemyId, attackIndex: 0 }, tutorialContent);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.code).toBe('INSUFFICIENT_RESOURCE');
    addResource(state, { resource: 'block', amount: 1, attackKind: 'normal', element: 'physical' });
    state = mustExecute(state, { type: 'DECLARE_BLOCK', enemyId: started.enemyId, attackIndex: 0 });
    expect(state.encounter?.incoming[0]).toMatchObject({ blocked: true, resolved: true });
  });

  it('CT-083 creates one independent block target per attack segment', () => {
    let state = createTutorialFixture();
    const enemyId = 'fixture-multi-attacker';
    state.enemies[enemyId] = { id: enemyId, definitionId: 'core.enemy.ice-mages', position: { q: 1, r: -1 }, defeated: false };
    state.map['1,-1']!.enemyIds = [enemyId];
    state = mustExecute(state, { type: 'FINISH_MOVEMENT' });
    state = mustExecute(state, { type: 'START_COMBAT', enemyIds: [enemyId] });
    state = mustExecute(state, { type: 'ADVANCE_COMBAT_PHASE' });
    expect(state.encounter?.incoming).toEqual([
      { enemyId, attackIndex: 0, blocked: false, resolved: false },
      { enemyId, attackIndex: 1, blocked: false, resolved: false },
    ]);
  });

  it('IT-080 resolves damage and a normal attack in phase order', () => {
    const started = startOrcCombat();
    let state = mustExecute(started.state, { type: 'ADVANCE_COMBAT_PHASE' });
    state = mustExecute(state, { type: 'ADVANCE_COMBAT_PHASE' });
    state = mustExecute(state, { type: 'ASSIGN_DAMAGE', enemyId: started.enemyId, attackIndex: 0, target: 'hero' });
    expect(state.player.hand.filter((card) => card.definitionId === 'core.card.wound')).toHaveLength(1);
    state = mustExecute(state, { type: 'ADVANCE_COMBAT_PHASE' });
    addResource(state, { resource: 'attack', amount: 3, attackKind: 'normal', element: 'physical' });
    state = mustExecute(state, { type: 'DECLARE_ATTACK', enemyIds: [started.enemyId], kind: 'normal' });
    state = mustExecute(state, { type: 'ADVANCE_COMBAT_PHASE' });
    expect(state.enemies[started.enemyId]?.defeated).toBe(true);
    expect(state.pendingRewards.fame).toBe(3);
    expect(state.phase).toBe('action');
  });

  it('IT-090 enters knockout when combat wounds reach the hand limit', () => {
    const started = startOrcCombat();
    let state = started.state;
    state.player.handLimit = 1;
    state = mustExecute(state, { type: 'ADVANCE_COMBAT_PHASE' });
    state = mustExecute(state, { type: 'ADVANCE_COMBAT_PHASE' });
    state = mustExecute(state, { type: 'ASSIGN_DAMAGE', enemyId: started.enemyId, attackIndex: 0, target: 'hero' });
    expect(state.player.knockedOut).toBe(true);
    expect(state.eventLog.some((event) => event.type === 'HeroKnockedOut')).toBe(true);
  });

  it('IT-112 retreats and gains a wound after failing to defeat the enemy', () => {
    let state = createTutorialFixture();
    addResource(state, { resource: 'move', amount: 3, attackKind: 'normal', element: 'physical' });
    state = mustExecute(state, { type: 'MOVE_HERO', to: { q: 1, r: -1 } });
    const enemyId = state.encounter?.enemyIds[0];
    if (!enemyId) throw new Error('Encounter fixture missing.');
    state = mustExecute(state, { type: 'ADVANCE_COMBAT_PHASE' });
    state = mustExecute(state, { type: 'ADVANCE_COMBAT_PHASE' });
    state = mustExecute(state, { type: 'ASSIGN_DAMAGE', enemyId, attackIndex: 0, target: 'hero' });
    state = mustExecute(state, { type: 'ADVANCE_COMBAT_PHASE' });
    state = mustExecute(state, { type: 'ADVANCE_COMBAT_PHASE' });
    expect(state.player.position).toEqual({ q: 0, r: 0 });
    expect(state.eventLog.at(-1)?.type).toBe('CombatLost');
    expect(state.player.hand.filter((card) => card.definitionId === 'core.card.wound')).toHaveLength(2);
  });

  it('CT-093 heals a hero wound outside combat', () => {
    let state = createTutorialFixture();
    state.player.hand.push({ id: 'heal-wound', definitionId: 'core.card.wound' });
    addResource(state, { resource: 'heal', amount: 1, attackKind: 'normal', element: 'physical' });
    state = mustExecute(state, { type: 'HEAL_WOUND', cardId: 'heal-wound' });
    expect(state.player.hand.some((card) => card.id === 'heal-wound')).toBe(false);
    expect(state.player.removed.some((card) => card.id === 'heal-wound')).toBe(true);
  });
});
