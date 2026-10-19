import type { BasicManaColor, ManaColor, ResourceType, Terrain } from '@mageknight/content';
import { terrainCost } from '../hex';
import type { ConquestErrorCode, ConquestResource, ConquestResult, ConquestState, RuleRuntimeState } from './types';
import { assertZoneUniqueness } from './zones';

export const CONQUEST_RESOURCES: ResourceType[] = ['move', 'influence', 'attack', 'block', 'heal'];

export function createRuleRuntime(): RuleRuntimeState {
  return {
    recruitReputation: 0, recruitFame: 0, famePerDefeated: 0, healFamePerPoint: 0,
    drawPerHandWound: false, allUnitsBonus: 0, allUnitsAllResistances: false, doublePhysicalAttacks: false, removePhysicalResistance: false,
    endlessMana: [], removeTurnWounds: false, extraTurn: false, noDrawNextTurn: false,
    ignoreFortification: false, goldAtNight: false, blackAtDay: false,
    ignoreWalls: false, allUnitsArmorBonus: 0,
    deepMineClaimed: false, ignoreReputation: false,
    recruitDiscount: 0, recruitReputationPenalty: 0,
    harvestOpportunities: 0, ruthlessReadyUnits: false,
    concealedMovement: false, preventNextHeroWound: false, discardCombatWounds: false,
    nextAttackRanged: false, explorationDiscount: 0,
  };
}

export function cloneConquestState(state: ConquestState): ConquestState { return structuredClone(state); }

export function conquestFailure(state: ConquestState, code: ConquestErrorCode, message: string): ConquestResult {
  return { ok: false, state, events: [], error: { code, message } };
}

export function conquestNextId(state: ConquestState, prefix: string): string {
  const id = `${prefix}-${state.nextEntityId}`;
  state.nextEntityId += 1;
  return id;
}

export function detachUnitAttachments(state: ConquestState, unitId: string): string[] {
  const detached = state.attachments.filter((attachment) => attachment.unitId === unitId);
  state.attachments = state.attachments.filter((attachment) => attachment.unitId !== unitId);
  for (const attachment of detached) {
    state.player.zones['set-aside'] = state.player.zones['set-aside'].filter((id) => id !== attachment.cardId);
    if (!state.player.zones.discard.includes(attachment.cardId)) state.player.zones.discard.push(attachment.cardId);
  }
  return detached.map((attachment) => attachment.cardId);
}

export function commandCapacity(state: ConquestState): number {
  const commandBanners = state.attachments.filter((attachment) =>
    attachment.definitionId === 'lost-legion.card.artifact.banner-command'
    && state.player.units.some((unit) => unit.id === attachment.unitId && !unit.destroyed),
  ).length;
  return state.player.commandSlots + commandBanners;
}

export function resourceTotals(state: ConquestState): Record<ResourceType, number> {
  const totals = Object.fromEntries(CONQUEST_RESOURCES.map((resource) => [resource, 0])) as Record<ResourceType, number>;
  for (const item of state.player.resources) totals[item.resource] += item.amount;
  return totals;
}

export function conquestTerrainCost(state: ConquestState, terrain: Terrain): number {
  let cost = terrainCost(terrain, state.time);
  for (const effect of state.lastingEffects.filter((candidate) => candidate.kind === 'terrain' && candidate.terrains?.includes(terrain))) {
    if (!Number.isFinite(cost) && effect.allowLake) cost = effect.amount;
    else if (effect.mode === 'set') cost = effect.amount;
    else if (effect.mode === 'reduce') cost = Math.max(effect.minimum ?? 0, cost - effect.amount);
  }
  return cost;
}

export function spendResource(state: ConquestState, resource: ResourceType, amount: number): boolean {
  const available = state.player.resources.filter((item) => item.resource === resource).reduce((sum, item) => sum + item.amount, 0);
  if (available < amount) return false;
  let remaining = amount;
  for (const item of state.player.resources) {
    if (item.resource !== resource || remaining === 0) continue;
    const spent = Math.min(item.amount, remaining);
    item.amount -= spent;
    remaining -= spent;
  }
  state.player.resources = state.player.resources.filter((item) => item.amount > 0);
  return true;
}

export function addResource(state: ConquestState, sourceId: string, resource: ResourceType, amount: number, attackKind: ConquestResource['attackKind'] = 'normal', element: ConquestResource['element'] = 'physical', tags?: string[]): void {
  state.player.resources.push({ id: conquestNextId(state, 'resource'), sourceId, resource, amount, attackKind, element, ...(tags?.length ? { tags: [...tags] } : {}) });
}

export function appendEvent(state: ConquestState, events: ConquestState['eventLog'], type: string, message: string, data: Record<string, unknown> = {}): void {
  events.push({ id: state.eventLog.length + events.length + 1, type, round: state.round, turn: state.turn, message, data });
}

export function drawCards(state: ConquestState, amount: number): number {
  let drawn = 0;
  while (drawn < amount && state.player.zones.deck.length > 0 && state.player.zones.hand.length < state.player.handLimit) {
    const cardId = state.player.zones.deck.shift();
    if (!cardId) break;
    state.player.zones.hand.push(cardId);
    drawn += 1;
  }
  return drawn;
}

export function reputationModifier(value: number): number {
  if (value <= -7) return -5;
  if (value <= -5) return -3;
  if (value <= -3) return -2;
  if (value <= -1) return -1;
  if (value <= 2) return 0;
  if (value <= 4) return 1;
  if (value <= 6) return 2;
  return 3;
}

export function randomBasicColor(state: ConquestState): BasicManaColor {
  const colors: BasicManaColor[] = ['red', 'blue', 'white', 'green'];
  state.rngState = (Math.imul(state.rngState, 1664525) + 1013904223) >>> 0;
  return colors[state.rngState % colors.length] ?? 'red';
}

export function randomManaColor(state: ConquestState): ManaColor {
  const colors: ManaColor[] = ['red', 'blue', 'white', 'green', 'gold', 'black'];
  state.rngState = (Math.imul(state.rngState, 1664525) + 1013904223) >>> 0;
  return colors[state.rngState % colors.length] ?? 'red';
}

export function assertConquestInvariants(state: ConquestState): void {
  assertZoneUniqueness(state);
  if (state.player.units.filter((unit) => !unit.destroyed).length > commandCapacity(state)) throw new Error('Invariant violated: active units exceed command capacity.');
  if (state.pendingDecision && state.phase !== 'decision') throw new Error('Invariant violated: a pending decision requires decision phase.');
  if (state.encounter && state.phase !== `combat-${state.encounter.phase}` && state.phase !== 'decision') throw new Error('Invariant violated: combat phase mismatch.');
  const coords = Object.values(state.map).map((space) => `${space.coord.q},${space.coord.r}`);
  if (new Set(coords).size !== coords.length) throw new Error('Invariant violated: overlapping map spaces.');
  if (state.player.reputation < -7 || state.player.reputation > 7) throw new Error('Invariant violated: reputation outside track.');
}
