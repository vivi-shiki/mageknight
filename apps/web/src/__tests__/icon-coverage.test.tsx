// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { createConquestContent, tutorialContent } from '@mageknight/content';
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { CardArt, TerrainArt, cardIcon, terrainIcon } from '../game-icons';

const terrains = ['plains', 'forest', 'hills', 'desert', 'wasteland', 'mountain', 'lake'] as const;

describe('SVG illustration coverage', () => {
  it('assigns a semantic SVG and a color to every card in every content module', () => {
    const content = createConquestContent();
    const cards = { ...tutorialContent.cards, ...content.cards };
    expect(Object.keys(cards).length).toBeGreaterThan(100);
    for (const card of Object.values(cards)) {
      const icon = cardIcon(card);
      expect(icon.word, card.id).toMatch(/^[a-z][a-z-]*$/);
      expect(icon.src, card.id).toMatch(/\.svg$/);
      expect(icon.color, card.id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(existsSync(path.resolve('apps/web/public', icon.src.slice(1))), card.id).toBe(true);
      const { unmount } = render(<CardArt card={card} />);
      expect(screen.getByRole('img', { name: `${card.name} 卡图` })).toHaveStyle({ backgroundColor: icon.color, maskImage: `url(${icon.src})` });
      unmount();
    }
  });

  it.each(terrains)('assigns and renders a colored SVG for %s', (terrain) => {
    const icon = terrainIcon(terrain);
    expect(icon.word).toMatch(/^[a-z][a-z-]*$/);
    expect(icon.src).toMatch(/\.svg$/);
    expect(icon.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(existsSync(path.resolve('apps/web/public', icon.src.slice(1)))).toBe(true);
    const { container } = render(<svg><TerrainArt terrain={terrain} /></svg>);
    expect(container.querySelector('image')).toHaveAttribute('href', icon.src);
  });
});
