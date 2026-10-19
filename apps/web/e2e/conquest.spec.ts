import { expect, test, type Page } from '@playwright/test';

const browserErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page).toHaveTitle('Mage Knight Web v0.8.0');
  await expect(page.getByText(/已开始 v0.8.0 新游戏|已恢复 v0.8.0 自动存档|v0.8.0 已自动保存/)).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([]);
});

test('E2E-520 configures a seeded hero and selects tactics', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Mage Knight Web v0.8.0' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'v0.8.0 征服地图' }).getByRole('button')).toHaveCount(7);
  await page.getByLabel('Seed').fill('e2e-v03');
  await page.getByLabel('英雄').selectOption('core.hero.arythea');
  await page.getByLabel('难度').selectOption('veteran');
  await page.getByRole('button', { name: '开始新征服' }).click();
  await expect(page.getByText(/难度 veteran，城市等级 8\/11/)).toBeVisible();
  await expect(page.getByText(/Arythea：护甲/)).toBeVisible();
  await page.getByRole('button', { name: /1 · 先发制人/ }).click();
  await expect(page.getByRole('button', { name: '结束移动' })).toBeVisible();
  await expect(page.getByText(/Dummy：牌库 16/)).toBeVisible();
});

test('E2E-521 explores a complete seven-space tile and restores it after refresh', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'The full persistence path runs once; cross-browser smoke runs in E2E-300.');
  await page.getByLabel('Seed').fill('e2e-map-v03');
  await page.getByRole('button', { name: '开始新征服' }).click();
  await page.getByRole('button', { name: /1 · 先发制人/ }).click();
  const sidewaysMove = page.getByRole('button', { name: /横置为 move 1/ });
  await sidewaysMove.nth(0).click();
  await sidewaysMove.nth(0).click();
  await page.getByLabel(/^1,0 .*可移动/).click();
  await page.getByRole('button', { name: /横置为 move 1/ }).nth(0).click();
  await page.getByRole('button', { name: /横置为 move 1/ }).nth(0).click();
  await page.getByRole('button', { name: '探索完整七格板块（移动 2）' }).click();
  await expect(page.getByRole('img', { name: 'v0.8.0 征服地图' }).getByRole('button')).toHaveCount(14);
  await expect(page.getByText(/揭示完整七格板块/)).toBeVisible();
  await expect(page.getByText('v0.8.0 已自动保存')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('img', { name: 'v0.8.0 征服地图' }).getByRole('button')).toHaveCount(14);
});

test('E2E-622 starts Wolfhawk in the Volkare scenario', async ({ page }) => {
  await page.getByLabel('Seed').fill('e2e-lost-legion');
  await page.getByLabel('英雄').selectOption('lost-legion.hero.wolfhawk');
  await page.getByLabel('场景').selectOption('lost-legion.scenario.volkares-quest');
  await page.getByRole('button', { name: '开始新征服' }).click();
  await expect(page.getByText(/Wolfhawk：护甲/)).toBeVisible();
  await expect(page.getByText(/Volkare 军队 0\/6，尚未揭示/)).toBeVisible();
  await page.getByRole('button', { name: /1 · 先发制人/ }).click();
  await expect(page.getByText(/Volkare：牌库 14/)).toBeVisible();
  await expect(page.getByText(/Dummy：牌库/)).toHaveCount(0);
});

test('E2E-700 isolates modules and starts Krang without Lost Legion', async ({ page }) => {
  await page.getByLabel('启用 Lost Legion').uncheck();
  await expect(page.getByLabel('英雄').getByRole('option', { name: 'Wolfhawk' })).toHaveCount(0);
  await expect(page.getByLabel('场景').getByRole('option', { name: "Volkare's Quest" })).toHaveCount(0);
  await page.getByLabel('英雄').selectOption('krang.hero.krang');
  await page.getByRole('button', { name: '开始新征服' }).click();
  await expect(page.getByText(/Krang：护甲 2/)).toBeVisible();
  await expect(page.getByText('v0.8.0 已自动保存')).toBeVisible();
});

test('E2E-800 starts Braevalar in the Hidden Valley scenario', async ({ page }) => {
  await expect(page.getByLabel('启用 Shades of Tezla')).toBeChecked();
  await page.getByLabel('Seed').fill('e2e-tezla');
  await page.getByLabel('英雄').selectOption('tezla.hero.braevalar');
  await page.getByLabel('场景').selectOption('tezla.scenario.hidden-valley');
  await page.getByRole('button', { name: '开始新征服' }).click();
  await expect(page.getByText(/Braevalar：护甲 2/)).toBeVisible();
  await expect(page.getByText(/阵营首领 0\/1/)).toBeVisible();
  await expect(page.getByText(/阵营奖励：无/)).toBeVisible();
});

test('E2E-710 exports and verifies the current deterministic replay', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'The file round-trip is renderer-independent.');
  await page.getByRole('button', { name: /1 · 先发制人/ }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出回放' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  await page.getByLabel('导入回放 JSON').setInputFiles(path!);
  await expect(page.getByText(/v0.8.0 回放验证通过，已载入第 1 步/)).toBeVisible();
  await expect(page.getByText(/第 1\/6 轮 · 白天 · movement/)).toBeVisible();
});

test('E2E-823 keeps v0.8.0 controls usable at release viewports', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Viewport matrix is renderer-independent.');
  for (const viewport of [{ width: 1024, height: 768 }, { width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.reload();
    await expect(page.getByRole('img', { name: 'v0.8.0 征服地图' })).toBeVisible();
    await expect(page.getByRole('button', { name: '开始新征服' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});

test('E2E-824 keeps the mobile turn loop readable and touchable', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'The responsive layout is renderer-independent.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('navigation', { name: '游戏区域' })).toBeVisible();
  await page.getByRole('button', { name: /1 · 先发制人/ }).click();
  await expect(page.getByRole('button', { name: '结束移动' })).toBeVisible();
  const mapBox = await page.getByRole('img', { name: 'v0.8.0 征服地图' }).boundingBox();
  expect(mapBox?.height ?? 0).toBeGreaterThan(200);
  expect(await page.locator('.hand').evaluate((element) => getComputedStyle(element).overflowX)).toBe('auto');
  expect(await page.locator('.card').first().evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBeGreaterThan(280);
  expect(await page.getByRole('button', { name: '结束移动' }).evaluate((element) => Math.round(element.getBoundingClientRect().height))).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
