import { describe, expect, it } from 'vitest';
import { ContentRegistry, tutorialContent, v01ContentManifest } from '../index';

function addon(overrides: Record<string, unknown> = {}) {
  return {
    id: 'core.module.addon',
    version: '0.2.0',
    requires: [v01ContentManifest.id],
    conflicts: [],
    cards: [{
      id: 'core.card.addon-test', name: '扩展测试牌', source: 'test', color: 'red', kind: 'advanced',
      basic: { resource: 'attack', amount: 1 }, assetAlias: 'card.addon-test',
    }],
    ...overrides,
  };
}

describe('content module registry', () => {
  it('ST-200 builds the v0.1 runtime from the validated canonical manifest', () => {
    expect(tutorialContent.basicDeck).toEqual(v01ContentManifest.basicDeck);
    for (const definition of v01ContentManifest.cards) {
      expect(tutorialContent.cards[definition.id]).toEqual({
        id: definition.id,
        name: definition.name,
        color: definition.color,
        kind: definition.kind,
        ...(definition.basic ? { basic: definition.basic } : {}),
        ...(definition.strong ? { strong: definition.strong } : {}),
        assetAlias: definition.assetAlias,
      });
    }
  });

  it('CT-200 resolves required modules and leaks no disabled entities', () => {
    const registry = new ContentRegistry([v01ContentManifest, addon()]);
    expect(registry.resolve([v01ContentManifest.id]).has('core.card.addon-test')).toBe(false);
    expect(registry.resolve([v01ContentManifest.id, 'core.module.addon']).has('core.card.addon-test')).toBe(true);
    expect(() => registry.resolve(['core.module.addon'])).toThrow(`requires ${v01ContentManifest.id}`);
  });

  it('ST-201 rejects module conflicts and duplicate entity IDs', () => {
    const conflicting = addon({ id: 'core.module.conflict', conflicts: [v01ContentManifest.id], cards: [] });
    expect(() => new ContentRegistry([v01ContentManifest, conflicting]).resolve([v01ContentManifest.id, 'core.module.conflict'])).toThrow('conflicts');
    const duplicate = addon({ cards: [{ ...v01ContentManifest.cards[0] }] });
    expect(() => new ContentRegistry([v01ContentManifest, duplicate]).resolve([v01ContentManifest.id, 'core.module.addon'])).toThrow('Duplicate entity ID');
  });
});
