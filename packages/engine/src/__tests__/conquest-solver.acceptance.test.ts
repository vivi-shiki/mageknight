import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createConquestContent } from '@mageknight/content';
import { expect, it } from 'vitest';
import { replayConquest, runConquestSolverBatch, runPassiveConquestBaseline } from '..';

it('SOL-100 completes 100 fixed seeds without illegal commands or dead loops', async () => {
  const content = createConquestContent([]);
  const configs = Array.from({ length: 100 }, (_, index) => ({
    seed: `solver-acceptance-${index.toString().padStart(3, '0')}`,
    difficulty: 'explorer' as const,
    scenarioId: 'core.scenario.single-city-development',
    heroId: 'core.hero.tovak',
  }));
  const batch = runConquestSolverBatch(content, configs, { maxSteps: 400 });
  const baselines = configs.map((config) => runPassiveConquestBaseline(content, config, 400));
  const passiveAverageScore = baselines.reduce((sum, run) => sum + run.score, 0) / baselines.length;
  const combatRuns = batch.runs.filter((run) => run.coverage.combatsStarted > 0).length;
  const skillRuns = batch.runs.filter((run) => run.coverage.skillsUsed > 0).length;
  const aggregate = batch.runs.reduce((totals, run) => ({
    tilesExplored: totals.tilesExplored + run.coverage.tilesExplored,
    combatsStarted: totals.combatsStarted + run.coverage.combatsStarted,
    combatsWon: totals.combatsWon + run.coverage.combatsWon,
    marketCardsBought: totals.marketCardsBought + run.coverage.marketCardsBought,
    unitsRecruited: totals.unitsRecruited + run.coverage.unitsRecruited,
    skillsUsed: totals.skillsUsed + run.coverage.skillsUsed,
    citiesConquered: totals.citiesConquered + run.coverage.citiesConquered,
  }), { tilesExplored: 0, combatsStarted: 0, combatsWon: 0, marketCardsBought: 0, unitsRecruited: 0, skillsUsed: 0, citiesConquered: 0 });

  const outputDirectory = path.resolve('artifacts/solver');
  await mkdir(outputDirectory, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    seeds: configs.length,
    terminalRuns: batch.terminalRuns,
    winningRuns: batch.winningRuns,
    averageScore: batch.averageScore,
    passiveAverageScore,
    combatRuns,
    skillRuns,
    aggregate,
    runs: batch.runs.map((run) => ({ seed: run.config.seed, status: run.state.scenario.status, steps: run.trace.length, score: run.score, coverage: run.coverage, reachedStepLimit: run.reachedStepLimit, illegalCommands: run.illegalCommands })),
  };
  await writeFile(path.join(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(path.join(outputDirectory, 'best-replay.json'), `${JSON.stringify(batch.bestReplay, null, 2)}\n`, 'utf8');
  if (batch.winningReplay) await writeFile(path.join(outputDirectory, 'winning-replay.json'), `${JSON.stringify(batch.winningReplay, null, 2)}\n`, 'utf8');

  expect(batch.terminalRuns).toBe(configs.length);
  expect(batch.runs.every((run) => !run.reachedStepLimit)).toBe(true);
  expect(batch.runs.every((run) => run.illegalCommands.length === 0)).toBe(true);
  expect(aggregate.tilesExplored).toBeGreaterThanOrEqual(configs.length * 2);
  expect(combatRuns).toBeGreaterThanOrEqual(Math.ceil(configs.length / 2));
  expect(aggregate.combatsWon).toBeGreaterThan(0);
  expect(aggregate.unitsRecruited).toBeGreaterThan(0);
  expect(skillRuns).toBeGreaterThan(0);
  expect(batch.averageScore).toBeGreaterThan(passiveAverageScore);
  expect(replayConquest(batch.bestReplay, content).state.scenario.status).not.toBe('playing');
  if (batch.winningReplay) expect(replayConquest(batch.winningReplay, content).state.scenario.status).toBe('won');
}, 600_000);
