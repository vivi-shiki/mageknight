import type { GameState, ResourceType } from './types';

const RESOURCE_TYPES: ResourceType[] = ['move', 'influence', 'attack', 'block', 'heal'];

export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortValue(nested)]),
    );
  }
  return value;
}

export function stateHash(state: GameState): string {
  const normalized = sortValue(state);
  const json = JSON.stringify(normalized);
  let hash = 2166136261;
  for (let index = 0; index < json.length; index += 1) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function resourceTotals(state: GameState): Record<ResourceType, number> {
  const totals = Object.fromEntries(RESOURCE_TYPES.map((resource) => [resource, 0])) as Record<ResourceType, number>;
  for (const contribution of state.player.resources) {
    totals[contribution.resource] += contribution.amount;
  }
  return totals;
}

export function assertInvariants(state: GameState): void {
  const cardIds = [
    ...state.player.deck,
    ...state.player.hand,
    ...state.player.playArea,
    ...state.player.discard,
    ...state.player.removed,
  ].map((card) => card.id);
  const uniqueCardIds = new Set(cardIds);
  if (uniqueCardIds.size !== cardIds.length) {
    throw new Error('Invariant violated: a card exists in more than one zone.');
  }
  if (state.player.units.length > state.player.commandSlots) {
    throw new Error('Invariant violated: unit count exceeds command slots.');
  }
  if (state.pendingDecision && state.phase !== 'decision') {
    throw new Error('Invariant violated: pending decision requires decision phase.');
  }
  if (state.encounter) {
    const expectedPhase = `combat-${state.encounter.phase}`;
    if (state.phase !== expectedPhase && state.phase !== 'decision') {
      throw new Error('Invariant violated: encounter and game phases disagree.');
    }
  }
  for (const die of state.source) {
    if (!['red', 'blue', 'white', 'green', 'gold', 'black'].includes(die.color)) {
      throw new Error(`Invariant violated: invalid mana die ${die.id}.`);
    }
  }
}

