import type { ConquestContent, EnemyPool, FactionId } from '@mageknight/content';
import { HEX_DIRECTIONS, addCoord, coordKey, hexDistance, neighbors } from '../hex';
import type { Coord } from '../types';
import { appendEvent, conquestNextId } from './state';
import type { ConquestState } from './types';

const TILE_OFFSETS: Coord[] = [{ q: 0, r: 0 }, ...HEX_DIRECTIONS];
const TILE_GRID_UPPER_RIGHT: Coord = { q: 3, r: -2 };
const TILE_GRID_LOWER_RIGHT: Coord = { q: 2, r: 1 };
type ExplorableTileKind = 'countryside' | 'core';

export function wallKey(left: Coord, right: Coord): string {
  return [coordKey(left), coordKey(right)].sort().join('|');
}

export function hasWall(state: ConquestState, left: Coord, right: Coord): boolean {
  return state.walls.includes(wallKey(left, right));
}

function drawEnemy(state: ConquestState, pool: keyof ConquestState['enemyPools']): string {
  const deck = state.enemyPools[pool];
  const definitionId = deck.shift();
  if (!definitionId) throw new Error(`Enemy pool ${pool} is empty.`);
  deck.push(definitionId);
  return definitionId;
}

function drawFactionEnemy(state: ConquestState, content: ConquestContent, factionId: FactionId, pool: EnemyPool): string | undefined {
  const values = content.factionEnemyPools[factionId][pool] ?? [];
  return values.length > 0 ? values[state.nextEntityId % values.length] : undefined;
}

function placeLeader(state: ConquestState, content: ConquestContent, leaderId: string, position: Coord, overlayId: string): void {
  const leader = state.factionLeaders[leaderId];
  const definition = content.factionLeaders[leaderId];
  const space = state.map[coordKey(position)];
  if (!leader || !definition || !space) return;
  for (const enemyId of space.enemyIds) delete state.enemies[enemyId];
  space.enemyIds = [];
  leader.position = { ...position };
  state.overlays[coordKey(position)] = { definitionId: overlayId, position: { ...position }, liberated: false, sealed: false };
  const level = definition.levels.find((candidate) => candidate.level === leader.initialLevel) ?? definition.levels[0];
  for (const [pool, amount] of Object.entries(level?.guards ?? {}) as Array<[EnemyPool, number]>) for (let index = 0; index < amount; index += 1) {
    const definitionId = drawFactionEnemy(state, content, definition.factionId, pool);
    if (!definitionId) continue;
    const enemyId = conquestNextId(state, 'faction-guard');
    state.enemies[enemyId] = { id: enemyId, definitionId, position: { ...position }, defeated: false, summoned: false };
    leader.guardEnemyIds.push(enemyId);
    space.enemyIds.push(enemyId);
  }
}

