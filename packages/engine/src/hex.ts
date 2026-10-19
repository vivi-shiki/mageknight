import type { Coord, Terrain, TimeOfDay } from './types';

export const HEX_DIRECTIONS: readonly Coord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function coordKey(coord: Coord): string {
  return `${coord.q},${coord.r}`;
}

export function addCoord(left: Coord, right: Coord): Coord {
  return { q: left.q + right.q, r: left.r + right.r };
}

export function neighbors(coord: Coord): Coord[] {
  return HEX_DIRECTIONS.map((direction) => addCoord(coord, direction));
}

export function hexDistance(left: Coord, right: Coord): number {
  const dq = left.q - right.q;
  const dr = left.r - right.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function areAdjacent(left: Coord, right: Coord): boolean {
  return hexDistance(left, right) === 1;
}

export function isCompleteSevenHexTile(coords: readonly Coord[]): boolean {
  const keys = new Set(coords.map(coordKey));
  if (coords.length !== 7 || keys.size !== 7) return false;
  return coords.some((center) => neighbors(center).every((neighbor) => keys.has(coordKey(neighbor))));
}

const TERRAIN_COSTS: Record<Terrain, Record<TimeOfDay, number>> = {
  plains: { day: 2, night: 2 },
  forest: { day: 3, night: 5 },
  hills: { day: 3, night: 3 },
  desert: { day: 5, night: 3 },
  wasteland: { day: 4, night: 4 },
  mountain: { day: Number.POSITIVE_INFINITY, night: Number.POSITIVE_INFINITY },
  lake: { day: Number.POSITIVE_INFINITY, night: Number.POSITIVE_INFINITY },
};

export function terrainCost(terrain: Terrain, time: TimeOfDay): number {
  return TERRAIN_COSTS[terrain][time];
}

export function axialToPixel(coord: Coord, size: number): { x: number; y: number } {
  return {
    x: size * Math.sqrt(3) * (coord.q + coord.r / 2),
    y: size * 1.5 * coord.r,
  };
}
