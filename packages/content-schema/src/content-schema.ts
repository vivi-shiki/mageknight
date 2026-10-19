import { z } from 'zod';

const idSchema = z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/);
const versionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
const sourcedSchema = z.object({ id: idSchema, name: z.string().min(1), source: z.string().min(1) });
const effectSchema = z.object({
  resource: z.enum(['move', 'influence', 'attack', 'block', 'heal']),
  amount: z.number().positive(),
  attackKind: z.enum(['normal', 'ranged', 'siege']).optional(),
  element: z.enum(['physical', 'fire', 'ice']).optional(),
});
const spaceSchema = z.object({
  q: z.number().int(),
  r: z.number().int(),
  terrain: z.enum(['plains', 'forest', 'hills', 'desert', 'wasteland', 'mountain', 'lake']),
  site: idSchema.optional(),
  enemyId: idSchema.optional(),
});

const scenarioSchema = sourcedSchema.extend({
  roundLimit: z.number().int().positive(),
  win: z.string().min(1),
  loss: z.string().min(1),
  tutorialSteps: z.array(z.string().min(1)).min(1),
});
const cardSchema = sourcedSchema.extend({ color: z.enum(['red', 'blue', 'white', 'green']), kind: z.enum(['basic', 'advanced', 'spell', 'wound']), basic: effectSchema.optional(), strong: effectSchema.optional(), assetAlias: z.string().min(1) });
const enemySchema = sourcedSchema.extend({ armor: z.number().positive(), attack: z.array(z.number().positive()), attackElement: z.enum(['physical', 'fire', 'ice']), resistances: z.array(z.enum(['physical', 'fire', 'ice'])), abilities: z.array(z.enum(['swift', 'brutal', 'poison', 'fortified', 'multi-attack'])), fame: z.number().nonnegative(), assetAlias: z.string().min(1) });
const unitSchema = sourcedSchema.extend({ level: z.number().positive(), armor: z.number().positive(), influenceCost: z.number().nonnegative(), ability: effectSchema, assetAlias: z.string().min(1) });
const tileSchema = z.object({ id: idSchema, name: z.string().min(1), source: z.string().min(1), spaces: z.array(spaceSchema).length(7) });

export const contentModuleManifestSchema = z.object({
  id: idSchema,
  version: versionSchema,
  requires: z.array(idSchema),
  conflicts: z.array(idSchema),
  hero: sourcedSchema.optional(),
  scenario: scenarioSchema.optional(),
  cards: z.array(cardSchema).default([]),
  basicDeck: z.array(idSchema).default([]),
  enemies: z.array(enemySchema).default([]),
  units: z.array(unitSchema).default([]),
  sites: z.array(sourcedSchema).default([]),
  mapTiles: z.array(tileSchema).default([]),
  rewards: z.array(idSchema).default([]),
});

export const contentManifestSchema = contentModuleManifestSchema.superRefine((manifest, context) => {
  if (manifest.version !== '0.1.0') context.addIssue({ code: 'custom', path: ['version'], message: 'Tutorial manifest version must be 0.1.0.' });
  if (!manifest.hero) context.addIssue({ code: 'custom', path: ['hero'], message: 'Tutorial hero is required.' });
  if (!manifest.scenario) context.addIssue({ code: 'custom', path: ['scenario'], message: 'Tutorial scenario is required.' });
  if (manifest.basicDeck.length !== 16) context.addIssue({ code: 'custom', path: ['basicDeck'], message: 'Tutorial basic deck must contain 16 cards.' });
});

export type ContentManifest = z.infer<typeof contentManifestSchema>;
export type ContentModuleManifest = z.infer<typeof contentModuleManifestSchema>;

function entityList(manifest: ContentModuleManifest) {
  return [...(manifest.hero ? [manifest.hero] : []), ...(manifest.scenario ? [manifest.scenario] : []), ...manifest.cards, ...manifest.enemies, ...manifest.units, ...manifest.sites, ...manifest.mapTiles];
}

export function lintContentModuleManifest(value: unknown): string[] {
  const parsed = contentModuleManifestSchema.safeParse(value);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  const manifest = parsed.data;
  const errors: string[] = [];
  const allIds = entityList(manifest).map((entity) => entity.id);
  if (new Set(allIds).size !== allIds.length) errors.push('All manifest entity IDs must be unique.');
  const entityIds = new Set(allIds);
  for (const cardId of manifest.basicDeck) if (!entityIds.has(cardId)) errors.push(`Basic deck references missing card ${cardId}.`);
  for (const tile of manifest.mapTiles) {
    for (const space of tile.spaces) {
      if (space.enemyId && !entityIds.has(space.enemyId)) errors.push(`${tile.id} references missing enemy ${space.enemyId}.`);
      if (space.site && !entityIds.has(space.site)) errors.push(`${tile.id} references missing site ${space.site}.`);
    }
  }
  for (const reward of manifest.rewards) if (!entityIds.has(reward)) errors.push(`Missing reward ${reward}.`);
  if (JSON.stringify(manifest).match(/TBD|TODO|temporary|temp-id/i)) errors.push('Manifest contains unfinished placeholder data.');
  return errors;
}

export function lintContentManifest(value: unknown): string[] {
  const parsed = contentManifestSchema.safeParse(value);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  const manifest = parsed.data;
  const errors = lintContentModuleManifest(manifest);
  if (manifest.cards.filter((card) => card.kind === 'basic').length !== 16) errors.push('v0.1 must contain exactly 16 basic action cards.');
  return errors;
}

