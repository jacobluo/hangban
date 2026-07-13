import { expect, test, type Page } from '@playwright/test';

const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

type RadarFreshness = 'latest' | 'historical-cache';

async function mockAvailableRadar(page: Page, freshness: RadarFreshness) {
  const frameTime = new Date(
    Date.now() - (freshness === 'historical-cache' ? 3 * 60 * 60_000 : 5 * 60_000),
  ).toISOString();

  await page.route('**/api/v1/weather/radar/tiles/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: TRANSPARENT_PNG,
    });
  });
  await page.route('**/api/v1/weather/radar', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        available: true,
        providerId: 'rainviewer',
        frameId: 'frame-1783929600',
        frameTime,
        freshness,
        tileTemplate: '/api/v1/weather/radar/tiles/frame-1783929600/{z}/{x}/{y}.png',
        attribution: {
          label: 'Weather radar by RainViewer',
          url: 'https://www.rainviewer.com/',
        },
      }),
    });
  });
}

async function enableWeatherRadar(page: Page) {
  await page.getByRole('button', { name: '打开图层与筛选' }).click();
  await page.getByRole('checkbox', { name: '天气雷达' }).check();
}

test('weather radar is opt-in and keeps attribution visible', async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await mockAvailableRadar(page, 'latest');
  await page.goto('/');

  await expect(page).toHaveTitle(/航迹/);
  await expect(page.locator('nextjs-portal')).toHaveCount(0);
  await expect(page.getByText('Weather radar by RainViewer')).toHaveCount(0);
  await enableWeatherRadar(page);

  const legend = page.getByRole('region', { name: '天气雷达图例' });
  await expect(legend.getByText(/最新/)).toBeVisible();
  await expect(legend.getByRole('link', { name: 'Weather radar by RainViewer' })).toBeVisible();
  await expect(page.getByLabel('实时航班地图', { exact: true })).toBeVisible();

  if (testInfo.project.name === 'mobile') {
    await expect
      .poll(async () => (await legend.boundingBox())?.width ?? 999)
      .toBeLessThanOrEqual(358);
  }

  await page.getByRole('button', { name: '关闭筛选与图层' }).click();
  await expect(page.getByText(/已显示 6 \/ 6 架航班/)).toHaveCount(0);
  if (testInfo.project.name === 'desktop') {
    const yBeforePlayback = (await legend.boundingBox())?.y ?? 0;
    await page.getByRole('slider', { name: '航迹回看时间' }).fill('15');
    await expect
      .poll(async () => (await legend.boundingBox())?.y ?? yBeforePlayback)
      .toBeLessThan(yBeforePlayback);
    await page.getByRole('button', { name: '返回实时位置' }).click();
  }

  if (process.env.CAPTURE_WEATHER_RADAR_QA === '1') {
    await page.waitForTimeout(1_000);
    await page.screenshot({
      path: `.ardot-qa/weather-radar/implementation-${testInfo.project.name}.png`,
      fullPage: false,
      scale: 'css',
    });
  }

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('unavailable radar turns itself off without blocking flight workflows', async ({ page }) => {
  await page.route('**/api/v1/weather/radar', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        available: false,
        providerId: 'rainviewer',
        reason: 'UPSTREAM_UNAVAILABLE',
      }),
    });
  });
  await page.goto('/');
  await enableWeatherRadar(page);

  await expect(page.getByText(/航班数据不受影响/)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: '天气雷达' })).not.toBeChecked();
  await expect(page.getByLabel('实时航班地图', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '关闭筛选与图层' }).click();
  await page.getByRole('searchbox', { name: '搜索航班、机场或城市' }).fill('CA981');
  await page.getByRole('button', { name: /CA981.*中国国际航空/ }).click();
  await expect(page.getByRole('heading', { name: 'CA981' })).toBeVisible();
});

test('historical radar is explicitly marked as non-current weather', async ({ page }) => {
  await mockAvailableRadar(page, 'historical-cache');
  await page.goto('/');
  await enableWeatherRadar(page);

  await expect(page.getByRole('region', { name: '天气雷达图例' })).toContainText('非当前天气');
});

test('status-page weather failure stays separate from flight health', async ({
  page,
}, testInfo) => {
  await page.route('**/api/v1/weather/radar', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        available: false,
        providerId: 'rainviewer',
        reason: 'UPSTREAM_UNAVAILABLE',
      }),
    });
  });
  await page.goto('/');

  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: /实时位置.*打开数据状态/ }).click();
  } else {
    await page.getByRole('button', { name: /实时位置/ }).click();
  }

  const statusPage = page.getByRole('region', { name: '数据覆盖与服务状态' });
  await expect(statusPage.getByRole('region', { name: '天气数据' })).toContainText('暂不可用');
  await expect(statusPage.getByRole('status')).toHaveText('部分服务降级');
  await expect(statusPage.getByText('2 / 3')).toBeVisible();
  await page.getByRole('button', { name: '返回地图' }).click();

  await expect(page.getByText('天气雷达暂时不可用，航班数据不受影响。')).toHaveCount(0);
  await expect(page.getByRole('main', { name: '全球实时航班地图' })).toBeVisible();
});
