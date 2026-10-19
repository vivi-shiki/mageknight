import { coordKey } from './hex';
import { pickWithState } from './rng';
import type { DomainEvent, ExecutionFailure, GameErrorCode, GameState, ManaColor, ResourceType, TutorialContent } from './types';

const MANA_COLORS: ManaColor[] = ['red', 'blue', 'white', 'green', 'gold', 'black'];

export function failure(state: GameState, code: GameErrorCode, message: string): ExecutionFailure {
  return { ok: false, state, events: [], error: { code, message } };
}

export function appendEvent(state: GameState, events: DomainEvent[], type: string, message: string, data: Record<string, unknown> = {}): void {
  events.push({ id: state.eventLog.length + events.length + 1, type, round: state.round, turn: state.turn, message, data });
}

export function commitEvents(state: GameState, events: DomainEvent[]): void {
  state.eventLog.push(...events);
}

export function nextId(state: GameState, prefix: string): string {
  const id = `${prefix}-${state.nextEntityId}`;
  state.nextEntityId += 1;
  return id;
}

export function drawToHand(state: GameState, events: DomainEvent[]): void {
  while (state.player.hand.length < state.player.handLimit && state.player.deck.length > 0) {
    const card = state.player.deck.shift();
    if (!card) break;
    state.player.hand.push(card);
    appendEvent(state, events, 'CardDrawn', '抽取一张行动牌。', { cardId: card.id });
  }
}

export function rollSource(state: GameState, count: number): void {
  const source = [];
  for (let index = 0; index < count; index += 1) {
    const picked = pickWithState(MANA_COLORS, state.rngState);
    state.rngState = picked.state;
    source.push({ id: `source-${index + 1}`, color: picked.item, used: false });
  }
  state.source = source;
}

function createEnemy(state: GameState, definitionId: string, position: { q: number; r: number }): string {
  const id = nextId(state, 'enemy');
  state.enemies[id] = { id, definitionId, position: { q: position.q, r: position.r }, defeated: false };
  return id;
}

export function addMapTemplates(state: GameState, templates: TutorialContent['startingMap']): void {
  for (const template of templates) {
    const key = coordKey(template);
    const space = {
      coord: { q: template.q, r: template.r }, terrain: template.terrain, revealed: true, enemyIds: [] as string[],
      ...(template.site ? { site: template.site } : {}),
    };
    if (template.enemyId) space.enemyIds.push(createEnemy(state, template.enemyId, template));
    state.map[key] = space;
  }
}

export function resourceLabel(resource: ResourceType): string {
  return { move: '移动', influence: '影响', attack: '攻击', block: '格挡', heal: '治疗' }[resource];
}

export function spendResource(state: GameState, resource: ResourceType, amount: number): boolean {
  const contributions = state.player.resources.filter((candidate) => candidate.resource === resource);
  if (contributions.reduce((sum, candidate) => sum + candidate.amount, 0) < amount) return false;
  let remaining = amount;
  for (const contribution of contributions) {
    if (remaining <= 0) break;
    const spent = Math.min(remaining, contribution.amount);
    contribution.amount -= spent;
    remaining -= spent;
  }
  state.player.resources = state.player.resources.filter((candidate) => candidate.amount > 0);
  return true;
}
