import { conquestContent, v05RulesManifest } from '@mageknight/content';
import { createConquestGame, executeConquestIntent, getConquestLegalIntents, SUPPORTED_SPECIAL_RULES } from '../index';
import type { ConquestCommand, ConquestState } from '../index';
import { describe, expect, it } from 'vitest';

function run(state: ConquestState, command: ConquestCommand): ConquestState {
  const result = executeConquestIntent(state, command, conquestContent);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.state;
}

function stateAt(seed: string, phase: ConquestState['phase'] = 'movement'): ConquestState {
  const state = createConquestGame({ seed, difficulty: 'standard' }, conquestContent);
  state.phase = phase;
  return state;
}

function giveCard(state: ConquestState, definitionId: string, zone: 'hand' | 'discard' = 'hand'): string {
  const id = `fixture-card-${state.nextEntityId++}`;
  state.player.cardInstances[id] = { id, definitionId };
  state.player.zones[zone].push(id);
  return id;
}

function sourceFor(state: ConquestState, definitionId: string, black = false): void {
  const color = conquestContent.cards[definitionId]?.color ?? 'red';
  state.source = [{ id: 'source-color', color, used: false }, ...(black ? [{ id: 'source-black', color: 'black' as const, used: false }] : [])];
}

function addResource(state: ConquestState, resource: 'move' | 'attack' | 'block' | 'heal', amount: number): void {
  state.player.resources.push({ id: `fixture-${state.nextEntityId++}`, sourceId: 'fixture', resource, amount, attackKind: 'normal', element: 'physical' });
}

function addEnemy(state: ConquestState, id = 'enemy-1'): string {
  state.enemies[id] = { id, definitionId: 'core.enemy.green.diggers', position: { q: 0, r: 0 }, defeated: false, summoned: false };
  state.map['0,0']!.enemyIds = [id];
  return id;
}