export function placeTile(state: ConquestState, content: ConquestContent, definitionId: string, center: Coord, events?: ConquestState['eventLog']): void {
  const tile = content.tiles[definitionId];
  if (!tile) throw new Error(`Unknown tile ${definitionId}.`);
  const revealedCities = state.placedTiles.filter((placed) => {
    const placedTile = content.tiles[placed.definitionId];
    return placedTile?.site && content.sites[placedTile.site.definitionId]?.kind === 'city';
  }).length;
  const spaces = TILE_OFFSETS.map((offset, index) => ({ coord: addCoord(center, offset), index }));
  for (const { coord } of spaces) if (state.map[coordKey(coord)]) throw new Error(`Tile ${definitionId} overlaps at ${coordKey(coord)}.`);
  for (const { coord, index } of spaces) {
    const enemyIds: string[] = [];
    const markers = tile.enemies.filter((marker) => marker.index === index);
    const isCity = tile.site?.index === index && content.sites[tile.site.definitionId]?.kind === 'city';
    const enemyCount = isCity ? (state.scenario.cityLevels[revealedCities] ?? state.scenario.cityLevels.at(-1) ?? 1) : markers.length;
    for (let enemyIndex = 0; enemyIndex < enemyCount; enemyIndex += 1) {
      const pool = isCity ? 'city' : markers[enemyIndex]?.pool;
      if (!pool) continue;
      const enemyId = conquestNextId(state, 'enemy');
      state.enemies[enemyId] = {
        id: enemyId, definitionId: drawEnemy(state, pool), position: { ...coord }, defeated: false, summoned: false,
        ...(state.scenario.id === 'tezla.scenario.hidden-valley' && tile.kind !== 'start' ? { ambushing: true } : {}),
        ...(state.scenario.id === 'tezla.scenario.realm-of-the-dead' && tile.kind !== 'start' ? { pursuing: true } : {}),
      };
      enemyIds.push(enemyId);
    }
    state.map[coordKey(coord)] = {
      coord: { ...coord }, terrain: tile.terrains[index] ?? 'plains', tileId: tile.id, revealed: true,
      conquered: false, burned: false, enemyIds,
      ...(tile.site?.index === index ? { siteId: tile.site.definitionId } : {}),
    };
  }
  for (const [leftIndex, rightIndex] of tile.walls ?? []) {
    const left = spaces[leftIndex]?.coord;
    const right = spaces[rightIndex]?.coord;
    if (left && right) state.walls.push(wallKey(left, right));
  }
  const siteCoord = tile.site ? spaces[tile.site.index]?.coord : undefined;
  const siteKind = tile.site ? content.sites[tile.site.definitionId]?.kind : undefined;
  if (siteCoord && siteKind === 'magical-glade' && state.scenario.id === 'tezla.scenario.realm-of-the-dead' && Object.values(state.overlays).filter((overlay) => overlay.definitionId === 'tezla.overlay.graveyard').length < state.scenario.graveyardsRequired) {
    const key = coordKey(siteCoord);
    state.overlays[key] = { definitionId: 'tezla.overlay.graveyard', position: { ...siteCoord }, liberated: false, sealed: false };
    const space = state.map[key];
    while ((space?.enemyIds.length ?? 0) < 2) {
      const definitionId = drawFactionEnemy(state, content, 'dark-crusader', space?.enemyIds.length ? 'brown' : 'green');
      if (!definitionId || !space) break;
      const enemyId = conquestNextId(state, 'graveyard-enemy');
      state.enemies[enemyId] = { id: enemyId, definitionId, position: { ...siteCoord }, defeated: false, summoned: false, pursuing: true };
      space.enemyIds.push(enemyId);
    }
  }
  if (siteCoord && siteKind === 'city') {
    const unplaced = Object.entries(state.factionLeaders).filter(([, leader]) => !leader.position);
    if (unplaced.length > 0) {
      const [leaderId] = state.scenario.id === 'tezla.scenario.life-and-death'
        ? unplaced[0]!
        : Object.entries(state.factionLeaders)[0]!;
      const overlayId = content.factionLeaders[leaderId]?.factionId === 'elementalist' ? 'tezla.overlay.hidden-valley' : 'tezla.overlay.necropolis';
      placeLeader(state, content, leaderId, siteCoord, overlayId);
    }
  }
  if (tile.site && content.sites[tile.site.definitionId]?.kind === 'volkare-camp' && state.volkare) {
    const camp = spaces[tile.site.index]?.coord;
    if (camp) {
      state.volkare.position = { ...camp };
      state.volkare.revealed = true;
      const campSpace = state.map[coordKey(camp)];
      for (let index = 0; index < state.scenario.volkareArmySize; index += 1) {
        const pool = index % 2 === 0 ? 'white' : 'red';
        const enemyId = conquestNextId(state, 'volkare-army');
        state.enemies[enemyId] = { id: enemyId, definitionId: drawEnemy(state, pool), position: { ...camp }, defeated: false, summoned: false };
        state.volkare.armyEnemyIds.push(enemyId);
        campSpace?.enemyIds.push(enemyId);
      }
    }
  }
  state.placedTiles.push({ definitionId, center: { ...center }, order: state.placedTiles.length });
  if (events) {
    state.checkpoints.push({ eventIndex: state.eventLog.length + events.length, barrier: true, reason: '揭示地图板块与标记' });
    appendEvent(state, events, 'TileRevealed', `揭示完整七格板块“${tile.name}”。`, { definitionId, center, spaceCount: 7, walls: tile.walls?.length ?? 0, volkare: content.sites[tile.site?.definitionId ?? '']?.kind === 'volkare-camp' });
  }
}