const conquestAbilitySchema = z.enum([
  'swift', 'brutal', 'poison', 'fortified', 'multi-attack', 'paralyze', 'summon',
  'elusive', 'unfortified', 'arcane-immunity', 'assassination', 'cumbersome',
]);
const conquestSiteKindSchema = z.enum(['village', 'monastery', 'keep', 'mage-tower', 'crystal-mine', 'magical-glade', 'city']);
const marketKindSchema = z.enum(['advanced', 'spell', 'unit', 'artifact']);

export const conquestContentManifestSchema = z.object({
  id: idSchema,
  version: z.literal('0.2.0'),
  requires: z.array(idSchema),
  conflicts: z.array(idSchema),
  scenario: sourcedSchema.extend({
    roundLimit: z.number().int().positive(),
    tilesToCity: z.number().int().positive(),
    cityLevelByDifficulty: z.object({ explorer: z.number().int().positive(), standard: z.number().int().positive(), veteran: z.number().int().positive() }),
    objective: z.string().min(1),
  }),
  tactics: z.array(sourcedSchema.extend({ time: z.enum(['day', 'night']), initiative: z.number().int().min(1).max(6), effect: z.enum(['draw-one', 'move-one', 'influence-one', 'reroll-source', 'heal-one', 'none']) })),
  skills: z.array(sourcedSchema.extend({ description: z.string().min(1), resource: z.enum(['move', 'influence', 'attack', 'block', 'heal']).optional(), amount: z.number().positive().optional(), oncePerRound: z.boolean(), assetAlias: z.string().min(1) })),
  cards: z.array(cardSchema),
  units: z.array(unitSchema.extend({ tier: z.enum(['regular', 'elite']), siteKinds: z.array(conquestSiteKindSchema).min(1), resistances: z.array(z.enum(['physical', 'fire', 'ice', 'cold-fire'])).default([]) })),
  enemies: z.array(enemySchema.omit({ abilities: true, attackElement: true }).extend({ pool: z.enum(['green', 'gray', 'brown', 'violet', 'city']), attackElement: z.enum(['physical', 'fire', 'ice', 'cold-fire']), abilities: z.array(conquestAbilitySchema) })),
  sites: z.array(sourcedSchema.extend({ kind: conquestSiteKindSchema, fortified: z.boolean(), recruit: z.boolean(), healCost: z.number().positive().optional(), reward: marketKindSchema.optional(), assetAlias: z.string().min(1) })),
  tiles: z.array(sourcedSchema.extend({
    kind: z.enum(['start', 'countryside', 'core']),
    terrains: z.array(spaceSchema.shape.terrain).length(7),
    site: z.object({ index: z.number().int().min(0).max(6), definitionId: idSchema }).optional(),
    enemies: z.array(z.object({ index: z.number().int().min(0).max(6), pool: z.enum(['green', 'gray', 'brown', 'violet', 'city']) })),
    assetAlias: z.string().min(1),
  })),
});

export type ConquestContentManifest = z.infer<typeof conquestContentManifestSchema>;

export function lintConquestContentManifest(value: unknown): string[] {
  const parsed = conquestContentManifestSchema.safeParse(value);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  const manifest = parsed.data;
  const errors: string[] = [];
  const ids = [manifest.scenario.id, ...manifest.tactics.map((item) => item.id), ...manifest.skills.map((item) => item.id), ...manifest.cards.map((item) => item.id), ...manifest.units.map((item) => item.id), ...manifest.enemies.map((item) => item.id), ...manifest.sites.map((item) => item.id), ...manifest.tiles.map((item) => item.id)];
  if (new Set(ids).size !== ids.length) errors.push('All v0.2 entity IDs must be unique.');
  const siteIds = new Set(manifest.sites.map((site) => site.id));
  for (const tile of manifest.tiles) if (tile.site && !siteIds.has(tile.site.definitionId)) errors.push(`${tile.id} references missing site ${tile.site.definitionId}.`);
  for (const time of ['day', 'night'] as const) {
    const values = manifest.tactics.filter((tactic) => tactic.time === time).map((tactic) => tactic.initiative);
    if (values.length !== 6 || new Set(values).size !== 6) errors.push(`${time} tactics must contain six unique initiative values.`);
  }
  if (manifest.cards.filter((card) => card.kind === 'advanced').length < 20) errors.push('v0.2 needs 12 advanced actions and 8 artifact cards.');
  if (manifest.cards.filter((card) => card.kind === 'spell').length < 8) errors.push('v0.2 needs at least 8 spells.');
  if (manifest.units.filter((unit) => unit.tier === 'regular').length < 12 || manifest.units.filter((unit) => unit.tier === 'elite').length < 8) errors.push('v0.2 unit counts are incomplete.');
  for (const pool of ['green', 'gray', 'brown', 'violet', 'city'] as const) if (manifest.enemies.filter((enemy) => enemy.pool === pool).length < 4) errors.push(`${pool} enemy pool needs at least four entries.`);
  if (manifest.tiles.filter((tile) => tile.kind === 'start').length !== 1) errors.push('v0.2 needs exactly one start tile.');
  if (manifest.tiles.filter((tile) => tile.kind === 'countryside').length < 4 || manifest.tiles.filter((tile) => tile.kind === 'core').length < 2) errors.push('v0.2 map tile counts are incomplete.');
  return errors;
}

