import { conquestContent, createConquestContent, v02ContentManifest, v05RulesManifest, v07KrangManifest, v08ShadesOfTezlaManifest } from '@mageknight/content';
import { lintConquestContentManifest, lintKrangContentManifestV7, lintRulesContentManifestV5, lintShadesOfTezlaContentManifestV8 } from '../index';
import { describe, expect, it } from 'vitest';

describe('v0.5 core content package', () => {
  it('ST-320 preserves v0.2 validity and exposes complete core decks', () => {
    expect(lintConquestContentManifest(v02ContentManifest)).toEqual([]);
    expect(conquestContent.advancedDeck.filter((id) => id.startsWith('core.'))).toHaveLength(16);
    expect(conquestContent.spellDeck.filter((id) => id.startsWith('core.'))).toHaveLength(16);
    expect(conquestContent.artifactDeck.filter((id) => id.startsWith('core.'))).toHaveLength(16);
    expect(conquestContent.regularUnitDeck.filter((id) => id.startsWith('core.'))).toHaveLength(20);
    expect(conquestContent.eliteUnitDeck.filter((id) => id.startsWith('core.'))).toHaveLength(20);
    expect(Object.values(conquestContent.tactics)).toHaveLength(12);
    expect(Object.values(conquestContent.heroes).filter((hero) => hero.id.startsWith('core.'))).toHaveLength(4);
    expect(Object.values(conquestContent.scenarios).filter((scenario) => scenario.id.startsWith('core.'))).toHaveLength(2);
    for (const hero of Object.values(conquestContent.heroes).filter((candidate) => candidate.id.startsWith('core.'))) {
      expect(hero.basicDeck, hero.id).toHaveLength(16);
      expect(hero.skillIds, hero.id).toHaveLength(9);
      expect(hero.sourceRef).toBeTruthy();
    }
  });

  it('ST-280 keeps source and replaceable asset aliases on every runtime entity', () => {
    for (const card of Object.values(conquestContent.cards)) expect(card.assetAlias).toBeTruthy();
    for (const unit of Object.values(conquestContent.units)) expect(unit.assetAlias).toBeTruthy();
    for (const enemy of Object.values(conquestContent.enemies)) expect(enemy.assetAlias).toBeTruthy();
    for (const tile of Object.values(conquestContent.tiles)) expect(tile.assetAlias).toBeTruthy();
  });

  it('CT-320 gives every v0.3 market card a supported positive resource effect', () => {
    const marketIds = [...conquestContent.advancedDeck, ...conquestContent.spellDeck, ...conquestContent.artifactDeck].filter((id) => id.startsWith('core.'));
    for (const definitionId of marketIds) {
      const card = conquestContent.cards[definitionId];
      expect(card, definitionId).toBeDefined();
      expect(card?.basic?.amount, `${definitionId} basic`).toBeGreaterThan(0);
      expect(card?.strong?.amount, `${definitionId} strong`).toBeGreaterThan(0);
      expect(['move', 'influence', 'attack', 'block', 'heal']).toContain(card?.basic?.resource);
      expect(['move', 'influence', 'attack', 'block', 'heal']).toContain(card?.strong?.resource);
    }
  });

  it('ST-410 covers every selected card, unique unit and hero skill with executable rules', () => {
    const cardIds = [...conquestContent.advancedDeck, ...conquestContent.spellDeck, ...conquestContent.artifactDeck].filter((id) => id.startsWith('core.'));
    const unitIds = [...new Set([...conquestContent.regularUnitDeck, ...conquestContent.eliteUnitDeck].filter((id) => id.startsWith('core.')))];
    const skillIds = [...new Set(Object.values(conquestContent.heroes).filter((hero) => hero.id.startsWith('core.')).flatMap((hero) => hero.skillIds))];
    expect(lintRulesContentManifestV5(v05RulesManifest, { cardIds, unitIds, skillIds })).toEqual([]);
    expect(v05RulesManifest.cardRules).toHaveLength(48);
    expect(v05RulesManifest.unitRules).toHaveLength(20);
    expect(v05RulesManifest.skillRules).toHaveLength(36);
    expect([...v05RulesManifest.cardRules, ...v05RulesManifest.unitRules, ...v05RulesManifest.skillRules].every((rule) => rule.implementation === 'full')).toBe(true);
  });

  it('ST-411 exposes source text, implementation state and effect nodes at runtime', () => {
    for (const id of [...conquestContent.advancedDeck, ...conquestContent.spellDeck, ...conquestContent.artifactDeck]) {
      const card = conquestContent.cards[id];
      expect(card?.basicText, `${id} basic text`).toBeTruthy();
      expect(card?.strongText, `${id} strong text`).toBeTruthy();
      expect(card?.basicEffect, `${id} basic effect`).toBeDefined();
      expect(card?.strongEffect, `${id} strong effect`).toBeDefined();
      expect(['full', 'modeled']).toContain(card?.implementation);
      expect(card?.sourceRef).toBeTruthy();
    }
  });
});

