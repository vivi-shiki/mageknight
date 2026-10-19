export type ResourceType = 'move' | 'influence' | 'attack' | 'block' | 'heal';
export type ManaColor = 'red' | 'blue' | 'white' | 'green' | 'gold' | 'black';
export type BasicManaColor = Exclude<ManaColor, 'gold' | 'black'>;
export type TimeOfDay = 'day' | 'night';
export type Terrain = 'plains' | 'forest' | 'hills' | 'desert' | 'wasteland' | 'mountain' | 'lake';
export type AttackElement = 'physical' | 'fire' | 'ice' | 'cold-fire';
export type AttackKind = 'normal' | 'ranged' | 'siege';

export type CardEffect = {
  resource: ResourceType;
  amount: number;
  attackKind?: AttackKind;
  element?: AttackElement;
};

export type EffectTarget = 'enemy' | 'unit' | 'hand-card';
export type EffectDuration = 'end-turn' | 'start-next-turn' | 'end-round' | 'end-combat';

export type EffectNode =
  | CardEffect
  | { type: 'sequence'; effects: EffectNode[] }
  | { type: 'spend-mana'; color: ManaColor; amount: number }
  | { type: 'repeat'; times: number; effect: EffectNode }
  | { type: 'draw'; amount: number }
  | { type: 'discard'; amount: number; filter?: 'wound' | 'non-wound' | 'any' }
  | { type: 'convert'; from: ResourceType; to: ResourceType; amount: number }
  | { type: 'choose-one'; options: EffectNode[]; labels?: string[] }
  | { type: 'conditional'; when: TimeOfDay; then: EffectNode; otherwise?: EffectNode }
  | { type: 'create-lasting-effect'; effect: 'hand-limit' | 'armor' | 'reputation' | 'resource'; amount: number; expires: Exclude<EffectDuration, 'end-combat'> }
  | { type: 'gain-crystal'; color: BasicManaColor; amount: number }
  | { type: 'gain-mana'; color: ManaColor; amount: number }
  | { type: 'take-wound'; amount: number }
  | { type: 'adjust-track'; track: 'fame' | 'reputation'; amount: number }
  | { type: 'refresh-unit'; maxLevel?: number; totalLevels?: number }
  | { type: 'modify-enemy'; modifier: 'armor' | 'attack' | 'skip-attack' | 'remove-fortification' | 'remove-resistance' | 'destroy'; amount?: number; scope?: 'target' | 'all'; expires: 'end-combat' | 'end-turn' }
  | { type: 'terrain-cost'; terrains: Terrain[]; mode: 'set' | 'reduce'; amount: number; minimum?: number; allowLake?: boolean; expires: 'end-turn' }
  | { type: 'special'; rule: string; target?: EffectTarget };

export type RulesImplementation = 'full' | 'modeled';

export type RuleOption = {
  label: string;
  text: string;
  effect: EffectNode;
};

export type CardDefinition = {
  id: string;
  name: string;
  color: BasicManaColor;
  kind: 'basic' | 'advanced' | 'spell' | 'wound';
  basic?: CardEffect;
  strong?: CardEffect;
  basicEffect?: EffectNode;
  strongEffect?: EffectNode;
  basicText?: string;
  strongText?: string;
  sourceRef?: string;
  implementation?: RulesImplementation;
  assetAlias: string;
};

export type EnemyAbility =
  | 'swift'
  | 'brutal'
  | 'poison'
  | 'fortified'
  | 'multi-attack'
  | 'paralyze'
  | 'summon'
  | 'elusive'
  | 'unfortified'
  | 'arcane-immunity'
  | 'assassination'
  | 'cumbersome'
  | 'defend'
  | 'vampiric'
  | 'ambush'
  | 'pursuit';

export type FactionId = 'elementalist' | 'dark-crusader';

export type EnemyDefinition = {
  id: string;
  name: string;
  armor: number;
  elusiveArmor?: number;
  attack: number[];
  attackElement: AttackElement;
  attackElements?: AttackElement[];
  resistances: AttackElement[];
  abilities: EnemyAbility[];
  factionId?: FactionId;
  defend?: number;
  fame: number;
  assetAlias: string;
  sourceRef?: string;
};

export type UnitDefinition = {
  id: string;
  name: string;
  level: number;
  armor: number;
  influenceCost: number;
  ability: CardEffect;
  abilities?: RuleOption[];
  sourceRef?: string;
  implementation?: RulesImplementation;
  assetAlias: string;
};

export type MapSpaceTemplate = {
  q: number;
  r: number;
  terrain: Terrain;
  site?: 'village';
  enemyId?: string;
};

export type TutorialContent = {
  version: string;
  cards: Record<string, CardDefinition>;
  basicDeck: string[];
  rewardDeck: string[];
  enemies: Record<string, EnemyDefinition>;
  units: Record<string, UnitDefinition>;
  startingMap: MapSpaceTemplate[];
  explorationMap: MapSpaceTemplate[];
};
