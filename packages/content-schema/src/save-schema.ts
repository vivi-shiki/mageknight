import { z } from 'zod';

const coordSchema = z.object({ q: z.number().int(), r: z.number().int() });
const cardInstanceSchema = z.object({ id: z.string().min(1), definitionId: z.string().min(1) });
const resourceSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  resource: z.enum(['move', 'influence', 'attack', 'block', 'heal']),
  amount: z.number().nonnegative(),
  attackKind: z.enum(['normal', 'ranged', 'siege']),
  element: z.enum(['physical', 'fire', 'ice']),
});

export const gameStateSchema = z.looseObject({
  schemaVersion: z.literal(1),
  contentVersion: z.string().min(1),
  seed: z.string(),
  rngState: z.number().int(),
  nextEntityId: z.number().int().positive(),
  round: z.number().int().positive(),
  turn: z.number().int().positive(),
  time: z.enum(['day', 'night']),
  phase: z.enum(['movement', 'action', 'interaction', 'combat-ranged', 'combat-block', 'combat-damage', 'combat-attack', 'decision', 'game-over']),
  actionTaken: z.boolean(),
  player: z.looseObject({
    id: z.literal('player-1'),
    heroId: z.literal('core.hero.tovak'),
    position: coordSchema,
    armor: z.number().int().positive(),
    fame: z.number().int().nonnegative(),
    level: z.number().int().positive(),
    handLimit: z.number().int().positive(),
    commandSlots: z.number().int().positive(),
    knockedOut: z.boolean(),
    deck: z.array(cardInstanceSchema),
    hand: z.array(cardInstanceSchema),
    playArea: z.array(cardInstanceSchema),
    discard: z.array(cardInstanceSchema),
    removed: z.array(cardInstanceSchema),
    units: z.array(z.looseObject({ id: z.string(), definitionId: z.string(), ready: z.boolean(), wounded: z.boolean() })),
    crystals: z.object({ red: z.number(), blue: z.number(), white: z.number(), green: z.number() }),
    resources: z.array(resourceSchema),
  }),
  source: z.array(z.object({ id: z.string(), color: z.enum(['red', 'blue', 'white', 'green', 'gold', 'black']), used: z.boolean() })),
  map: z.record(z.string(), z.looseObject({ coord: coordSchema, terrain: z.string(), revealed: z.boolean(), enemyIds: z.array(z.string()) })),
  enemies: z.record(z.string(), z.looseObject({ id: z.string(), definitionId: z.string(), position: coordSchema, defeated: z.boolean() })),
  explored: z.boolean(),
  scenario: z.looseObject({ id: z.string(), status: z.enum(['playing', 'won', 'lost']), roundLimit: z.number().int().positive(), enemiesDefeated: z.number().int().nonnegative(), objective: z.string() }),
  pendingRewards: z.object({ fame: z.number().int().nonnegative() }),
  eventLog: z.array(z.looseObject({ id: z.number().int(), type: z.string(), round: z.number().int(), turn: z.number().int(), message: z.string(), data: z.record(z.string(), z.unknown()) })),
  checkpoints: z.array(z.object({ eventIndex: z.number().int(), barrier: z.boolean(), reason: z.string() })),
});

export const commandSchema = z.looseObject({ type: z.string().min(1) });

const historySchema = z.object({
  undoStack: z.array(z.object({ state: gameStateSchema, commandCount: z.number().int().nonnegative() })),
  commandLog: z.array(commandSchema),
  barrierReason: z.string().optional(),
});

export const saveEnvelopeV1Schema = z.object({
  saveSchemaVersion: z.literal(1),
  appVersion: z.literal('0.1.0'),
  slot: z.enum(['auto', 'manual-1']),
  savedAt: z.number().int().nonnegative(),
  state: gameStateSchema,
  history: historySchema,
});