describe('v0.6.1 module isolation and v0.7 Krang', () => {
  it('ST-700 builds four deterministic module combinations without content leakage', () => {
    const core = createConquestContent([]);
    const lostLegion = createConquestContent(['lost-legion.official-v0.6']);
    const krang = createConquestContent(['krang.character-v0.7']);
    const all = createConquestContent(['lost-legion.official-v0.6', 'krang.character-v0.7']);
    expect(new Set([core.contentHash, lostLegion.contentHash, krang.contentHash, all.contentHash]).size).toBe(4);
    expect(createConquestContent([]).contentHash).toBe(core.contentHash);
    const allIds = (content: typeof core) => [
      ...Object.keys(content.heroes), ...Object.keys(content.scenarios), ...Object.keys(content.cards), ...Object.keys(content.skills),
      ...Object.keys(content.units), ...Object.keys(content.enemies), ...Object.keys(content.sites), ...Object.keys(content.tiles),
      ...content.advancedDeck, ...content.spellDeck, ...content.artifactDeck, ...content.regularUnitDeck, ...content.eliteUnitDeck,
      ...Object.values(content.enemyPools).flat(), ...content.countrysideTiles, ...content.coreTiles,
    ];
    expect(allIds(core).some((id) => id.startsWith('lost-legion.') || id.startsWith('krang.'))).toBe(false);
    expect(Object.keys(lostLegion.heroes)).toContain('lost-legion.hero.wolfhawk');
    expect(allIds(lostLegion).some((id) => id.startsWith('krang.'))).toBe(false);
    expect(Object.keys(krang.heroes)).toContain('krang.hero.krang');
    expect(allIds(krang).some((id) => id.startsWith('lost-legion.'))).toBe(false);
    expect(all.enabledModules).toEqual([...core.enabledModules, 'lost-legion.official-v0.6', 'krang.character-v0.7']);
  });

  it('ST-701 validates Krang and exposes the printed solo component counts', () => {
    expect(lintKrangContentManifestV7(v07KrangManifest)).toEqual([]);
    const krang = createConquestContent(['krang.character-v0.7']);
    expect(krang.heroes['krang.hero.krang']?.basicDeck).toHaveLength(16);
    expect(krang.heroes['krang.hero.krang']?.skillIds).toHaveLength(9);
    expect(krang.skills['krang.skill.shamanic-ritual']?.flipBackCondition).toBe('action');
    expect(krang.skills['krang.skill.arcane-disguise']?.flipBackCondition).toBe('pay-green');
    expect(krang.skills['krang.skill.battle-frenzy']?.flipBackCondition).toBe('rest');
    expect(krang.skills['krang.skill.mana-enhancement']).toBeUndefined();
  });
});

describe('v0.8 Shades of Tezla content', () => {
  it('ST-800 validates every printed solo component group', () => {
    expect(lintShadesOfTezlaContentManifestV8(v08ShadesOfTezlaManifest)).toEqual([]);
    const tezla = createConquestContent(['shades-of-tezla.official-v0.8']);
    expect(tezla.heroes['tezla.hero.braevalar']?.basicDeck).toHaveLength(16);
    expect(tezla.heroes['tezla.hero.braevalar']?.skillIds).toHaveLength(9);
    expect(Object.values(tezla.factionEnemyPools).flatMap((pools) => Object.values(pools).flat()).length).toBe(32);
    expect(Object.values(tezla.factionTokens).reduce((sum, token) => sum + token.copies, 0)).toBe(24);
    expect(Object.values(tezla.factionLeaders)).toHaveLength(2);
    expect(Object.values(tezla.factionLeaders).every((leader) => leader.levels.length === 12)).toBe(true);
    expect(Object.values(tezla.siteOverlays)).toHaveLength(3);
    expect(Object.values(tezla.scenarios).filter((scenario) => scenario.id.startsWith('tezla.'))).toHaveLength(4);
  });

  it('ST-801 builds all eight optional-module combinations without leakage', () => {
    const optional = ['lost-legion.official-v0.6', 'krang.character-v0.7', 'shades-of-tezla.official-v0.8'] as const;
    const builds = Array.from({ length: 8 }, (_, mask) => createConquestContent(optional.filter((_, index) => (mask & (1 << index)) !== 0)));
    expect(new Set(builds.map((content) => content.contentHash)).size).toBe(8);
    for (const [mask, content] of builds.entries()) {
      expect(Boolean(content.heroes['lost-legion.hero.wolfhawk'])).toBe(Boolean(mask & 1));
      expect(Boolean(content.heroes['krang.hero.krang'])).toBe(Boolean(mask & 2));
      expect(Boolean(content.heroes['tezla.hero.braevalar'])).toBe(Boolean(mask & 4));
      expect(Boolean(content.scenarios['tezla.scenario.life-and-death'])).toBe(Boolean(mask & 4));
    }
  });
});
