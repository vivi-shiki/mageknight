// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { createConquestContent } from '@mageknight/content';
import { createConquestGame, projectConquestView } from '@mageknight/engine';
import { expect, it } from 'vitest';
import { ConquestBoard } from '../ConquestBoard';

it('fits the seven starting hexes and draws cells to their shared grid edges', () => {
  const content = createConquestContent([]);
  const state = createConquestGame({ seed: 'map-layout', difficulty: 'explorer', heroId: content.defaultHeroId, scenarioId: content.defaultScenarioId }, content);
  const { container } = render(<ConquestBoard view={projectConquestView(state, content)} content={content} onIntent={() => {}} />);
  const map = screen.getByRole('img', { name: 'v0.8.0 征服地图' });
  const [, , width, height] = map.getAttribute('viewBox')!.split(' ').map(Number);
  expect(width).toBeGreaterThan(300);
  expect(width).toBeLessThan(600);
  expect(height).toBeLessThan(500);
  expect(container.querySelectorAll('.hex')).toHaveLength(7);
  const polygon = container.querySelector('.hex polygon')!;
  const firstVertex = polygon.getAttribute('points')!.split(' ')[0]!.split(',').map(Number);
  expect(Math.hypot(firstVertex[0]!, firstVertex[1]!)).toBeCloseTo(44, 1);
});

it('shows the rulebook wedge as seven-hex unrevealed tiles without exposing terrain', () => {
  const content = createConquestContent([]);
  const state = createConquestGame({ seed: 'wedge-preview', difficulty: 'explorer', heroId: content.defaultHeroId, scenarioId: content.defaultScenarioId }, content);
  const { container } = render(<ConquestBoard view={projectConquestView(state, content)} content={content} onIntent={() => {}} />);
  expect(container.querySelectorAll('.unrevealed-tile')).toHaveLength(2);
  expect(container.querySelectorAll('.unrevealed-tile polygon')).toHaveLength(14);
  expect(container.querySelector('[data-tile-center="3,-2"]')).toBeInTheDocument();
  expect(container.querySelector('[data-tile-center="2,1"]')).toBeInTheDocument();
  expect(container.querySelectorAll('.hex')).toHaveLength(7);
  expect(container.querySelector('.unrevealed-tile image')).toBeNull();
});