const coreHeroSchema = sourcedSchema.extend({
  sourceRef: z.string().min(1),
  armor: z.number().int().positive(),
  handLimit: z.number().int().positive(),
  commandSlots: z.number().int().positive(),
  basicDeck: z.array(idSchema).length(16),
  skillIds: z.array(idSchema).min(1),
  assetAlias: z.string().min(1),
});

const coreScenarioSchema = sourcedSchema.extend({
  sourceRef: z.string().min(1),
  roundLimit: z.number().int().positive(),
  countrysideTileCount: z.number().int().nonnegative(),
  coreNonCityTileCount: z.number().int().nonnegative(),
  coreCityTileCount: z.number().int().nonnegative(),
  cityLevelsByDifficulty: z.object({
    explorer: z.array(z.number().int().positive()),
    standard: z.array(z.number().int().positive()),
    veteran: z.array(z.number().int().positive()),
  }),
  citiesRequired: z.number().int().positive(),
  finalTurnAfterObjective: z.boolean(),
  objective: z.string().min(1),
});

export const coreContentManifestV3Schema = z.object({
  id: idSchema,
  version: z.literal('0.3.0'),
  requires: z.array(idSchema),
  conflicts: z.array(idSchema),
  heroes: z.array(coreHeroSchema).length(4),
  scenarios: z.array(coreScenarioSchema).min(2),
  cards: z.array(cardSchema),
  skills: z.array(sourcedSchema.extend({
    sourceRef: z.string().min(1),
    description: z.string().min(1),
    resource: z.enum(['move', 'influence', 'attack', 'block', 'heal']),
    amount: z.number().positive(),
    oncePerRound: z.boolean(),
    assetAlias: z.string().min(1),
  })),
  units: z.array(unitSchema.extend({
    tier: z.enum(['regular', 'elite']),
    siteKinds: z.array(conquestSiteKindSchema).min(1),
    resistances: z.array(z.enum(['physical', 'fire', 'ice', 'cold-fire'])).default([]),
  })),
  tiles: z.array(sourcedSchema.extend({
    kind: z.enum(['countryside', 'core']),
    terrains: z.array(spaceSchema.shape.terrain).length(7),
    site: z.object({ index: z.number().int().min(0).max(6), definitionId: idSchema }).optional(),
    enemies: z.array(z.object({ index: z.number().int().min(0).max(6), pool: z.enum(['green', 'gray', 'brown', 'violet', 'city']) })),
    assetAlias: z.string().min(1),
  })),
  advancedDeck: z.array(idSchema).length(16),
  spellDeck: z.array(idSchema).length(16),
  artifactDeck: z.array(idSchema).length(16),
  regularUnitDeck: z.array(idSchema).length(20),
  eliteUnitDeck: z.array(idSchema).length(20),
});

export type CoreContentManifestV3 = z.infer<typeof coreContentManifestV3Schema>;

export function lintCoreContentManifestV3(value: unknown, inheritedIds: Iterable<string> = []): string[] {
  const parsed = coreContentManifestV3Schema.safeParse(value);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  const manifest = parsed.data;
  const errors: string[] = [];
  const inherited = new Set(inheritedIds);
  const localIds = [
    ...manifest.heroes.map((item) => item.id),
    ...manifest.scenarios.map((item) => item.id),
    ...manifest.cards.map((item) => item.id),
    ...manifest.skills.map((item) => item.id),
    ...manifest.units.map((item) => item.id),
    ...manifest.tiles.map((item) => item.id),
  ];
  if (new Set(localIds).size !== localIds.length) errors.push('All v0.3 local entity IDs must be unique.');
  const available = new Set([...inherited, ...localIds]);
  for (const hero of manifest.heroes) {
    for (const id of hero.basicDeck) if (!available.has(id)) errors.push(`${hero.id} references missing basic card ${id}.`);
    for (const id of hero.skillIds) if (!available.has(id)) errors.push(`${hero.id} references missing skill ${id}.`);
  }
  for (const [name, deck] of Object.entries({ advancedDeck: manifest.advancedDeck, spellDeck: manifest.spellDeck, artifactDeck: manifest.artifactDeck, regularUnitDeck: manifest.regularUnitDeck, eliteUnitDeck: manifest.eliteUnitDeck })) {
    for (const id of deck) if (!available.has(id)) errors.push(`${name} references missing entity ${id}.`);
  }
  for (const scenario of manifest.scenarios) {
    for (const difficulty of ['explorer', 'standard', 'veteran'] as const) {
      if (scenario.cityLevelsByDifficulty[difficulty].length !== scenario.citiesRequired) errors.push(`${scenario.id} ${difficulty} city levels must match citiesRequired.`);
    }
  }
  if (JSON.stringify(manifest).match(/TBD|TODO|temporary|temp-id/i)) errors.push('v0.3 manifest contains unfinished placeholder data.');
  return errors;
}

const effectResourceSchema = z.object({
  resource: z.enum(['move', 'influence', 'attack', 'block', 'heal']),
  amount: z.number().positive(),
  attackKind: z.enum(['normal', 'ranged', 'siege']).optional(),
  element: z.enum(['physical', 'fire', 'ice', 'cold-fire']).optional(),
});

