import type { AttackElement, AttackKind, BasicManaColor, ConquestContent, Difficulty, EnemyPool, FactionId, ManaColor, MarketKind, ResourceType, Terrain, TimeOfDay } from '@mageknight/content';
import type { Coord, DomainEvent } from '../types';

export type ConquestPhase = 'tactics' | 'movement' | 'action' | 'interaction' | 'combat-ranged' | 'combat-block' | 'combat-damage' | 'combat-attack' | 'decision' | 'game-over';
export type EntityZone = 'deck' | 'hand' | 'play' | 'discard' | 'removed' | 'inventory' | 'set-aside';

export type CardZones = Record<EntityZone, string[]>;
export type ConquestCardInstance = { id: string; definitionId: string };
export type ConquestResource = { id: string; sourceId: string; resource: ResourceType; amount: number; attackKind: AttackKind; element: AttackElement; tags?: string[] };
export type ConquestUnitState = { id: string; definitionId: string; ready: boolean; wounds: number; destroyed: boolean; usedAbilityIndexes?: number[] };
export type SkillState = {
  definitionId: string;
  used: boolean;
  usedThisTurn?: boolean;
  flipped?: boolean;
  value?: number;
  storedEnemyDefinitionIds?: string[];
};
export type LastingEffect = {
  id: string;
  kind: 'hand-limit' | 'armor' | 'reputation' | 'resource' | 'terrain';
  amount: number;
  expires: 'end-turn' | 'start-next-turn' | 'end-round';
  terrains?: Terrain[];
  mode?: 'set' | 'reduce';
  minimum?: number;
  allowLake?: boolean;
};
export type EnemyModifierState = { armor: number; attack: number; attackByIndex?: Record<number, number>; skipAttack: boolean; removeFortification: boolean; removeResistance: boolean; destroy: boolean; expires: 'end-combat' | 'end-turn' };
export type RuleAttachmentState = { id: string; cardId: string; definitionId: string; unitId: string; used: boolean };
export type RuleRuntimeState = {
  moveToAttack?: 'normal' | 'ranged';
  movementMode?: { kind: 'space-bending' | 'wings-of-wind' | 'underground' | 'underground-assault'; maxDistance: number; ignoreEnemies: boolean; allowFortified: boolean };
  recruitReputation: number;
  recruitFame: number;
  famePerDefeated: number;
  healFamePerPoint: number;
  drawPerHandWound: boolean;
  allUnitsBonus: number;
  allUnitsAllResistances: boolean;
  doublePhysicalAttacks: boolean;
  removePhysicalResistance: boolean;
  convertAttacks?: 'cold-fire' | 'siege';
  pendingBlockEffect?: 'fire-attack' | 'destroy';
  endlessMana: ManaColor[];
  spellFameColor?: BasicManaColor;
  removeTurnWounds: boolean;
  extraTurn: boolean;
  noDrawNextTurn: boolean;
  ignoreFortification: boolean;
  goldAtNight: boolean;
  blackAtDay: boolean;
  ignoreWalls: boolean;
  allUnitsArmorBonus: number;
  deepMineClaimed: boolean;
  ignoreReputation: boolean;
  heroDamageReduction?: { physical: number; elemental: number };
  recruitDiscount: number;
  recruitReputationPenalty: number;
  savageHarvesting?: 'once' | 'each';
  harvestOpportunities: number;
  ruthlessReadyUnits: boolean;
  concealedMovement: boolean;
  preventNextHeroWound: boolean;
  discardCombatWounds: boolean;
  factionAttackElement?: 'fire' | 'ice';
  nextAttackRanged: boolean;
  explorationDiscount: number;
  shapeshiftResource?: 'move' | 'attack' | 'block';
};

export type ConquestSpaceState = {
  coord: Coord;
  terrain: Terrain;
  tileId: string;
  revealed: boolean;
  siteId?: string;
  conquered: boolean;
  burned: boolean;
  enemyIds: string[];
};

export type ConquestEnemyState = { id: string; definitionId: string; position: Coord; defeated: boolean; summoned: boolean; pursuing?: boolean; ambushing?: boolean; pursuitExhausted?: boolean };
export type PlacedTile = { definitionId: string; center: Coord; order: number };
export type ConquestSourceDie = { id: string; color: ManaColor; used: boolean };
export type ConquestAttackState = { enemyId: string; attackIndex: number; attack: number; element: AttackElement; blocked: boolean; resolved: boolean; summoned: boolean };
export type ConquestEncounter = { enemyIds: string[]; origin: Coord; siteId?: string; leaderId?: string; leaderLevelsHit?: number; phase: 'ranged' | 'block' | 'damage' | 'attack'; incoming: ConquestAttackState[]; defeatedThisCombat: string[]; heroWoundsGained: number; fullyBlockedEnemyIds: string[]; defendAssignments?: Record<string, string>; crossedWall?: boolean; adventureMove?: 2 | 4 | 6; adventureCrystalColors?: BasicManaColor[] };

