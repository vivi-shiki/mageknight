import type { ConquestContent } from '@mageknight/content';
import { appendEvent } from './state';
import type { ConquestScore, ConquestState } from './types';

export function calculateConquestScore(state: ConquestState, content: ConquestContent): ConquestScore {
  const knowledge = state.player.zones.discard.concat(state.player.zones.hand, state.player.zones.deck)
    .filter((id) => {
      const definition = content.cards[state.player.cardInstances[id]?.definitionId ?? ''];
      return definition?.kind === 'advanced' || definition?.kind === 'spell';
    }).length * 2 + state.player.skills.length * 2;
  const loot = state.player.zones.inventory.length * 3 + Object.values(state.player.crystals).reduce((sum, value) => sum + value, 0) + state.factionTokens.inventory.length;
  const leadership = state.player.units.filter((unit) => !unit.destroyed && unit.wounds === 0).reduce((sum, unit) => sum + (content.units[unit.definitionId]?.level ?? 0), 0);
  const allCities = state.scenario.objectiveKind === 'cities' && state.scenario.citiesConquered >= state.scenario.citiesRequired;
  const tezlaGoal = state.scenario.leadersDefeated * 10
    + (state.scenario.leadersRequired > 1 && state.scenario.leadersDefeated >= state.scenario.leadersRequired ? 15 : 0)
    + state.scenario.graveyardsSealed * 5
    + state.scenario.relicsFound * 5
    + (state.scenario.relicsRequired > 0 && state.scenario.relicsFound >= state.scenario.relicsRequired ? 10 : 0);
  const adventure = state.placedTiles.length + Object.values(state.map).filter((space) => space.conquered || space.burned).length * 2
    + state.scenario.citiesConquered * 10 + (allCities ? 15 : 0) + tezlaGoal;
  const wounds = Object.values(state.player.cardInstances).filter((card) => card.definitionId === 'core.card.wound').length * -2;
  const tempoCards = state.scenario.objectiveKind === 'volkare' ? (state.volkare?.deck.length ?? 0) : state.dummy.deck.length;
  const rounds = Math.max(0, state.scenario.roundLimit - state.round) * 30 + tempoCards + (!state.roundEndAnnounced && allCities ? 5 : 0);
  const total = state.player.fame + knowledge + loot + leadership + adventure + wounds + rounds;
  return { fame: state.player.fame, knowledge, loot, leadership, adventure, wounds, rounds, total };
}

export function resolveScenario(state: ConquestState, content: ConquestContent, events: ConquestState['eventLog']): boolean {
  if (state.scenario.objectiveKind === 'volkare') {
    if (state.volkare?.defeated) {
      state.scenario.objectiveCompleted = true;
      state.scenario.status = 'won';
      state.scenario.score = calculateConquestScore(state, content);
      state.phase = 'game-over';
      appendEvent(state, events, 'ScenarioWon', `Volkare 已被击败，最终得分 ${state.scenario.score.total}。`, { score: state.scenario.score });
      return true;
    }
    if (state.volkare?.reachedPortal || state.round > state.scenario.roundLimit) {
      state.scenario.status = 'lost';
      state.scenario.score = calculateConquestScore(state, content);
      state.phase = 'game-over';
      appendEvent(state, events, 'ScenarioLost', state.volkare?.reachedPortal ? 'Volkare 抵达传送门，场景失败。' : '轮数耗尽，场景失败。', { score: state.scenario.score });
      return true;
    }
    return false;
  }
  const objectiveMet = state.scenario.objectiveKind === 'cities'
    ? state.scenario.citiesConquered >= state.scenario.citiesRequired
    : state.scenario.objectiveKind === 'faction-leaders'
      ? state.scenario.leadersDefeated >= state.scenario.leadersRequired
      : state.scenario.objectiveKind === 'necromancer'
        ? state.scenario.leadersDefeated >= state.scenario.leadersRequired && state.scenario.graveyardsSealed >= state.scenario.graveyardsRequired
        : state.scenario.objectiveKind === 'relics'
          ? state.scenario.relicsFound >= state.scenario.relicsRequired
          : false;
  if (objectiveMet && !state.scenario.objectiveCompleted) {
    state.scenario.objectiveCompleted = true;
    if (state.scenario.finalTurnAfterObjective) {
      state.roundEndAnnounced = true;
      state.finalTurnsRemaining = Math.max(state.finalTurnsRemaining, 2);
      appendEvent(state, events, 'ScenarioObjectiveCompleted', '场景目标已完成，玩家还有最后一回合。');
      return false;
    }
  }
  if (objectiveMet && (!state.scenario.finalTurnAfterObjective || state.finalTurnsRemaining <= 0)) {
    state.scenario.status = 'won';
    state.scenario.score = calculateConquestScore(state, content);
    state.phase = 'game-over';
    appendEvent(state, events, 'ScenarioWon', `场景目标已完成，最终得分 ${state.scenario.score.total}。`, { score: state.scenario.score });
    return true;
  }
  if (state.round > state.scenario.roundLimit) {
    state.scenario.status = 'lost';
    state.scenario.score = calculateConquestScore(state, content);
    state.phase = 'game-over';
    appendEvent(state, events, 'ScenarioLost', `轮数耗尽，最终得分 ${state.scenario.score.total}。`, { score: state.scenario.score });
    return true;
  }
  return false;
}