export const effectNodeSchema: z.ZodType = z.lazy(() => z.union([
  effectResourceSchema,
  z.object({ type: z.literal('sequence'), effects: z.array(effectNodeSchema).min(1) }),
  z.object({ type: z.literal('spend-mana'), color: z.enum(['red', 'blue', 'white', 'green', 'gold', 'black']), amount: z.number().int().positive() }),
  z.object({ type: z.literal('repeat'), times: z.number().int().positive(), effect: effectNodeSchema }),
  z.object({ type: z.literal('draw'), amount: z.number().int().positive() }),
  z.object({ type: z.literal('discard'), amount: z.number().int().positive(), filter: z.enum(['wound', 'non-wound', 'any']).optional() }),
  z.object({ type: z.literal('convert'), from: z.enum(['move', 'influence', 'attack', 'block', 'heal']), to: z.enum(['move', 'influence', 'attack', 'block', 'heal']), amount: z.number().positive() }),
  z.object({ type: z.literal('choose-one'), options: z.array(effectNodeSchema).min(2), labels: z.array(z.string().min(1)).optional() }),
  z.object({ type: z.literal('conditional'), when: z.enum(['day', 'night']), then: effectNodeSchema, otherwise: effectNodeSchema.optional() }),
  z.object({ type: z.literal('create-lasting-effect'), effect: z.enum(['hand-limit', 'armor', 'reputation', 'resource']), amount: z.number(), expires: z.enum(['end-turn', 'start-next-turn', 'end-round']) }),
  z.object({ type: z.literal('gain-crystal'), color: z.enum(['red', 'blue', 'white', 'green']), amount: z.number().int().positive() }),
  z.object({ type: z.literal('gain-mana'), color: z.enum(['red', 'blue', 'white', 'green', 'gold', 'black']), amount: z.number().int().positive() }),
  z.object({ type: z.literal('take-wound'), amount: z.number().int().positive() }),
  z.object({ type: z.literal('adjust-track'), track: z.enum(['fame', 'reputation']), amount: z.number().int() }),
  z.object({ type: z.literal('refresh-unit'), maxLevel: z.number().int().positive().optional(), totalLevels: z.number().int().positive().optional() }),
  z.object({ type: z.literal('modify-enemy'), modifier: z.enum(['armor', 'attack', 'skip-attack', 'remove-fortification', 'remove-resistance', 'destroy']), amount: z.number().int().optional(), scope: z.enum(['target', 'all']).optional(), expires: z.enum(['end-combat', 'end-turn']) }),
  z.object({ type: z.literal('terrain-cost'), terrains: z.array(spaceSchema.shape.terrain).min(1), mode: z.enum(['set', 'reduce']), amount: z.number().nonnegative(), minimum: z.number().nonnegative().optional(), allowLake: z.boolean().optional(), expires: z.literal('end-turn') }),
  z.object({ type: z.literal('special'), rule: z.string().min(1), target: z.enum(['enemy', 'unit', 'hand-card']).optional() }),
]));

const implementationSchema = z.enum(['full', 'modeled']);

export const rulesContentManifestV4Schema = z.object({
  id: idSchema,
  version: z.literal('0.4.0'),
  requires: z.array(idSchema).min(1),
  conflicts: z.array(idSchema),
  cardRules: z.array(z.object({
    id: idSchema,
    sourceRef: z.string().min(1),
    basicText: z.string().min(1),
    strongText: z.string().min(1),
    basicEffect: effectNodeSchema,
    strongEffect: effectNodeSchema,
    implementation: implementationSchema,
  })),
  unitRules: z.array(z.object({
    id: idSchema,
    sourceRef: z.string().min(1),
    implementation: implementationSchema,
    abilities: z.array(z.object({ label: z.string().min(1), text: z.string().min(1), effect: effectNodeSchema })).min(1),
  })),
  skillRules: z.array(z.object({
    id: idSchema,
    sourceRef: z.string().min(1),
    ruleText: z.string().min(1),
    effect: effectNodeSchema,
    implementation: implementationSchema,
  })),
});

export type RulesContentManifestV4 = z.infer<typeof rulesContentManifestV4Schema>;

export type RulesCoverageExpected = { cardIds: Iterable<string>; unitIds: Iterable<string>; skillIds: Iterable<string> };

export function lintRulesContentManifestV4(value: unknown, expected?: RulesCoverageExpected): string[] {
  const parsed = rulesContentManifestV4Schema.safeParse(value);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  const manifest = parsed.data;
  const errors: string[] = [];
  const groups = [manifest.cardRules, manifest.unitRules, manifest.skillRules];
  for (const group of groups) {
    const ids = group.map((item) => item.id);
    if (new Set(ids).size !== ids.length) errors.push('v0.4 rule IDs must be unique within each entity type.');
  }
  if (expected) {
    for (const [name, actual, required] of [
      ['card', new Set(manifest.cardRules.map((item) => item.id)), new Set(expected.cardIds)],
      ['unit', new Set(manifest.unitRules.map((item) => item.id)), new Set(expected.unitIds)],
      ['skill', new Set(manifest.skillRules.map((item) => item.id)), new Set(expected.skillIds)],
    ] as const) {
      for (const id of required) if (!actual.has(id)) errors.push(`v0.4 ${name} coverage is missing ${id}.`);
      for (const id of actual) if (!required.has(id)) errors.push(`v0.4 ${name} coverage contains unknown ${id}.`);
    }
  }
  if (JSON.stringify(manifest).match(/TBD|TODO|placeholder|temporary|temp-id/i)) errors.push('v0.4 rules contain unfinished placeholder data.');
  return errors;
}

