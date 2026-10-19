import type { ConquestContent } from '@mageknight/content';
import { coordKey, hexDistance } from '../hex';
import { calculateConquestScore } from './scenario';
import { createConquestGame } from './create';
import { conquestStateHash, executeConquestIntent, getConquestLegalIntents } from './engine';
import { explorationDistance } from './map';
import { allowedMarkets } from './market';
import { resourceTotals } from './state';
import type { ConquestCommand, ConquestConfig, ConquestIntent, ConquestState } from './types';
import type { ConquestReplayInput } from './replay';

export type ConquestSolverOptions = {
  maxSteps?: number;
  checkpointEvery?: number;
};

export type ConquestSolverCoverage = {
  tilesExplored: number;
  combatsStarted: number;
  combatsWon: number;
  marketCardsBought: number;
  unitsRecruited: number;
  skillsUsed: number;
  citiesConquered: number;
  decisionsResolved: number;
  saveRestores: number;
};

export type ConquestSolverStep = {
  index: number;
  round: number;
  turn: number;
  phase: ConquestState['phase'];
  intentId: string;
  command: ConquestCommand;
  stateHash: string;
};

export type ConquestSolverRun = {
  config: ConquestConfig;
  state: ConquestState;
  replay: ConquestReplayInput;
  trace: ConquestSolverStep[];
  coverage: ConquestSolverCoverage;
  score: number;
  terminal: boolean;
  reachedStepLimit: boolean;
  illegalCommands: string[];
};

export type ConquestSolverBatch = {
  runs: ConquestSolverRun[];
  terminalRuns: number;
  winningRuns: number;
  averageScore: number;
  bestReplay: ConquestReplayInput;
  winningReplay?: ConquestReplayInput;
};

type Candidate = { intent: ConquestIntent; state: ConquestState; score: number };

const TERMINAL_INTENTS = new Set(['END_TURN', 'DECLARE_END_ROUND', 'FINISH_MOVEMENT', 'FINISH_INTERACTION', 'ADVANCE_COMBAT_PHASE']);

function remainingTiles(state: ConquestState): number {
  return state.countrysideTileDeck.length + state.coreTileDeck.length;
}

function activeEnemiesAt(state: ConquestState, position = state.player.position): number {
  return state.map[coordKey(position)]?.enemyIds.filter((id) => !state.enemies[id]?.defeated).length ?? 0;
}

function failedEnemyIds(state: ConquestState): Set<string> {
  return new Set(state.eventLog.flatMap((event) => event.type === 'CombatLost' && Array.isArray(event.data.remaining)
    ? event.data.remaining.filter((id): id is string => typeof id === 'string')
    : []));
}

function viableNearbyEnemies(state: ConquestState): number {
  const failed = failedEnemyIds(state);
  return Object.values(state.enemies).filter((enemy) => !enemy.defeated && !failed.has(enemy.id) && hexDistance(state.player.position, enemy.position) <= 1).length;
}

function usableHandSize(state: ConquestState): number {
  return state.player.zones.hand.filter((id) => state.player.cardInstances[id]?.definitionId !== 'core.card.wound').length;
}

function combatReadiness(state: ConquestState): number {
  const readyUnits = state.player.units.filter((unit) => unit.ready && !unit.destroyed && unit.wounds === 0).length;
  return usableHandSize(state) * 2 + readyUnits * 3 + resourceTotals(state).attack;
}

function objectiveDistance(state: ConquestState, content: ConquestContent): number {
  if (remainingTiles(state) > 0) return explorationDistance(state, state.player.position);
  const needsCard = !state.eventLog.some((event) => event.type === 'MarketCardBought');
  const needsUnit = !state.eventLog.some((event) => event.type === 'UnitRecruited');
  const marketTargets = Object.values(state.map).filter((space) => {
    const site = space.siteId ? content.sites[space.siteId] : undefined;
    if (!site || (site.fortified && !space.conquered)) return false;
    const markets = allowedMarkets(site.kind, true);
    return (needsUnit && markets.includes('unit')) || (needsCard && markets.some((kind) => kind !== 'unit'));
  });
  if (marketTargets.length > 0) return Math.min(...marketTargets.map((space) => hexDistance(state.player.position, space.coord)));
  const failed = failedEnemyIds(state);
  const targets = Object.values(state.map).filter((space) => {
    const site = space.siteId ? content.sites[space.siteId] : undefined;
    if (space.enemyIds.some((id) => !state.enemies[id]?.defeated && !failed.has(id))) return true;
    if (site?.kind === 'city' && !space.conquered) return true;
    return Object.values(state.factionLeaders).some((leader) => !leader.defeated && leader.position && coordKey(leader.position) === coordKey(space.coord));
  });
  return targets.length === 0 ? 0 : Math.min(...targets.map((space) => hexDistance(state.player.position, space.coord)));
}

