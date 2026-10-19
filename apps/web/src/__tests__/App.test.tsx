// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { tutorialContent } from '@mageknight/content';
import { createGame } from '@mageknight/engine';

function card(definitionId: string): HTMLElement {
  const element = document.querySelector(`[data-definition-id="${definitionId}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`Card ${definitionId} not rendered.`);
  return element;
}

describe('web game shell', () => {
  beforeEach(async () => {
    window.history.replaceState({}, '', '/?mode=tutorial');
    window.localStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('mageknight-web');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  });
  afterEach(cleanup);

  it('UI-120 renders the engine projection and legal card actions', async () => {
    render(<App />);
    await screen.findByText(/已开始新游戏|已自动保存/);
    expect(screen.getByRole('heading', { name: 'Mage Knight Web v0.1.0' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '六边形探索地图' })).toBeInTheDocument();
    expect(within(card('core.card.march-1')).getByRole('button', { name: '基础效果' })).toBeInTheDocument();
    expect(screen.getByText(/打出移动牌/)).toBeInTheDocument();
  });

  it('UI-121 executes map intents and explains an illegal target', async () => {
    render(<App />);
    await screen.findByText(/已开始新游戏|已自动保存/);
    fireEvent.click(screen.getByLabelText(/^0,0 /));
    expect(screen.getByRole('alert')).toHaveTextContent('SPACE_NOT_ADJACENT');

    fireEvent.click(within(card('core.card.march-1')).getByRole('button', { name: '基础效果' }));
    fireEvent.click(within(card('core.card.march-2')).getByRole('button', { name: '基础效果' }));
    const village = screen.getByLabelText(/^1,0 .*可移动/);
    fireEvent.click(village);
    expect(screen.getByRole('button', { name: '探索新板块（移动 2）' })).toBeInTheDocument();
  });

  it('UI-132 restores an autosaved engine state after remount', async () => {
    const first = render(<App />);
    await screen.findByText(/已开始新游戏|已自动保存/);
    fireEvent.click(within(card('core.card.march-1')).getByRole('button', { name: '基础效果' }));
    expect(screen.getByText(/资源：移动 2/)).toBeInTheDocument();
    await screen.findByText('正在自动保存…');
    await screen.findByText('已自动保存');
    first.unmount();
    render(<App />);
    expect(await screen.findByText(/资源：移动 2/)).toBeInTheDocument();
  });

  it('UI-132 restores a pending decision and blocks unrelated actions', async () => {
    const state = createGame({ seed: 'decision', deckOrder: tutorialContent.basicDeck }, tutorialContent);
    state.phase = 'decision';
    state.pendingDecision = {
      id: 'decision-test',
      kind: 'level-up',
      prompt: '选择 Tovak 的升级奖励。',
      options: [{ id: 'armor', label: '战斗纪律：护甲 +1' }],
      returnPhase: 'movement',
    };
    window.localStorage.setItem('mageknight-web:v0.1:autosave', JSON.stringify(state));
    render(<App />);
    expect(await screen.findByRole('button', { name: '战斗纪律：护甲 +1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '结束移动' })).not.toBeInTheDocument();
  });

  it('migrates an old explored save from three spaces to a complete seven-space tile', async () => {
    const state = createGame({ seed: 'old-map', deckOrder: tutorialContent.basicDeck }, tutorialContent);
    state.explored = true;
    for (const template of tutorialContent.explorationMap.slice(0, 3)) {
      state.map[`${template.q},${template.r}`] = {
        coord: { q: template.q, r: template.r },
        terrain: template.terrain,
        revealed: true,
        enemyIds: [],
      };
    }
    window.localStorage.setItem('mageknight-web:v0.1:autosave', JSON.stringify(state));
    render(<App />);
    await waitFor(() => expect(screen.getByRole('img', { name: '六边形探索地图' }).querySelectorAll('[role="button"]')).toHaveLength(14));
  });

  it('UI-141 opens structured details from an event log entry', async () => {
    render(<App />);
    await screen.findByText(/已开始新游戏|已自动保存/);
    fireEvent.click(within(card('core.card.march-1')).getByRole('button', { name: '基础效果' }));
    fireEvent.click(screen.getByRole('button', { name: /行军产生 2 点移动/ }));
    expect(screen.getByText('事件详情')).toBeInTheDocument();
    expect(screen.getByText(/"definitionId": "core.card.march-1"/)).toBeInTheDocument();
  });
});
