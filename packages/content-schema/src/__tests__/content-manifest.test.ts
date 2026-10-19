import { tutorialContent, v01ContentManifest } from '@mageknight/content';
import { contentManifestSchema, lintContentManifest } from '../index';
import { describe, expect, it } from 'vitest';

describe('v0.1 content manifest', () => {
  it('ST-010 validates the frozen schema and contains no placeholders', () => {
    expect(contentManifestSchema.safeParse(v01ContentManifest).success).toBe(true);
    expect(lintContentManifest(v01ContentManifest)).toEqual([]);
  });

  it('ST-011 contains exactly the runtime basic deck IDs', () => {
    const manifestIds = v01ContentManifest.cards.filter((card) => card.kind === 'basic').map((card) => card.id);
    expect(manifestIds).toHaveLength(16);
    expect(new Set(manifestIds)).toEqual(new Set(tutorialContent.basicDeck));
  });

  it('ST-012 resolves rewards and map references', () => {
    expect(v01ContentManifest.rewards).toEqual(tutorialContent.rewardDeck);
    expect(lintContentManifest(v01ContentManifest)).toEqual([]);
  });

  it('ST-013 rejects missing cross references', () => {
    const broken = structuredClone(v01ContentManifest);
    broken.mapTiles[0]!.spaces[0]!.enemyId = 'core.enemy.missing';
    expect(lintContentManifest(broken)).toContain('core.tile.v0.1-start references missing enemy core.enemy.missing.');
  });
});
