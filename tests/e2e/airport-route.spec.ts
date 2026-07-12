import { expect, test } from '@playwright/test';

test('explores PEK and its nearby live flights', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: '机场' }).click();
  await page.getByRole('searchbox', { name: '搜索航班、机场或城市' }).fill('PEK');
  await page.getByRole('button', { name: /北京首都国际机场 PEK/ }).click();
  await expect(page.getByRole('heading', { name: 'PEK' })).toBeVisible();
  await expect(page.getByText('周边实时航班')).toBeVisible();
  await expect(page.getByText(/不代表机场到离港时刻/)).toBeVisible();
});

test('explores PEK to JFK active flights', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: '航线' }).click();
  await expect(page.getByRole('heading', { name: '航线探索' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '当前在途航班' })).toBeVisible();
  await expect(page.getByText('CA981').first()).toBeVisible();
});