export type SiteOverlayState = { definitionId: string; position: Coord; liberated: boolean; sealed: boolean };
export type FactionLeaderState = { definitionId: string; position?: Coord; level: number; initialLevel: number; defeated: boolean; guardEnemyIds: string[] };
export type FactionTokenState = {
  decks: Record<FactionId, string[]>;
  discards: Record<FactionId, string[]>;
  inventory: string[];
  usedNamesThisTurn: string[];
};

export type VolkareCard = { color: BasicManaColor | 'wound'; steps: 0 | 1 | 2 };
export type VolkareState = {
  position: Coord;
  armyEnemyIds: string[];
  deck: VolkareCard[];
  discard: VolkareCard[];
  revealed: boolean;
  defeated: boolean;
  reachedPortal: boolean;
  lastAction?: string;
};

export type ConquestDecision = {
  id: string;
  kind: 'level-up' | 'replace-unit' | 'reward';
  prompt: string;
  options: Array<{ id: string; label: string }>;
  returnPhase: ConquestPhase;
  context: Record<string, string | number | boolean>;
  selection?: { entity: 'card' | 'unit' | 'enemy' | 'skill' | 'offer'; mode: 'single' | 'multiple' | 'ordered'; minimum: number; maximum: number };
};

export type MarketState = {
  advanced: { deck: string[]; offer: string[] };
  spell: { deck: string[]; offer: string[] };
  artifact: { deck: string[]; offer: string[] };
  unit: { regularDeck: string[]; eliteDeck: string[]; offer: string[] };
};

export type DummyState = {
  deck: BasicManaColor[];
  discard: BasicManaColor[];
  crystals: Record<BasicManaColor, number>;
  tacticId?: string;
  exhausted: boolean;
  lastCardsDrawn: number;
};

export type ConquestScenarioState = {
  id: string;
  status: 'playing' | 'won' | 'lost';
  objective: string;
  roundLimit: number;
  difficulty: Difficulty;
  cityLevels: number[];
  citiesRequired: number;
  citiesConquered: number;
  finalTurnAfterObjective: boolean;
  objectiveCompleted: boolean;
  objectiveKind: 'cities' | 'volkare' | 'faction-leaders' | 'necromancer' | 'relics';
  volkareArmySize: number;
  leadersRequired: number;
  leadersDefeated: number;
  graveyardsRequired: number;
  graveyardsSealed: number;
  relicsRequired: number;
  relicsFound: number;
  score?: ConquestScore;
};

export type ConquestScore = {
  fame: number;
  knowledge: number;
  loot: number;
  leadership: number;
  adventure: number;
  wounds: number;
  rounds: number;
  total: number;
};

export type ConquestState = {
  schemaVersion: 8;
  appVersion: '0.8.0';
  contentVersion: '0.8.0';
  contentHash: string;
  enabledModules: string[];
  seed: string;
  rngState: number;
  nextEntityId: number;
  round: number;
  turn: number;
  time: TimeOfDay;
  phase: ConquestPhase;
  actionTaken: boolean;
  roundEndAnnounced: boolean;
  finalTurnsRemaining: number;
  player: {
    id: 'player-1';
    heroId: string;
    position: Coord;
    armor: number;
    fame: number;
    level: number;
    reputation: number;
    handLimit: number;
    commandSlots: number;
    knockedOut: boolean;
    crystals: Record<BasicManaColor, number>;
    manaTokens: Record<ManaColor, number>;
    cardInstances: Record<string, ConquestCardInstance>;
    zones: CardZones;
    units: ConquestUnitState[];
    skills: SkillState[];
    resources: ConquestResource[];
  };
  source: ConquestSourceDie[];
  map: Record<string, ConquestSpaceState>;
  placedTiles: PlacedTile[];
  walls: string[];
  adventureClaims: Record<string, number[]>;
  countrysideTileDeck: string[];
  coreTileDeck: string[];
  enemies: Record<string, ConquestEnemyState>;
  overlays: Record<string, SiteOverlayState>;
  factionLeaders: Record<string, FactionLeaderState>;
  factionTokens: FactionTokenState;
  enemyModifiers: Record<string, EnemyModifierState>;
  attachments: RuleAttachmentState[];
  ruleRuntime: RuleRuntimeState;
  turnWoundIds: string[];
  defeatedThisTurn: string[];
  enemyPools: Record<EnemyPool, string[]>;
  volkare?: VolkareState;
  market: MarketState;
  dummy: DummyState;
  scenario: ConquestScenarioState;
  pendingDecision?: ConquestDecision;
  encounter?: ConquestEncounter;
  pendingFame: number;
  lastingEffects: LastingEffect[];
  eventLog: DomainEvent[];
  checkpoints: Array<{ eventIndex: number; barrier: boolean; reason: string }>;
};

