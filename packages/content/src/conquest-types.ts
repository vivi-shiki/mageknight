import type { AttackElement, BasicManaColor, CardDefinition, EffectNode, EnemyAbility, EnemyDefinition, FactionId, RulesImplementation, Terrain, UnitDefinition } from './types';

export type SiteKind = 'village' | 'monastery' | 'keep' | 'mage-tower' | 'crystal-mine' | 'magical-glade' | 'city' | 'maze' | 'labyrinth' | 'deep-mine' | 'refugee-camp' | 'volkare-camp';
export type Difficulty = 'explorer' | 'standard' | 'veteran';
export type MarketKind = 'advanced' | 'spell' | 'unit' | 'artifact';
export type EnemyPool = 'green' | 'gray' | 'brown' | 'violet' | 'city' | 'red' | 'white';

export type TacticDefinition = {
  id: string;
  name: string;
  time: 'day' | 'night';
  initiative: number;
  effect: 'draw-one' | 'move-one' | 'influence-one' | 'reroll-source' | 'heal-one' | 'none';
};

export type SkillDefinition = {
  id: string;
  name: string;
  description: string;
  resource?: 'move' | 'influence' | 'attack' | 'block' | 'heal';
  amount?: number;
  effect?: EffectNode;
  ruleText?: string;
  sourceRef?: string;
  implementation?: RulesImplementation;
  oncePerRound: boolean;
  flipBackCondition?: 'rest' | 'action' | 'pay-green';
  assetAlias: string;
};

export type SiteDefinition = {
  id: string;
  kind: SiteKind;
  name: string;
  fortified: boolean;
  recruit: boolean;
  healCost?: number;
  reward?: MarketKind;
  assetAlias: string;
};

export type ConquestTileDefinition = {
  id: string;
  name: string;
  kind: 'start' | 'countryside' | 'core';
  terrains: [Terrain, Terrain, Terrain, Terrain, Terrain, Terrain, Terrain];
  site?: { index: number; definitionId: string };
  enemies: Array<{ index: number; pool: EnemyPool }>;
  walls?: Array<[number, number]>;
  assetAlias: string;
};

export type ConquestScenarioDefinition = {
  id: string;
  name: string;
  roundLimit: number;
  countrysideTileCount: number;
  coreNonCityTileCount: number;
  coreCityTileCount: number;
  cityLevelsByDifficulty: Record<Difficulty, number[]>;
  citiesRequired: number;
  finalTurnAfterObjective: boolean;
  objective: string;
  objectiveKind?: 'cities' | 'volkare' | 'faction-leaders' | 'necromancer' | 'relics';
  volkareArmyByDifficulty?: Record<Difficulty, number>;
  factionLeaderIds?: string[];
  graveyardsRequired?: number;
  relicsRequired?: number;
};

export type FactionTokenKind =
  | 'heal-or-remove-wound'
  | 'add-element'
  | 'remote-explore'
  | 'prevent-wound'
  | 'swap-skill'
  | 'physical-attack-bonus'
  | 'discard-combat-wounds'
  | 'make-ranged'
  | 'concealed-movement'
  | 'recover-discard'
  | 'swap-source-mana';

export type FactionTokenDefinition = {
  id: string;
  name: string;
  factionId: FactionId;
  copies: number;
  kind: FactionTokenKind;
  description: string;
  element?: 'fire' | 'ice';
  assetAlias: string;
  sourceRef: string;
};

export type FactionLeaderLevelDefinition = {
  level: number;
  armor: number;
  attacks: number[];
  attackElements: AttackElement[];
  abilities: EnemyAbility[];
  resistances: AttackElement[];
  fame: number;
  guards: Partial<Record<EnemyPool, number>>;
};

export type FactionLeaderDefinition = {
  id: string;
  name: string;
  factionId: FactionId;
  levels: FactionLeaderLevelDefinition[];
  assetAlias: string;
  sourceRef: string;
};

export type SiteOverlayDefinition = {
  id: string;
  name: string;
  kind: 'hidden-valley' | 'necropolis' | 'graveyard';
  moveCost?: number;
  nightRules: boolean;
  assetAlias: string;
  sourceRef: string;
};

export type HeroDefinition = {
  id: string;
  name: string;
  armor: number;
  handLimit: number;
  commandSlots: number;
  basicDeck: string[];
  skillIds: string[];
  startingCrystals?: BasicManaColor[];
  assetAlias: string;
  sourceRef: string;
};

export type ConquestContent = {
  version: '0.8.0';
  enabledModules: string[];
  contentHash: string;
  heroes: Record<string, HeroDefinition>;
  scenarios: Record<string, ConquestScenarioDefinition>;
  defaultHeroId: string;
  defaultScenarioId: string;
  cards: Record<string, CardDefinition>;
  advancedDeck: string[];
  spellDeck: string[];
  artifactDeck: string[];
  units: Record<string, UnitDefinition & { tier: 'regular' | 'elite'; siteKinds: SiteKind[]; resistances: AttackElement[] }>;
  regularUnitDeck: string[];
  eliteUnitDeck: string[];
  enemies: Record<string, EnemyDefinition>;
  enemyPools: Record<EnemyPool, string[]>;
  tactics: Record<string, TacticDefinition>;
  skills: Record<string, SkillDefinition>;
  sites: Record<string, SiteDefinition>;
  tiles: Record<string, ConquestTileDefinition>;
  countrysideTiles: string[];
  coreTiles: string[];
  factionTokens: Record<string, FactionTokenDefinition>;
  factionTokenDecks: Record<FactionId, string[]>;
  factionEnemyPools: Record<FactionId, Partial<Record<EnemyPool, string[]>>>;
  factionLeaders: Record<string, FactionLeaderDefinition>;
  siteOverlays: Record<string, SiteOverlayDefinition>;
};
