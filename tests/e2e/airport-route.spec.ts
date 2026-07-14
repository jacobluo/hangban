import { expect, test } from '@playwright/test';

test('explores PEK and its nearby live flights', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: '机场' }).click();
  await page.getByRole('searchbox', { name: '搜索航班、机场或城市' }).fill('PEK');
  await page.getByRole('button', { name: /北京首都国际机场 PEK/ }).click();
  await expect(page.getByRole('heading', { name: 'PEK' })).toBeVisible();
  await expect(page.getByText('周边实时航班')).toBeVisible();
  await expect(page.getByText('周边航班不等同于到港或离港班次')).toBeVisible();
});

test('returns to PEK after opening a nearby flight with back or close', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: '机场' }).click();
  await page
    .getByRole('region', { name: '机场探索' })
    .getByRole('button', { name: /北京首都国际机场/ })
    .click();

  const nearbyFlight = page
    .getByRole('complementary', { name: '机场概览' })
    .getByRole('button', { name: /MU5102/ });
  await nearbyFlight.click();
  await expect(page.getByRole('button', { name: '返回 PEK 周边航班' })).toBeVisible();

  await page.getByRole('button', { name: '返回 PEK 周边航班' }).click();
  await expect(page.getByRole('heading', { name: 'PEK' })).toBeVisible();
  await expect(page.getByText('周边实时航班')).toBeVisible();

  await page
    .getByRole('complementary', { name: '机场概览' })
    .getByRole('button', { name: /MU5102/ })
    .click();
  await page.getByRole('button', { name: '关闭航班详情' }).click();
  await expect(page.getByRole('heading', { name: 'PEK' })).toBeVisible();
  await expect(page.getByText('周边实时航班')).toBeVisible();
});

test('explores PEK to JFK active flights', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: '航线' }).click();
  await expect(page.getByRole('heading', { name: '航线探索' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '当前在途航班' })).toBeVisible();
  await expect(page.getByRole('button', { name: '交换起点和终点' })).toBeVisible();
  await expect(page.getByText(/基于公开航班信息和实时位置归并/)).toBeVisible();
  await expect(page.getByText('CA981').first()).toBeVisible();
});