export const conquestGameStateSchema = z.looseObject({
  schemaVersion: z.literal(2),
  appVersion: z.literal('0.2.0'),
  contentVersion: z.literal('0.2.0'),
  contentHash: z.string().min(1),
  enabledModules: z.array(z.string().min(1)).min(1),
  seed: z.string(),
  rngState: z.number().int(),
  nextEntityId: z.number().int().positive(),
  round: z.number().int().positive(),
  turn: z.number().int().positive(),
  time: z.enum(['day', 'night']),
  phase: z.enum(['tactics', 'movement', 'action', 'interaction', 'combat-ranged', 'combat-block', 'combat-damage', 'combat-attack', 'decision', 'game-over']),
  player: z.looseObject({
    id: z.literal('player-1'),
    heroId: z.literal('core.hero.tovak'),
    cardInstances: z.record(z.string(), cardInstanceSchema),
    zones: z.object({ deck: z.array(z.string()), hand: z.array(z.string()), play: z.array(z.string()), discard: z.array(z.string()), removed: z.array(z.string()), inventory: z.array(z.string()), 'set-aside': z.array(z.string()) }),
  }),
  scenario: z.looseObject({ id: z.string().min(1), status: z.enum(['playing', 'won', 'lost']), difficulty: z.enum(['explorer', 'standard', 'veteran']), cityConquered: z.boolean() }),
  map: z.record(z.string(), z.looseObject({ coord: coordSchema, terrain: z.string(), tileId: z.string(), revealed: z.boolean(), conquered: z.boolean(), burned: z.boolean(), enemyIds: z.array(z.string()) })),
  eventLog: z.array(z.looseObject({ id: z.number().int(), type: z.string(), round: z.number().int(), turn: z.number().int(), message: z.string(), data: z.record(z.string(), z.unknown()) })),
});

const conquestCommandSchema = z.looseObject({ type: z.string().min(1) });
const conquestHistorySchema = z.object({
  undoStack: z.array(z.object({ state: conquestGameStateSchema, commandCount: z.number().int().nonnegative() })),
  commandLog: z.array(conquestCommandSchema),
  barrierReason: z.string().optional(),
});

export const saveEnvelopeV2Schema = z.object({
  saveSchemaVersion: z.literal(2),
  appVersion: z.literal('0.2.0'),
  slot: z.enum(['conquest-auto', 'conquest-manual-1']),
  savedAt: z.number().int().nonnegative(),
  contentHash: z.string().min(1),
  enabledModules: z.array(z.string().min(1)).min(1),
  scenarioId: z.string().min(1),
  difficulty: z.enum(['explorer', 'standard', 'veteran']),
  state: conquestGameStateSchema,
  history: conquestHistorySchema,
});

export const conquestGameStateV3Schema = conquestGameStateSchema.extend({
  schemaVersion: z.literal(3),
  appVersion: z.literal('0.3.0'),
  contentVersion: z.literal('0.3.0'),
  player: conquestGameStateSchema.shape.player.extend({ heroId: z.string().min(1) }),
  scenario: z.looseObject({
    id: z.string().min(1),
    status: z.enum(['playing', 'won', 'lost']),
    difficulty: z.enum(['explorer', 'standard', 'veteran']),
    cityLevels: z.array(z.number().int().positive()).min(1),
    citiesRequired: z.number().int().positive(),
    citiesConquered: z.number().int().nonnegative(),
    finalTurnAfterObjective: z.boolean(),
    objectiveCompleted: z.boolean(),
  }),
});

const conquestHistoryV3Schema = z.object({
  undoStack: z.array(z.object({ state: conquestGameStateV3Schema, commandCount: z.number().int().nonnegative() })),
  commandLog: z.array(conquestCommandSchema),
  barrierReason: z.string().optional(),
});

export const saveEnvelopeV3Schema = z.object({
  saveSchemaVersion: z.literal(3),
  appVersion: z.literal('0.3.0'),
  slot: z.enum(['conquest-auto', 'conquest-manual-1']),
  savedAt: z.number().int().nonnegative(),
  contentHash: z.string().min(1),
  enabledModules: z.array(z.string().min(1)).min(1),
  scenarioId: z.string().min(1),
  heroId: z.string().min(1),
  difficulty: z.enum(['explorer', 'standard', 'veteran']),
  state: conquestGameStateV3Schema,
  history: conquestHistoryV3Schema,
});

