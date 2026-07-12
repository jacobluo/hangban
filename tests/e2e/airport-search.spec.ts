import { expect, test } from '@playwright/test';

test('searches a global airport by Chinese city name outside the current list', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('searchbox', { name: '搜索航班、机场或城市' }).fill('深圳');
  const result = page.getByRole('button', { name: /Shenzhen Bao'an International Airport SZX/ });
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.getByRole('heading', { name: 'SZX' })).toBeVisible();
  await expect(page.getByText(/ZGSZ.*深圳.*CN/)).toBeVisible();
});
