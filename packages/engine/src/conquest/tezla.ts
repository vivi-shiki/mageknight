import type { ConquestContent, FactionId } from '@mageknight/content';
import { areAdjacent, coordKey, hexDistance, neighbors } from '../hex';
import { explorationDistance, hasWall, revealNextTile } from './map';
import { addResource, appendEvent, conquestFailure } from './state';
import type { ConquestCommand, ConquestResult, ConquestState } from './types';

function discardToken(state: ConquestState, content: ConquestContent, tokenId: string): FactionId | undefined {
  const token = content.factionTokens[tokenId];
  const index = state.factionTokens.inventory.indexOf(tokenId);
  if (!token || index < 0 || state.factionTokens.usedNamesThisTurn.includes(token.name)) return undefined;
  state.factionTokens.inventory.splice(index, 1);
  state.factionTokens.discards[token.factionId].push(tokenId);
  state.factionTokens.usedNamesThisTurn.push(token.name);
  return token.factionId;
}

function spendAnyMana(state: ConquestState): boolean {
  for (const color of ['red', 'blue', 'white', 'green', 'gold', 'black'] as const) if (state.player.manaTokens[color] > 0) {
    state.player.manaTokens[color] -= 1;
    return true;
  }
  for (const color of ['red', 'blue', 'white', 'green'] as const) if (state.player.crystals[color] > 0) {
    state.player.crystals[color] -= 1;
    return true;
  }
  return false;
}

