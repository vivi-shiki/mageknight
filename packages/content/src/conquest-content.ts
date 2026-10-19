import { conquestContentManifestSchema, coreContentManifestV3Schema, krangContentManifestV7Schema, lintConquestContentManifest, lintCoreContentManifestV3, lintKrangContentManifestV7, lintLostLegionContentManifestV6, lintRulesContentManifestV5, lintShadesOfTezlaContentManifestV8, lostLegionContentManifestV6Schema, rulesContentManifestV5Schema, shadesOfTezlaContentManifestV8Schema } from '@mageknight/content-schema';
import manifestJson from './v0.2-content-manifest.json';
import coreManifestJson from './v0.3-content-manifest.json';
import rulesManifestJson from './v0.5-rules-manifest.json';
import lostLegionManifestJson from './v0.6-lost-legion-manifest.json';
import krangManifestJson from './v0.7-krang-manifest.json';
import tezlaManifestJson from './v0.8-shades-of-tezla-manifest.json';
import { tutorialContent } from './tutorial-content';
import type { CardDefinition, CardEffect, EffectNode, EnemyDefinition } from './types';
import type { ConquestContent, ConquestScenarioDefinition, ConquestTileDefinition, EnemyPool, HeroDefinition, SiteDefinition, SkillDefinition, TacticDefinition } from './conquest-types';

function mapEffect(effect: { resource: CardEffect['resource']; amount: number; attackKind?: CardEffect['attackKind']; element?: CardEffect['element'] }): CardEffect {
  return {
    resource: effect.resource,
    amount: effect.amount,
    ...(effect.attackKind ? { attackKind: effect.attackKind } : {}),
    ...(effect.element ? { element: effect.element } : {}),
  };
}

function stableHash(value: unknown): string {
  const json = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < json.length; index += 1) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export type ConquestModuleId = 'lost-legion.official-v0.6' | 'krang.character-v0.7' | 'shades-of-tezla.official-v0.8';
export const defaultConquestModules: ConquestModuleId[] = ['lost-legion.official-v0.6', 'krang.character-v0.7', 'shades-of-tezla.official-v0.8'];

