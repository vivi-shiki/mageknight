import { createConquestContent } from '@mageknight/content';
import { describe, expect, it } from 'vitest';
import {
  chooseConquestSolverIntent,
  conquestStateHash,
  createConquestGame,
  executeConquestIntent,
  frontierCoords,
  getConquestLegalIntents,
  replayConquest,
  runConquestSolver,
  runConquestSolverBatch,
  runPassiveConquestBaseline,
} from '..';
import type { ConquestCommand, ConquestState } from '..';

const content = createConquestContent([]);
const config = {
  seed: 'solver-complete-game',
  difficulty: 'explorer' as const,
  scenarioId: 'core.scenario.single-city-development',
  heroId: 'core.hero.tovak',
};

function mustExecute(state: ConquestState, command: ConquestCommand): ConquestState {
  const result = executeConquestIntent(state, command, content);
  if (!result.ok) throw new Error(`${command.type}: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function addResource(state: ConquestState, resource: 'move' | 'influence' | 'attack', amount: number, attackKind: 'normal' | 'siege' = 'normal'): void {
  state.player.resources.push({ id: `solver-fixture-${resource}-${state.player.resources.length}`, sourceId: 'solver-fixture', resource, amount, attackKind, element: 'physical' });
}

function revealCity(state: ConquestState): ConquestState {
  state = mustExecute(state, { type: 'SELECT_TACTIC', tacticId: 'core.tactic.day.early-bird' });
  while (!Object.values(state.map).some((space) => space.siteId === 'core.site.city')) {
    state.player.position = frontierCoords(state)[0]!;
    state.player.resources = [];
    addResource(state, 'move', 2);
    state = mustExecute(state, { type: 'EXPLORE_TILE' });
  }
  return state;
}

describe('offline conquest solver', () => {
  it('SOL-001 selects and executes only public legal intents', () => {
    let state = createConquestGame(config, content);
    for (let step = 0; step < 120 && state.scenario.status === 'playing'; step += 1) {
      const legal = getConquestLegalIntents(state, content);
      const selected = chooseConquestSolverIntent(state, content);
      expect(selected).toBeDefined();
      expect(legal.some((intent) => intent.id === selected?.id)).toBe(true);
      state = mustExecute(state, selected!.command);
    }
  });

  it('SOL-002 completes and exactly replays a full game', () => {
    const run = runConquestSolver(content, config, { maxSteps: 400 });
    expect(run.terminal).toBe(true);
    expect(run.reachedStepLimit).toBe(false);
    expect(run.illegalCommands).toEqual([]);
    expect(run.coverage.tilesExplored).toBeGreaterThanOrEqual(3);
    expect(run.coverage.combatsStarted).toBeGreaterThan(0);
    expect(run.coverage.unitsRecruited).toBeGreaterThan(0);
    const replayed = replayConquest(run.replay, content);
    expect(conquestStateHash(replayed.state)).toBe(conquestStateHash(run.state));
  }, 60_000);

  it('SOL-003 survives repeated JSON save and restore boundaries', () => {
    const continuous = runConquestSolver(content, config, { maxSteps: 400 });
    const restored = runConquestSolver(content, config, { maxSteps: 400, checkpointEvery: 7 });
    expect(restored.coverage.saveRestores).toBeGreaterThan(0);
    expect(restored.replay.commandSequence).toEqual(continuous.replay.commandSequence);
    expect(conquestStateHash(restored.state)).toBe(conquestStateHash(continuous.state));
  }, 60_000);

  it('SOL-004 uses unit and card markets when location and influence permit it', () => {
    let state = createConquestGame(config, content);
    state = mustExecute(state, { type: 'SELECT_TACTIC', tacticId: 'core.tactic.day.early-bird' });
    state.phase = 'interaction';
    state.player.resources = [];
    addResource(state, 'influence', 100);
    let selected = chooseConquestSolverIntent(state, content);
    expect(selected?.command.type).toBe('BUY_MARKET');
    if (selected?.command.type !== 'BUY_MARKET') throw new Error('Solver did not recruit from the village.');
    expect(selected.command.market).toBe('unit');
    state = mustExecute(state, selected.command);
    expect(state.eventLog.some((event) => event.type === 'UnitRecruited')).toBe(true);

    delete state.pendingDecision;
    state.phase = 'interaction';
    state.map['0,0']!.siteId = 'core.site.mage-tower';
    state.map['0,0']!.conquered = true;
    state.player.resources = [];
    addResource(state, 'influence', 100);
    selected = chooseConquestSolverIntent(state, content);
    expect(selected?.command.type).toBe('BUY_MARKET');
    if (selected?.command.type !== 'BUY_MARKET') throw new Error('Solver did not buy from the mage tower.');
    expect(selected.command.market).toBe('spell');
    state = mustExecute(state, selected.command);
    expect(state.eventLog.some((event) => event.type === 'MarketCardBought')).toBe(true);
  });

  it('SOL-005 closes a prepared city battle and reaches a won terminal state', () => {
    let state = revealCity(createConquestGame({ ...config, seed: 'solver-city-victory' }, content));
    const city = Object.values(state.map).find((space) => space.siteId === 'core.site.city')!;
    state.player.position = { ...city.coord };
    state.phase = 'action';
    state.player.resources = [];
    addResource(state, 'attack', 100, 'siege');
    for (let step = 0; step < 30 && state.scenario.status === 'playing'; step += 1) {
      const selected = chooseConquestSolverIntent(state, content);
      expect(selected).toBeDefined();
      state = mustExecute(state, selected!.command);
    }
    expect(state.scenario.citiesConquered).toBe(1);
    expect(state.scenario.status).toBe('won');
    expect(state.phase).toBe('game-over');
  });

  it('SOL-006 beats the passive policy across fixed seeds and preserves a best replay', () => {
    const configs = Array.from({ length: 5 }, (_, index) => ({ ...config, seed: `solver-comparison-${index}` }));
    const batch = runConquestSolverBatch(content, configs, { maxSteps: 400 });
    const passiveAverage = configs.map((item) => runPassiveConquestBaseline(content, item, 400)).reduce((sum, run) => sum + run.score, 0) / configs.length;
    expect(batch.terminalRuns).toBe(configs.length);
    expect(batch.runs.every((run) => !run.reachedStepLimit && run.illegalCommands.length === 0)).toBe(true);
    expect(batch.averageScore).toBeGreaterThan(passiveAverage);
    const best = replayConquest(batch.bestReplay, content);
    expect(best.state.scenario.status).not.toBe('playing');
  }, 90_000);
});
