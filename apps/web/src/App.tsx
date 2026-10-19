import { useEffect, useMemo, useRef, useState } from 'react';
import { tutorialContent } from '@mageknight/content';
import { createGame, createHistory, executeIntent, projectView, recordSuccessfulCommand, undoHistory } from '@mageknight/engine';
import type { Coord, GameCommand, GameState, LegalIntent } from '@mageknight/engine';
import { ActionPanel } from './ActionPanel';
import { EventLog } from './EventLog';
import { GameBoard } from './GameBoard';
import { Hand } from './Hand';
import { StatusPanel } from './StatusPanel';
import { StorageControls } from './StorageControls';
import { clearSaves, exportSession, loadSession, saveSession } from './game-storage';
import type { GameSession } from './game-storage';
import { tutorialHint } from './tutorial';
import { ConquestApp } from './ConquestApp';
import { OnlineApp } from './OnlineApp';

const DEFAULT_SEED = 'mageknight-v0.1-browser';

function newGame(): GameState {
  return createGame({ seed: DEFAULT_SEED, deckOrder: tutorialContent.basicDeck, sourceColors: ['green', 'blue', 'white'] }, tutorialContent);
}

function newSession(): GameSession {
  return { state: newGame(), history: createHistory() };
}

export function TutorialApp() {
  const [session, setSession] = useState<GameSession>(newSession);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [storageStatus, setStorageStatus] = useState('正在读取自动存档…');
  const saveSequence = useRef(0);
  const view = useMemo(() => projectView(session.state, tutorialContent), [session.state]);

  useEffect(() => {
    let active = true;
    loadSession('auto').then((loaded) => {
      if (!active) return;
      if (loaded) setSession(loaded);
      setStorageStatus(loaded ? '已恢复自动存档' : '已开始新游戏');
      setReady(true);
    }).catch((cause: unknown) => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : '无法读取自动存档。');
      setStorageStatus('自动存档不可用');
      setReady(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const current = ++saveSequence.current;
    saveSession('auto', session).then(() => {
      if (current === saveSequence.current) setStorageStatus('已自动保存');
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : '自动存档失败。'));
  }, [ready, session]);

  function dispatch(command: GameCommand) {
    const result = executeIntent(session.state, command, tutorialContent);
    if (!result.ok) {
      setError(`${result.error.code}：${result.error.message}`);
      return;
    }
    setError('');
    setStorageStatus('正在自动保存…');
    setSession({ state: result.state, history: recordSuccessfulCommand(session.history, session.state, command, result.events) });
  }

  function handleIntent(intent: LegalIntent) { dispatch(intent.command); }
  function handleInvalidMove(coord: Coord) { dispatch({ type: 'MOVE_HERO', to: coord }); }

  async function restart() {
    await clearSaves();
    setSession(newSession());
    setError('');
    setStorageStatus('已重新开始');
  }

  function undo() {
    const result = undoHistory(session.history);
    if (!result.ok) {
      setError(`${result.code}：${result.message}`);
      return;
    }
    setError('');
    setSession({ state: result.state, history: result.history });
    setStorageStatus('已撤销最近操作');
  }

  async function manualSave() {
    try {
      await saveSession('manual-1', session);
      setStorageStatus('手动存档已保存');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '手动存档失败。');
    }
  }

  async function manualLoad() {
    try {
      const loaded = await loadSession('manual-1');
      if (!loaded) {
        setError('手动存档槽为空。');
        return;
      }
      setSession(loaded);
      setError('');
      setStorageStatus('已载入手动存档');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '手动存档读取失败。');
    }
  }

  function downloadExport() {
    const blob = new Blob([exportSession(session)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mageknight-${session.state.seed}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setStorageStatus('日志已导出');
  }

  return (
    <main>
      <header>
        <h1>Mage Knight Web v0.1.0</h1>
        <p>{view.scenario.objective}</p>
        <p><a href="/">打开 v0.8.0 模块化征服</a></p>
        <button type="button" onClick={() => void restart()}>重新开始</button>
      </header>
      <aside className="tutorial" aria-live="polite"><strong>当前提示：</strong>{tutorialHint(view)}</aside>
      {error ? <p className="error" role="alert">{error} <button type="button" onClick={() => setError('')}>关闭</button></p> : null}
      <StatusPanel view={view} content={tutorialContent} />
      <GameBoard view={view} onIntent={handleIntent} onInvalidMove={handleInvalidMove} />
      <Hand view={view} content={tutorialContent} onIntent={handleIntent} />
      <ActionPanel view={view} onIntent={handleIntent} />
      <StorageControls canUndo={session.history.undoStack.length > 0} status={storageStatus} onUndo={undo} onSave={() => void manualSave()} onLoad={() => void manualLoad()} onExport={downloadExport} />
      <EventLog events={view.eventLog} enemies={view.enemies} content={tutorialContent} />
    </main>
  );
}

export function App() {
  const mode = new URLSearchParams(window.location.search).get('mode');
  if (mode === 'tutorial') return <TutorialApp />;
  if (mode === 'online') return <OnlineApp />;
  return <ConquestApp />;
}
