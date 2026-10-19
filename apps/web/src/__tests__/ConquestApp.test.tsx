// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';

describe('v0.8.0 web shell', () => {
  beforeEach(async () => {
    window.history.replaceState({}, '', '/');
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('mageknight-web');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  });
  afterEach(cleanup);

  it('UI-500 starts in conquest setup with a complete seven-space tile', async () => {
    render(<App />);
    await screen.findByText(/已开始 v0.8.0 新游戏|v0.8.0 已自动保存/);
    expect(screen.getByRole('heading', { name: 'Mage Knight Web v0.8.0' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'v0.8.0 征服地图' }).querySelectorAll('[role="button"]')).toHaveLength(7);
    expect(screen.getByRole('button', { name: /1 · 先发制人/ })).toBeInTheDocument();
  });

  it('UI-501 selects a tactic and renders only engine-projected actions', async () => {
    render(<App />);
    await screen.findByText(/已开始 v0.8.0 新游戏|v0.8.0 已自动保存/);
    fireEvent.click(screen.getByRole('button', { name: /1 · 先发制人/ }));
    await waitFor(() => expect(screen.getByText(/Dummy：牌库/)).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: '选择战术' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '结束移动' })).toBeInTheDocument();
    const firstCard = document.querySelector('.card');
    expect(firstCard).not.toBeNull();
    expect(within(firstCard as HTMLElement).getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('UI-502 creates a seeded veteran game and exposes map controls', async () => {
    render(<App />);
    await screen.findByText(/已开始 v0.8.0 新游戏|v0.8.0 已自动保存/);
    fireEvent.change(screen.getByLabelText('Seed'), { target: { value: 'ui-veteran' } });
    fireEvent.change(screen.getByLabelText('英雄'), { target: { value: 'core.hero.goldyx' } });
    fireEvent.change(screen.getByLabelText('难度'), { target: { value: 'veteran' } });
    fireEvent.click(screen.getByRole('button', { name: '开始新征服' }));
    await screen.findByText(/难度 veteran，城市等级 8\/11/);
    expect(screen.getByText(/Goldyx：护甲/)).toBeInTheDocument();
    expect(screen.getByLabelText('地图缩放')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '地图向左' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '地图向右' })).toBeInTheDocument();
  });

  it('UI-503 keeps a damaged legacy save from taking over the page', async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('mageknight-web', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('saves', { keyPath: 'slot' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction('saves', 'readwrite').objectStore('saves').put({ slot: 'conquest-auto', legacy: 'unsupported' });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    db.close();

    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('征服存档格式损坏或版本不受支持。');
    expect(screen.getByRole('heading', { name: '状态' })).toBeInTheDocument();
    expect(screen.queryByText(/invalid_union/)).not.toBeInTheDocument();
  });

  it('UI-700 filters heroes and scenarios by the selected content modules', async () => {
    render(<App />);
    await screen.findByText(/已开始 v0.8.0 新游戏|v0.8.0 已自动保存/);
    expect(screen.getByLabelText('启用 Shades of Tezla')).toBeChecked();
    expect(screen.getByRole('option', { name: 'Braevalar' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Krang' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Wolfhawk' })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('启用 Krang'));
    expect(screen.queryByRole('option', { name: 'Krang' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('启用 Lost Legion'));
    expect(screen.queryByRole('option', { name: 'Wolfhawk' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: "Volkare's Quest" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('启用 Krang'));
    fireEvent.change(screen.getByLabelText('英雄'), { target: { value: 'krang.hero.krang' } });
    fireEvent.click(screen.getByRole('button', { name: '开始新征服' }));
    await screen.findByText(/Krang：护甲 2/);
  });
});
