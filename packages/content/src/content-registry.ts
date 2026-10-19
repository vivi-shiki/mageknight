import { contentManifestSchema, contentModuleManifestSchema, lintContentManifest, lintContentModuleManifest } from '@mageknight/content-schema';
import type { ContentManifest, ContentModuleManifest } from '@mageknight/content-schema';
import type { CardDefinition, CardEffect, EnemyDefinition, MapSpaceTemplate, TutorialContent, UnitDefinition } from './types';

type EntityWithId = { id: string };

function moduleEntities(manifest: ContentModuleManifest): EntityWithId[] {
  return [...(manifest.hero ? [manifest.hero] : []), ...(manifest.scenario ? [manifest.scenario] : []), ...manifest.cards, ...manifest.enemies, ...manifest.units, ...manifest.sites, ...manifest.mapTiles];
}

export class ContentRegistry {
  readonly modules = new Map<string, ContentModuleManifest>();

  constructor(rawModules: unknown[]) {
    for (const rawModule of rawModules) {
      const manifest = contentModuleManifestSchema.parse(rawModule);
      const lintErrors = lintContentModuleManifest(manifest);
      if (lintErrors.length > 0) throw new Error(`Invalid content module ${manifest.id}: ${lintErrors.join(' ')}`);
      if (this.modules.has(manifest.id)) throw new Error(`Duplicate content module ID ${manifest.id}.`);
      this.modules.set(manifest.id, manifest);
    }
  }

  resolve(enabledModuleIds: string[]): Map<string, EntityWithId> {
    const enabled = new Set(enabledModuleIds);
    const resolved = new Map<string, EntityWithId>();
    for (const moduleId of enabled) {
      const manifest = this.modules.get(moduleId);
      if (!manifest) throw new Error(`Unknown content module ${moduleId}.`);
      for (const requirement of manifest.requires) {
        if (!enabled.has(requirement)) throw new Error(`Content module ${moduleId} requires ${requirement}.`);
      }
      for (const conflict of manifest.conflicts) {
        if (enabled.has(conflict)) throw new Error(`Content module ${moduleId} conflicts with ${conflict}.`);
      }
      for (const entity of moduleEntities(manifest)) {
        if (resolved.has(entity.id)) throw new Error(`Duplicate entity ID ${entity.id}.`);
        resolved.set(entity.id, entity);
      }
    }
    return resolved;
  }
}

function mapSpace(space: ContentManifest['mapTiles'][number]['spaces'][number]): MapSpaceTemplate {
  return {
    q: space.q,
    r: space.r,
    terrain: space.terrain,
    ...(space.site === 'core.site.village' ? { site: 'village' as const } : {}),
    ...(space.enemyId ? { enemyId: space.enemyId } : {}),
  };
}

function mapEffect(effect: ContentManifest['cards'][number]['basic'] & {}): CardEffect {
  return {
    resource: effect.resource,
    amount: effect.amount,
    ...(effect.attackKind ? { attackKind: effect.attackKind } : {}),
    ...(effect.element ? { element: effect.element } : {}),
  };
}

export function buildTutorialContent(rawManifest: unknown): TutorialContent {
  const manifest = contentManifestSchema.parse(rawManifest);
  const errors = lintContentManifest(manifest);
  if (errors.length > 0) throw new Error(`Invalid tutorial content: ${errors.join(' ')}`);
  const startingTile = manifest.mapTiles.find((tile) => tile.id === 'core.tile.v0.1-start');
  const explorationTile = manifest.mapTiles.find((tile) => tile.id === 'core.tile.v0.1-exploration');
  if (!startingTile || !explorationTile) throw new Error('Tutorial map tiles are missing.');
  const cards = Object.fromEntries(manifest.cards.map((card) => [card.id, {
    id: card.id,
    name: card.name,
    color: card.color,
    kind: card.kind,
    ...(card.basic ? { basic: mapEffect(card.basic) } : {}),
    ...(card.strong ? { strong: mapEffect(card.strong) } : {}),
    assetAlias: card.assetAlias,
  } satisfies CardDefinition]));
  return {
    version: manifest.version,
    cards,
    basicDeck: [...manifest.basicDeck],
    rewardDeck: [...manifest.rewards],
    enemies: Object.fromEntries(manifest.enemies.map((enemy) => [enemy.id, {
      id: enemy.id,
      name: enemy.name,
      armor: enemy.armor,
      attack: [...enemy.attack],
      attackElement: enemy.attackElement,
      resistances: [...enemy.resistances],
      abilities: enemy.abilities,
      fame: enemy.fame,
      assetAlias: enemy.assetAlias,
    } satisfies EnemyDefinition])),
    units: Object.fromEntries(manifest.units.map((unit) => [unit.id, {
      id: unit.id,
      name: unit.name,
      level: unit.level,
      armor: unit.armor,
      influenceCost: unit.influenceCost,
      ability: mapEffect(unit.ability),
      assetAlias: unit.assetAlias,
    } satisfies UnitDefinition])),
    startingMap: startingTile.spaces.map(mapSpace),
    explorationMap: explorationTile.spaces.map(mapSpace),
  };
}
