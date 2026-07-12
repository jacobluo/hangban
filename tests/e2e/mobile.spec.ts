import { expect, test } from '@playwright/test';

test('keeps the core mobile experience inside the viewport', async ({ page }) => {
  test.skip(test.info().project.name !== 'mobile', 'mobile-only check');
  await page.goto('/');
  await page.getByRole('tab', { name: '机场' }).click();
  await expect(page.getByRole('heading', { name: '机场探索' })).toBeVisible();
  const sizes = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(sizes.document).toBeLessThanOrEqual(sizes.viewport);
  await expect(page.getByRole('searchbox')).toBeVisible();

  await page.getByRole('tab', { name: '航线' }).click();
  const routeSizes = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    scrollX: window.scrollX,
  }));
  expect(routeSizes.document).toBeLessThanOrEqual(routeSizes.viewport);
  expect(routeSizes.scrollX).toBe(0);
});
