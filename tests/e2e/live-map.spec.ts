import { expect, test } from '@playwright/test';

test('loads the live map and opens CA981 from search', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: '全球实时' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByLabel('实时航班地图', { exact: true })).toBeVisible();

  await page.getByRole('searchbox').fill('CA981');
  await page.getByRole('button', { name: /CA981.*中国国际航空/ }).click();

  await expect(page.getByRole('heading', { name: 'CA981' })).toBeVisible();
  await expect(page.getByText('10,668 m')).toBeVisible();
  const observationTime = page.getByLabel('航班详情').locator('time');
  await expect(observationTime).toContainText(/GMT\+8$/);
  await expect(observationTime).toHaveAttribute('datetime', /Z$/);
  await expect(observationTime).toHaveAttribute('title', /^UTC：/);
  if (process.env.CAPTURE_BROWSER_TIME_QA === '1') {
    await page.screenshot({
      path: `.ardot-qa/browser-local-time/implementation-${testInfo.project.name}.png`,
    });
  }
  if (testInfo.project.name === 'mobile') {
    await expect(
      page.getByRole('button', { name: '实时位置，部分覆盖，打开数据状态' }),
    ).toBeVisible();
  } else {
    await expect(page.getByRole('button', { name: '实时位置，部分覆盖' })).toContainText(
      '部分覆盖',
    );
  }
});
