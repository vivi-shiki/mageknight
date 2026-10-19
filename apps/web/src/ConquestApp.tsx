import { createConquestContent, defaultConquestModules } from '@mageknight/content';
import type { ConquestContent, ConquestModuleId, Difficulty } from '@mageknight/content';
import { createConquestGame, createConquestHistory, executeConquestIntent, projectConquestView, recordConquestCommand, undoConquestHistory } from '@mageknight/engine';
import type { ConquestCommand, ConquestIntent, ConquestState } from '@mageknight/engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConquestBoard } from './ConquestBoard';
import { clearConquestSaves, contentForEnabled, exportConquestReplay, importConquestReplay, loadConquestSession, modulesFromEnabled, saveConquestSession } from './conquest-storage';
import type { ConquestSession } from './conquest-storage';

const DEFAULT_SEED = 'mageknight-v0.8';
const RELEASE_LABEL = 'v0.8.0';
const defaultContent = createConquestContent(defaultConquestModules);

function readableError(cause: unknown, fallback: string): string {
  if (!(cause instanceof Error) || cause.message.length > 160 || cause.message.includes('{')) return fallback;
  return cause.message;
}

function makeSession(content: ConquestContent, seed = DEFAULT_SEED, difficulty: Difficulty = 'standard', heroId = content.defaultHeroId, scenarioId = content.defaultScenarioId): ConquestSession {
  return { state: createConquestGame({ seed, difficulty, heroId, scenarioId }, content), history: createConquestHistory() };
}

function displayCard(content: ConquestContent, state: Pick<ConquestState, 'player'>, cardId: string) {
  return content.cards[state.player.cardInstances[cardId]?.definitionId ?? ''];
}

function IntentButtons({ intents, onIntent }: { intents: ConquestIntent[]; onIntent: (intent: ConquestIntent) => void }) {
  return <div className="actions">{intents.map((intent) => <button key={intent.id} type="button" onClick={() => onIntent(intent)}>{intent.label}</button>)}</div>;
}

function CardRules({ definitionId, content }: { definitionId: string; content: ConquestContent }) {
  const card = content.cards[definitionId];
  if (!card) return null;
  const basic = card.basicText ?? (card.basic ? `${card.basic.resource} ${card.basic.amount}` : '无');
  const strong = card.strongText ?? (card.strong ? `${card.strong.resource} ${card.strong.amount}` : '无');
  return <details><summary>规则</summary><p><strong>基础：</strong>{basic}</p><p><strong>强化：</strong>{strong}</p>{card.implementation ? <small>{card.implementation === 'full' ? '完整实现' : '模型化实现'} · {card.sourceRef}</small> : null}</details>;
}