function isPendingMarketSite(state: ConquestState, content: ConquestContent): boolean {
  const space = state.map[coordKey(state.player.position)];
  const site = space?.siteId ? content.sites[space.siteId] : undefined;
  if (!space || !site || (site.fortified && !space.conquered)) return false;
  const markets = allowedMarkets(site.kind, true);
  const needsCard = !state.eventLog.some((event) => event.type === 'MarketCardBought');
  const needsUnit = !state.eventLog.some((event) => event.type === 'UnitRecruited');
  return (needsUnit && markets.includes('unit')) || (needsCard && markets.some((kind) => kind !== 'unit'));
}

function objectiveProgress(state: ConquestState): number {
  return state.scenario.citiesConquered * 300
    + state.scenario.leadersDefeated * 300
    + state.scenario.graveyardsSealed * 120
    + state.scenario.relicsFound * 180;
}

function stateValue(state: ConquestState, content: ConquestContent): number {
  const score = calculateConquestScore(state, content).total;
  const defeated = Object.values(state.enemies).filter((enemy) => enemy.defeated).length;
  const wounds = state.player.zones.hand.concat(state.player.zones.discard).filter((id) => state.player.cardInstances[id]?.definitionId === 'core.card.wound').length;
  const terminal = state.scenario.status === 'won' ? 1_000_000 : state.scenario.status === 'lost' ? -10_000 : 0;
  const distance = objectiveDistance(state, content);
  return terminal + objectiveProgress(state) + score * 10 + defeated * 50 + state.placedTiles.length * 35
    + state.player.units.filter((unit) => !unit.destroyed).length * 25 + state.player.skills.length * 20
    - wounds * 30 - (Number.isFinite(distance) ? distance * 12 : 500);
}

function commandResourceGain(before: ConquestState, after: ConquestState, resource: keyof ReturnType<typeof resourceTotals>): number {
  return resourceTotals(after)[resource] - resourceTotals(before)[resource];
}

function movementScore(before: ConquestState, after: ConquestState, intent: ConquestIntent, content: ConquestContent): number {
  if (intent.command.type === 'EXPLORE_TILE') return 20_000;
  if (intent.command.type === 'DECLARE_END_ROUND') return 5_000;
  if (intent.command.type === 'MOVE_HERO') {
    const beforeDistance = objectiveDistance(before, content);
    const afterDistance = objectiveDistance(after, content);
    const destination = after.map[coordKey(after.player.position)];
    const site = destination?.siteId ? content.sites[destination.siteId] : undefined;
    const distanceGain = Number.isFinite(beforeDistance) && Number.isFinite(afterDistance) ? beforeDistance - afterDistance : 0;
    if (destination?.enemyIds.some((id) => !after.enemies[id]?.defeated && failedEnemyIds(before).has(id))) return -20_000;
    const destinationDifficulty = destination?.enemyIds.filter((id) => !after.enemies[id]?.defeated).reduce((sum, id) => sum + (content.enemies[after.enemies[id]?.definitionId ?? '']?.armor ?? 0), 0) ?? 0;
    if (destinationDifficulty > combatReadiness(before)) return -12_000;
    if (distanceGain <= 0 && activeEnemiesAt(after) === 0) return -5_000 + distanceGain * 700;
    return 3_000 + distanceGain * 1_500 + activeEnemiesAt(after) * 300 + (site ? 80 : 0);
  }
  if (intent.command.type === 'PLAY_CARD' || intent.command.type === 'USE_SKILL' || intent.command.type === 'ACTIVATE_UNIT') {
    const gain = commandResourceGain(before, after, 'move');
    if (isPendingMarketSite(before, content)) return -6_000;
    const preservationPenalty = usableHandSize(after) <= 2 && viableNearbyEnemies(after) > 0 ? 5_000 : 0;
    return gain > 0 ? 2_000 + gain * 250 - preservationPenalty : -1_000;
  }
  if (intent.command.type === 'FINISH_MOVEMENT') {
    if (isPendingMarketSite(before, content)) return 12_000;
    return viableNearbyEnemies(before) > 0 && combatReadiness(before) >= 5 ? 9_000 : 100;
  }
  if (intent.command.type === 'REST') return before.player.zones.hand.filter((id) => before.player.cardInstances[id]?.definitionId === 'core.card.wound').length * 200;
  return -500;
}

