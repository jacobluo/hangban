import { expect, test } from '@playwright/test';

test('loads the live map and opens CA981 from search', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: '全球实时' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByLabel('实时航班地图')).toBeVisible();

  await page.getByRole('searchbox').fill('CA981');
  await page.getByRole('button', { name: /CA981.*中国国际航空/ }).click();

  await expect(page.getByRole('heading', { name: 'CA981' })).toBeVisible();
  await expect(page.getByText('10,668 m')).toBeVisible();
  await expect(page.getByLabel('实时数据状态')).toContainText('部分数据延迟');
});