export const rulesContentManifestV5Schema = rulesContentManifestV4Schema.extend({ version: z.literal('0.5.0') });
export type RulesContentManifestV5 = z.infer<typeof rulesContentManifestV5Schema>;

const V5_SPECIAL_RULES = new Set([
  'combat-move-to-attack', 'combat-move-to-ranged-attack', 'refreshing-walk-basic', 'refreshing-walk-strong',
  'pay-blue-for-free-lakes', 'choose-one-mana', 'choose-two-mana', 'choose-mana-colors-and-optional-crystal',
  'recruit-reputation-bonus', 'recruit-fame-reputation-bonus', 'forest-heal-bonus', 'forest-heal-ready-bonus',
  'plus-two-per-enemy', 'space-bending-movement', 'time-bending-extra-turn', 'return-random-discard-cards',
  'return-chosen-discard-cards', 'wings-of-wind-movement', 'additional-skip-targets-for-move', 'skip-up-to-three-enemies',
  'double-armor-reduction-if-fortified', 'successful-block-fire-attack', 'successful-block-destroy',
  'use-unit-offer-ability', 'recruit-unit-free', 'underground-travel', 'underground-assault',
  'assign-banner-of-glory', 'all-units-glory-bonus', 'assign-banner-of-fear', 'assign-banner-of-protection', 'assign-banner-of-courage',
  'remove-turn-wounds', 'ready-all-units', 'endless-red-black-mana', 'endless-blue-black-mana',
  'endless-white-black-mana', 'endless-green-black-mana', 'discard-cards-for-attack', 'double-physical-attacks',
  'risk-wound-die', 'risk-wound-dice', 'roll-two-crystals', 'fame-per-heal-spent',
  'draw-per-hand-wound-healed', 'exchange-action-for-advanced', 'exchange-action-for-spell',
  'sun-amulet-night-rules', 'darkness-amulet-day-rules', 'double-against-swiftness',
  'wound-activating-unit', 'all-units-all-resistances', 'convert-all-attacks', 'night-only',
]);

export function lintRulesContentManifestV5(value: unknown, expected?: RulesCoverageExpected): string[] {
  const parsed = rulesContentManifestV5Schema.safeParse(value);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  const manifest = parsed.data;
  const errors: string[] = [];
  const groups = [manifest.cardRules, manifest.unitRules, manifest.skillRules];
  for (const group of groups) {
    const ids = group.map((item) => item.id);
    if (new Set(ids).size !== ids.length) errors.push('v0.5 rule IDs must be unique within each entity type.');
    for (const item of group) if (item.implementation !== 'full') errors.push(`v0.5 requires full implementation for ${item.id}.`);
  }
  if (expected) {
    for (const [name, actual, required] of [
      ['card', new Set(manifest.cardRules.map((item) => item.id)), new Set(expected.cardIds)],
      ['unit', new Set(manifest.unitRules.map((item) => item.id)), new Set(expected.unitIds)],
      ['skill', new Set(manifest.skillRules.map((item) => item.id)), new Set(expected.skillIds)],
    ] as const) {
      for (const id of required) if (!actual.has(id)) errors.push(`v0.5 ${name} coverage is missing ${id}.`);
      for (const id of actual) if (!required.has(id)) errors.push(`v0.5 ${name} coverage contains unknown ${id}.`);
    }
  }
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (record.type === 'special' && typeof record.rule === 'string' && !V5_SPECIAL_RULES.has(record.rule)) errors.push(`v0.5 contains unknown special rule ${record.rule}.`);
    for (const value of Object.values(record)) if (Array.isArray(value)) value.forEach(walk); else walk(value);
  };
  walk(manifest);
  return [...new Set(errors)];
}

const enemyPoolV6Schema = z.enum(['green', 'gray', 'brown', 'violet', 'city', 'red', 'white']);
const siteKindV6Schema = z.enum(['village', 'monastery', 'keep', 'mage-tower', 'crystal-mine', 'magical-glade', 'city', 'maze', 'labyrinth', 'deep-mine', 'refugee-camp', 'volkare-camp']);
const difficultyNumbersSchema = z.object({ explorer: z.number().int().positive(), standard: z.number().int().positive(), veteran: z.number().int().positive() });