function actionScore(before: ConquestState, after: ConquestState, intent: ConquestIntent, content: ConquestContent): number {
  if (intent.command.type === 'START_COMBAT' || intent.command.type === 'START_LEADER_COMBAT' || intent.command.type === 'ENTER_ADVENTURE_SITE') {
    if (intent.command.type === 'START_COMBAT' && intent.command.enemyIds.some((id) => failedEnemyIds(before).has(id))) return -20_000;
    return combatReadiness(before) >= 5 ? 8_000 : -4_000;
  }
  if (intent.command.type === 'START_INTERACTION') return 9_000;
  if (intent.command.type === 'CLAIM_DEEP_MINE' || intent.command.type === 'SEAL_GRAVEYARD') return 7_000;
  if (intent.command.type === 'USE_SKILL') return 1_200 + stateValue(after, content) - stateValue(before, content);
  if (intent.command.type === 'PLAY_CARD' || intent.command.type === 'ACTIVATE_UNIT') {
    const attack = commandResourceGain(before, after, 'attack');
    const influence = commandResourceGain(before, after, 'influence');
    return Math.max(attack, influence) > 0 ? 400 + Math.max(attack, influence) * 100 : -500;
  }
  if (intent.command.type === 'END_TURN') return 100;
  return stateValue(after, content) - stateValue(before, content);
}

function interactionScore(before: ConquestState, after: ConquestState, intent: ConquestIntent, content: ConquestContent): number {
  const needsUnit = !before.eventLog.some((event) => event.type === 'UnitRecruited');
  const needsCard = !before.eventLog.some((event) => event.type === 'MarketCardBought');
  if (intent.command.type === 'RECRUIT_UNIT' || (intent.command.type === 'BUY_MARKET' && intent.command.market === 'unit')) {
    const definitionId = intent.command.definitionId;
    return needsUnit ? 12_000 + (content.units[definitionId]?.level ?? 0) * 300 : -10_000;
  }
  if (intent.command.type === 'BUY_MARKET') return needsCard ? 10_000 : -10_000;
  if (intent.command.type === 'HEAL') return 8_000;
  if (intent.command.type === 'BURN_MONASTERY') return 5_000;
  const influence = commandResourceGain(before, after, 'influence');
  if (influence > 0) return isPendingMarketSite(before, content) ? 2_000 + influence * 300 : -8_000;
  if (intent.command.type === 'FINISH_INTERACTION') return isPendingMarketSite(before, content) ? 100 : 15_000;
  return stateValue(after, content) - stateValue(before, content);
}

function combatScore(before: ConquestState, after: ConquestState, intent: ConquestIntent, content: ConquestContent): number {
  const command = intent.command;
  if (command.type === 'DECLARE_ATTACK' || command.type === 'DECLARE_LEADER_ATTACK') return 20_000 + objectiveProgress(after) - objectiveProgress(before);
  if (command.type === 'DECLARE_BLOCK') return 15_000;
  if (command.type === 'ASSIGN_DAMAGE') {
    const target = command.target === 'hero' ? 0 : 500;
    const destroyed = after.player.units.filter((unit) => unit.destroyed).length - before.player.units.filter((unit) => unit.destroyed).length;
    return 7_000 + target - destroyed * 1_000;
  }
  if (command.type === 'PLAY_CARD' || command.type === 'USE_SKILL' || command.type === 'ACTIVATE_UNIT' || command.type === 'USE_ATTACHMENT' || command.type === 'USE_FACTION_TOKEN') {
    const resource = before.phase === 'combat-block' ? 'block' : 'attack';
    const gain = commandResourceGain(before, after, resource);
    const unresolved = before.encounter?.incoming.some((attack) => !attack.resolved && !attack.blocked) ?? false;
    if (before.phase === 'combat-block' && !unresolved) return -5_000;
    if (gain <= 0) return -1_000;
    return 3_000 + gain * 300;
  }
  if (command.type === 'ADVANCE_COMBAT_PHASE') {
    const blockComplete = before.phase === 'combat-block' && (before.encounter?.incoming.every((attack) => attack.blocked || attack.resolved) ?? true);
    return blockComplete ? 12_000 : 100;
  }
  return stateValue(after, content) - stateValue(before, content);
}

