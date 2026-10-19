import type { ConquestContent, MarketKind, SiteKind } from '@mageknight/content';
import { appendEvent, commandCapacity, conquestNextId, reputationModifier, spendResource } from './state';
import type { ConquestDecision, ConquestState, MarketState } from './types';

function shiftOffer(zone: { deck: string[]; offer: string[] }, size = 3): void {
  if (zone.offer.length > 0) zone.deck.push(zone.offer.shift() as string);
  while (zone.offer.length < size && zone.deck.length > 0) zone.offer.push(zone.deck.shift() as string);
}

export function createMarket(advanced: string[], spell: string[], artifact: string[], regular: string[], elite: string[]): MarketState {
  const market: MarketState = {
    advanced: { deck: [...advanced], offer: [] }, spell: { deck: [...spell], offer: [] }, artifact: { deck: [...artifact], offer: [] },
    unit: { regularDeck: [...regular], eliteDeck: [...elite], offer: [] },
  };
  shiftOffer(market.advanced);
  shiftOffer(market.spell);
  shiftOffer(market.artifact, 1);
  while (market.unit.offer.length < 3 && market.unit.regularDeck.length > 0) market.unit.offer.push(market.unit.regularDeck.shift() as string);
  return market;
}

export function refreshMarket(state: ConquestState, coreRevealed: boolean, monasteryCount: number, events: ConquestState['eventLog']): void {
  shiftOffer(state.market.advanced, 3 + monasteryCount);
  shiftOffer(state.market.spell);
  shiftOffer(state.market.artifact, 1);
  state.market.unit.regularDeck.push(...state.market.unit.offer);
  state.market.unit.offer = [];
  const eliteCount = coreRevealed ? 1 : 0;
  while (state.market.unit.offer.length < 3 - eliteCount && state.market.unit.regularDeck.length > 0) state.market.unit.offer.push(state.market.unit.regularDeck.shift() as string);
  while (state.market.unit.offer.length < 3 && state.market.unit.eliteDeck.length > 0) state.market.unit.offer.push(state.market.unit.eliteDeck.shift() as string);
  appendEvent(state, events, 'MarketRefreshed', '按轮初顺序刷新单位、高级行动、法术和神器牌区。', { coreRevealed, monasteryCount });
}

export function allowedMarkets(site: SiteKind, conquered: boolean): MarketKind[] {
  if (site === 'village') return ['unit'];
  if (site === 'monastery') return ['unit', 'advanced'];
  if (site === 'keep') return conquered ? ['unit'] : [];
  if (site === 'mage-tower') return conquered ? ['unit', 'spell'] : [];
  if (site === 'city') return conquered ? ['unit', 'advanced', 'spell', 'artifact'] : [];
  if (site === 'refugee-camp') return ['unit'];
  return [];
}

export function marketCost(kind: MarketKind, definitionId: string, content: ConquestContent, reputation: number, site?: SiteKind, discount = 0): number {
  const base = kind === 'unit' ? (content.units[definitionId]?.influenceCost ?? Number.POSITIVE_INFINITY) : kind === 'advanced' ? 6 : kind === 'spell' ? 7 : 0;
  const modifier = reputationModifier(reputation);
  const reputationCost = definitionId === 'lost-legion.unit.regular.thugs'
    ? modifier
    : definitionId === 'lost-legion.unit.elite.heroes' ? -2 * modifier : -modifier;
  const refugeeSurcharge = site === 'refugee-camp'
    ? (content.units[definitionId]?.siteKinds.includes('village') ? 0 : content.units[definitionId]?.siteKinds.includes('city') ? 3 : 1)
    : 0;
  return Math.max(0, base + reputationCost + refugeeSurcharge - (kind === 'unit' ? discount : 0));
}

export function applyRecruitBonuses(state: ConquestState): void {
  state.player.reputation = Math.max(-7, Math.min(7, state.player.reputation + state.ruleRuntime.recruitReputation - state.ruleRuntime.recruitReputationPenalty));
  state.player.fame += state.ruleRuntime.recruitFame;
}

export function buyMarket(state: ConquestState, content: ConquestContent, kind: MarketKind, definitionId: string, site: SiteKind, events: ConquestState['eventLog']): string | ConquestDecision | undefined {
  if (!allowedMarkets(site, true).includes(kind)) return '该地点不能购买这类内容。';
  const offer = kind === 'unit' ? state.market.unit.offer : state.market[kind].offer;
  if (!offer.includes(definitionId)) return '所选内容不在市场中。';
  const cost = marketCost(kind, definitionId, content, state.ruleRuntime.ignoreReputation ? 0 : state.player.reputation, site, state.ruleRuntime.recruitDiscount);
  if (!spendResource(state, 'influence', cost)) return `购买需要 ${cost} 影响。`;
  if (kind === 'unit') {
    const definition = content.units[definitionId];
    if (!definition || (site !== 'refugee-camp' && !definition.siteKinds.includes(site))) return '该单位不能在此地点招募。';
    const activeUnits = state.player.units.filter((unit) => !unit.destroyed);
    if (activeUnits.length >= commandCapacity(state)) {
      const decision: ConquestDecision = {
        id: conquestNextId(state, 'decision'), kind: 'replace-unit', prompt: '指挥槽已满，选择要解散的单位或放弃招募。', returnPhase: 'interaction',
        options: [...activeUnits.map((unit) => ({ id: unit.id, label: `解散 ${content.units[unit.definitionId]?.name ?? unit.id}` })), { id: 'cancel', label: '放弃招募' }],
        context: { definitionId, cost },
      };
      return decision;
    }
    const unitId = conquestNextId(state, 'unit');
    state.player.units.push({ id: unitId, definitionId, ready: true, wounds: 0, destroyed: false });
    offer.splice(offer.indexOf(definitionId), 1);
    applyRecruitBonuses(state);
    appendEvent(state, events, 'UnitRecruited', `招募${definition.name}。`, { unitId, definitionId, cost });
    return undefined;
  }
  offer.splice(offer.indexOf(definitionId), 1);
  const cardId = conquestNextId(state, 'card');
  state.player.cardInstances[cardId] = { id: cardId, definitionId };
  state.player.zones.discard.push(cardId);
  appendEvent(state, events, 'MarketCardBought', `获得${content.cards[definitionId]?.name ?? definitionId}。`, { market: kind, definitionId, cardId, cost });
  return undefined;
}