export function ConquestApp() {
  const [session, setSession] = useState<ConquestSession>(() => makeSession(defaultContent));
  const [modules, setModules] = useState<ConquestModuleId[]>([...defaultConquestModules]);
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [difficulty, setDifficulty] = useState<Difficulty>('standard');
  const [heroId, setHeroId] = useState(defaultContent.defaultHeroId);
  const [scenarioId, setScenarioId] = useState(defaultContent.defaultScenarioId);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('正在读取征服存档…');
  const [error, setError] = useState('');
  const saveSequence = useRef(0);
  const setupContent = useMemo(() => createConquestContent(modules), [modules]);
  const sessionContent = useMemo(() => contentForEnabled(session.state.enabledModules), [session.state.enabledModules]);
  const view = useMemo(() => projectConquestView(session.state, sessionContent), [session.state, sessionContent]);

  useEffect(() => {
    let active = true;
    loadConquestSession('conquest-auto').then((loaded) => {
      if (!active) return;
      if (loaded) { setSession(loaded); setModules(modulesFromEnabled(loaded.state.enabledModules)); setSeed(loaded.state.seed); setDifficulty(loaded.state.scenario.difficulty); setHeroId(loaded.state.player.heroId); setScenarioId(loaded.state.scenario.id); }
      setStatus(loaded ? `已恢复 ${RELEASE_LABEL} 自动存档` : `已开始 ${RELEASE_LABEL} 新游戏`);
      setReady(true);
    }).catch((cause: unknown) => {
      if (!active) return;
      setError(readableError(cause, '征服存档格式损坏或版本不受支持。'));
      setStatus(`旧自动存档不可用，已开始 ${RELEASE_LABEL} 新游戏`);
      setReady(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const current = ++saveSequence.current;
    saveConquestSession('conquest-auto', session).then(() => { if (current === saveSequence.current) setStatus(`${RELEASE_LABEL} 已自动保存`); }).catch((cause: unknown) => setError(readableError(cause, '自动存档失败。')));
  }, [ready, session]);

  function dispatch(command: ConquestCommand) {
    const result = executeConquestIntent(session.state, command, sessionContent);
    if (!result.ok) { setError(`${result.error.code}：${result.error.message}`); return; }
    setError('');
    setStatus('正在自动保存…');
    setSession({ state: result.state, history: recordConquestCommand(session.history, session.state, command, result.events) });
  }

  function startNewGame() {
    void clearConquestSaves().then(() => {
      setSession(makeSession(setupContent, seed.trim() || DEFAULT_SEED, difficulty, heroId, scenarioId));
      setError('');
      setStatus(`已开始 ${RELEASE_LABEL} 新游戏`);
    });
  }

  function undo() {
    const result = undoConquestHistory(session.history);
    if (!result.ok) { setError(`${result.code}：${result.message}`); return; }
    setSession({ state: result.state, history: result.history });
    setStatus('已撤销最近操作');
  }

  async function manualSave() {
    try {
      await saveConquestSession('conquest-manual-1', session);
      setStatus(`${RELEASE_LABEL} 手动存档已保存`);
      setError('');
    } catch (cause) { setError(readableError(cause, '手动存档失败。')); }
  }
  async function manualLoad() {
    try {
      const loaded = await loadConquestSession('conquest-manual-1');
      if (!loaded) { setError(`${RELEASE_LABEL} 手动存档槽为空。`); return; }
      setSession(loaded); setModules(modulesFromEnabled(loaded.state.enabledModules)); setHeroId(loaded.state.player.heroId); setScenarioId(loaded.state.scenario.id); setStatus(`已载入 ${RELEASE_LABEL} 手动存档`); setError('');
    } catch (cause) { setError(readableError(cause, '手动存档读取失败。')); }
  }
  function exportReplay() {
    const url = URL.createObjectURL(new Blob([exportConquestReplay(session)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `mageknight-v0.8.0-${view.seed}.json`; link.click(); URL.revokeObjectURL(url);
    setStatus(`${RELEASE_LABEL} 回放已导出`);
  }

  async function importReplay(file: File | undefined) {
    if (!file) return;
    try {
      const loaded = importConquestReplay(await file.text());
      setSession(loaded);
      setModules(modulesFromEnabled(loaded.state.enabledModules));
      setSeed(loaded.state.seed);
      setDifficulty(loaded.state.scenario.difficulty);
      setHeroId(loaded.state.player.heroId);
      setScenarioId(loaded.state.scenario.id);
      setStatus(`${RELEASE_LABEL} 回放验证通过，已载入第 ${loaded.history.commandLog.length} 步`);
      setError('');
    } catch (cause) { setError(readableError(cause, '回放损坏、规则不兼容或终局校验失败。')); }
  }

  function toggleModule(moduleId: ConquestModuleId, checked: boolean) {
    const nextModules = checked ? [...modules, moduleId] : modules.filter((id) => id !== moduleId);
    const nextContent = createConquestContent(nextModules);
    setModules(nextModules);
    if (!nextContent.heroes[heroId]) setHeroId(nextContent.defaultHeroId);
    if (!nextContent.scenarios[scenarioId]) setScenarioId(nextContent.defaultScenarioId);
  }

  const handCards = view.player.zones.hand.map((id) => ({ id, definition: displayCard(sessionContent, view, id) }));
  const groups = new Map<string, ConquestIntent[]>();
  for (const intent of view.legalIntents) groups.set(intent.group, [...(groups.get(intent.group) ?? []), intent]);
  const activeEnemies = view.encounter?.enemyIds.flatMap((id) => {
    const enemy = sessionContent.enemies[view.enemies[id]?.definitionId ?? ''];
    return enemy ? [enemy] : [];
  }) ?? [];
  const activeRules = [
    view.ruleRuntime.moveToAttack ? `移动转${view.ruleRuntime.moveToAttack === 'ranged' ? '远程' : '普通'}攻击` : '',
    view.ruleRuntime.movementMode ? `特殊移动：${view.ruleRuntime.movementMode.kind}` : '',
    view.ruleRuntime.endlessMana.length ? `无限法力：${view.ruleRuntime.endlessMana.join('/')}` : '',
    view.ruleRuntime.allUnitsBonus ? `全体单位 +${view.ruleRuntime.allUnitsBonus}` : '',
    view.ruleRuntime.allUnitsAllResistances ? '全体单位全抗性' : '',
  ].filter(Boolean);
  const objectiveStatus = view.scenario.objectiveKind === 'volkare'
    ? `Volkare 军队 ${view.volkare?.armyEnemyIds.filter((id) => !view.enemies[id]?.defeated).length ?? 0}/${view.scenario.volkareArmySize}，${view.volkare?.revealed ? `位置 ${view.volkare.position.q},${view.volkare.position.r}` : '尚未揭示'}`
    : view.scenario.objectiveKind === 'faction-leaders'
      ? `阵营首领 ${view.scenario.leadersDefeated}/${view.scenario.leadersRequired}`
      : view.scenario.objectiveKind === 'necromancer'
        ? `墓地封印 ${view.scenario.graveyardsSealed}/${view.scenario.graveyardsRequired}，暗黑首领 ${view.scenario.leadersDefeated}/${view.scenario.leadersRequired}`
        : view.scenario.objectiveKind === 'relics'
          ? `遗物 ${view.scenario.relicsFound}/${view.scenario.relicsRequired}`
          : `城市等级 ${view.scenario.cityLevels.join('/')}，已征服 ${view.scenario.citiesConquered}/${view.scenario.citiesRequired}`;
  const factionRewards = view.factionTokens.inventory.map((id) => sessionContent.factionTokens[id]?.name ?? id);
  const leaders = Object.values(view.factionLeaders).filter((leader) => leader.position || leader.defeated);

  return (
    <main>
      <header>
        <h1>Mage Knight Web v0.8.0</h1>
        <p>{view.scenario.objective}</p>
        <p><a href="?mode=tutorial">打开 v0.1 教学模式</a> · <a href="?mode=online">打开多人联机</a></p>
        <div className="new-game">
          <label className="seed-control">Seed <input aria-label="Seed" value={seed} onChange={(event) => setSeed(event.target.value)} /></label>
          <label className="module-toggle"><input aria-label="启用 Lost Legion" type="checkbox" checked={modules.includes('lost-legion.official-v0.6')} onChange={(event) => toggleModule('lost-legion.official-v0.6', event.target.checked)} /> Lost Legion</label>
          <label className="module-toggle"><input aria-label="启用 Krang" type="checkbox" checked={modules.includes('krang.character-v0.7')} onChange={(event) => toggleModule('krang.character-v0.7', event.target.checked)} /> Krang</label>
          <label className="module-toggle"><input aria-label="启用 Shades of Tezla" type="checkbox" checked={modules.includes('shades-of-tezla.official-v0.8')} onChange={(event) => toggleModule('shades-of-tezla.official-v0.8', event.target.checked)} /> Shades of Tezla</label>
          <label className="setup-select">英雄 <select aria-label="英雄" value={heroId} onChange={(event) => setHeroId(event.target.value)}>{Object.values(setupContent.heroes).map((hero) => <option key={hero.id} value={hero.id}>{hero.name}</option>)}</select></label>
          <label className="setup-select">场景 <select aria-label="场景" value={scenarioId} onChange={(event) => setScenarioId(event.target.value)}>{Object.values(setupContent.scenarios).map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.name}</option>)}</select></label>
          <label className="setup-select">难度 <select aria-label="难度" value={difficulty} onChange={(event) => setDifficulty(event.target.value as Difficulty)}><option value="explorer">探索者</option><option value="standard">标准</option><option value="veteran">老兵</option></select></label>
          <button className="setup-start" type="button" onClick={startNewGame}>开始新征服</button>
        </div>
      </header>
      <nav className="mobile-nav" aria-label="游戏区域"><a href="#status">状态</a><a href="#map">地图</a><a href="#actions">动作</a><a href="#hand">手牌</a></nav>
      {error ? <p className="error" role="alert">{error} <button type="button" onClick={() => setError('')}>关闭</button></p> : null}
      <section id="status" className="status" aria-labelledby="conquest-status-title">
        <h2 id="conquest-status-title">状态</h2>
        <p>第 {view.round}/{view.scenario.roundLimit} 轮 · {view.time === 'day' ? '白天' : '夜晚'} · {view.phase}</p>
        <p>难度 {view.scenario.difficulty}，{objectiveStatus}</p>
        <p>{sessionContent.heroes[view.player.heroId]?.name ?? view.player.heroId}：护甲 {view.player.armor}，名望 {view.player.fame}，声望 {view.player.reputation}，等级 {view.player.level}</p>
        <p>手牌 {view.player.zones.hand.length}/{view.player.handLimit}，指挥 {view.player.units.filter((unit) => !unit.destroyed).length}/{view.player.commandSlots}</p>
        <p>资源：移动 {view.resourceTotals.move}，影响 {view.resourceTotals.influence}，攻击 {view.resourceTotals.attack}，格挡 {view.resourceTotals.block}，治疗 {view.resourceTotals.heal}</p>
        <p>Source：{view.source.map((die) => `${die.color}${die.used ? '（已用）' : ''}`).join('，')}</p>
        <p>法力令牌：{Object.entries(view.player.manaTokens).filter(([, amount]) => amount > 0).map(([color, amount]) => `${color} ${amount}`).join('，') || '无'}</p>
        <p>阵营奖励：{factionRewards.join('，') || '无'}</p>
        {leaders.length ? <p>阵营首领：{leaders.map((leader) => `${sessionContent.factionLeaders[leader.definitionId]?.name ?? leader.definitionId} ${leader.defeated ? '已击败' : `等级 ${leader.level}`}`).join('，')}</p> : null}
        <p>持续规则：{activeRules.join('，') || '无'}</p>
        {view.scenario.objectiveKind === 'volkare'
          ? <p>Volkare：牌库 {view.volkare?.deck.length ?? 0}，弃牌 {view.volkare?.discard.length ?? 0}{view.volkare?.lastAction ? `，上次行动 ${view.volkare.lastAction}` : ''}</p>
          : <p>Dummy：牌库 {view.dummy.deck.length}，上次翻牌 {view.dummy.lastCardsDrawn}{view.dummy.exhausted ? '，已耗尽' : ''}</p>}
      </section>
      {groups.get('tactic') ? <section><h2>选择战术</h2><IntentButtons intents={groups.get('tactic')!} onIntent={(intent) => dispatch(intent.command)} /></section> : null}
      <ConquestBoard view={view} content={sessionContent} onIntent={(intent) => dispatch(intent.command)} />
      {activeEnemies.length ? <section><h2>当前战斗</h2>{activeEnemies.map((enemy) => <p key={enemy.id}>{enemy.name}：护甲 {enemy.armor}，攻击 {enemy.attack.join('/')} {enemy.attackElement}，能力 {enemy.abilities.join('、') || '无'}</p>)}</section> : null}
      <section id="actions" className="turn-actions"><h2>可执行动作</h2><IntentButtons intents={view.legalIntents.filter((intent) => !['card', 'tactic', 'market'].includes(intent.group) && intent.command.type !== 'MOVE_HERO')} onIntent={(intent) => dispatch(intent.command)} /></section>
      <section id="hand"><h2>手牌</h2><div className="hand">{handCards.map(({ id, definition }) => <article className="card" key={id} data-definition-id={definition?.id}><strong>{definition?.name ?? id}</strong><small>{definition?.kind}</small>{definition ? <CardRules definitionId={definition.id} content={sessionContent} /> : null}<IntentButtons intents={view.legalIntents.filter((intent) => intent.command.type === 'PLAY_CARD' && intent.command.cardId === id)} onIntent={(intent) => dispatch(intent.command)} /></article>)}</div></section>
      {view.player.units.length ? <section><h2>单位</h2>{view.player.units.filter((unit) => !unit.destroyed).map((unit) => { const definition = sessionContent.units[unit.definitionId]; const attachments = view.attachments.filter((attachment) => attachment.unitId === unit.id); return <details key={unit.id}><summary>{definition?.name ?? unit.definitionId} · {unit.ready ? '就绪' : '已使用'} · 伤 {unit.wounds}</summary>{definition?.abilities?.map((ability) => <p key={ability.label}><strong>{ability.label}：</strong>{ability.text}</p>)}{attachments.length ? <p><strong>附着：</strong>{attachments.map((attachment) => `${sessionContent.cards[attachment.definitionId]?.name ?? attachment.definitionId}${attachment.used ? '（已用）' : ''}`).join('，')}</p> : null}{definition?.sourceRef ? <small>{definition.implementation === 'full' ? '完整实现' : '模型化实现'} · {definition.sourceRef}</small> : null}</details>; })}</section> : null}
      <section><h2>技能</h2>{view.player.skills.map((skill) => { const definition = sessionContent.skills[skill.definitionId]; return <details key={skill.definitionId}><summary>{definition?.name ?? skill.definitionId}{skill.flipped ? '（背面）' : skill.used || skill.usedThisTurn ? '（已使用）' : ''}</summary><p>{definition?.ruleText ?? definition?.description}</p>{definition?.sourceRef ? <small>{definition.implementation === 'full' ? '完整实现' : '模型化实现'} · {definition.sourceRef}</small> : null}</details>; })}</section>
      {view.phase === 'interaction' ? <section><h2>市场</h2><h3>高级行动</h3>{view.market.advanced.offer.map((id) => <div key={id}><strong>{sessionContent.cards[id]?.name}</strong><CardRules definitionId={id} content={sessionContent} /></div>)}<h3>法术</h3>{view.market.spell.offer.map((id) => <div key={id}><strong>{sessionContent.cards[id]?.name}</strong><CardRules definitionId={id} content={sessionContent} /></div>)}<h3>单位</h3>{view.market.unit.offer.map((id) => { const unit = sessionContent.units[id]; return <details key={id}><summary>{unit?.name ?? id}</summary>{unit?.abilities?.map((ability) => <p key={ability.label}><strong>{ability.label}：</strong>{ability.text}</p>)}</details>; })}<IntentButtons intents={groups.get('market') ?? []} onIntent={(intent) => dispatch(intent.command)} /></section> : null}
      {view.scenario.score ? <section><h2>{view.scenario.status === 'won' ? '征服成功' : '征服失败'}</h2><p>名望 {view.scenario.score.fame} · 知识 {view.scenario.score.knowledge} · 战利品 {view.scenario.score.loot} · 领导力 {view.scenario.score.leadership} · 冒险 {view.scenario.score.adventure} · 伤牌 {view.scenario.score.wounds} · 轮数 {view.scenario.score.rounds}</p><strong>总分 {view.scenario.score.total}</strong></section> : null}
      <section id="storage"><h2>存档与回放</h2><div className="actions"><button type="button" onClick={undo} disabled={session.history.undoStack.length === 0}>撤销</button><button type="button" onClick={() => void manualSave()}>手动存档</button><button type="button" onClick={() => void manualLoad()}>载入存档</button><button type="button" onClick={exportReplay}>导出回放</button><label>验证回放 <input aria-label="导入回放 JSON" type="file" accept="application/json,.json" onChange={(event) => void importReplay(event.target.files?.[0])} /></label></div><p aria-live="polite">{status}</p></section>
      <section><h2>事件</h2><ol className="event-log">{view.eventLog.slice(-20).reverse().map((event) => <li key={event.id}>{event.message}</li>)}</ol></section>
    </main>
  );
}