const manaTokenSchema = z.object({ red: z.number().int().nonnegative(), blue: z.number().int().nonnegative(), white: z.number().int().nonnegative(), green: z.number().int().nonnegative(), gold: z.number().int().nonnegative(), black: z.number().int().nonnegative() });
const enemyModifierSchema = z.object({
  armor: z.number(),
  attack: z.number(),
  attackByIndex: z.record(z.string(), z.number()).optional(),
  skipAttack: z.boolean(),
  removeFortification: z.boolean(),
  removeResistance: z.boolean(),
  destroy: z.boolean(),
  expires: z.enum(['end-combat', 'end-turn']),
});

export const conquestGameStateV4Schema = conquestGameStateV3Schema.extend({
  schemaVersion: z.literal(4),
  appVersion: z.literal('0.4.0'),
  contentVersion: z.literal('0.4.0'),
  player: conquestGameStateV3Schema.shape.player.extend({ manaTokens: manaTokenSchema }),
  enemyModifiers: z.record(z.string(), enemyModifierSchema),
});

const conquestHistoryV4Schema = z.object({
  undoStack: z.array(z.object({ state: conquestGameStateV4Schema, commandCount: z.number().int().nonnegative() })),
  commandLog: z.array(conquestCommandSchema),
  barrierReason: z.string().optional(),
});

export const saveEnvelopeV4Schema = z.object({
  saveSchemaVersion: z.literal(4),
  appVersion: z.literal('0.4.0'),
  slot: z.enum(['conquest-auto', 'conquest-manual-1']),
  savedAt: z.number().int().nonnegative(),
  contentHash: z.string().min(1),
  enabledModules: z.array(z.string().min(1)).min(1),
  scenarioId: z.string().min(1),
  heroId: z.string().min(1),
  difficulty: z.enum(['explorer', 'standard', 'veteran']),
  state: conquestGameStateV4Schema,
  history: conquestHistoryV4Schema,
});

const ruleRuntimeSchema = z.looseObject({
  recruitReputation: z.number().int(),
  recruitFame: z.number().int(),
  famePerDefeated: z.number().int(),
  healFamePerPoint: z.number().int(),
  drawPerHandWound: z.boolean(),
  allUnitsBonus: z.number().int(),
  allUnitsAllResistances: z.boolean(),
  doublePhysicalAttacks: z.boolean(),
  removePhysicalResistance: z.boolean(),
  endlessMana: z.array(z.enum(['red', 'blue', 'white', 'green', 'gold', 'black'])),
  removeTurnWounds: z.boolean(),
  extraTurn: z.boolean(),
  noDrawNextTurn: z.boolean(),
  ignoreFortification: z.boolean(),
  goldAtNight: z.boolean(),
  blackAtDay: z.boolean(),
});

export const conquestGameStateV5Schema = conquestGameStateV4Schema.extend({
  schemaVersion: z.literal(5),
  appVersion: z.literal('0.5.0'),
  contentVersion: z.literal('0.5.0'),
  attachments: z.array(z.object({ id: z.string(), cardId: z.string(), definitionId: z.string(), unitId: z.string(), used: z.boolean() })),
  ruleRuntime: ruleRuntimeSchema,
  turnWoundIds: z.array(z.string()),
});

const conquestHistoryV5Schema = z.object({
  undoStack: z.array(z.object({ state: conquestGameStateV5Schema, commandCount: z.number().int().nonnegative() })),
  commandLog: z.array(conquestCommandSchema),
  barrierReason: z.string().optional(),
});

export const saveEnvelopeV5Schema = z.object({
  saveSchemaVersion: z.literal(5),
  appVersion: z.literal('0.5.0'),
  slot: z.enum(['conquest-auto', 'conquest-manual-1']),
  savedAt: z.number().int().nonnegative(),
  contentHash: z.string().min(1),
  enabledModules: z.array(z.string().min(1)).min(1),
  scenarioId: z.string().min(1),
  heroId: z.string().min(1),
  difficulty: z.enum(['explorer', 'standard', 'veteran']),
  state: conquestGameStateV5Schema,
  history: conquestHistoryV5Schema,
});