export const lostLegionContentManifestV6Schema = z.object({
  id: idSchema,
  version: z.literal('0.6.0'),
  requires: z.array(idSchema).min(1),
  conflicts: z.array(idSchema),
  hero: z.object({
    id: idSchema, name: z.string().min(1), armor: z.number().int().positive(), handLimit: z.number().int().positive(), commandSlots: z.number().int().positive(),
    basicDeck: z.array(idSchema).length(16), skillIds: z.array(idSchema).length(9), assetAlias: z.string().min(1), sourceRef: z.string().min(1),
  }),
  scenarios: z.array(z.object({
    id: idSchema, name: z.string().min(1), roundLimit: z.number().int().positive(), countrysideTileCount: z.number().int().nonnegative(), coreNonCityTileCount: z.number().int().nonnegative(), coreCityTileCount: z.number().int().nonnegative(),
    cityLevelsByDifficulty: z.object({ explorer: z.array(z.number().int().positive()), standard: z.array(z.number().int().positive()), veteran: z.array(z.number().int().positive()) }),
    citiesRequired: z.number().int().nonnegative(), finalTurnAfterObjective: z.boolean(), objective: z.string().min(1), objectiveKind: z.literal('volkare'), volkareArmyByDifficulty: difficultyNumbersSchema, sourceRef: z.string().min(1),
  })).min(1),
  cards: z.array(z.object({
    id: idSchema, name: z.string().min(1), color: z.enum(['red', 'blue', 'white', 'green']), kind: z.enum(['basic', 'advanced', 'spell']), deck: z.enum(['hero', 'advanced', 'spell', 'artifact']),
    basicText: z.string().min(1), strongText: z.string().min(1), basicEffect: effectNodeSchema, strongEffect: effectNodeSchema,
    sourceRef: z.string().min(1), implementation: z.literal('full'), assetAlias: z.string().min(1), copies: z.number().int().positive().default(1),
  })).min(26),
  units: z.array(z.object({
    id: idSchema, name: z.string().min(1), level: z.number().int().positive(), armor: z.number().int().positive(), influenceCost: z.number().int().positive(), tier: z.enum(['regular', 'elite']), copies: z.number().int().positive(),
    siteKinds: z.array(siteKindV6Schema).min(1), resistances: z.array(z.enum(['physical', 'fire', 'ice', 'cold-fire'])), abilities: z.array(z.object({ label: z.string().min(1), text: z.string().min(1), effect: effectNodeSchema })).min(1),
    sourceRef: z.string().min(1), implementation: z.literal('full'), assetAlias: z.string().min(1),
  })).min(7),
  skills: z.array(z.object({ id: idSchema, name: z.string().min(1), description: z.string().min(1), ruleText: z.string().min(1), effect: effectNodeSchema, oncePerRound: z.boolean(), sourceRef: z.string().min(1), implementation: z.literal('full'), assetAlias: z.string().min(1) })).length(9),
  enemies: z.array(z.object({
    id: idSchema, name: z.string().min(1), pool: enemyPoolV6Schema, copies: z.number().int().positive(), armor: z.number().int().positive(), elusiveArmor: z.number().int().positive().optional(), attack: z.array(z.number().int().nonnegative()).min(1),
    attackElement: z.enum(['physical', 'fire', 'ice', 'cold-fire']), resistances: z.array(z.enum(['physical', 'fire', 'ice', 'cold-fire'])),
    abilities: z.array(z.enum(['swift', 'brutal', 'poison', 'fortified', 'multi-attack', 'paralyze', 'summon', 'elusive', 'unfortified', 'arcane-immunity', 'assassination', 'cumbersome'])),
    fame: z.number().int().nonnegative(), sourceRef: z.string().min(1), assetAlias: z.string().min(1),
  })).min(15),
  sites: z.array(z.object({ id: idSchema, kind: siteKindV6Schema, name: z.string().min(1), fortified: z.boolean(), recruit: z.boolean(), healCost: z.number().int().positive().optional(), reward: z.enum(['advanced', 'spell', 'unit', 'artifact']).optional(), assetAlias: z.string().min(1) })).min(5),
  tiles: z.array(z.object({
    id: idSchema, name: z.string().min(1), kind: z.enum(['countryside', 'core']), terrains: z.array(spaceSchema.shape.terrain).length(7),
    site: z.object({ index: z.number().int().min(0).max(6), definitionId: idSchema }).optional(), enemies: z.array(z.object({ index: z.number().int().min(0).max(6), pool: enemyPoolV6Schema })),
    walls: z.array(z.tuple([z.number().int().min(0).max(6), z.number().int().min(0).max(6)])).optional(), assetAlias: z.string().min(1),
  })).min(6),
});

export type LostLegionContentManifestV6 = z.infer<typeof lostLegionContentManifestV6Schema>;

export function lintLostLegionContentManifestV6(value: unknown): string[] {
  const parsed = lostLegionContentManifestV6Schema.safeParse(value);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  const manifest = parsed.data;
  const ids = [manifest.hero.id, ...manifest.cards.map((item) => item.id), ...manifest.units.map((item) => item.id), ...manifest.skills.map((item) => item.id), ...manifest.enemies.map((item) => item.id), ...manifest.sites.map((item) => item.id), ...manifest.tiles.map((item) => item.id), ...manifest.scenarios.map((item) => item.id)];
  const errors: string[] = [];
  if (new Set(ids).size !== ids.length) errors.push('v0.6 Lost Legion entity IDs must be globally unique.');
  const cardIds = new Set(manifest.cards.map((card) => card.id));
  for (const id of manifest.hero.basicDeck) if (!cardIds.has(id) && !id.startsWith('core.card.')) errors.push(`Wolfhawk deck references unknown card ${id}.`);
  const skillIds = new Set(manifest.skills.map((skill) => skill.id));
  for (const id of manifest.hero.skillIds) if (!skillIds.has(id)) errors.push(`Wolfhawk references unknown skill ${id}.`);
  if (JSON.stringify(manifest).match(/TBD|TODO|placeholder|temporary|temp-id/i)) errors.push('v0.6 Lost Legion content contains unfinished data.');
  return errors;
}