function wedgeSlot(layer: number, slot: number): Coord {
  return {
    q: (layer - slot) * TILE_GRID_UPPER_RIGHT.q + slot * TILE_GRID_LOWER_RIGHT.q,
    r: (layer - slot) * TILE_GRID_UPPER_RIGHT.r + slot * TILE_GRID_LOWER_RIGHT.r,
  };
}

function symmetricSlots(first: number, last: number): number[] {
  const result: number[] = [];
  for (let left = first, right = last; left <= right; left += 1, right -= 1) {
    result.push(left);
    if (right !== left) result.push(right);
  }
  return result;
}

function tileKindToExplore(state: ConquestState): ExplorableTileKind | undefined {
  if (state.countrysideTileDeck.length > 0) return 'countryside';
  if (state.coreTileDeck.length > 0) return 'core';
  return undefined;
}

function wedgeSlots(layer: number, kind: ExplorableTileKind): number[] {
  if (kind === 'core') return layer < 2 ? [] : symmetricSlots(1, layer - 1);
  return [0, layer, ...symmetricSlots(1, layer - 1)];
}

export function nextTileCenter(state: ConquestState, kind = tileKindToExplore(state)): Coord {
  if (!kind) throw new Error('No map tile remains to explore.');
  const occupied = new Set(state.placedTiles.map((tile) => coordKey(tile.center)));
  for (let layer = 1; layer <= 24; layer += 1) {
    for (const slot of wedgeSlots(layer, kind)) {
      const candidate = wedgeSlot(layer, slot);
      if (!occupied.has(coordKey(candidate))) return candidate;
    }
  }
  throw new Error('No wedge map slot remains for the next tile.');
}

export function frontierCoords(state: ConquestState): Coord[] {
  const kind = tileKindToExplore(state);
  if (!kind) return [];
  const targetSpaces = new Set(TILE_OFFSETS.map((offset) => coordKey(addCoord(nextTileCenter(state, kind), offset))));
  return Object.values(state.map)
    .filter((space) => neighbors(space.coord).some((neighbor) => targetSpaces.has(coordKey(neighbor))))
    .map((space) => ({ ...space.coord }));
}

export function explorationDistance(state: ConquestState, from: Coord): number {
  const frontier = frontierCoords(state);
  return frontier.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...frontier.map((coord) => hexDistance(from, coord)));
}

export function frontierCoord(state: ConquestState): Coord {
  return frontierCoords(state).sort((left, right) => hexDistance(state.player.position, left) - hexDistance(state.player.position, right))[0]
    ?? { ...state.player.position };
}

export function canExplore(state: ConquestState): boolean {
  return explorationDistance(state, state.player.position) === 0;
}

export function revealNextTile(state: ConquestState, content: ConquestContent, events: ConquestState['eventLog']): string {
  const kind = tileKindToExplore(state);
  const tileId = kind === 'countryside' ? state.countrysideTileDeck.shift() : state.coreTileDeck.shift();
  if (!tileId) throw new Error('No map tile remains to explore.');
  placeTile(state, content, tileId, nextTileCenter(state, kind), events);
  return tileId;
}

export function isSafeSpace(state: ConquestState, coord: Coord): boolean {
  const space = state.map[coordKey(coord)];
  const activeLeader = Object.values(state.factionLeaders).some((leader) => !leader.defeated && leader.position && coordKey(leader.position) === coordKey(coord));
  return Boolean(space && !activeLeader && space.enemyIds.every((enemyId) => state.enemies[enemyId]?.defeated));
}
