import { expect, test } from '@playwright/test';

test('two new accounts can join one room and start a shared game', async ({ browser }) => {
  test.setTimeout(60_000);
  const suffix = Math.random().toString(36).slice(2, 9);
  const ownerName = `owner-${suffix}`;
  const guestName = `guest-${suffix}`;
  const ownerContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const guest = await guestContext.newPage();
  try {
    await owner.goto('/?mode=online');
    await owner.getByLabel('用户名').fill(ownerName);
    await owner.getByLabel('密码').fill('secret12');
    await owner.getByRole('button', { name: '注册并进入' }).click();
    await expect(owner.getByRole('heading', { name: '创建对局' })).toBeVisible();
    await owner.getByLabel('房间名称').fill('联机验收');
    await owner.getByRole('button', { name: '创建', exact: true }).click();
    await expect(owner.getByRole('heading', { name: '联机验收' })).toBeVisible();
    const roomCode = (await owner.locator('.room-heading strong').textContent())?.trim();
    expect(roomCode).toMatch(/^[A-Z2-9]{6}$/);

    await guest.goto('/?mode=online');
    await guest.getByLabel('用户名').fill(guestName);
    await guest.getByLabel('密码').fill('secret12');
    await guest.getByRole('button', { name: '注册并进入' }).click();
    await guest.getByLabel('六位房间码').fill(roomCode ?? '');
    await guest.getByLabel('六位房间码').locator('..').getByRole('button', { name: '加入', exact: true }).click();
    await expect(guest.getByRole('heading', { name: '等待房主开局' })).toBeVisible();

    await expect(owner.getByText(new RegExp(`${ownerName}、${guestName}`))).toBeVisible({ timeout: 5_000 });
    await owner.getByRole('button', { name: '开始游戏' }).click();
    await expect(owner.getByRole('heading', { name: '地图' })).toBeVisible();
    await expect(owner.getByText('轮到你操作')).toBeVisible();
    await expect(guest.getByRole('heading', { name: '地图' })).toBeVisible({ timeout: 5_000 });
    await guest.getByRole('button', { name: '接管操作' }).click();
    await expect(guest.getByText('轮到你操作')).toBeVisible();
    await expect(owner.getByText(`等待 ${guestName}`)).toBeVisible({ timeout: 5_000 });
  } finally {
    await ownerContext.close();
    await guestContext.close();
  }
});