const volkareCardSchema = z.object({ color: z.enum(['red', 'blue', 'white', 'green', 'wound']), steps: z.union([z.literal(0), z.literal(1), z.literal(2)]) });

export const conquestGameStateV6Schema = conquestGameStateV5Schema.extend({
  schemaVersion: z.literal(6),
  appVersion: z.literal('0.6.0'),
  contentVersion: z.literal('0.6.0'),
  walls: z.array(z.string()),
  adventureClaims: z.record(z.string(), z.array(z.union([z.literal(2), z.literal(4), z.literal(6)]))),
  scenario: conquestGameStateV5Schema.shape.scenario.extend({
    citiesRequired: z.number().int().nonnegative(),
    objectiveKind: z.enum(['cities', 'volkare']),
    volkareArmySize: z.number().int().nonnegative(),
  }),
  ruleRuntime: ruleRuntimeSchema.extend({ ignoreWalls: z.boolean(), allUnitsArmorBonus: z.number().int(), deepMineClaimed: z.boolean() }),
  volkare: z.object({
    position: coordSchema,
    armyEnemyIds: z.array(z.string()),
    deck: z.array(volkareCardSchema),
    discard: z.array(volkareCardSchema),
    revealed: z.boolean(),
    defeated: z.boolean(),
    reachedPortal: z.boolean(),
    lastAction: z.string().optional(),
  }).optional(),
});

const conquestHistoryV6Schema = z.object({
  undoStack: z.array(z.object({ state: conquestGameStateV6Schema, commandCount: z.number().int().nonnegative() })),
  commandLog: z.array(conquestCommandSchema),
  barrierReason: z.string().optional(),
});

export const saveEnvelopeV6Schema = z.object({
  saveSchemaVersion: z.literal(6),
  appVersion: z.literal('0.6.0'),
  slot: z.enum(['conquest-auto', 'conquest-manual-1']),
  savedAt: z.number().int().nonnegative(),
  contentHash: z.string().min(1),
  enabledModules: z.array(z.string().min(1)).min(1),
  scenarioId: z.string().min(1),
  heroId: z.string().min(1),
  difficulty: z.enum(['explorer', 'standard', 'veteran']),
  state: conquestGameStateV6Schema,
  history: conquestHistoryV6Schema,
});

export const conquestGameStateV7Schema = conquestGameStateV6Schema.extend({
  schemaVersion: z.literal(7),
  appVersion: z.literal('0.7.0'),
  contentVersion: z.literal('0.7.0'),
  defeatedThisTurn: z.array(z.string()),
  ruleRuntime: conquestGameStateV6Schema.shape.ruleRuntime.extend({
    ignoreReputation: z.boolean(),
    recruitDiscount: z.number().int().nonnegative(),
    recruitReputationPenalty: z.number().int().nonnegative(),
    harvestOpportunities: z.number().int().nonnegative(),
    ruthlessReadyUnits: z.boolean(),
  }),
});

const conquestHistoryV7Schema = z.object({
  undoStack: z.array(z.object({ state: conquestGameStateV7Schema, commandCount: z.number().int().nonnegative() })),
  commandLog: z.array(conquestCommandSchema),
  barrierReason: z.string().optional(),
});

export const saveEnvelopeV7Schema = z.object({
  saveSchemaVersion: z.literal(7),
  appVersion: z.literal('0.7.0'),
  slot: z.enum(['conquest-auto', 'conquest-manual-1']),
  savedAt: z.number().int().nonnegative(),
  contentHash: z.string().min(1),
  enabledModules: z.array(z.string().min(1)).min(1),
  scenarioId: z.string().min(1),
  heroId: z.string().min(1),
  difficulty: z.enum(['explorer', 'standard', 'veteran']),
  state: conquestGameStateV7Schema,
  history: conquestHistoryV7Schema,
});

const factionIdSchema = z.enum(['elementalist', 'dark-crusader']);