function policyScore(before: ConquestState, after: ConquestState, intent: ConquestIntent, content: ConquestContent): number {
  let score = stateValue(after, content) - stateValue(before, content);
  if (before.phase === 'movement') score += movementScore(before, after, intent, content);
  else if (before.phase === 'action') score += actionScore(before, after, intent, content);
  else if (before.phase === 'interaction') score += interactionScore(before, after, intent, content);
  else if (before.phase.startsWith('combat-')) score += combatScore(before, after, intent, content);
  else if (before.phase === 'tactics') score += intent.id.includes('planning') ? 200 : 0;
  else if (before.phase === 'decision') {
    score += stateValue(after, content) - stateValue(before, content);
    if (intent.command.type === 'RESOLVE_DECISION' && intent.command.optionId === 'cancel') score -= 20_000;
  }
  if (TERMINAL_INTENTS.has(intent.command.type)) score -= 1;
  return score;
}

export function chooseConquestSolverIntent(state: ConquestState, content: ConquestContent): ConquestIntent | undefined {
  const candidates: Candidate[] = [];
  for (const intent of getConquestLegalIntents(state, content)) {
    const result = executeConquestIntent(state, intent.command, content);
    if (!result.ok) continue;
    candidates.push({ intent, state: result.state, score: policyScore(state, result.state, intent, content) });
  }
  candidates.sort((left, right) => right.score - left.score || left.intent.id.localeCompare(right.intent.id));
  return candidates[0]?.intent;
}

function coverageFromState(state: ConquestState, saveRestores: number): ConquestSolverCoverage {
  const count = (type: string) => state.eventLog.filter((event) => event.type === type).length;
  return {
    tilesExplored: count('TileRevealed'),
    combatsStarted: count('CombatStarted') + count('FactionLeaderCombatStarted'),
    combatsWon: count('CombatWon'),
    marketCardsBought: count('MarketCardBought'),
    unitsRecruited: count('UnitRecruited'),
    skillsUsed: count('SkillUsed'),
    citiesConquered: state.scenario.citiesConquered,
    decisionsResolved: count('DecisionResolved'),
    saveRestores,
  };
}

function replayFor(config: ConquestConfig, state: ConquestState, commandSequence: ConquestCommand[]): ConquestReplayInput {
  return {
    seed: config.seed,
    scenarioId: state.scenario.id,
    heroId: state.player.heroId,
    difficulty: config.difficulty,
    enabledModules: [...state.enabledModules],
    contentHash: state.contentHash,
    commandSequence,
  };
}