export function buildConquestContent(
  raw: unknown,
  coreRaw: unknown = coreManifestJson,
  rulesRaw: unknown = rulesManifestJson,
  lostLegionRaw: unknown = lostLegionManifestJson,
  krangRaw: unknown = krangManifestJson,
  tezlaRaw: unknown = tezlaManifestJson,
  modules: readonly ConquestModuleId[] = defaultConquestModules,
): ConquestContent {
  const enabled = new Set(modules);
  const useLostLegion = enabled.has('lost-legion.official-v0.6');
  const useKrang = enabled.has('krang.character-v0.7');
  const useTezla = enabled.has('shades-of-tezla.official-v0.8');
  const errors = lintConquestContentManifest(raw);
  if (errors.length > 0) throw new Error(`Invalid v0.2 content: ${errors.join(' ')}`);
  const manifest = conquestContentManifestSchema.parse(raw);
  const inheritedIds = [
    ...Object.keys(tutorialContent.cards),
    ...manifest.cards.map((item) => item.id), ...manifest.skills.map((item) => item.id),
    ...manifest.units.map((item) => item.id), ...manifest.enemies.map((item) => item.id),
    ...manifest.sites.map((item) => item.id), ...manifest.tiles.map((item) => item.id),
  ];
  const coreErrors = lintCoreContentManifestV3(coreRaw, inheritedIds);
  if (coreErrors.length > 0) throw new Error(`Invalid v0.3 content: ${coreErrors.join(' ')}`);
  const core = coreContentManifestV3Schema.parse(coreRaw);
  const marketCardIds = [...core.advancedDeck, ...core.spellDeck, ...core.artifactDeck];
  const marketUnitIds = [...new Set([...core.regularUnitDeck, ...core.eliteUnitDeck])];
  const heroSkillIds = [...new Set(core.heroes.flatMap((hero) => hero.skillIds))];
  const rulesErrors = lintRulesContentManifestV5(rulesRaw, { cardIds: marketCardIds, unitIds: marketUnitIds, skillIds: heroSkillIds });
  if (rulesErrors.length > 0) throw new Error(`Invalid v0.5 rules: ${rulesErrors.join(' ')}`);
  const rules = rulesContentManifestV5Schema.parse(rulesRaw);
  const lostLegionErrors = lintLostLegionContentManifestV6(lostLegionRaw);
  if (lostLegionErrors.length > 0) throw new Error(`Invalid v0.6 Lost Legion content: ${lostLegionErrors.join(' ')}`);
  const lostLegion = lostLegionContentManifestV6Schema.parse(lostLegionRaw);
  const krangErrors = lintKrangContentManifestV7(krangRaw);
  if (krangErrors.length > 0) throw new Error(`Invalid v0.7 Krang content: ${krangErrors.join(' ')}`);
  const krang = krangContentManifestV7Schema.parse(krangRaw);
  const tezlaErrors = lintShadesOfTezlaContentManifestV8(tezlaRaw);
  if (tezlaErrors.length > 0) throw new Error(`Invalid v0.8 Shades of Tezla content: ${tezlaErrors.join(' ')}`);
  const tezla = shadesOfTezlaContentManifestV8Schema.parse(tezlaRaw);
  const cardRules = new Map(rules.cardRules.map((item) => [item.id, item]));
  const unitRules = new Map(rules.unitRules.map((item) => [item.id, item]));
  const skillRules = new Map(rules.skillRules.map((item) => [item.id, item]));
  const allCardData = [...manifest.cards, ...core.cards];
  const addedCards = Object.fromEntries(allCardData.map((card) => {
    const rule = cardRules.get(card.id);
    return [card.id, {
    id: card.id, name: card.name, color: card.color, kind: card.kind,
    ...(card.basic ? { basic: mapEffect(card.basic) } : {}),
    ...(card.strong ? { strong: mapEffect(card.strong) } : {}),
    ...(rule ? {
      basicEffect: rule.basicEffect as EffectNode, strongEffect: rule.strongEffect as EffectNode,
      basicText: rule.basicText, strongText: rule.strongText, sourceRef: rule.sourceRef, implementation: rule.implementation,
    } : {}),
    assetAlias: card.assetAlias,
  } satisfies CardDefinition];
  }));
  const lostLegionCards = Object.fromEntries(lostLegion.cards.map((card) => [card.id, {
    id: card.id, name: card.name, color: card.color, kind: card.kind,
    basicEffect: card.basicEffect as EffectNode, strongEffect: card.strongEffect as EffectNode,
    basicText: card.basicText, strongText: card.strongText, sourceRef: card.sourceRef, implementation: card.implementation,
    assetAlias: card.assetAlias,
  } satisfies CardDefinition]));
  const krangCards = Object.fromEntries(krang.cards.map((card) => [card.id, {
    id: card.id, name: card.name, color: card.color, kind: card.kind,
    basicEffect: card.basicEffect as EffectNode, strongEffect: card.strongEffect as EffectNode,
    basicText: card.basicText, strongText: card.strongText, sourceRef: card.sourceRef, implementation: card.implementation,
    assetAlias: card.assetAlias,
  } satisfies CardDefinition]));
  const tezlaCards = Object.fromEntries(tezla.cards.map((card) => [card.id, {
    id: card.id, name: card.name, color: card.color, kind: card.kind,
    basicEffect: card.basicEffect as EffectNode, strongEffect: card.strongEffect as EffectNode,
    basicText: card.basicText, strongText: card.strongText, sourceRef: card.sourceRef, implementation: card.implementation,
    assetAlias: card.assetAlias,
  } satisfies CardDefinition]));
  const units: ConquestContent['units'] = Object.fromEntries([...manifest.units, ...core.units].map((unit) => {
    const rule = unitRules.get(unit.id);
    return [unit.id, {
    id: unit.id, name: unit.name, level: unit.level, armor: unit.armor, influenceCost: unit.influenceCost,
    ability: mapEffect(unit.ability), assetAlias: unit.assetAlias, tier: unit.tier, siteKinds: [...unit.siteKinds], resistances: [...unit.resistances],
    ...(rule ? {
      abilities: rule.abilities.map((ability) => ({ label: ability.label, text: ability.text, effect: ability.effect as EffectNode })),
      sourceRef: rule.sourceRef, implementation: rule.implementation,
    } : {}),
  } satisfies ConquestContent['units'][string]];
  }));
  for (const unit of useLostLegion ? lostLegion.units : []) units[unit.id] = {
    id: unit.id, name: unit.name, level: unit.level, armor: unit.armor, influenceCost: unit.influenceCost,
    ability: { resource: 'attack', amount: 0 }, abilities: unit.abilities.map((ability) => ({ label: ability.label, text: ability.text, effect: ability.effect as EffectNode })),
    assetAlias: unit.assetAlias, tier: unit.tier, siteKinds: [...unit.siteKinds], resistances: [...unit.resistances], sourceRef: unit.sourceRef, implementation: unit.implementation,
  };
  const enemies: ConquestContent['enemies'] = Object.fromEntries(manifest.enemies.map((enemy) => [enemy.id, {
    id: enemy.id, name: enemy.name, armor: enemy.armor, attack: [...enemy.attack], attackElement: enemy.attackElement,
    resistances: [...enemy.resistances], abilities: [...enemy.abilities], fame: enemy.fame, assetAlias: enemy.assetAlias,
  } satisfies EnemyDefinition]));
  for (const enemy of useLostLegion ? lostLegion.enemies : []) enemies[enemy.id] = {
    id: enemy.id, name: enemy.name, armor: enemy.armor, ...(enemy.elusiveArmor ? { elusiveArmor: enemy.elusiveArmor } : {}), attack: [...enemy.attack], attackElement: enemy.attackElement,
    resistances: [...enemy.resistances], abilities: [...enemy.abilities], fame: enemy.fame, assetAlias: enemy.assetAlias, sourceRef: enemy.sourceRef,
  };
  for (const enemy of useTezla ? tezla.enemies : []) enemies[enemy.id] = {
    id: enemy.id, name: enemy.name, armor: enemy.armor, ...(enemy.elusiveArmor ? { elusiveArmor: enemy.elusiveArmor } : {}), attack: [...enemy.attack],
    attackElement: enemy.attackElement, ...(enemy.attackElements ? { attackElements: [...enemy.attackElements] } : {}), resistances: [...enemy.resistances],
    abilities: [...enemy.abilities], ...(enemy.defend ? { defend: enemy.defend } : {}), factionId: enemy.factionId,
    fame: enemy.fame, assetAlias: enemy.assetAlias, sourceRef: enemy.sourceRef,
  };
  const skills: ConquestContent['skills'] = Object.fromEntries([...manifest.skills, ...core.skills].map((skill) => {
    const rule = skillRules.get(skill.id);
    return [skill.id, {
    id: skill.id, name: skill.name, description: skill.description, oncePerRound: skill.oncePerRound, assetAlias: skill.assetAlias,
    ...(skill.resource ? { resource: skill.resource } : {}), ...(skill.amount ? { amount: skill.amount } : {}),
    ...(rule ? { effect: rule.effect as EffectNode, ruleText: rule.ruleText, sourceRef: rule.sourceRef, implementation: rule.implementation } : {}),
  } satisfies SkillDefinition];
  }));
  for (const skill of useLostLegion ? lostLegion.skills : []) skills[skill.id] = {
    id: skill.id, name: skill.name, description: skill.description, oncePerRound: skill.oncePerRound, assetAlias: skill.assetAlias,
    effect: skill.effect as EffectNode, ruleText: skill.ruleText, sourceRef: skill.sourceRef, implementation: skill.implementation,
  };
  for (const skill of useKrang ? krang.skills : []) skills[skill.id] = {
    id: skill.id, name: skill.name, description: skill.description, oncePerRound: skill.oncePerRound, assetAlias: skill.assetAlias,
    effect: skill.effect as EffectNode, ruleText: skill.ruleText, sourceRef: skill.sourceRef, implementation: skill.implementation,
    ...(skill.flipBackCondition ? { flipBackCondition: skill.flipBackCondition } : {}),
  };
  for (const skill of useTezla ? tezla.skills : []) skills[skill.id] = {
    id: skill.id, name: skill.name, description: skill.description, oncePerRound: skill.oncePerRound, assetAlias: skill.assetAlias,
    effect: skill.effect as EffectNode, ruleText: skill.ruleText, sourceRef: skill.sourceRef, implementation: skill.implementation,
  };
  const tiles: ConquestContent['tiles'] = Object.fromEntries([...manifest.tiles, ...core.tiles].map((tile) => [tile.id, {
    id: tile.id, name: tile.name, kind: tile.kind, terrains: [...tile.terrains] as ConquestTileDefinition['terrains'], enemies: [...tile.enemies], assetAlias: tile.assetAlias,
    ...(tile.site ? { site: { ...tile.site } } : {}),
  } satisfies ConquestTileDefinition]));
  for (const tile of useLostLegion ? lostLegion.tiles : []) tiles[tile.id] = {
    id: tile.id, name: tile.name, kind: tile.kind, terrains: [...tile.terrains] as ConquestTileDefinition['terrains'], enemies: [...tile.enemies], assetAlias: tile.assetAlias,
    ...(tile.site ? { site: { ...tile.site } } : {}), ...(tile.walls ? { walls: tile.walls.map((wall) => [...wall] as [number, number]) } : {}),
  };
  const heroes: ConquestContent['heroes'] = Object.fromEntries(core.heroes.map((hero) => [hero.id, {
    id: hero.id, name: hero.name, armor: hero.armor, handLimit: hero.handLimit, commandSlots: hero.commandSlots,
    basicDeck: [...hero.basicDeck], skillIds: [...hero.skillIds], assetAlias: hero.assetAlias, sourceRef: hero.sourceRef,
  } satisfies HeroDefinition]));
  if (useLostLegion) heroes[lostLegion.hero.id] = { ...lostLegion.hero, basicDeck: [...lostLegion.hero.basicDeck], skillIds: [...lostLegion.hero.skillIds] };
  if (useKrang) heroes[krang.hero.id] = { ...krang.hero, basicDeck: [...krang.hero.basicDeck], skillIds: [...krang.hero.skillIds] };
  if (useTezla) heroes[tezla.hero.id] = { ...tezla.hero, basicDeck: [...tezla.hero.basicDeck], skillIds: [...tezla.hero.skillIds] };
  const scenarios: ConquestContent['scenarios'] = Object.fromEntries(core.scenarios.map((scenario) => [scenario.id, {
    id: scenario.id, name: scenario.name, roundLimit: scenario.roundLimit,
    countrysideTileCount: scenario.countrysideTileCount, coreNonCityTileCount: scenario.coreNonCityTileCount, coreCityTileCount: scenario.coreCityTileCount,
    cityLevelsByDifficulty: { explorer: [...scenario.cityLevelsByDifficulty.explorer], standard: [...scenario.cityLevelsByDifficulty.standard], veteran: [...scenario.cityLevelsByDifficulty.veteran] },
    citiesRequired: scenario.citiesRequired, finalTurnAfterObjective: scenario.finalTurnAfterObjective, objective: scenario.objective,
  } satisfies ConquestScenarioDefinition]));
  for (const scenario of useLostLegion ? lostLegion.scenarios : []) scenarios[scenario.id] = {
    id: scenario.id, name: scenario.name, roundLimit: scenario.roundLimit, countrysideTileCount: scenario.countrysideTileCount,
    coreNonCityTileCount: scenario.coreNonCityTileCount, coreCityTileCount: scenario.coreCityTileCount,
    cityLevelsByDifficulty: { explorer: [...scenario.cityLevelsByDifficulty.explorer], standard: [...scenario.cityLevelsByDifficulty.standard], veteran: [...scenario.cityLevelsByDifficulty.veteran] },
    citiesRequired: scenario.citiesRequired, finalTurnAfterObjective: scenario.finalTurnAfterObjective, objective: scenario.objective,
    objectiveKind: scenario.objectiveKind, volkareArmyByDifficulty: { ...scenario.volkareArmyByDifficulty },
  };
  for (const scenario of useTezla ? tezla.scenarios : []) scenarios[scenario.id] = {
    id: scenario.id, name: scenario.name, roundLimit: scenario.roundLimit, countrysideTileCount: scenario.countrysideTileCount,
    coreNonCityTileCount: scenario.coreNonCityTileCount, coreCityTileCount: scenario.coreCityTileCount,
    cityLevelsByDifficulty: { explorer: [...scenario.cityLevelsByDifficulty.explorer], standard: [...scenario.cityLevelsByDifficulty.standard], veteran: [...scenario.cityLevelsByDifficulty.veteran] },
    citiesRequired: scenario.citiesRequired, finalTurnAfterObjective: scenario.finalTurnAfterObjective, objective: scenario.objective,
    objectiveKind: scenario.objectiveKind, factionLeaderIds: [...scenario.factionLeaderIds],
    ...(scenario.graveyardsRequired === undefined ? {} : { graveyardsRequired: scenario.graveyardsRequired }),
    ...(scenario.relicsRequired === undefined ? {} : { relicsRequired: scenario.relicsRequired }),
  };
  const sites: ConquestContent['sites'] = Object.fromEntries(manifest.sites.map((site) => [site.id, {
    id: site.id, kind: site.kind, name: site.name, fortified: site.fortified, recruit: site.recruit, assetAlias: site.assetAlias,
    ...(site.healCost ? { healCost: site.healCost } : {}), ...(site.reward ? { reward: site.reward } : {}),
  } satisfies SiteDefinition]));
  for (const site of useLostLegion ? lostLegion.sites : []) sites[site.id] = {
    id: site.id, kind: site.kind, name: site.name, fortified: site.fortified, recruit: site.recruit, assetAlias: site.assetAlias,
    ...(site.healCost ? { healCost: site.healCost } : {}), ...(site.reward ? { reward: site.reward } : {}),
  };
  const copyIds = <T extends { id: string; copies: number }>(items: T[]): string[] => items.flatMap((item) => Array.from({ length: item.copies }, () => item.id));
  const pools = ['green', 'gray', 'brown', 'violet', 'city', 'red', 'white'] as const satisfies readonly EnemyPool[];
  const factionTokens = Object.fromEntries((useTezla ? tezla.factionTokens : []).map((token) => [token.id, {
    id: token.id, name: token.name, factionId: token.factionId, copies: token.copies, kind: token.kind,
    description: token.description, ...(token.element ? { element: token.element } : {}), assetAlias: token.assetAlias, sourceRef: token.sourceRef,
  }])) as ConquestContent['factionTokens'];
  const factionTokenDecks = {
    elementalist: (useTezla ? tezla.factionTokens : []).filter((token) => token.factionId === 'elementalist').flatMap((token) => Array.from({ length: token.copies }, () => token.id)),
    'dark-crusader': (useTezla ? tezla.factionTokens : []).filter((token) => token.factionId === 'dark-crusader').flatMap((token) => Array.from({ length: token.copies }, () => token.id)),
  };
  const factionEnemyPools = Object.fromEntries((['elementalist', 'dark-crusader'] as const).map((factionId) => [factionId, Object.fromEntries(pools.map((pool) => [pool, (useTezla ? tezla.enemies : []).filter((enemy) => enemy.factionId === factionId && enemy.pool === pool).flatMap((enemy) => Array.from({ length: enemy.copies }, () => enemy.id))]))])) as ConquestContent['factionEnemyPools'];
  const factionLeaders = Object.fromEntries((useTezla ? tezla.leaders : []).map((leader) => [leader.id, { ...leader, levels: leader.levels.map((level) => ({ ...level, attacks: [...level.attacks], attackElements: [...level.attackElements], abilities: [...level.abilities], resistances: [...level.resistances], guards: { ...level.guards } })) }]));
  const siteOverlays = Object.fromEntries((useTezla ? tezla.overlays : []).map((overlay) => [overlay.id, {
    id: overlay.id, name: overlay.name, kind: overlay.kind, ...(overlay.moveCost ? { moveCost: overlay.moveCost } : {}),
    nightRules: overlay.nightRules, assetAlias: overlay.assetAlias, sourceRef: overlay.sourceRef,
  }])) as ConquestContent['siteOverlays'];
  return {
    version: '0.8.0',
    enabledModules: ['core.tutorial-v0.1', manifest.id, core.id, rules.id, ...(useLostLegion ? [lostLegion.id] : []), ...(useKrang ? [krang.id] : []), ...(useTezla ? [tezla.id] : [])],
    contentHash: stableHash([manifest, core, rules, ...(useLostLegion ? [lostLegion] : []), ...(useKrang ? [krang] : []), ...(useTezla ? [tezla] : [])]),
    heroes,
    scenarios,
    defaultHeroId: 'core.hero.tovak',
    defaultScenarioId: 'core.scenario.solo-conquest',
    cards: { ...tutorialContent.cards, ...addedCards, ...(useLostLegion ? lostLegionCards : {}), ...(useKrang ? krangCards : {}), ...(useTezla ? tezlaCards : {}) },
    advancedDeck: [...core.advancedDeck, ...(useLostLegion ? copyIds(lostLegion.cards.filter((card) => card.deck === 'advanced')) : [])],
    spellDeck: [...core.spellDeck, ...(useLostLegion ? copyIds(lostLegion.cards.filter((card) => card.deck === 'spell')) : [])],
    artifactDeck: [...core.artifactDeck, ...(useLostLegion ? copyIds(lostLegion.cards.filter((card) => card.deck === 'artifact')) : [])],
    units,
    regularUnitDeck: [...core.regularUnitDeck, ...(useLostLegion ? copyIds(lostLegion.units.filter((unit) => unit.tier === 'regular')) : [])],
    eliteUnitDeck: [...core.eliteUnitDeck, ...(useLostLegion ? copyIds(lostLegion.units.filter((unit) => unit.tier === 'elite')) : [])],
    enemies,
    enemyPools: Object.fromEntries(pools.map((pool) => [pool, [...manifest.enemies.filter((enemy) => enemy.pool === pool).map((enemy) => enemy.id), ...(useLostLegion ? copyIds(lostLegion.enemies.filter((enemy) => enemy.pool === pool)) : []), ...(useTezla ? copyIds(tezla.enemies.filter((enemy) => enemy.pool === pool)) : [])]])) as ConquestContent['enemyPools'],
    tactics: Object.fromEntries(manifest.tactics.map((tactic) => [tactic.id, { id: tactic.id, name: tactic.name, time: tactic.time, initiative: tactic.initiative, effect: tactic.effect } satisfies TacticDefinition])),
    skills,
    sites,
    tiles,
    countrysideTiles: Object.values(tiles).filter((tile) => tile.kind === 'countryside').map((tile) => tile.id),
    coreTiles: Object.values(tiles).filter((tile) => tile.kind === 'core').map((tile) => tile.id),
    factionTokens,
    factionTokenDecks,
    factionEnemyPools,
    factionLeaders,
    siteOverlays,
  };
}

export function createConquestContent(modules: readonly ConquestModuleId[] = defaultConquestModules): ConquestContent {
  return buildConquestContent(manifestJson, coreManifestJson, rulesManifestJson, lostLegionManifestJson, krangManifestJson, tezlaManifestJson, modules);
}

export const conquestContent = createConquestContent();