export const conquestGameStateV8Schema = conquestGameStateV7Schema.extend({
  schemaVersion: z.literal(8),
  appVersion: z.literal('0.8.0'),
  contentVersion: z.literal('0.8.0'),
  overlays: z.record(z.string(), z.object({ definitionId: z.string().min(1), position: coordSchema, liberated: z.boolean(), sealed: z.boolean() })),
  factionLeaders: z.record(z.string(), z.looseObject({
    definitionId: z.string().min(1), position: coordSchema.optional(), level: z.number().int().nonnegative(), initialLevel: z.number().int().positive(), defeated: z.boolean(), guardEnemyIds: z.array(z.string()),
  })),
  factionTokens: z.object({
    decks: z.record(factionIdSchema, z.array(z.string())), discards: z.record(factionIdSchema, z.array(z.string())), inventory: z.array(z.string()), usedNamesThisTurn: z.array(z.string()),
  }),
  scenario: conquestGameStateV7Schema.shape.scenario.extend({
    objectiveKind: z.enum(['cities', 'volkare', 'faction-leaders', 'necromancer', 'relics']),
    leadersRequired: z.number().int().nonnegative(), leadersDefeated: z.number().int().nonnegative(),
    graveyardsRequired: z.number().int().nonnegative(), graveyardsSealed: z.number().int().nonnegative(),
    relicsRequired: z.number().int().nonnegative(), relicsFound: z.number().int().nonnegative(),
  }),
  ruleRuntime: conquestGameStateV7Schema.shape.ruleRuntime.extend({
    concealedMovement: z.boolean(), preventNextHeroWound: z.boolean(), discardCombatWounds: z.boolean(), nextAttackRanged: z.boolean(), explorationDiscount: z.number().int().nonnegative(),
  }),
});

const conquestHistoryV8Schema = z.object({
  undoStack: z.array(z.object({ state: conquestGameStateV8Schema, commandCount: z.number().int().nonnegative() })),
  commandLog: z.array(conquestCommandSchema),
  barrierReason: z.string().optional(),
});

export const saveEnvelopeV8Schema = z.object({
  saveSchemaVersion: z.literal(8),
  appVersion: z.literal('0.8.0'),
  slot: z.enum(['conquest-auto', 'conquest-manual-1']),
  savedAt: z.number().int().nonnegative(),
  contentHash: z.string().min(1),
  enabledModules: z.array(z.string().min(1)).min(1),
  scenarioId: z.string().min(1),
  heroId: z.string().min(1),
  difficulty: z.enum(['explorer', 'standard', 'veteran']),
  state: conquestGameStateV8Schema,
  history: conquestHistoryV8Schema,
});

export const saveEnvelopeSchema = z.union([saveEnvelopeV1Schema, saveEnvelopeV2Schema, saveEnvelopeV3Schema, saveEnvelopeV4Schema, saveEnvelopeV5Schema, saveEnvelopeV6Schema, saveEnvelopeV7Schema, saveEnvelopeV8Schema]);

export type SaveEnvelope = z.infer<typeof saveEnvelopeSchema>;
export type SaveEnvelopeV2 = z.infer<typeof saveEnvelopeV2Schema>;
export type SaveEnvelopeV3 = z.infer<typeof saveEnvelopeV3Schema>;
export type SaveEnvelopeV4 = z.infer<typeof saveEnvelopeV4Schema>;
export type SaveEnvelopeV5 = z.infer<typeof saveEnvelopeV5Schema>;
export type SaveEnvelopeV6 = z.infer<typeof saveEnvelopeV6Schema>;
export type SaveEnvelopeV7 = z.infer<typeof saveEnvelopeV7Schema>;
export type SaveEnvelopeV8 = z.infer<typeof saveEnvelopeV8Schema>;

export function parseSaveEnvelope(value: unknown): SaveEnvelope {
  return saveEnvelopeSchema.parse(value);
}

export function parseConquestSaveEnvelope(value: unknown): SaveEnvelopeV2 | SaveEnvelopeV3 | SaveEnvelopeV4 | SaveEnvelopeV5 | SaveEnvelopeV6 | SaveEnvelopeV7 | SaveEnvelopeV8 {
  const parsed = saveEnvelopeSchema.parse(value);
  if (parsed.saveSchemaVersion === 1) throw new Error('v0.1 教学存档不能迁移为征服模式；请保留在教学模式中或开始新征服。');
  return parsed;
}
