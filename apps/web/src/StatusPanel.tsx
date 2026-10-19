import type { TutorialContent } from '@mageknight/content';
import type { GameView } from '@mageknight/engine';

type StatusPanelProps = { view: GameView; content: TutorialContent };

export function StatusPanel({ view, content }: StatusPanelProps) {
  const activeEnemies = view.encounter?.enemyIds.map((id) => ({ state: view.enemies[id], definition: view.enemies[id] ? content.enemies[view.enemies[id]!.definitionId] : undefined })) ?? [];
  return (
    <section className="status" aria-labelledby="status-title">
      <h2 id="status-title">状态</h2>
      <p>第 {view.round} 轮 · {view.time === 'day' ? '白天' : '夜晚'} · {view.phase}</p>
      <p>Tovak：护甲 {view.player.armor}，名望 {view.player.fame}，等级 {view.player.level}，手牌 {view.player.hand.length}/{view.player.handLimit}</p>
      <p>资源：移动 {view.resourceTotals.move}，影响 {view.resourceTotals.influence}，攻击 {view.resourceTotals.attack}，格挡 {view.resourceTotals.block}，治疗 {view.resourceTotals.heal}</p>
      <p>Source：{view.source.map((die) => `${die.color}${die.used ? '（已用）' : ''}`).join('，')}</p>
      <p>单位：{view.player.units.length === 0 ? '无' : view.player.units.map((unit) => `${content.units[unit.definitionId]?.name ?? unit.definitionId}${unit.wounded ? '（受伤）' : unit.ready ? '（就绪）' : '（已用）'}`).join('，')}</p>
      {activeEnemies.map(({ state, definition }) => state && definition ? (
        <p key={state.id}>敌人：{definition.name}，护甲 {definition.armor}，攻击 {definition.attack.join('/')}，能力 {definition.abilities.join('、') || '无'}</p>
      ) : null)}
    </section>
  );
}
