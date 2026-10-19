import { createConquestContent } from '@mageknight/content';
import type { ConquestModuleId } from '@mageknight/content';
import type { ConquestCommand, ConquestIntent, ConquestView } from '@mageknight/engine';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConquestBoard } from './ConquestBoard';
import { ApiError, onlineApi } from './online-api';
import type { OnlineAccount, OnlineRoom, OnlineRoomSetup, OnlineRoomSummary } from './online-api';

const TOKEN_KEY = 'mageknight.online.token';

function errorMessage(cause: unknown): string {
  if (cause instanceof ApiError || cause instanceof Error) return cause.message;
  return '请求失败。';
}

function statusLabel(status: OnlineRoomSummary['status']): string {
  return status === 'lobby' ? '等待开局' : status === 'playing' ? '游戏中' : '已结束';
}

function ActionButtons({ intents, busy, onIntent }: { intents: ConquestIntent[]; busy: boolean; onIntent: (intent: ConquestIntent) => void }) {
  return <div className="actions">{intents.map((intent) => <button key={intent.id} type="button" disabled={busy} onClick={() => onIntent(intent)}>{intent.label}</button>)}</div>;
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (token: string, account: OnlineAccount) => void }) {
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = mode === 'register' ? await onlineApi.register(username, password) : await onlineApi.login(username, password);
      onAuthenticated(result.token, result.account);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="online-shell auth-shell">
      <header><h1>Mage Knight 联机</h1><p><a href="/">返回单人游戏</a></p></header>
      <div className="mode-switch" role="group" aria-label="账号方式">
        <button type="button" aria-pressed={mode === 'register'} onClick={() => setMode('register')}>注册</button>
        <button type="button" aria-pressed={mode === 'login'} onClick={() => setMode('login')}>登录</button>
      </div>
      <form className="online-form" onSubmit={(event) => void submit(event)}>
        <label>用户名<input autoComplete="username" minLength={3} maxLength={20} required value={username} onChange={(event) => setUsername(event.target.value)} /></label>
        <label>密码<input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={6} maxLength={72} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <button type="submit" disabled={busy}>{busy ? '处理中…' : mode === 'register' ? '注册并进入' : '登录'}</button>
      </form>
      {error ? <p className="error" role="alert">{error}</p> : null}
    </main>
  );
}

function Lobby({ rooms, busy, onCreate, onJoin, onOpen }: {
  rooms: OnlineRoomSummary[];
  busy: boolean;
  onCreate: (name: string) => Promise<void>;
  onJoin: (code: string) => Promise<void>;
  onOpen: (roomId: string) => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  return (
    <>
      <section><h2>创建对局</h2><form className="inline-form" onSubmit={(event) => { event.preventDefault(); void onCreate(name); }}><input aria-label="房间名称" maxLength={30} placeholder="房间名称" value={name} onChange={(event) => setName(event.target.value)} /><button type="submit" disabled={busy}>创建</button></form></section>
      <section><h2>加入对局</h2><form className="inline-form" onSubmit={(event) => { event.preventDefault(); void onJoin(code); }}><input aria-label="六位房间码" maxLength={6} placeholder="房间码" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} /><button type="submit" disabled={busy || code.length !== 6}>加入</button></form></section>
      <section><h2>房间</h2><div className="room-list">{rooms.length === 0 ? <p>暂无房间</p> : rooms.map((room) => <article className="room-row" key={room.id}><div><strong>{room.name}</strong><p>{room.code} · {statusLabel(room.status)} · {room.memberCount}/4</p></div><button type="button" disabled={!room.isMember && room.status !== 'lobby'} onClick={() => room.isMember ? onOpen(room.id) : void onJoin(room.code)}>{room.isMember ? '进入' : '加入'}</button></article>)}</div></section>
    </>
  );
}