export type ConquestConfig = { seed: string; difficulty: Difficulty; scenarioId?: string; heroId?: string };

export type ConquestCommand =
  | { type: 'SELECT_TACTIC'; tacticId: string }
  | { type: 'PLAY_CARD'; cardId: string; mode: 'basic' | 'strong' | 'sideways'; sidewaysResource?: ResourceType; choiceIndex?: number; targetId?: string; targetIds?: string[]; amount?: number; manaColors?: BasicManaColor[]; secondaryIndex?: number; secondaryTargetId?: string }
  | { type: 'USE_SKILL'; skillId: string; choiceIndex?: number; targetId?: string; targetIds?: string[]; amount?: number; manaColors?: BasicManaColor[] }
  | { type: 'FLIP_BACK_SKILL'; skillId: string }
  | { type: 'REST'; discardCardId: string; woundCardIds: string[] }
  | { type: 'HARVEST_CRYSTAL'; cardId: string; color?: BasicManaColor }
  | { type: 'READY_UNIT_WITH_INFLUENCE'; unitId: string }
  | { type: 'MOVE_HERO'; to: Coord }
  | { type: 'EXPLORE_TILE' }
  | { type: 'FINISH_MOVEMENT' }
  | { type: 'START_COMBAT'; enemyIds: string[] }
  | { type: 'START_LEADER_COMBAT'; leaderId: string }
  | { type: 'DECLARE_ATTACK'; enemyIds: string[]; kind: AttackKind }
  | { type: 'DECLARE_LEADER_ATTACK'; leaderId: string; kind: AttackKind }
  | { type: 'DECLARE_BLOCK'; enemyId: string; attackIndex: number }
  | { type: 'REDUCE_CUMBERSOME'; enemyId: string; attackIndex: number }
  | { type: 'ASSIGN_DAMAGE'; enemyId: string; attackIndex: number; target: 'hero' | string }
  | { type: 'ADVANCE_COMBAT_PHASE' }
  | { type: 'ACTIVATE_UNIT'; unitId: string; abilityIndex?: number; choiceIndex?: number; targetId?: string; targetIds?: string[]; amount?: number; manaColors?: BasicManaColor[] }
  | { type: 'USE_ATTACHMENT'; attachmentId: string; targetId?: string }
  | { type: 'HEAL_WOUND'; target: 'hero' | string; woundId?: string }
  | { type: 'START_INTERACTION' }
  | { type: 'BUY_MARKET'; market: MarketKind; definitionId: string }
  | { type: 'RECRUIT_UNIT'; definitionId: string }
  | { type: 'HEAL'; target: 'hero' | string }
  | { type: 'BURN_MONASTERY' }
  | { type: 'FINISH_INTERACTION' }
  | { type: 'ENTER_ADVENTURE_SITE'; amount: 2 | 4 | 6; crystalColors?: BasicManaColor[] }
  | { type: 'CLAIM_DEEP_MINE'; color: BasicManaColor }
  | { type: 'USE_FACTION_TOKEN'; tokenId: string; choice?: string; targetId?: string }
  | { type: 'SEAL_GRAVEYARD' }
  | { type: 'END_TURN' }
  | { type: 'DECLARE_END_ROUND' }
  | { type: 'RESOLVE_DECISION'; optionId: string };

export type ConquestErrorCode = 'WRONG_PHASE' | 'INVALID_COMMAND' | 'INVALID_TARGET' | 'INSUFFICIENT_RESOURCE' | 'MANA_UNAVAILABLE' | 'CARD_NOT_IN_HAND' | 'DECISION_REQUIRED' | 'ROUND_END_NOT_AVAILABLE' | 'GAME_ALREADY_OVER' | 'COMMAND_LIMIT_REACHED';
export type ConquestResult = { ok: true; state: ConquestState; events: DomainEvent[] } | { ok: false; state: ConquestState; events: []; error: { code: ConquestErrorCode; message: string } };
export type ConquestIntent = { id: string; label: string; command: ConquestCommand; group: 'tactic' | 'card' | 'map' | 'combat' | 'market' | 'action' | 'decision' };
export type ConquestView = Omit<ConquestState, 'rngState' | 'enemyPools' | 'countrysideTileDeck' | 'coreTileDeck'> & {
  legalIntents: ConquestIntent[];
  resourceTotals: Record<ResourceType, number>;
  hidden: { countrysideTiles: number; coreTiles: number; enemyMarkers: Record<string, number> };
};

export type ConquestRulesContext = { content: ConquestContent };
