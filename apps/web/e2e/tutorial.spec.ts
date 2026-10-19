import { expect, test, type Page } from '@playwright/test';

const browserErrors = new WeakMap<Page, string[]>();

function card(page: Page, definitionId: string) {
  return page.locator(`[data-definition-id="${definitionId}"]`);
}

async function playBasic(page: Page, definitionId: string) {
  await card(page, definitionId).getByRole('button', { name: '基础效果' }).click();
}

async function playSideways(page: Page, definitionId: string, resourceLabel: string) {
  await card(page, definitionId).getByRole('button', { name: `横置为${resourceLabel} 1` }).click();
}

async function waitForAutosave(page: Page) {
  await page.waitForTimeout(100);
  await expect(page.getByText('已自动保存')).toBeVisible();
}

async function completeTutorial(page: Page, marchOneAlreadyPlayed = false, reloadDuringCombat = false) {
  if (!marchOneAlreadyPlayed) await playBasic(page, 'core.card.march-1');
  await playBasic(page, 'core.card.march-2');
  await page.getByLabel(/^1,0 .*可移动/).click();
  await page.getByRole('button', { name: '探索新板块（移动 2）' }).click();
  await expect(page.getByRole('img', { name: '六边形探索地图' }).getByRole('button')).toHaveCount(14);
  await page.getByRole('button', { name: '结束移动' }).click();
  await page.getByRole('button', { name: '与村庄互动' }).click();
  await playBasic(page, 'core.card.promise');
  await playSideways(page, 'core.card.rage-1', '影响');
  await page.getByRole('button', { name: '招募农民（影响 3）' }).click();
  await page.getByRole('button', { name: '结束互动' }).click();
  await page.getByRole('button', { name: '结束回合' }).click();

  await playBasic(page, 'core.card.stamina-1');
  await playSideways(page, 'core.card.swiftness-1', '移动');
  await page.getByLabel(/^1,-1 .*可移动/).click();
  if (reloadDuringCombat) {
    await waitForAutosave(page);
    await page.reload();
    await expect(page.getByText(/combat-ranged/)).toBeVisible();
  }
  await page.getByRole('button', { name: '结束远程/攻城阶段', exact: true }).click();
  await page.getByRole('button', { name: '结束格挡阶段', exact: true }).click();
  await page.getByRole('button', { name: '由英雄承受伤害', exact: true }).click();
  await page.getByRole('button', { name: '进入普通攻击阶段', exact: true }).click();
  await playBasic(page, 'core.card.rage-2');
  await playSideways(page, 'core.card.threaten', '攻击');
  await page.getByRole('button', { name: '以普通攻击目标' }).click();
  await page.getByRole('button', { name: '结束普通攻击阶段', exact: true }).click();
  await page.getByRole('button', { name: '结束回合' }).click();
  await page.getByRole('button', { name: '战斗纪律：护甲 +1' }).click();

  await playBasic(page, 'core.card.stamina-2');
  await playSideways(page, 'core.card.determination-1', '移动');
  await page.getByLabel(/^2,-1 .*可移动/).click();
  await page.getByRole('button', { name: '结束远程/攻城阶段', exact: true }).click();
  await page.getByRole('button', { name: '结束格挡阶段', exact: true }).click();
  await page.getByRole('button', { name: '由英雄承受伤害', exact: true }).click();
  await page.getByRole('button', { name: '进入普通攻击阶段', exact: true }).click();
  await page.getByRole('button', { name: '激活单位' }).click();
  await playSideways(page, 'core.card.determination-2', '攻击');
  await playSideways(page, 'core.card.swiftness-2', '攻击');
  await page.getByRole('button', { name: '以普通攻击目标' }).click();
  await page.getByRole('button', { name: '结束普通攻击阶段', exact: true }).click();
  await page.getByRole('button', { name: '结束回合' }).click();
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?mode=tutorial');
  await expect(page.getByText(/已恢复自动存档|已开始新游戏|已自动保存/)).toBeVisible();
  await page.getByRole('button', { name: '重新开始' }).click();
  await waitForAutosave(page);
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([]);
});

test('E2E-120 starts with map, hero, hand, time and Source visible', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Mage Knight Web v0.1.0' })).toBeVisible();
  await expect(page.getByRole('img', { name: '六边形探索地图' })).toBeVisible();
  await expect(page.getByText(/Tovak：护甲 2/)).toBeVisible();
  await expect(page.getByText(/第 1 轮 · 白天/)).toBeVisible();
  await expect(page.getByText(/Source：green，blue，white/)).toBeVisible();
});

test('E2E-121 keeps core controls reachable at all accepted viewports', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Viewport matrix is renderer-independent; browser smoke runs on every project.');
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    await page.reload();
    await expect(page.getByRole('img', { name: '六边形探索地图' })).toBeVisible();
    await expect(page.getByRole('button', { name: '重新开始' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  }
});

test('E2E-140 completes the guided tutorial in the browser', async ({ page }) => {
  await completeTutorial(page);
  await expect(page.getByText(/侦察完成/)).toBeVisible();
  await expect(page.getByText(/完成侦察目标/)).toBeVisible();
});

test('E2E-161 manual save, undo, combat refresh and continuation reach victory', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'The full persistence path runs once; cross-browser smoke is covered separately.');
  await playBasic(page, 'core.card.march-1');
  await page.getByRole('button', { name: '手动存档', exact: true }).click();
  await expect(page.getByText('手动存档已保存')).toBeVisible();
  await playBasic(page, 'core.card.march-2');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByText(/资源：移动 2/)).toBeVisible();
  await playBasic(page, 'core.card.march-2');
  await expect(page.getByText(/资源：移动 4/)).toBeVisible();
  await page.getByRole('button', { name: '载入手动存档', exact: true }).click();
  await expect(page.getByText(/资源：移动 2/)).toBeVisible();
  await expect(card(page, 'core.card.march-2')).toBeVisible();
  await completeTutorial(page, true, true);
  await expect(page.getByText(/侦察完成/)).toBeVisible();
});