function SetupForm({ initial, busy, onStart }: { initial: OnlineRoomSetup; busy: boolean; onStart: (setup: OnlineRoomSetup) => Promise<void> }) {
  const [setup, setSetup] = useState(initial);
  const content = useMemo(() => createConquestContent(setup.modules), [setup.modules]);

  function toggleModule(moduleId: ConquestModuleId, checked: boolean) {
    setSetup((current) => {
      const modules = checked ? [...current.modules, moduleId] : current.modules.filter((id) => id !== moduleId);
      const nextContent = createConquestContent(modules);
      return {
        ...current,
        modules,
        heroId: nextContent.heroes[current.heroId] ? current.heroId : nextContent.defaultHeroId,
        scenarioId: nextContent.scenarios[current.scenarioId] ? current.scenarioId : nextContent.defaultScenarioId,
      };
    });
  }

  return (
    <form className="online-setup" onSubmit={(event) => { event.preventDefault(); void onStart(setup); }}>
      <label>Seed<input value={setup.seed} maxLength={80} onChange={(event) => setSetup({ ...setup, seed: event.target.value })} /></label>
      <label>英雄<select value={setup.heroId} onChange={(event) => setSetup({ ...setup, heroId: event.target.value })}>{Object.values(content.heroes).map((hero) => <option key={hero.id} value={hero.id}>{hero.name}</option>)}</select></label>
      <label>场景<select value={setup.scenarioId} onChange={(event) => setSetup({ ...setup, scenarioId: event.target.value })}>{Object.values(content.scenarios).map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.name}</option>)}</select></label>
      <label>难度<select value={setup.difficulty} onChange={(event) => setSetup({ ...setup, difficulty: event.target.value as OnlineRoomSetup['difficulty'] })}><option value="explorer">探索者</option><option value="standard">标准</option><option value="veteran">老兵</option></select></label>
      <fieldset><legend>扩展</legend><label><input type="checkbox" checked={setup.modules.includes('lost-legion.official-v0.6')} onChange={(event) => toggleModule('lost-legion.official-v0.6', event.target.checked)} /> Lost Legion</label><label><input type="checkbox" checked={setup.modules.includes('krang.character-v0.7')} onChange={(event) => toggleModule('krang.character-v0.7', event.target.checked)} /> Krang</label><label><input type="checkbox" checked={setup.modules.includes('shades-of-tezla.official-v0.8')} onChange={(event) => toggleModule('shades-of-tezla.official-v0.8', event.target.checked)} /> Shades of Tezla</label></fieldset>
      <button type="submit" disabled={busy}>开始游戏</button>
    </form>
  );
}

function OnlineGame({ account, room, busy, onCommand, onClaim, onPass }: {
  account: OnlineAccount;
  room: OnlineRoom;
  busy: boolean;
  onCommand: (command: ConquestCommand) => Promise<void>;
  onClaim: () => Promise<void>;
  onPass: () => Promise<void>;
}) {
  const content = useMemo(() => createConquestContent(room.setup.modules), [room.setup.modules]);
  const view = room.view;
  if (!view) return <p className="error">对局状态缺失。</p>;
  const active = room.activeAccountId === account.id && room.status === 'playing';
  const interactiveView: ConquestView = active ? view : { ...view, legalIntents: [] };
  const activeName = room.members.find((member) => member.id === room.activeAccountId)?.username ?? '无';
  const cardActions = new Map<string, ConquestIntent[]>();
  for (const intent of view.legalIntents) {
    if (intent.command.type === 'PLAY_CARD') cardActions.set(intent.command.cardId, [...(cardActions.get(intent.command.cardId) ?? []), intent]);
  }
  const generalActions = view.legalIntents.filter((intent) => intent.command.type !== 'MOVE_HERO' && intent.command.type !== 'PLAY_CARD');
  return (
    <>
      <section id="status" className="status"><h2>对局状态</h2><p>第 {view.round}/{view.scenario.roundLimit} 轮</p><p>{view.time === 'day' ? '白天' : '夜晚'}</p><p>{view.phase}</p><p>操作者：{activeName}</p><p>版本 {room.revision}</p></section>
      <section className="controller-bar"><strong>{active ? '轮到你操作' : `等待 ${activeName}`}</strong><div className="actions">{active && room.members.length > 1 ? <button type="button" disabled={busy} onClick={() => void onPass()}>交接操作</button> : null}{!active && room.status === 'playing' ? <button type="button" disabled={busy} onClick={() => void onClaim()}>接管操作</button> : null}</div></section>
      <ConquestBoard view={interactiveView} content={content} onIntent={(intent) => void onCommand(intent.command)} />
      <section id="actions"><h2>可执行动作</h2>{active ? <ActionButtons intents={generalActions} busy={busy} onIntent={(intent) => void onCommand(intent.command)} /> : <p>等待当前操作者</p>}</section>
      <section id="hand"><h2>手牌</h2><div className="hand">{view.player.zones.hand.map((cardId) => { const card = content.cards[view.player.cardInstances[cardId]?.definitionId ?? '']; return <article className="card" key={cardId}><strong>{card?.name ?? cardId}</strong><small>{card?.kind}</small>{card ? <details><summary>规则</summary><p><strong>基础：</strong>{card.basicText ?? (card.basic ? `${card.basic.resource} ${card.basic.amount}` : '无')}</p><p><strong>强化：</strong>{card.strongText ?? (card.strong ? `${card.strong.resource} ${card.strong.amount}` : '无')}</p></details> : null}{active ? <ActionButtons intents={cardActions.get(cardId) ?? []} busy={busy} onIntent={(intent) => void onCommand(intent.command)} /> : null}</article>; })}</div></section>
      {view.scenario.score ? <section><h2>{view.scenario.status === 'won' ? '征服成功' : '征服失败'}</h2><p>名望 {view.scenario.score.fame} · 知识 {view.scenario.score.knowledge} · 战利品 {view.scenario.score.loot} · 领导力 {view.scenario.score.leadership} · 冒险 {view.scenario.score.adventure} · 伤牌 {view.scenario.score.wounds}</p><strong>总分 {view.scenario.score.total}</strong></section> : null}
      <section><h2>事件</h2><ol className="event-log">{view.eventLog.slice(-20).reverse().map((event) => <li key={event.id}>{event.message}</li>)}</ol></section>
    </>
  );
}