describe('v0.5 full rules runtime', () => {
  it('CT-500 has a registered runtime handler for every special rule', () => {
    const rules = new Set<string>();
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      if (record.type === 'special' && typeof record.rule === 'string') rules.add(record.rule);
      for (const value of Object.values(record)) if (Array.isArray(value)) value.forEach(walk); else walk(value);
    };
    walk(v05RulesManifest);
    expect([...rules].filter((rule) => !SUPPORTED_SPECIAL_RULES.has(rule))).toEqual([]);
  });
  it('CT-510 converts Agility movement into combat attack', () => {
    let state = stateAt('agility');
    const cardId = giveCard(state, 'core.card.advanced.agility');
    state = run(state, { type: 'PLAY_CARD', cardId, mode: 'basic' });
    expect(state.ruleRuntime.moveToAttack).toBe('normal');
    addResource(state, 'move', 2);
    const enemyId = addEnemy(state);
    state.phase = 'combat-attack';
    state.encounter = { enemyIds: [enemyId], origin: { q: 0, r: 0 }, phase: 'attack', incoming: [], defeatedThisCombat: [], heroWoundsGained: 0, fullyBlockedEnemyIds: [] };
    state = run(state, { type: 'DECLARE_ATTACK', enemyIds: [enemyId], kind: 'normal' });
    expect(state.enemies[enemyId]?.defeated).toBe(true);
  });

  it('CT-511 applies Refreshing Walk phase-specific healing', () => {
    let state = stateAt('refresh-walk', 'combat-block');
    const cardId = giveCard(state, 'core.card.advanced.refreshing-walk');
    state = run(state, { type: 'PLAY_CARD', cardId, mode: 'basic' });
    expect(state.player.resources.some((resource) => resource.resource === 'move' && resource.amount === 2)).toBe(true);
    expect(state.player.resources.some((resource) => resource.resource === 'heal')).toBe(false);
  });

  it('CT-512 resolves arbitrary mana choice and removes strong artifacts', () => {
    let state = stateAt('blood-mana');
    const blood = giveCard(state, 'core.card.advanced.blood-ritual');
    state = run(state, { type: 'PLAY_CARD', cardId: blood, mode: 'basic', manaColors: ['green'] });
    expect(state.player.manaTokens.green).toBe(1);

    state = stateAt('artifact-remove');
    const pouch = giveCard(state, 'core.card.artifact.gem-pouch');
    state = run(state, { type: 'PLAY_CARD', cardId: pouch, mode: 'strong' });
    expect(state.player.zones.removed).toContain(pouch);
    expect(state.player.manaTokens).toMatchObject({ red: 1, blue: 1, white: 1, green: 1, gold: 1 });
  });

  it('CT-513 permits Space Bending distance-two movement', () => {
    let state = stateAt('space-bending');
    state.map['2,0'] = { coord: { q: 2, r: 0 }, terrain: 'plains', tileId: 'fixture', revealed: true, conquered: false, burned: false, enemyIds: [] };
    const cardId = giveCard(state, 'core.card.spell.space-bending');
    sourceFor(state, 'core.card.spell.space-bending');
    state = run(state, { type: 'PLAY_CARD', cardId, mode: 'basic' });
    addResource(state, 'move', 2);
    expect(getConquestLegalIntents(state, conquestContent).some((intent) => intent.command.type === 'MOVE_HERO' && intent.command.to.q === 2)).toBe(true);
    state = run(state, { type: 'MOVE_HERO', to: { q: 2, r: 0 } });
    expect(state.player.position).toEqual({ q: 2, r: 0 });
  });

  it('CT-514 resolves selected Meditation cards deterministically', () => {
    let state = stateAt('meditation');
    state.time = 'night';
    const meditation = giveCard(state, 'core.card.spell.meditation');
    const first = giveCard(state, 'core.card.basic.march', 'discard');
    const second = giveCard(state, 'core.card.basic.stamina', 'discard');
    sourceFor(state, 'core.card.spell.meditation', true);
    state = run(state, { type: 'PLAY_CARD', cardId: meditation, mode: 'strong', targetId: first, targetIds: [first, second] });
    expect(state.player.zones.discard).not.toContain(first);
    expect(state.player.zones.discard).not.toContain(second);
    expect(state.player.zones.deck).toContain(first);
    expect(state.player.zones.deck).toContain(second);
  });

  it('CT-515 turns a successful Burning Shield block into Fire Attack', () => {
    let state = stateAt('burning-shield', 'combat-block');
    const enemyId = addEnemy(state);
    state.encounter = { enemyIds: [enemyId], origin: { q: 0, r: 0 }, phase: 'block', incoming: [{ enemyId, attackIndex: 0, attack: 3, element: 'physical', blocked: false, resolved: false, summoned: false }], defeatedThisCombat: [], heroWoundsGained: 0, fullyBlockedEnemyIds: [] };
    const cardId = giveCard(state, 'core.card.spell.burning-shield');
    sourceFor(state, 'core.card.spell.burning-shield');
    state = run(state, { type: 'PLAY_CARD', cardId, mode: 'basic' });
    state = run(state, { type: 'DECLARE_BLOCK', enemyId, attackIndex: 0 });
    expect(state.player.resources.some((resource) => resource.resource === 'attack' && resource.amount === 4 && resource.element === 'fire')).toBe(true);
  });

  it('CT-516 borrows a unit offer ability with Call to Arms', () => {
    let state = stateAt('call-to-arms');
    state.market.unit.offer = ['core.unit.regular.foresters'];
    const cardId = giveCard(state, 'core.card.spell.call-to-arms');
    sourceFor(state, 'core.card.spell.call-to-arms');
    state = run(state, { type: 'PLAY_CARD', cardId, mode: 'basic', targetId: 'core.unit.regular.foresters', secondaryIndex: 0 });
    expect(state.player.resources.some((resource) => resource.resource === 'move' && resource.amount === 2)).toBe(true);
    expect(state.player.units).toHaveLength(0);
  });

  it('CT-517 persists Banner of Glory and modifies its unit', () => {
    let state = stateAt('banner', 'combat-attack');
    state.player.units.push({ id: 'unit-1', definitionId: 'core.unit.regular.swordsmen', ready: true, wounds: 0, destroyed: false });
    const banner = giveCard(state, 'core.card.artifact.banner');
    state = run(state, { type: 'PLAY_CARD', cardId: banner, mode: 'basic', targetId: 'unit-1' });
    expect(state.player.zones['set-aside']).toContain(banner);
    expect(state.attachments).toEqual([expect.objectContaining({ cardId: banner, unitId: 'unit-1' })]);
    state = run(state, { type: 'ACTIVATE_UNIT', unitId: 'unit-1', abilityIndex: 0, choiceIndex: 0 });
    expect(state.player.resources.some((resource) => resource.resource === 'attack' && resource.amount === 4)).toBe(true);
    expect(state.player.fame).toBe(1);
  });

  it('CT-518 applies Golden Grail healing triggers', () => {
    let state = stateAt('grail');
    const wound = giveCard(state, 'core.card.wound');
    const grail = giveCard(state, 'core.card.artifact.golden-grail');
    state = run(state, { type: 'PLAY_CARD', cardId: grail, mode: 'basic' });
    state = run(state, { type: 'HEAL_WOUND', target: 'hero', woundId: wound });
    expect(state.player.zones.removed).toContain(wound);
    expect(state.player.fame).toBe(1);
  });

  it('CT-519 discards multiple cards for Sword of Justice attack', () => {
    let state = stateAt('sword', 'combat-attack');
    const sword = giveCard(state, 'core.card.artifact.sword');
    const first = giveCard(state, 'core.card.basic.march');
    const second = giveCard(state, 'core.card.basic.stamina');
    state = run(state, { type: 'PLAY_CARD', cardId: sword, mode: 'basic', targetId: first, targetIds: [first, second] });
    expect(state.player.resources.some((resource) => resource.resource === 'attack' && resource.amount === 6)).toBe(true);
    expect(state.player.zones.discard).toEqual(expect.arrayContaining([first, second]));
  });

  it('CT-519b doubles physical attack gained after Sword of Justice resolves', () => {
    let state = stateAt('sword-strong', 'combat-attack');
    const sword = giveCard(state, 'core.card.artifact.sword');
    state = run(state, { type: 'PLAY_CARD', cardId: sword, mode: 'strong' });
    expect(state.ruleRuntime.doublePhysicalAttacks).toBe(true);
    expect(state.player.zones.removed).toContain(sword);

    addResource(state, 'attack', 2);
    const enemyId = addEnemy(state);
    state.encounter = { enemyIds: [enemyId], origin: { q: 0, r: 0 }, phase: 'attack', incoming: [], defeatedThisCombat: [], heroWoundsGained: 0, fullyBlockedEnemyIds: [] };
    state = run(state, { type: 'DECLARE_ATTACK', enemyIds: [enemyId], kind: 'normal' });
    expect(state.enemies[enemyId]?.defeated).toBe(true);
  });

  it('CT-520 starts the Time Bending extra turn with played cards returned', () => {
    let state = stateAt('time-bending');
    state.time = 'night';
    const prior = giveCard(state, 'core.card.basic.march');
    state.player.zones.hand = state.player.zones.hand.filter((id) => id !== prior);
    state.player.zones.play.push(prior);
    const spell = giveCard(state, 'core.card.spell.space-bending');
    sourceFor(state, 'core.card.spell.space-bending', true);
    const turn = state.turn;
    state = run(state, { type: 'PLAY_CARD', cardId: spell, mode: 'strong' });
    expect(state.turn).toBe(turn + 1);
    expect(state.phase).toBe('movement');
    expect(state.player.zones.hand).toContain(prior);
    expect(state.player.zones['set-aside']).toContain(spell);
  });

  it('CT-521 removes wounds received this turn with Banner of Protection', () => {
    let state = stateAt('protection');
    const banner = giveCard(state, 'core.card.artifact.banner-protection');
    const wound = giveCard(state, 'core.card.wound', 'discard');
    state.turnWoundIds.push(wound);
    state = run(state, { type: 'PLAY_CARD', cardId: banner, mode: 'strong' });
    state.phase = 'action';
    state = run(state, { type: 'END_TURN' });
    expect(state.player.zones.removed).toEqual(expect.arrayContaining([banner, wound]));
  });

  it('CT-522 applies Heroic Tale bonuses when recruiting', () => {
    let state = stateAt('heroic-tale', 'interaction');
    const definitionId = Object.values(conquestContent.units).find((unit) => unit.siteKinds.includes('village'))!.id;
    state.market.unit.offer = [definitionId];
    const cardId = giveCard(state, 'core.card.advanced.heroic-tale');
    state.player.resources.push({ id: 'influence-fixture', sourceId: 'fixture', resource: 'influence', amount: 20, attackKind: 'normal', element: 'physical' });
    state = run(state, { type: 'PLAY_CARD', cardId, mode: 'basic' });
    state = run(state, { type: 'BUY_MARKET', market: 'unit', definitionId });
    expect(state.player.reputation).toBe(1);
    expect(state.player.units[0]?.definitionId).toBe(definitionId);
  });

  it('CT-523 doubles Guardsmen block against Swiftness', () => {
    let state = stateAt('swift-block', 'combat-block');
    state.player.units.push({ id: 'unit-1', definitionId: 'core.unit.regular.guardsmen', ready: true, wounds: 0, destroyed: false });
    const enemyId = 'enemy-swift';
    state.enemies[enemyId] = { id: enemyId, definitionId: 'core.enemy.gray.crossbowmen', position: { q: 0, r: 0 }, defeated: false, summoned: false };
    state.encounter = { enemyIds: [enemyId], origin: { q: 0, r: 0 }, phase: 'block', incoming: [{ enemyId, attackIndex: 0, attack: 3, element: 'physical', blocked: false, resolved: false, summoned: false }], defeatedThisCombat: [], heroWoundsGained: 0, fullyBlockedEnemyIds: [] };
    state = run(state, { type: 'ACTIVATE_UNIT', unitId: 'unit-1', abilityIndex: 1 });
    state = run(state, { type: 'DECLARE_BLOCK', enemyId, attackIndex: 0 });
    expect(state.encounter?.incoming[0]?.blocked).toBe(true);
  });

  it('CT-524 discards a replaced unit attachment', () => {
    let state = stateAt('replace-attachment', 'decision');
    const replacement = Object.values(conquestContent.units).find((unit) => unit.id !== 'core.unit.regular.swordsmen')!.id;
    const banner = giveCard(state, 'core.card.artifact.banner');
    state.player.zones.hand = state.player.zones.hand.filter((id) => id !== banner);
    state.player.zones['set-aside'].push(banner);
    state.player.units.push({ id: 'unit-old', definitionId: 'core.unit.regular.swordsmen', ready: true, wounds: 0, destroyed: false });
    state.attachments.push({ id: 'attachment-1', cardId: banner, definitionId: 'core.card.artifact.banner', unitId: 'unit-old', used: false });
    state.market.unit.offer = [replacement];
    state.pendingDecision = {
      id: 'decision-replace', kind: 'replace-unit', prompt: 'replace',
      options: [{ id: 'unit-old', label: 'replace' }, { id: 'cancel', label: 'cancel' }],
      returnPhase: 'interaction', context: { definitionId: replacement, cost: 0 },
    };

    state = run(state, { type: 'RESOLVE_DECISION', optionId: 'unit-old' });
    expect(state.attachments).toEqual([]);
    expect(state.player.zones['set-aside']).not.toContain(banner);
    expect(state.player.zones.discard).toContain(banner);
  });
});