export function activateFactionToken(state: ConquestState, content: ConquestContent, command: Extract<ConquestCommand, { type: 'USE_FACTION_TOKEN' }>, events: ConquestState['eventLog']): ConquestResult | undefined {
  const token = content.factionTokens[command.tokenId];
  if (!token || !state.factionTokens.inventory.includes(command.tokenId)) return conquestFailure(state, 'INVALID_TARGET', '该阵营奖励不在物品区。');
  if (state.factionTokens.usedNamesThisTurn.includes(token.name)) return conquestFailure(state, 'INVALID_COMMAND', '同名阵营奖励每回合只能使用一次。');
  if ((command.choice === 'fame' || command.choice === 'influence') && state.phase !== 'interaction') return conquestFailure(state, 'WRONG_PHASE', '阵营奖励只能在互动时兑换名望或影响。');
  if (command.choice === 'fame') {
    state.player.fame += 1;
  } else if (command.choice === 'influence') {
    addResource(state, token.id, 'influence', 3);
  } else switch (token.kind) {
    case 'heal-or-remove-wound': {
      if (command.choice === 'remove') {
        const woundId = state.player.zones.discard.find((id) => state.player.cardInstances[id]?.definitionId === 'core.card.wound');
        if (!woundId) return conquestFailure(state, 'INVALID_TARGET', '弃牌堆没有伤牌。');
        state.player.zones.discard = state.player.zones.discard.filter((id) => id !== woundId);
        state.player.zones.removed.push(woundId);
      } else addResource(state, token.id, 'heal', 1);
      break;
    }
    case 'add-element': {
      const resource = state.player.resources.find((item) => item.id === command.targetId && (item.resource === 'attack' || item.resource === 'block'));
      if (!resource || !token.element) return conquestFailure(state, 'INVALID_TARGET', '请选择一个攻击或格挡来源。');
      resource.element = resource.element === 'physical' || resource.element === token.element ? token.element : 'cold-fire';
      break;
    }
    case 'remote-explore':
      if (state.phase !== 'movement' || state.countrysideTileDeck.length + state.coreTileDeck.length === 0) return conquestFailure(state, 'WRONG_PHASE', '秘法地图只能在移动阶段用于探索。');
      if (explorationDistance(state, state.player.position) > 3) return conquestFailure(state, 'INVALID_TARGET', '秘法地图只能揭示三格距离内的板块。');
      revealNextTile(state, content, events);
      break;
    case 'prevent-wound': state.ruleRuntime.preventNextHeroWound = true; break;
    case 'swap-skill': {
      if (state.phase.startsWith('combat')) return conquestFailure(state, 'WRONG_PHASE', '战斗中不能重学技能。');
      const index = state.player.skills.findIndex((skill) => skill.definitionId === command.targetId);
      const replacement = content.heroes[state.player.heroId]?.skillIds.find((id) => !state.player.skills.some((skill) => skill.definitionId === id));
      if (index < 0 || !replacement) return conquestFailure(state, 'INVALID_TARGET', '没有可交换的已获得技能或公共技能。');
      state.player.skills[index] = { definitionId: replacement, used: false, usedThisTurn: false, flipped: false };
      break;
    }
    case 'physical-attack-bonus': {
      const source = state.player.resources.find((item) => item.id === command.targetId && item.resource === 'attack' && item.element === 'physical');
      if (!source) return conquestFailure(state, 'INVALID_TARGET', '毒液瓶必须指定一个物理攻击来源。');
      const amount = source.attackKind === 'normal' ? 3 : source.attackKind === 'ranged' ? 2 : 1;
      addResource(state, token.id, 'attack', amount, source.attackKind, 'physical');
      break;
    }
    case 'discard-combat-wounds': state.ruleRuntime.discardCombatWounds = true; break;
    case 'make-ranged': {
      const source = state.player.resources.find((item) => item.id === command.targetId && item.resource === 'attack');
      if (!source) return conquestFailure(state, 'INVALID_TARGET', '幽魂药剂必须指定一个攻击来源。');
      source.attackKind = 'ranged';
      break;
    }
    case 'concealed-movement':
      addResource(state, token.id, 'move', 2);
      state.ruleRuntime.concealedMovement = true;
      break;
    case 'recover-discard': {
      if (state.player.zones.discard.length === 0) return conquestFailure(state, 'INVALID_TARGET', '弃牌堆为空。');
      state.rngState = (Math.imul(state.rngState, 1664525) + 1013904223) >>> 0;
      const index = state.rngState % state.player.zones.discard.length;
      const cardId = state.player.zones.discard.splice(index, 1)[0];
      if (cardId) state.player.zones.deck.push(cardId);
      state.player.handLimit += 1;
      state.lastingEffects.push({ id: `faction-token-${state.nextEntityId++}`, kind: 'hand-limit', amount: 1, expires: 'start-next-turn' });
      break;
    }
    case 'swap-source-mana': {
      const die = state.source.find((candidate) => candidate.id === command.targetId && (candidate.color === 'black' || candidate.color === 'gold'));
      if (!die) return conquestFailure(state, 'INVALID_TARGET', '暮光宝珠只能改变法力源中的金色或黑色骰。');
      die.color = die.color === 'black' ? 'gold' : 'black';
      break;
    }
  }
  discardToken(state, content, token.id);
  appendEvent(state, events, 'FactionTokenUsed', `使用阵营奖励“${token.name}”。`, { tokenId: token.id, choice: command.choice, targetId: command.targetId });
  return undefined;
}

export function sealGraveyard(state: ConquestState, events: ConquestState['eventLog']): ConquestResult | undefined {
  if (state.phase !== 'action') return conquestFailure(state, 'WRONG_PHASE', '只能在行动阶段封印墓地。');
  const overlay = state.overlays[coordKey(state.player.position)];
  if (!overlay || overlay.definitionId !== 'tezla.overlay.graveyard' || !overlay.liberated || overlay.sealed) return conquestFailure(state, 'INVALID_TARGET', '当前位置没有可封印的已解放墓地。');
  if (!spendAnyMana(state)) return conquestFailure(state, 'MANA_UNAVAILABLE', '封印墓地需要支付一枚法力令牌或水晶。');
  overlay.sealed = true;
  state.scenario.graveyardsSealed += 1;
  state.player.reputation = Math.min(7, state.player.reputation + 1);
  appendEvent(state, events, 'GraveyardSealed', '封印墓地并获得 1 声望。', { position: overlay.position });
  return undefined;
}