export function runConquestSolver(content: ConquestContent, config: ConquestConfig, options: ConquestSolverOptions = {}): ConquestSolverRun {
  const maxSteps = options.maxSteps ?? 1_500;
  const checkpointEvery = options.checkpointEvery ?? 0;
  let state = createConquestGame(config, content);
  const trace: ConquestSolverStep[] = [];
  const commandSequence: ConquestCommand[] = [];
  const illegalCommands: string[] = [];
  let saveRestores = 0;

  for (let index = 0; index < maxSteps && state.scenario.status === 'playing'; index += 1) {
    const intent = chooseConquestSolverIntent(state, content);
    if (!intent) {
      illegalCommands.push(`No legal intent at step ${index + 1} (${state.phase}).`);
      break;
    }
    const phase = state.phase;
    const round = state.round;
    const turn = state.turn;
    const result = executeConquestIntent(state, intent.command, content);
    if (!result.ok) {
      illegalCommands.push(`Step ${index + 1} ${intent.id}: ${result.error.code} ${result.error.message}`);
      break;
    }
    state = result.state;
    commandSequence.push(intent.command);
    trace.push({ index: index + 1, round, turn, phase, intentId: intent.id, command: intent.command, stateHash: conquestStateHash(state) });
    if (checkpointEvery > 0 && (index + 1) % checkpointEvery === 0 && state.scenario.status === 'playing') {
      state = JSON.parse(JSON.stringify(state)) as ConquestState;
      saveRestores += 1;
    }
  }

  const terminal = state.scenario.status !== 'playing';
  const replay = replayFor(config, state, commandSequence);
  return {
    config,
    state,
    replay,
    trace,
    coverage: coverageFromState(state, saveRestores),
    score: state.scenario.score?.total ?? calculateConquestScore(state, content).total,
    terminal,
    reachedStepLimit: !terminal && trace.length >= maxSteps,
    illegalCommands,
  };
}

export function runPassiveConquestBaseline(content: ConquestContent, config: ConquestConfig, maxSteps = 1_500): ConquestSolverRun {
  let state = createConquestGame(config, content);
  const trace: ConquestSolverStep[] = [];
  const commandSequence: ConquestCommand[] = [];
  const illegalCommands: string[] = [];
  for (let index = 0; index < maxSteps && state.scenario.status === 'playing'; index += 1) {
    const intents = getConquestLegalIntents(state, content);
    const intent = intents.find((item) => item.command.type === 'SELECT_TACTIC')
      ?? intents.find((item) => item.command.type === 'RESOLVE_DECISION')
      ?? intents.find((item) => item.command.type === 'DECLARE_END_ROUND')
      ?? intents.find((item) => item.command.type === 'REST')
      ?? intents.find((item) => item.command.type === 'FINISH_MOVEMENT')
      ?? intents.find((item) => item.command.type === 'FINISH_INTERACTION')
      ?? intents.find((item) => item.command.type === 'ADVANCE_COMBAT_PHASE')
      ?? intents.find((item) => item.command.type === 'ASSIGN_DAMAGE')
      ?? intents.find((item) => item.command.type === 'END_TURN')
      ?? intents[0];
    if (!intent) { illegalCommands.push(`No legal intent at step ${index + 1}.`); break; }
    const phase = state.phase;
    const round = state.round;
    const turn = state.turn;
    const result = executeConquestIntent(state, intent.command, content);
    if (!result.ok) { illegalCommands.push(`Step ${index + 1}: ${result.error.code}.`); break; }
    state = result.state;
    commandSequence.push(intent.command);
    trace.push({ index: index + 1, round, turn, phase, intentId: intent.id, command: intent.command, stateHash: conquestStateHash(state) });
  }
  const terminal = state.scenario.status !== 'playing';
  return {
    config,
    state,
    replay: replayFor(config, state, commandSequence),
    trace,
    coverage: coverageFromState(state, 0),
    score: state.scenario.score?.total ?? calculateConquestScore(state, content).total,
    terminal,
    reachedStepLimit: !terminal && trace.length >= maxSteps,
    illegalCommands,
  };
}

export function runConquestSolverBatch(content: ConquestContent, configs: ConquestConfig[], options: ConquestSolverOptions = {}): ConquestSolverBatch {
  if (configs.length === 0) throw new Error('Solver batch requires at least one configuration.');
  const runs = configs.map((config) => runConquestSolver(content, config, options));
  const ranked = [...runs].sort((left, right) => Number(right.state.scenario.status === 'won') - Number(left.state.scenario.status === 'won') || right.score - left.score);
  const winning = ranked.find((run) => run.state.scenario.status === 'won');
  return {
    runs,
    terminalRuns: runs.filter((run) => run.terminal).length,
    winningRuns: runs.filter((run) => run.state.scenario.status === 'won').length,
    averageScore: runs.reduce((sum, run) => sum + run.score, 0) / runs.length,
    bestReplay: ranked[0]!.replay,
    ...(winning ? { winningReplay: winning.replay } : {}),
  };
}
