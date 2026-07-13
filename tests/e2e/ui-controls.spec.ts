import { expect, test } from '@playwright/test';

test('data status uses a full responsive page and returns to the map', async ({
  page,
}, testInfo) => {
  await page.goto('/');

  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: /实时位置.*打开数据状态/ }).click();
  } else {
    await page.getByRole('button', { name: /实时位置/ }).click();
  }

  const statusPage = page.getByRole('region', { name: '数据覆盖与服务状态' });
  const viewportWidth = testInfo.project.name === 'mobile' ? 390 : 1440;
  await expect(statusPage).toBeVisible();
  await expect(page.getByRole('main', { name: '全球实时航班地图' })).toBeHidden();
  await expect(page.getByText(/当前航班数不代表全球实际在途总数/)).toBeVisible();
  await expect
    .poll(async () => Math.round((await statusPage.boundingBox())?.width ?? 0))
    .toBe(viewportWidth);
  await expect
    .poll(() =>
      statusPage.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      })),
    )
    .toEqual({ clientWidth: viewportWidth, scrollWidth: viewportWidth });

  const backButton = page.getByRole('button', { name: '返回地图' });
  await expect(backButton).toBeFocused();
  if (testInfo.project.name === 'mobile') {
    const box = await backButton.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  if (process.env.CAPTURE_DATA_STATUS_QA === '1') {
    await page.screenshot({
      path: `.ardot-qa/data-status-page/implementation-${testInfo.project.name}.png`,
      fullPage: true,
    });
  }
  await backButton.click();

  await expect(statusPage).toBeHidden();
  await expect(page.getByRole('main', { name: '全球实时航班地图' })).toBeVisible();
});

test('map controls, filters, source status and complete details change real UI state', async ({
  page,
}, testInfo) => {
  await page.goto('/');

  if (testInfo.project.name === 'desktop') {
    const zoomOutput = page.getByLabel('地图缩放级别');
    const zoomBefore = Number(await zoomOutput.textContent());
    await page.getByRole('button', { name: '放大' }).click();
    await expect
      .poll(async () => Number(await zoomOutput.textContent()))
      .toBeGreaterThan(zoomBefore);
    await page.getByRole('button', { name: '缩小' }).click();
  } else {
    await expect(page.getByRole('button', { name: '放大' })).toBeHidden();
    await expect(page.getByRole('button', { name: '缩小' })).toBeHidden();
  }

  await page.getByRole('button', { name: '打开图层与筛选' }).click();
  await expect(page.getByRole('dialog', { name: '筛选与图层' })).toBeVisible();
  const altitude = page.getByRole('slider', { name: '最大高度' });
  await altitude.fill('9000');
  await expect(page.getByRole('button', { name: '重置筛选' })).toBeVisible();
  await expect(page.getByRole('button', { name: /应用筛选/ })).toHaveCount(0);
  await expect(page.getByText(/已显示 2 \/ \d+ 架航班/)).toBeVisible();
  await page.getByRole('button', { name: '关闭筛选与图层' }).click();

  await page.getByRole('button', { name: '定位到当前位置' }).click();
  await expect(page.getByText(/未获得定位权限|不支持定位/)).toBeVisible();

  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: /实时位置.*打开数据状态/ }).click();
  } else {
    await page.getByRole('button', { name: /实时位置/ }).click();
  }
  const statusPage = page.getByRole('region', { name: '数据覆盖与服务状态' });
  await expect(statusPage).toBeVisible();
  await expect(page.getByRole('main', { name: '全球实时航班地图' })).toBeHidden();
  await expect(page.getByText('Airplanes.live')).toBeVisible();
  await expect(page.getByText(/当前航班数不代表全球实际在途总数/)).toBeVisible();
  await expect
    .poll(async () => Math.round((await statusPage.boundingBox())?.width ?? 0))
    .toBe(testInfo.project.name === 'mobile' ? 390 : 1440);
  await expect
    .poll(() =>
      statusPage.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      })),
    )
    .toEqual(
      testInfo.project.name === 'mobile'
        ? { clientWidth: 390, scrollWidth: 390 }
        : {
            clientWidth: 1440,
            scrollWidth: 1440,
          },
    );
  await page.getByRole('button', { name: '返回地图' }).click();
  await expect(page.getByRole('main', { name: '全球实时航班地图' })).toBeVisible();

  await page.getByRole('searchbox', { name: '搜索航班、机场或城市' }).fill('CA981');
  await page.getByRole('button', { name: /CA981.*中国国际航空/ }).click();
  await page.getByRole('button', { name: '查看完整详情' }).click();
  await expect(page.getByRole('heading', { name: '实时飞行数据' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '补充资料' })).toBeVisible();
  await expect(page.getByText('演示数据趋势', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '返回地图' }).click();
  await expect(page.getByRole('heading', { name: 'CA981' })).toBeVisible();

  if (testInfo.project.name === 'desktop') {
    await page.getByRole('slider', { name: '航迹回看时间' }).fill('15');
    await expect(page.getByText('15 分钟前')).toBeVisible();
    await page.getByRole('button', { name: '返回实时位置' }).click();
    await expect(page.getByText('实时位置')).toBeVisible();
  }
});

test('route endpoints can be searched and produce a consistent empty route result', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: '航线' }).click();
  await page.getByRole('button', { name: /选择到达机场/ }).click();
  await page.getByRole('searchbox', { name: '搜索到达机场' }).fill('PVG');
  await page.getByRole('option', { name: /PVG 上海浦东国际机场/ }).click();

  if (test.info().project.name === 'desktop') {
    await expect(page.getByText('PEK → PVG')).toBeVisible();
  } else {
    await expect(page.getByRole('button', { name: /选择到达机场，当前 PVG/ })).toBeVisible();
  }
  await expect(page.getByText('当前没有匹配的在途航班')).toBeVisible();
  await expect(page.getByText('0 ACTIVE')).toBeVisible();

  await page.getByRole('button', { name: /选择到达机场/ }).click();
  await page.getByRole('searchbox', { name: '搜索到达机场' }).fill('PEK');
  await page.getByRole('option', { name: /PEK 北京首都国际机场/ }).click();
  await expect(page.getByText(/起点和终点不能相同/)).toBeVisible();
});
