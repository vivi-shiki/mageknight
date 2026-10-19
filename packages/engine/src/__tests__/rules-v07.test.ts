import { createConquestContent, v07KrangManifest } from '@mageknight/content';
import { lintKrangContentManifestV7 } from '@mageknight/content-schema';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_SPECIAL_RULES, createConquestGame, executeConquestIntent } from '../index';
import type { ConquestCommand, ConquestState } from '../index';

const content = createConquestContent(['krang.character-v0.7']);

function run(state: ConquestState, command: ConquestCommand): ConquestState {
  const result = executeConquestIntent(state, command, content);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.state;
}

function addSkill(state: ConquestState, definitionId: string) {
  state.player.skills.push({ definitionId, used: false, usedThisTurn: false, flipped: false });
}

function specialRules(value: unknown, output = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => specialRules(item, output));
  else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.type === 'special' && typeof record.rule === 'string') output.add(record.rule);
    Object.values(record).forEach((item) => specialRules(item, output));
  }
  return output;
}

describe('v0.7 Krang character expansion', () => {
  it('ST-702 validates every Krang special rule against the executable registry', () => {
    expect(lintKrangContentManifestV7(v07KrangManifest)).toEqual([]);
    expect([...specialRules(v07KrangManifest)].filter((rule) => !SUPPORTED_SPECIAL_RULES.has(rule))).toEqual([]);
  });

  it('ST-703 creates the isolated 16-card Krang deck', () => {
    const state = createConquestGame({ seed: 'krang', difficulty: 'standard', heroId: 'krang.hero.krang' }, content);
    expect(state).toMatchObject({ schemaVersion: 8, appVersion: '0.8.0', contentVersion: '0.8.0' });
    expect(state.enabledModules).toContain('krang.character-v0.7');
    expect(state.enabledModules).not.toContain('lost-legion.official-v0.6');
    expect(Object.values(state.player.cardInstances)).toHaveLength(16);
    expect(Object.values(state.player.cardInstances).map((card) => card.definitionId)).toEqual(expect.arrayContaining(['krang.card.ruthless-coercion', 'krang.card.savage-harvesting']));
  });

  it('CT-700 flips Battle Frenzy and flips it back through a real rest action', () => {
    let state = createConquestGame({ seed: 'battle-frenzy', difficulty: 'standard', heroId: 'krang.hero.krang' }, content);
    addSkill(state, 'krang.skill.battle-frenzy');
    state.phase = 'combat-attack';
    state = run(state, { type: 'USE_SKILL', skillId: 'krang.skill.battle-frenzy', choiceIndex: 1 });
    expect(state.player.skills[0]).toMatchObject({ flipped: true, usedThisTurn: true });
    expect(state.player.resources.some((resource) => resource.resource === 'attack' && resource.amount === 4)).toBe(true);
    state.phase = 'movement';
    const discardCardId = state.player.zones.hand.find((id) => state.player.cardInstances[id]?.definitionId !== 'core.card.wound')!;
    state = run(state, { type: 'REST', discardCardId, woundCardIds: [] });
    expect(state.player.skills[0]).toMatchObject({ flipped: false });
    expect(state).toMatchObject({ phase: 'action', actionTaken: true });
  });

  it('CT-701 handles action and green-mana flip-back conditions generically', () => {
    let state = createConquestGame({ seed: 'flip-back', difficulty: 'standard', heroId: 'krang.hero.krang' }, content);
    addSkill(state, 'krang.skill.shamanic-ritual');
    addSkill(state, 'krang.skill.arcane-disguise');
    state.phase = 'movement';
    state = run(state, { type: 'USE_SKILL', skillId: 'krang.skill.shamanic-ritual', manaColors: ['blue'] });
    expect(state.player.manaTokens.blue).toBe(1);
    state.player.skills[0]!.usedThisTurn = false;
    state.phase = 'action';
    state = run(state, { type: 'FLIP_BACK_SKILL', skillId: 'krang.skill.shamanic-ritual' });
    expect(state.player.skills[0]?.flipped).toBe(false);
    expect(state.actionTaken).toBe(true);

    state.phase = 'interaction';
    state = run(state, { type: 'USE_SKILL', skillId: 'krang.skill.arcane-disguise', choiceIndex: 1 });
    state.player.manaTokens.green = 1;
    state = run(state, { type: 'FLIP_BACK_SKILL', skillId: 'krang.skill.arcane-disguise' });
    expect(state.player.skills[1]?.flipped).toBe(false);
    expect(state.player.manaTokens.green).toBe(0);
  });

  it('CT-702 enforces once-per-turn use for ordinary Krang skills', () => {
    const state = createConquestGame({ seed: 'once-turn', difficulty: 'standard', heroId: 'krang.hero.krang' }, content);
    addSkill(state, 'krang.skill.spirit-guides');
    state.phase = 'movement';
    const first = executeConquestIntent(state, { type: 'USE_SKILL', skillId: 'krang.skill.spirit-guides' }, content);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(executeConquestIntent(first.state, { type: 'USE_SKILL', skillId: 'krang.skill.spirit-guides' }, content).ok).toBe(false);
  });

  it('CT-703 resolves Curse per attack and Regenerate with red mana', () => {
    let state = createConquestGame({ seed: 'curse-regenerate', difficulty: 'standard', heroId: 'krang.hero.krang' }, content);
    addSkill(state, 'krang.skill.curse');
    addSkill(state, 'krang.skill.regenerate');
    state.enemies.fixture = { id: 'fixture', definitionId: 'core.enemy.brown.minotaur', position: { q: 0, r: 0 }, defeated: false, summoned: false };
    state.encounter = { enemyIds: ['fixture'], origin: { q: 0, r: 0 }, phase: 'block', incoming: [], defeatedThisCombat: [], heroWoundsGained: 0, fullyBlockedEnemyIds: [] };
    state.phase = 'combat-block';
    state = run(state, { type: 'USE_SKILL', skillId: 'krang.skill.curse', targetId: 'fixture', choiceIndex: 0, amount: 0 });
    expect(state.enemyModifiers.fixture?.attackByIndex).toEqual({ 0: -1 });

    delete state.encounter;
    const woundId = 'krang-test-wound';
    const spare = state.player.zones.hand.pop();
    if (spare) state.player.zones.discard.push(spare);
    state.player.cardInstances[woundId] = { id: woundId, definitionId: 'core.card.wound' };
    state.player.zones.hand.push(woundId);
    state.player.manaTokens.red = 1;
    state.phase = 'movement';
    state = run(state, { type: 'USE_SKILL', skillId: 'krang.skill.regenerate', targetId: woundId, manaColors: ['red'] });
    expect(state.player.zones.removed).toContain(woundId);
    expect(state.player.manaTokens.red === 0 || state.source.some((die) => die.color === 'red' && die.used)).toBe(true);
    expect(state.player.zones.hand).toHaveLength(state.player.handLimit);
  });

  it('CT-704 turns Savage Harvesting movement into a replaceable crystal choice', () => {
    let state = createConquestGame({ seed: 'savage', difficulty: 'standard', heroId: 'krang.hero.krang' }, content);
    const savageId = Object.values(state.player.cardInstances).find((card) => card.definitionId === 'krang.card.savage-harvesting')!.id;
    for (const zone of Object.keys(state.player.zones) as Array<keyof typeof state.player.zones>) state.player.zones[zone] = state.player.zones[zone].filter((id) => id !== savageId);
    state.player.zones.hand.push(savageId);
    state.phase = 'movement';
    state = run(state, { type: 'PLAY_CARD', cardId: savageId, mode: 'basic' });
    state = run(state, { type: 'MOVE_HERO', to: { q: 1, r: 0 } });
    expect(state.ruleRuntime.harvestOpportunities).toBe(1);
    const discardId = state.player.zones.hand.find((id) => state.player.cardInstances[id]?.definitionId !== 'core.card.wound')!;
    const color = content.cards[state.player.cardInstances[discardId]!.definitionId]!.color;
    state = run(state, { type: 'HARVEST_CRYSTAL', cardId: discardId });
    expect(state.player.crystals[color]).toBe(1);
    expect(state.ruleRuntime.harvestOpportunities).toBe(0);
  });
});
