import { expect, test } from '@playwright/test';

test('shows a recoverable empty state when filters remove every flight', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '地图图层' }).click();
  const altitude = page.getByRole('slider', { name: '最大高度' });
  await altitude.fill('1000');
  await page.getByRole('button', { name: /应用筛选/ }).click();

  await expect(page.getByText(/当前筛选暂无航班/)).toBeVisible();
  await page.getByRole('button', { name: '清除筛选' }).click();
  await expect(page.getByText(/当前筛选暂无航班/)).not.toBeVisible();
});

test('keeps the map usable and offers retry when the initial snapshot network fails', async ({
  page,
}) => {
  await page.route('**/api/v1/map/snapshot**', async (route) => route.abort('failed'));
  await page.goto('/');

  await expect(page.getByLabel('实时航班地图')).toBeVisible();
  await expect(page.getByText(/正在重新连接|实时连接已中断/)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('button', { name: '重新连接' })).toBeVisible();
  await page.getByRole('button', { name: '重新连接' }).click();
  await expect(page.getByText(/正在重新连接|正在连接实时航班网络/)).toBeVisible();
});
