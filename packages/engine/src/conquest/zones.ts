import type { CardZones, ConquestState, EntityZone } from './types';

export const ENTITY_ZONES: EntityZone[] = ['deck', 'hand', 'play', 'discard', 'removed', 'inventory', 'set-aside'];

export function createEmptyZones(): CardZones {
  return { deck: [], hand: [], play: [], discard: [], removed: [], inventory: [], 'set-aside': [] };
}

export function locateEntity(zones: CardZones, entityId: string): EntityZone | undefined {
  return ENTITY_ZONES.find((zone) => zones[zone].includes(entityId));
}

export function moveEntity(zones: CardZones, entityId: string, from: EntityZone, to: EntityZone): void {
  const actual = locateEntity(zones, entityId);
  if (actual !== from) throw new Error(`Entity ${entityId} is in ${actual ?? 'no zone'}, expected ${from}.`);
  zones[from] = zones[from].filter((id) => id !== entityId);
  zones[to].push(entityId);
}

export function assertZoneUniqueness(state: ConquestState): void {
  const ids = ENTITY_ZONES.flatMap((zone) => state.player.zones[zone]);
  if (new Set(ids).size !== ids.length) throw new Error('Invariant violated: an entity exists in multiple zones.');
  const instanceIds = Object.keys(state.player.cardInstances);
  if (ids.length !== instanceIds.length || ids.some((id) => !state.player.cardInstances[id])) throw new Error('Invariant violated: every card instance must exist in exactly one zone.');
}
