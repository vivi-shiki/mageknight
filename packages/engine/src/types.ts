import type {
  AttackElement,
  AttackKind,
  BasicManaColor,
  ManaColor,
  ResourceType,
  Terrain,
  TimeOfDay,
  TutorialContent,
} from '@mageknight/content';

export type { AttackElement, AttackKind, BasicManaColor, ManaColor, ResourceType, Terrain, TimeOfDay, TutorialContent };

export type Coord = { q: number; r: number };
export type GamePhase =
  | 'movement'
  | 'action'
  | 'interaction'
  | 'combat-ranged'
  | 'combat-block'
  | 'combat-damage'
  | 'combat-attack'
  | 'decision'
  | 'game-over';

export type ScenarioStatus = 'playing' | 'won' | 'lost';
export type CardUseMode = 'basic' | 'strong' | 'sideways';

export type ResourceContribution = {
  id: string;
  sourceId: string;
  resource: ResourceType;
  amount: number;
  attackKind: AttackKind;
  element: AttackElement;
};

export type CardInstance = {
  id: string;
  definitionId: string;
};

export type UnitState = {
  id: string;
  definitionId: string;
  ready: boolean;
  wounded: boolean;
};

export type PlayerState = {
  id: 'player-1';
  heroId: 'core.hero.tovak';
  position: Coord;
  armor: number;
  fame: number;
  level: number;
  handLimit: number;
  commandSlots: number;
  knockedOut: boolean;
  deck: CardInstance[];
  hand: CardInstance[];
  playArea: CardInstance[];
  discard: CardInstance[];
  removed: CardInstance[];
  units: UnitState[];
  crystals: Record<BasicManaColor, number>;
  resources: ResourceContribution[];
};

export type MapSpaceState = {
  coord: Coord;
  terrain: Terrain;
  revealed: boolean;
  site?: 'village';
  enemyIds: string[];
};

export type EnemyState = {
  id: string;
  definitionId: string;
  position: Coord;
  defeated: boolean;
};

export type SourceDie = {
  id: string;
  color: ManaColor;
  used: boolean;
};

export type CombatAttackState = {
  enemyId: string;
  attackIndex: number;
  blocked: boolean;
  resolved: boolean;
};

export type EncounterState = {
  enemyIds: string[];
  origin: Coord;
  phase: 'ranged' | 'block' | 'damage' | 'attack';
  incoming: CombatAttackState[];
  defeatedThisCombat: string[];
  heroWoundsGained: number;
};

export type DecisionRequest = {
  id: string;
  kind: 'level-up';
  prompt: string;
  options: Array<{ id: string; label: string }>;
  returnPhase: GamePhase;
};

export type DomainEvent = {
  id: number;
  type: string;
  round: number;
  turn: number;
  message: string;
  data: Record<string, unknown>;
};

export type Checkpoint = {
  eventIndex: number;
  barrier: boolean;
  reason: string;
};

export type GameState = {
  schemaVersion: 1;
  contentVersion: string;
  seed: string;
  rngState: number;
  nextEntityId: number;
  round: number;
  turn: number;
  time: TimeOfDay;
  phase: GamePhase;
  actionTaken: boolean;
  player: PlayerState;
  source: SourceDie[];
  map: Record<string, MapSpaceState>;
  enemies: Record<string, EnemyState>;
  explored: boolean;
  scenario: {
    id: 'core.scenario.first-reconnaissance-lite';
    status: ScenarioStatus;
    roundLimit: number;
    enemiesDefeated: number;
    objective: string;
  };
  encounter?: EncounterState;
  pendingDecision?: DecisionRequest;
  pendingRewards: { fame: number };
  eventLog: DomainEvent[];
  checkpoints: Checkpoint[];
};

export type GameConfig = {
  seed: string;
  deckOrder?: string[];
  sourceColors?: ManaColor[];
};

export type GameCommand =
  | { type: 'PLAY_CARD'; cardId: string; mode: CardUseMode; sidewaysResource?: ResourceType }
  | { type: 'MOVE_HERO'; to: Coord }
  | { type: 'EXPLORE_TILE' }
  | { type: 'FINISH_MOVEMENT' }
  | { type: 'REST'; discardCardId: string; woundCardIds: string[] }
  | { type: 'START_COMBAT'; enemyIds: string[] }
  | { type: 'DECLARE_ATTACK'; enemyIds: string[]; kind: AttackKind }
  | { type: 'DECLARE_BLOCK'; enemyId: string; attackIndex: number }
  | { type: 'ASSIGN_DAMAGE'; enemyId: string; attackIndex: number; target: 'hero' | string }
  | { type: 'ADVANCE_COMBAT_PHASE' }
  | { type: 'ACTIVATE_UNIT' }
  | { type: 'START_INTERACTION' }
  | { type: 'RECRUIT_UNIT'; definitionId: string }
  | { type: 'HEAL_WOUND'; cardId: string }
  | { type: 'FINISH_INTERACTION' }
  | { type: 'END_TURN' }
  | { type: 'DECLARE_END_ROUND' }
  | { type: 'RESOLVE_DECISION'; optionId: string };

export type GameErrorCode =
  | 'WRONG_PHASE'
  | 'INVALID_COMMAND'
  | 'INVALID_TARGET'
  | 'CARD_NOT_IN_HAND'
  | 'CARD_CANNOT_BE_PLAYED'
  | 'MANA_COLOR_UNAVAILABLE'
  | 'INSUFFICIENT_RESOURCE'
  | 'SPACE_NOT_FOUND'
  | 'SPACE_NOT_ADJACENT'
  | 'TERRAIN_IMPASSABLE'
  | 'ACTION_ALREADY_TAKEN'
  | 'ENEMY_NOT_AVAILABLE'
  | 'ATTACK_NOT_EFFECTIVE'
  | 'ATTACK_ALREADY_RESOLVED'
  | 'UNIT_NOT_AVAILABLE'
  | 'COMMAND_LIMIT_REACHED'
  | 'DECISION_REQUIRED'
  | 'INVALID_DECISION'
  | 'ROUND_END_NOT_AVAILABLE'
  | 'INFORMATION_BARRIER'
  | 'GAME_ALREADY_OVER';

export type ExecutionSuccess = {
  ok: true;
  state: GameState;
  events: DomainEvent[];
};

export type ExecutionFailure = {
  ok: false;
  state: GameState;
  events: [];
  error: { code: GameErrorCode; message: string };
};

export type ExecutionResult = ExecutionSuccess | ExecutionFailure;

export type LegalIntent = {
  id: string;
  label: string;
  command: GameCommand;
  group: 'card' | 'map' | 'combat' | 'action' | 'decision';
};

export type GameView = Omit<GameState, 'rngState'> & {
  legalIntents: LegalIntent[];
  resourceTotals: Record<ResourceType, number>;
};