export function OnlineApp() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '');
  const [account, setAccount] = useState<OnlineAccount>();
  const [rooms, setRooms] = useState<OnlineRoomSummary[]>([]);
  const [room, setRoom] = useState<OnlineRoom>();
  const [roomId, setRoomId] = useState(() => new URLSearchParams(window.location.search).get('room') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const clearSession = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken('');
    setAccount(undefined);
    setRoom(undefined);
    setRoomId('');
  }, []);

  const handleError = useCallback((cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 401) clearSession();
    setError(errorMessage(cause));
  }, [clearSession]);

  const openRoom = useCallback((id: string) => {
    setRoomId(id);
    const url = new URL(window.location.href);
    url.searchParams.set('mode', 'online');
    url.searchParams.set('room', id);
    window.history.replaceState(null, '', url);
  }, []);

  useEffect(() => {
    if (!token) return;
    let active = true;
    Promise.all([onlineApi.me(token), onlineApi.rooms(token)]).then(([nextAccount, nextRooms]) => {
      if (!active) return;
      setAccount(nextAccount);
      setRooms(nextRooms);
    }).catch((cause: unknown) => active && handleError(cause));
    return () => { active = false; };
  }, [token, handleError]);

  useEffect(() => {
    if (!token || !roomId) return;
    let active = true;
    const refresh = () => onlineApi.room(token, roomId).then((nextRoom) => { if (active) setRoom(nextRoom); }).catch((cause: unknown) => active && handleError(cause));
    void refresh();
    const timer = window.setInterval(refresh, 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [token, roomId, handleError]);

  function authenticated(nextToken: string, nextAccount: OnlineAccount) {
    localStorage.setItem(TOKEN_KEY, nextToken);
    setToken(nextToken);
    setAccount(nextAccount);
    setError('');
  }

  async function run(operation: () => Promise<OnlineRoom | void>) {
    setBusy(true);
    setError('');
    try {
      const result = await operation();
      if (result) { setRoom(result); openRoom(result.id); }
      setRooms(await onlineApi.rooms(token));
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try { await onlineApi.logout(token); } catch { /* Local logout still succeeds. */ }
    clearSession();
  }

  function backToLobby() {
    setRoom(undefined);
    setRoomId('');
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState(null, '', url);
  }

  if (!token) return <AuthScreen onAuthenticated={authenticated} />;
  if (!account) return <main className="online-shell"><p>正在载入账号…</p>{error ? <p className="error">{error}</p> : null}</main>;

  return (
    <main className="online-shell">
      <header><h1>Mage Knight 联机</h1><p>{account.username} · <button className="link-button" type="button" onClick={() => void logout()}>退出账号</button> · <a href="/">单人游戏</a></p></header>
      {error ? <p className="error" role="alert">{error} <button type="button" onClick={() => setError('')}>关闭</button></p> : null}
      {!roomId ? <Lobby rooms={rooms} busy={busy} onCreate={(name) => run(() => onlineApi.createRoom(token, name))} onJoin={(code) => run(() => onlineApi.joinRoom(token, code))} onOpen={openRoom} /> : !room ? <p>正在载入房间…</p> : (
        <>
          <section className="room-heading"><button type="button" onClick={backToLobby}>返回大厅</button><h2>{room.name}</h2><p>房间码 <strong>{room.code}</strong> · {statusLabel(room.status)} · {room.members.map((member) => member.username).join('、')}</p><button type="button" onClick={() => void navigator.clipboard?.writeText(room.code)}>复制房间码</button></section>
          {room.status === 'lobby' ? room.hostAccountId === account.id ? <SetupForm key={room.id} initial={room.setup} busy={busy} onStart={(setup) => run(() => onlineApi.startRoom(token, room.id, setup))} /> : <section><h2>等待房主开局</h2><p>{room.members.length}/4 位成员</p></section> : <OnlineGame account={account} room={room} busy={busy} onCommand={(command) => run(() => onlineApi.command(token, room.id, room.revision, command))} onClaim={() => run(() => onlineApi.claim(token, room.id))} onPass={() => run(() => onlineApi.pass(token, room.id))} />}
        </>
      )}
    </main>
  );
}
