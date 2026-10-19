import { cardId, createTutorialFixture, mustExecute } from '@mageknight/test-kit';
import { assertInvariants, stateHash } from '../index';
import { describe, expect, it } from 'vitest';

function play(state: ReturnType<typeof createTutorialFixture>, definitionId: string, mode: 'basic' | 'sideways', sidewaysResource?: 'move' | 'influence' | 'attack') {
  return mustExecute(state, {
    type: 'PLAY_CARD',
    cardId: cardId(state, definitionId),
    mode,
    ...(sidewaysResource ? { sidewaysResource } : {}),
  });
}

export function runWinningTutorial(roundTripAfterRecruit = false) {
  let state = createTutorialFixture();

  state = play(state, 'core.card.march-1', 'basic');
  state = play(state, 'core.card.march-2', 'basic');
  state = mustExecute(state, { type: 'MOVE_HERO', to: { q: 1, r: 0 } });
  state = mustExecute(state, { type: 'EXPLORE_TILE' });
  state = mustExecute(state, { type: 'FINISH_MOVEMENT' });
  state = mustExecute(state, { type: 'START_INTERACTION' });
  state = play(state, 'core.card.promise', 'basic');
  state = play(state, 'core.card.rage-1', 'sideways', 'influence');
  state = mustExecute(state, { type: 'RECRUIT_UNIT', definitionId: 'core.unit.peasants' });
  if (roundTripAfterRecruit) state = JSON.parse(JSON.stringify(state)) as typeof state;
  state = mustExecute(state, { type: 'FINISH_INTERACTION' });
  state = mustExecute(state, { type: 'END_TURN' });

  state = play(state, 'core.card.stamina-1', 'basic');
  state = play(state, 'core.card.swiftness-1', 'sideways', 'move');
  state = mustExecute(state, { type: 'MOVE_HERO', to: { q: 1, r: -1 } });
  const orcId = state.encounter?.enemyIds[0];
  if (!orcId) throw new Error('Orc encounter did not start.');
  state = mustExecute(state, { type: 'ADVANCE_COMBAT_PHASE' });
  state = mustExecute(state, { type: 'ADVANCE_COMBAT_PHASE' });
  state = mustExecute(state, { type: 'ASSIGN_DAMAGE', enemyId: orcId, attackIndex: 0, target: 'hero' });
  state = mustExecute(state, { type: 'ADVANCE_COMBAT_PHASE' });
  state = play(state, 'core.card.rage-2', 'basic');
  state = play(state, 'core.card.threaten', 'sideways', 'attack');
  state = mustExecute(state, { type: 'DECLARE_ATTACK', enemyIds: [orcId], kind: 'normal' });
  state = mustExecute(state, { type: 'ADVANCE_COMBAT_PHASE' });
  state = mustExecute(state, { type: 'END_TURN' });
  state = mustExecute(state, { type: 'RESOLVE_DECISION', optionId: 'armor' });

  state = play(state, 'core.card.stamina-2', 'basic');
  state = play(state, 'core.card.determination-1', 'sideways', 'move');
  state = mustExecute(state, { type: 'MOVE_HERO', to: { q: 2, r: -1 } });
  const guardId = state.encounter?.enemyIds[0];
  if (!guardId) throw new Error('Keep guard encounter did not start.');
  state = mustExecute(state, { type: 'ADVANCE_COMBAT_PHASE' });
  state = mustExecute(state, { type: 'ADVANCE_COMBAT_PHASE' });
  state = mustExecute(state, { type: 'ASSIGN_DAMAGE', enemyId: guardId, attackIndex: 0, target: 'hero' });
  state = mustExecute(state, { type: 'ADVANCE_COMBAT_PHASE' });
  state = mustExecute(state, { type: 'ACTIVATE_UNIT' });
  state = play(state, 'core.card.determination-2', 'sideways', 'attack');
  state = play(state, 'core.card.swiftness-2', 'sideways', 'attack');
  state = mustExecute(state, { type: 'DECLARE_ATTACK', enemyIds: [guardId], kind: 'normal' });
  state = mustExecute(state, { type: 'ADVANCE_COMBAT_PHASE' });
  state = mustExecute(state, { type: 'END_TURN' });
  return state;
}

export function runRoundLimitLoss() {
  let state = createTutorialFixture();
  for (let index = 0; index < 4; index += 1) {
    state.player.deck = [];
    state = mustExecute(state, { type: 'DECLARE_END_ROUND' });
  }
  return state;
}

export function runCombatDamageRecovery() {
  let state = createTutorialFixture();
  state.player.resources.push({ id: 'move-replay', sourceId: 'replay', resource: 'move', amount: 3, attackKind: 'normal', element: 'physical' });
  state = mustExecute(state, { type: 'MOVE_HERO', to: { q: 1, r: -1 } });
  const enemyId = state.encounter?.enemyIds[0];
  if (!enemyId) throw new Error('Replay enemy missing.');
  state = mustExecute(state, { type: 'ADVANCE_COMBAT_PHASE' });
  state = mustExecute(state, { type: 'ADVANCE_COMBAT_PHASE' });
  state = mustExecute(state, { type: 'ASSIGN_DAMAGE', enemyId, attackIndex: 0, target: 'hero' });
  state = mustExecute(state, { type: 'ADVANCE_COMBAT_PHASE' });
  state = mustExecute(state, { type: 'ADVANCE_COMBAT_PHASE' });
  state = mustExecute(state, { type: 'END_TURN' });
  return state;
}

describe('tutorial golden replay', () => {
  it('GR-110 completes the fixed tutorial through public commands', () => {
    const state = runWinningTutorial();
    assertInvariants(state);
    expect(state.scenario.status).toBe('won');
    expect(state.scenario.enemiesDefeated).toBe(2);
    expect(state.player.level).toBe(2);
    expect(state.player.armor).toBe(3);
    expect(state.eventLog.at(-1)?.type).toBe('ScenarioWon');
    expect(stateHash(state)).toBe('0ee7463f');
  });

  it('GR-110 is deterministic across independent runs', () => {
    expect(stateHash(runWinningTutorial())).toBe(stateHash(runWinningTutorial()));
  });

  it('GR-150 reaches the same final hash after a mid-game save round-trip', () => {
    expect(stateHash(runWinningTutorial(true))).toBe(stateHash(runWinningTutorial()));
  });

  it('IT-111 loses when the round limit is exceeded', () => {
    const state = runRoundLimitLoss();
    expect(state.round).toBe(5);
    expect(state.scenario.status).toBe('lost');
    expect(state.eventLog.at(-1)?.type).toBe('ScenarioLost');
  });

  it('GR-160 freezes win, round-limit loss and combat recovery hashes', () => {
    expect({
      win: stateHash(runWinningTutorial()),
      loss: stateHash(runRoundLimitLoss()),
      recovery: stateHash(runCombatDamageRecovery()),
    }).toEqual({ win: '0ee7463f', loss: '8f373300', recovery: 'fc8e8863' });
  });

  it('ST-100 serializes and resumes a pending level-up decision', () => {
    let state = createTutorialFixture();
    state.phase = 'action';
    state.actionTaken = true;
    state.pendingRewards.fame = 3;
    state = mustExecute(state, { type: 'END_TURN' });
    expect(state.phase).toBe('decision');
    const restored = JSON.parse(JSON.stringify(state));
    state = mustExecute(restored, { type: 'RESOLVE_DECISION', optionId: 'training' });
    expect(state.player.level).toBe(2);
    expect(state.player.discard.some((card) => card.definitionId === 'core.card.training')).toBe(true);
  });
});