export const krangContentManifestV7Schema = z.object({
  id: idSchema,
  version: z.literal('0.7.0'),
  requires: z.array(idSchema).min(1),
  conflicts: z.array(idSchema),
  hero: z.object({
    id: idSchema, name: z.string().min(1), armor: z.number().int().positive(), handLimit: z.number().int().positive(), commandSlots: z.number().int().positive(),
    basicDeck: z.array(idSchema).length(16), skillIds: z.array(idSchema).length(9), assetAlias: z.string().min(1), sourceRef: z.string().min(1),
  }),
  cards: z.array(z.object({
    id: idSchema, name: z.string().min(1), color: z.enum(['red', 'blue', 'white', 'green']), kind: z.literal('basic'),
    basicText: z.string().min(1), strongText: z.string().min(1), basicEffect: effectNodeSchema, strongEffect: effectNodeSchema,
    sourceRef: z.string().min(1), implementation: z.literal('full'), assetAlias: z.string().min(1),
  })).length(2),
  skills: z.array(z.object({
    id: idSchema, name: z.string().min(1), description: z.string().min(1), ruleText: z.string().min(1), effect: effectNodeSchema,
    oncePerRound: z.boolean(), flipBackCondition: z.enum(['rest', 'action', 'pay-green']).optional(),
    sourceRef: z.string().min(1), implementation: z.literal('full'), assetAlias: z.string().min(1),
  })).length(9),
});

export type KrangContentManifestV7 = z.infer<typeof krangContentManifestV7Schema>;

export function lintKrangContentManifestV7(value: unknown): string[] {
  const parsed = krangContentManifestV7Schema.safeParse(value);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  const manifest = parsed.data;
  const ids = [manifest.hero.id, ...manifest.cards.map((card) => card.id), ...manifest.skills.map((skill) => skill.id)];
  const errors: string[] = [];
  if (new Set(ids).size !== ids.length) errors.push('v0.7 Krang entity IDs must be globally unique.');
  const availableCards = new Set([...manifest.cards.map((card) => card.id),
    'core.card.determination-1', 'core.card.crystallize', 'core.card.rage-1', 'core.card.rage-2',
    'core.card.swiftness-1', 'core.card.swiftness-2', 'core.card.stamina-1', 'core.card.stamina-2',
    'core.card.tranquility', 'core.card.mana-draw', 'core.card.hero.improvisation', 'core.card.march-1',
    'core.card.concentration', 'core.card.promise']);
  for (const id of manifest.hero.basicDeck) if (!availableCards.has(id)) errors.push(`Krang deck references unknown card ${id}.`);
  const skillIds = new Set(manifest.skills.map((skill) => skill.id));
  for (const id of manifest.hero.skillIds) if (!skillIds.has(id)) errors.push(`Krang references unknown skill ${id}.`);
  if (JSON.stringify(manifest).match(/TBD|TODO|placeholder|temporary|temp-id/i)) errors.push('v0.7 Krang content contains unfinished data.');
  return errors;
}

const tezlaFactionSchema = z.enum(['elementalist', 'dark-crusader']);
const tezlaAbilitySchema = z.enum([
  'swift', 'brutal', 'poison', 'fortified', 'multi-attack', 'paralyze', 'summon',
  'elusive', 'unfortified', 'arcane-immunity', 'assassination', 'cumbersome',
  'defend', 'vampiric', 'ambush', 'pursuit',
]);

