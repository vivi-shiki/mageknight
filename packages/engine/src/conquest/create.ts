import type { BasicManaColor, ConquestContent } from '@mageknight/content';
import { createRngState, shuffleWithState } from '../rng';
import { placeTile } from './map';
import { createMarket } from './market';
import { assertConquestInvariants, createRuleRuntime, randomBasicColor } from './state';
import type { ConquestCardInstance, ConquestConfig, ConquestState } from './types';
import { createEmptyZones } from './zones';

function shuffled<T>(state: ConquestState, values: readonly T[]): T[] {
  const result = shuffleWithState(values, state.rngState);
  state.rngState = result.state;
  return result.items;
}

export function createConquestGame(config: ConquestConfig, content: ConquestContent): ConquestState {
  const hero = content.heroes[config.heroId ?? content.defaultHeroId];
  if (!hero) throw new Error(`Unknown hero ${config.heroId ?? content.defaultHeroId}.`);
  const scenario = content.scenarios[config.scenarioId ?? content.defaultScenarioId];
  if (!scenario) throw new Error(`Unknown scenario ${config.scenarioId ?? content.defaultScenarioId}.`);
  const rngState = createRngState(config.seed);
  const zones = createEmptyZones();
  const cardInstances: Record<string, ConquestCardInstance> = {};
  const state: ConquestState = {
    schemaVersion: 8, appVersion: '0.8.0', contentVersion: '0.8.0', contentHash: content.contentHash,
    enabledModules: [...content.enabledModules], seed: config.seed, rngState, nextEntityId: 1,
    round: 1, turn: 1, time: 'day', phase: 'tactics', actionTaken: false, roundEndAnnounced: false, finalTurnsRemaining: 0,
    player: {
      id: 'player-1', heroId: hero.id, position: { q: 0, r: 0 }, armor: hero.armor, fame: 0, level: 1, reputation: 0,
      handLimit: hero.handLimit, commandSlots: hero.commandSlots, knockedOut: false, crystals: { red: 0, blue: 0, white: 0, green: 0 },
      manaTokens: { red: 0, blue: 0, white: 0, green: 0, gold: 0, black: 0 },
      cardInstances, zones, units: [], skills: [], resources: [],
    },
    source: [], map: {}, placedTiles: [], walls: [], adventureClaims: {}, countrysideTileDeck: [], coreTileDeck: [], enemies: {}, enemyModifiers: {},
    overlays: {}, factionLeaders: {}, factionTokens: {
      decks: { elementalist: [], 'dark-crusader': [] }, discards: { elementalist: [], 'dark-crusader': [] }, inventory: [], usedNamesThisTurn: [],
    },
    attachments: [], ruleRuntime: createRuleRuntime(), turnWoundIds: [], defeatedThisTurn: [],
    enemyPools: { green: [], gray: [], brown: [], violet: [], city: [], red: [], white: [] },
    market: createMarket([], [], [], [], []),
    dummy: { deck: [], discard: [], crystals: { red: 0, blue: 0, white: 0, green: 0 }, exhausted: false, lastCardsDrawn: 0 },
    scenario: {
      id: scenario.id, status: 'playing', objective: scenario.objective, roundLimit: scenario.roundLimit,
      difficulty: config.difficulty, cityLevels: [...scenario.cityLevelsByDifficulty[config.difficulty]], citiesRequired: scenario.citiesRequired,
      citiesConquered: 0, finalTurnAfterObjective: scenario.finalTurnAfterObjective, objectiveCompleted: false,
      objectiveKind: scenario.objectiveKind ?? 'cities', volkareArmySize: scenario.volkareArmyByDifficulty?.[config.difficulty] ?? 0,
      leadersRequired: scenario.factionLeaderIds?.length ?? 0, leadersDefeated: 0,
      graveyardsRequired: scenario.graveyardsRequired ?? 0, graveyardsSealed: 0,
      relicsRequired: scenario.relicsRequired ?? 0, relicsFound: 0,
    },
    pendingFame: 0, lastingEffects: [], eventLog: [], checkpoints: [{ eventIndex: 0, barrier: false, reason: '游戏开始' }],
  };
  const deck = shuffled(state, hero.basicDeck);
  deck.forEach((definitionId, index) => {
    const id = `card-${index + 1}`;
    cardInstances[id] = { id, definitionId };
    zones.deck.push(id);
  });
  state.nextEntityId = deck.length + 1;
  for (const color of hero.startingCrystals ?? []) state.player.crystals[color] = Math.min(3, state.player.crystals[color] + 1);
  if (hero.id === 'tezla.hero.braevalar') state.ruleRuntime.explorationDiscount = 1;
  for (let index = 0; index < 5; index += 1) {
    const id = zones.deck.shift();
    if (id) zones.hand.push(id);
  }
  const volkareScenario = scenario.objectiveKind === 'volkare';
  const lostLegionCountryside = content.countrysideTiles.filter((id) => id.startsWith('lost-legion.'));
  const ordinaryCountryside = content.countrysideTiles.filter((id) => !id.startsWith('lost-legion.'));
  state.countrysideTileDeck = volkareScenario
    ? shuffled(state, [...lostLegionCountryside, ...ordinaryCountryside]).slice(0, scenario.countrysideTileCount)
    : shuffled(state, content.countrysideTiles).slice(0, scenario.countrysideTileCount);
  const cityTiles = content.coreTiles.filter((id) => content.tiles[id]?.site && content.sites[content.tiles[id]!.site!.definitionId]?.kind === 'city');
  const nonCityTiles = content.coreTiles.filter((id) => !cityTiles.includes(id) && id !== 'lost-legion.tile.volkare-camp');
  const repeatTo = <T>(values: T[], amount: number): T[] => amount === 0 || values.length === 0 ? [] : Array.from({ length: amount }, (_, index) => values[index % values.length]!);
  state.coreTileDeck = volkareScenario
    ? [...shuffled(state, nonCityTiles).slice(0, scenario.coreNonCityTileCount), 'lost-legion.tile.volkare-camp']
    : shuffled(state, [
      ...repeatTo(shuffled(state, cityTiles), scenario.coreCityTileCount),
      ...repeatTo(shuffled(state, nonCityTiles), scenario.coreNonCityTileCount),
    ]);
  for (const pool of Object.keys(content.enemyPools) as Array<keyof typeof content.enemyPools>) state.enemyPools[pool] = shuffled(state, content.enemyPools[pool]);
  if (scenario.id === 'tezla.scenario.hidden-valley') for (const pool of ['green', 'brown', 'red'] as const) state.enemyPools[pool] = shuffled(state, content.factionEnemyPools.elementalist[pool] ?? []);
  if (scenario.id === 'tezla.scenario.realm-of-the-dead') for (const pool of ['green', 'brown', 'red'] as const) state.enemyPools[pool] = shuffled(state, content.factionEnemyPools['dark-crusader'][pool] ?? []);
  state.factionTokens.decks.elementalist = shuffled(state, content.factionTokenDecks.elementalist);
  state.factionTokens.decks['dark-crusader'] = shuffled(state, content.factionTokenDecks['dark-crusader']);
  for (const [index, leaderId] of (scenario.factionLeaderIds ?? []).entries()) {
    const initialLevel = scenario.cityLevelsByDifficulty[config.difficulty][index] ?? scenario.cityLevelsByDifficulty[config.difficulty][0] ?? 1;
    state.factionLeaders[leaderId] = { definitionId: leaderId, level: initialLevel, initialLevel, defeated: false, guardEnemyIds: [] };
  }
  if (scenario.objectiveKind === 'relics') {
    state.player.level = 3;
    state.player.fame = 9;
    state.player.commandSlots = 2;
  }
  const advanced = shuffled(state, content.advancedDeck);
  const spells = shuffled(state, content.spellDeck);
  const artifacts = shuffled(state, content.artifactDeck);
  const regular = shuffled(state, content.regularUnitDeck);
  const elite = shuffled(state, content.eliteUnitDeck);
  state.market = createMarket(advanced, spells, artifacts, regular, elite);
  const dummyColors = hero.basicDeck.map((id) => content.cards[id]?.color).filter((color): color is BasicManaColor => Boolean(color));
  state.dummy.deck = shuffled(state, dummyColors);
  if (volkareScenario) {
    const volkareDeck = [
      ...(['red', 'blue', 'white', 'green'] as const).flatMap((color) => [{ color, steps: 1 as const }, { color, steps: 1 as const }, { color, steps: 2 as const }]),
      { color: 'wound' as const, steps: 0 as const }, { color: 'wound' as const, steps: 0 as const },
    ];
    state.volkare = { position: { q: 999, r: 999 }, armyEnemyIds: [], deck: shuffled(state, volkareDeck), discard: [], revealed: false, defeated: false, reachedPortal: false };
    state.dummy.deck = [];
  }
  state.source = Array.from({ length: 3 }, (_, index) => ({ id: `source-${index + 1}`, color: randomBasicColor(state), used: false }));
  placeTile(state, content, 'core.tile.conquest.start', { q: 0, r: 0 });
  assertConquestInvariants(state);
  return state;
}
