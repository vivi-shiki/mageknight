import type { GameView } from '@mageknight/engine';

export function tutorialHint(view: GameView): string {
  if (view.scenario.status === 'won') return '侦察完成。你已经掌握移动、探索、互动、战斗和升级。';
  if (view.scenario.status === 'lost') return '轮数已经耗尽，请重新开始并减少无效回合。';
  if (view.pendingDecision) return view.pendingDecision.prompt;
  if (!view.explored) {
    if (view.player.position.q === 1 && view.player.position.r === 0) return '使用剩余移动探索东侧的新板块。';
    return '打出移动牌，前往东侧村庄。';
  }
  if (view.player.units.length === 0 && view.map[`${view.player.position.q},${view.player.position.r}`]?.site === 'village') {
    return view.phase === 'interaction' ? '组合 3 点影响并招募农民。' : '结束移动，然后与村庄互动。';
  }
  if (view.phase.startsWith('combat')) {
    const labels: Record<string, string> = {
      'combat-ranged': '可以使用远程或攻城攻击；也可以跳过此阶段。',
      'combat-block': '每段攻击单独格挡；格挡不足时进入伤害阶段。',
      'combat-damage': '为每次未格挡攻击分配承伤目标。',
      'combat-attack': '组合普通攻击，达到敌人护甲后将其击败。',
    };
    return labels[view.phase] ?? '完成当前战斗阶段。';
  }
  if (view.scenario.enemiesDefeated === 0) return '前往西北侧丘陵，击败兽人游荡者。';
  return '前往新板块的丘陵，击败要塞守卫。';
}