export const shadesOfTezlaContentManifestV8Schema = z.object({
  id: idSchema,
  version: z.literal('0.8.0'),
  requires: z.array(idSchema).min(1),
  conflicts: z.array(idSchema),
  hero: z.object({
    id: idSchema, name: z.string().min(1), armor: z.number().int().positive(), handLimit: z.number().int().positive(), commandSlots: z.number().int().positive(),
    basicDeck: z.array(idSchema).length(16), skillIds: z.array(idSchema).length(9), startingCrystals: z.array(z.enum(['red', 'blue', 'white', 'green'])).length(3),
    assetAlias: z.string().min(1), sourceRef: z.string().min(1),
  }),
  cards: z.array(z.object({
    id: idSchema, name: z.string().min(1), color: z.enum(['red', 'blue', 'white', 'green']), kind: z.literal('basic'),
    basicText: z.string().min(1), strongText: z.string().min(1), basicEffect: effectNodeSchema, strongEffect: effectNodeSchema,
    sourceRef: z.string().min(1), implementation: z.literal('full'), assetAlias: z.string().min(1),
  })).length(2),
  skills: z.array(z.object({
    id: idSchema, name: z.string().min(1), description: z.string().min(1), ruleText: z.string().min(1), effect: effectNodeSchema,
    oncePerRound: z.boolean(), sourceRef: z.string().min(1), implementation: z.literal('full'), assetAlias: z.string().min(1),
  })).length(9),
  enemies: z.array(z.object({
    id: idSchema, name: z.string().min(1), factionId: tezlaFactionSchema, pool: enemyPoolV6Schema, copies: z.number().int().positive(),
    armor: z.number().int().positive(), elusiveArmor: z.number().int().positive().optional(), attack: z.array(z.number().int().nonnegative()).min(1),
    attackElement: z.enum(['physical', 'fire', 'ice', 'cold-fire']), attackElements: z.array(z.enum(['physical', 'fire', 'ice', 'cold-fire'])).optional(),
    resistances: z.array(z.enum(['physical', 'fire', 'ice', 'cold-fire'])), abilities: z.array(tezlaAbilitySchema), defend: z.number().int().positive().optional(),
    fame: z.number().int().nonnegative(), sourceRef: z.string().min(1), assetAlias: z.string().min(1),
  })).length(22),
  factionTokens: z.array(z.object({
    id: idSchema, name: z.string().min(1), factionId: tezlaFactionSchema, copies: z.number().int().positive(),
    kind: z.enum(['heal-or-remove-wound', 'add-element', 'remote-explore', 'prevent-wound', 'swap-skill', 'physical-attack-bonus', 'discard-combat-wounds', 'make-ranged', 'concealed-movement', 'recover-discard', 'swap-source-mana']),
    description: z.string().min(1), element: z.enum(['fire', 'ice']).optional(), assetAlias: z.string().min(1), sourceRef: z.string().min(1),
  })).length(12),
  leaders: z.array(z.object({
    id: idSchema, name: z.string().min(1), factionId: tezlaFactionSchema, assetAlias: z.string().min(1), sourceRef: z.string().min(1),
    levels: z.array(z.object({
      level: z.number().int().min(1).max(12), armor: z.number().int().positive(), attacks: z.array(z.number().int().nonnegative()).min(1),
      attackElements: z.array(z.enum(['physical', 'fire', 'ice', 'cold-fire'])).min(1), abilities: z.array(tezlaAbilitySchema),
      resistances: z.array(z.enum(['physical', 'fire', 'ice', 'cold-fire'])), fame: z.number().int().positive(),
      guards: z.partialRecord(enemyPoolV6Schema, z.number().int().nonnegative()),
    })).length(12),
  })).length(2),
  overlays: z.array(z.object({
    id: idSchema, name: z.string().min(1), kind: z.enum(['hidden-valley', 'necropolis', 'graveyard']), moveCost: z.number().int().positive().optional(),
    nightRules: z.boolean(), assetAlias: z.string().min(1), sourceRef: z.string().min(1),
  })).length(3),
  scenarios: z.array(z.object({
    id: idSchema, name: z.string().min(1), roundLimit: z.number().int().positive(), countrysideTileCount: z.number().int().nonnegative(),
    coreNonCityTileCount: z.number().int().nonnegative(), coreCityTileCount: z.number().int().nonnegative(), cityLevelsByDifficulty: z.object({
      explorer: z.array(z.number().int().positive()), standard: z.array(z.number().int().positive()), veteran: z.array(z.number().int().positive()),
    }), citiesRequired: z.number().int().nonnegative(), finalTurnAfterObjective: z.boolean(), objective: z.string().min(1),
    objectiveKind: z.enum(['faction-leaders', 'necromancer', 'relics']), factionLeaderIds: z.array(idSchema), graveyardsRequired: z.number().int().nonnegative().optional(),
    relicsRequired: z.number().int().nonnegative().optional(), sourceRef: z.string().min(1),
  })).length(4),
});

export type ShadesOfTezlaContentManifestV8 = z.infer<typeof shadesOfTezlaContentManifestV8Schema>;

export function lintShadesOfTezlaContentManifestV8(value: unknown): string[] {
  const parsed = shadesOfTezlaContentManifestV8Schema.safeParse(value);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  const manifest = parsed.data;
  const ids = [manifest.hero.id, ...manifest.cards.map((item) => item.id), ...manifest.skills.map((item) => item.id), ...manifest.enemies.map((item) => item.id), ...manifest.factionTokens.map((item) => item.id), ...manifest.leaders.map((item) => item.id), ...manifest.overlays.map((item) => item.id), ...manifest.scenarios.map((item) => item.id)];
  const errors: string[] = [];
  if (new Set(ids).size !== ids.length) errors.push('v0.8 Shades of Tezla entity IDs must be globally unique.');
  const skillIds = new Set(manifest.skills.map((skill) => skill.id));
  for (const id of manifest.hero.skillIds) if (!skillIds.has(id)) errors.push(`Braevalar references unknown skill ${id}.`);
  const factionEnemyCopies = (factionId: 'elementalist' | 'dark-crusader') => manifest.enemies.filter((enemy) => enemy.factionId === factionId).reduce((sum, enemy) => sum + enemy.copies, 0);
  for (const faction of ['elementalist', 'dark-crusader'] as const) {
    if (factionEnemyCopies(faction) !== 16) errors.push(`${faction} must contain exactly 16 enemy tokens.`);
    const tokenCopies = manifest.factionTokens.filter((token) => token.factionId === faction).reduce((sum, token) => sum + token.copies, 0);
    if (tokenCopies !== 12) errors.push(`${faction} must contain exactly 12 faction tokens.`);
  }
  for (const enemy of manifest.enemies) if (enemy.attackElements && enemy.attackElements.length !== enemy.attack.length) errors.push(`${enemy.id} attackElements must match attack count.`);
  for (const leader of manifest.leaders) {
    const levels = leader.levels.map((level) => level.level).sort((a, b) => a - b);
    if (levels.some((level, index) => level !== index + 1)) errors.push(`${leader.id} must define levels 1 through 12.`);
    for (const level of leader.levels) if (level.attacks.length !== level.attackElements.length) errors.push(`${leader.id} level ${level.level} attack elements must match attacks.`);
  }
  if (JSON.stringify(manifest).match(/TBD|TODO|placeholder|temporary|temp-id/i)) errors.push('v0.8 Shades of Tezla content contains unfinished data.');
  return errors;
}