function ambushHasLine(state: ConquestState, enemy: { position: { q: number; r: number } }, destination: { q: number; r: number }): boolean {
  if (areAdjacent(enemy.position, destination)) return true;
  if (hexDistance(enemy.position, destination) !== 2) return false;
  return neighbors(enemy.position).some((middle) => areAdjacent(middle, destination) && state.map[coordKey(middle)] && !['mountain', 'lake'].includes(state.map[coordKey(middle)]!.terrain) && !hasWall(state, enemy.position, middle) && !hasWall(state, middle, destination));
}

export function ambushingEnemies(state: ConquestState, content: ConquestContent, origin: { q: number; r: number }, destination: { q: number; r: number }): string[] {
  if (state.ruleRuntime.concealedMovement || state.ruleRuntime.movementMode?.ignoreEnemies) return [];
  return Object.values(state.enemies).filter((enemy) => {
    const definition = content.enemies[enemy.definitionId];
    if (enemy.defeated || !(enemy.ambushing || definition?.abilities.includes('ambush'))) return false;
    return hexDistance(enemy.position, origin) <= 2 && hexDistance(enemy.position, destination) <= 2 && ambushHasLine(state, enemy, destination);
  }).map((enemy) => enemy.id);
}

export function resolvePursuit(state: ConquestState, content: ConquestContent, events: ConquestState['eventLog']): string[] {
  if (state.ruleRuntime.concealedMovement) return [];
  const pursuing = Object.values(state.enemies).filter((enemy) => !enemy.defeated && (enemy.pursuing || content.enemies[enemy.definitionId]?.abilities.includes('pursuit')));
  const heroSpace = state.map[coordKey(state.player.position)];
  const heroSite = heroSpace?.siteId ? content.sites[heroSpace.siteId] : undefined;
  const interactionSafe = Boolean(heroSite && (
    heroSite.kind === 'village'
    || heroSite.kind === 'refugee-camp'
    || (heroSite.kind === 'monastery' && !heroSpace?.burned)
    || (heroSite.fortified && heroSpace?.conquered)
  ));
  const fortifiedSafe = Boolean(heroSite?.fortified && !heroSpace?.conquered);
  const safeFromAttack = interactionSafe || fortifiedSafe;
  const previouslyExhausted = new Set(pursuing.filter((enemy) => enemy.pursuitExhausted).map((enemy) => enemy.id));
  const blockedFromAttack = new Set(safeFromAttack ? pursuing.filter((enemy) => areAdjacent(enemy.position, state.player.position) && !enemy.pursuitExhausted).map((enemy) => enemy.id) : []);
  const attackers = safeFromAttack ? [] : pursuing.filter((enemy) => areAdjacent(enemy.position, state.player.position) && !enemy.pursuitExhausted);
  if (attackers.length > 0) return attackers.map((enemy) => enemy.id);
  for (const enemy of pursuing) {
    if (previouslyExhausted.has(enemy.id)) { enemy.pursuitExhausted = false; continue; }
    if (blockedFromAttack.has(enemy.id)) { enemy.pursuitExhausted = true; continue; }
    const currentDistance = hexDistance(enemy.position, state.player.position);
    const destination = neighbors(enemy.position)
      .filter((coord) => state.map[coordKey(coord)])
      .filter((coord) => {
        const space = state.map[coordKey(coord)]!;
        return !(space.siteId && content.sites[space.siteId]?.fortified && !space.conquered);
      })
      .sort((left, right) => hexDistance(left, state.player.position) - hexDistance(right, state.player.position) || coordKey(left).localeCompare(coordKey(right)))[0];
    if (!destination || hexDistance(destination, state.player.position) >= currentDistance) continue;
    const oldSpace = state.map[coordKey(enemy.position)];
    const newSpace = state.map[coordKey(destination)];
    if (oldSpace) oldSpace.enemyIds = oldSpace.enemyIds.filter((id) => id !== enemy.id);
    newSpace?.enemyIds.push(enemy.id);
    enemy.position = { ...destination };
    appendEvent(state, events, 'EnemyPursued', `${content.enemies[enemy.definitionId]?.name ?? enemy.id}向英雄追击一格。`, { enemyId: enemy.id, to: destination });
  }
  return [];
}
