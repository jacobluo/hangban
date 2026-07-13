# Weather Data Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「数据覆盖与服务状态」页面主动检查并独立展示 RainViewer 天气雷达状态，同时保持航班总体健康统计不变。

**Architecture:** 继续复用 `useWeatherRadar` 的单一状态实例，把启用条件扩展为「地图雷达已开启或状态页已打开」。新增纯展示组件负责天气状态映射，`DataStatusPage` 组合航班与天气状态；MapLibre 图层仍只受 `mapLayers.weatherRadar` 控制。

**Tech Stack:** Next.js 16、React 19、TypeScript、Vitest、Testing Library、Playwright、Ardot、pnpm workspace

## Global Constraints

- 天气雷达是独立的可选能力，不进入航班 `SourceStatus[]`。
- 天气异常不改变航班总体健康状态，也不进入「正常来源数」的分子或分母。
- 打开状态页时主动请求 `/api/v1/weather/radar`，但不自动开启 MapLibre 天气雷达图层。
- 关闭状态页且地图雷达关闭后停止天气状态请求；再次打开时重新检查。
- 只复用现有 RainViewer 后端契约，不修改 API、缓存期限或供应商适配器。
- 界面必须显示加载、最新、延迟、历史缓存、不可用和请求失败状态。
- 可用状态使用后端署名；不可用状态仍显示 `Weather radar by RainViewer` 和 `https://www.rainviewer.com/`。
- PC 使用 `1440 × 900` 视口，手机使用 `390 × 844` 视口；手机页面不得水平溢出。
- 前端实现前必须先更新并确认 Ardot `main_deep（16:1）` 中的 PC 节点 `16:1970` 和手机节点 `16:2032`。

---

### Task 1: 更新并确认 Ardot 天气数据状态卡片

**Files:**

- Inspect: Ardot file `hangban`（file ID `702710471706421`）
- Modify: `main_deep（16:1）` / `Deep / Desktop / Data Coverage and Status（16:1970）`
- Modify: `main_deep（16:1）` / `Deep / Mobile / Data Coverage and Status（16:2032）`
- Create: `.ardot-qa/weather-data-status/design-desktop.png`
- Create: `.ardot-qa/weather-data-status/design-mobile.png`

**Interfaces:**

- Consumes: `docs/superpowers/specs/2026-07-13-weather-data-status-design.md` 中的信息结构和状态文案。
- Produces: 已确认的桌面端与手机端天气数据卡片视觉基线，供 Task 2 的 CSS 和 Task 4 的视觉核对使用。

- [x] **Step 1: 读取两个状态页节点的完整结构**

使用 Ardot `batch_read` 读取 `16:1970`、`16:2032` 及其子节点，记录航班数据源列表、右侧覆盖说明、手机纵向排列和现有间距。不得凭截图猜测子节点 ID。

Expected: 返回两个节点的完整层级、布局属性和文字样式，无截断错误。

- [x] **Step 2: 在 PC 状态页增加天气数据卡片**

使用 Ardot `batch_edit` 在航班数据源列表之后插入名为 `Weather Data / Latest` 的卡片。卡片必须包含以下可见内容：

```text
天气数据
可选能力
RainViewer
最新
雷达帧时间 14:20 UTC
雷达帧时间不代表所有区域的精确观测时间
Weather radar by RainViewer
```

复用状态页现有边框、圆角、字体和间距；状态标签不能只依赖颜色。

Expected: 卡片位于航班来源列表之后，不改变顶部「正常来源」统计和右侧覆盖说明。

- [x] **Step 3: 在手机状态页增加纵向天气数据卡片**

使用 Ardot `batch_edit` 增加同样的信息结构，允许时间和说明换行。来源链接所在行的触控高度按 `44 px` 设计，不扩大画板宽度。

Expected: `390 × 844` 画板内无横向溢出，卡片可随页面纵向滚动。

- [x] **Step 4: 补齐关键状态变体**

从 PC 与手机状态页复制天气卡片，分别生成以下变体，不修改航班总体健康标签：

```text
最新：雷达帧处于 15 分钟窗口内
非当前天气：缓存帧超过 2 小时但不超过 24 小时
暂不可用：RainViewer 当前无法提供有效雷达帧
```

Expected: 三种状态都同时使用标签和说明表达，不能只更换颜色。

- [x] **Step 5: 截图并完成设计确认**

使用 Ardot `capture_screenshot` 导出 PC 和手机状态页到：

```text
.ardot-qa/weather-data-status/design-desktop.png
.ardot-qa/weather-data-status/design-mobile.png
```

检查信息层级、卡片位置、移动端换行和无溢出后，请求设计确认。未确认前不执行 Task 2。

Expected: 两张截图可读且与规格一致，设计确认完成。

### Task 2: 以测试先行实现天气数据展示组件

**Files:**

- Create: `apps/web/src/components/weather-data-status.tsx`
- Create: `apps/web/src/components/weather-data-status.test.tsx`
- Modify: `apps/web/src/components/data-status-page.tsx`
- Modify: `apps/web/src/app/globals.css:1388-1507`
- Modify: `apps/web/src/app/globals.css:2060-2125`

**Interfaces:**

- Consumes: `WeatherRadarStatus` from `@hangban/contracts`。
- Produces: `WeatherDataStatus({ status, loading, error })`；`DataStatusPage` 新增 `weatherRadarStatus`、`weatherRadarLoading`、`weatherRadarError`、`onRetryWeather` 输入。

- [ ] **Step 1: 写天气状态映射的失败测试**

创建 `weather-data-status.test.tsx`，定义一个有效雷达 fixture，并覆盖以下断言：

```tsx
const availableRadar: WeatherRadarStatus = {
  available: true,
  providerId: 'rainviewer',
  frameId: 'frame-1783929600',
  frameTime: '2026-07-13T06:20:00.000Z',
  freshness: 'latest',
  tileTemplate: '/api/v1/weather/radar/tiles/frame-1783929600/{z}/{x}/{y}.png',
  attribution: {
    label: 'Weather radar by RainViewer',
    url: 'https://www.rainviewer.com/',
  },
};

it.each([
  ['latest', '最新'],
  ['delayed', '数据延迟'],
  ['historical-cache', '非当前天气'],
] as const)('renders %s as %s', (freshness, label) => {
  render(
    <WeatherDataStatus status={{ ...availableRadar, freshness }} loading={false} error={null} />,
  );
  expect(screen.getByText(label)).toBeVisible();
  expect(screen.getByText(/雷达帧时间/)).toBeVisible();
});

it.each([
  ['DISABLED', '服务未启用'],
  ['UPSTREAM_UNAVAILABLE', '暂不可用'],
  ['NO_VALID_FRAME', '暂无有效雷达帧'],
  ['FRAME_EXPIRED', '缓存已过期'],
] as const)('renders %s as %s', (reason, label) => {
  render(
    <WeatherDataStatus
      status={{ available: false, providerId: 'rainviewer', reason }}
      loading={false}
      error="天气雷达暂时不可用"
    />,
  );
  expect(screen.getByText(label)).toBeVisible();
});

it('distinguishes loading and request failure', () => {
  const { rerender } = render(<WeatherDataStatus status={null} loading error={null} />);
  expect(screen.getByText('正在检查')).toBeVisible();
  rerender(<WeatherDataStatus status={null} loading={false} error="天气雷达暂时不可用" />);
  expect(screen.getByText('检查失败')).toBeVisible();
});
```

同时断言 RainViewer 署名链接的 `href`、`target="_blank"` 和 `rel="noreferrer"`。

- [ ] **Step 2: 运行测试并确认按预期失败**

Run:

```bash
pnpm test:unit -- apps/web/src/components/weather-data-status.test.tsx
```

Expected: FAIL，原因是 `weather-data-status.tsx` 或 `WeatherDataStatus` 尚不存在。

- [ ] **Step 3: 实现纯展示组件**

创建以下稳定映射，优先级必须是 `loading`、已获得的 `status`、请求 `error`、尚无结果：

```tsx
import type { WeatherRadarStatus } from '@hangban/contracts';

type Props = {
  status: WeatherRadarStatus | null;
  loading: boolean;
  error: string | null;
};

const unavailableCopy = {
  DISABLED: ['服务未启用', '服务端尚未启用天气雷达'],
  UPSTREAM_UNAVAILABLE: ['暂不可用', 'RainViewer 当前无法提供有效状态'],
  NO_VALID_FRAME: ['暂无有效雷达帧', '上游响应中没有可使用的雷达帧'],
  FRAME_EXPIRED: ['缓存已过期', '最近缓存帧已超过 24 小时有效范围'],
} as const;

const freshnessCopy = {
  latest: ['最新', '雷达帧处于当前天气窗口内'],
  delayed: ['数据延迟', '雷达帧存在延迟，请结合帧时间判断'],
  'historical-cache': ['非当前天气', '缓存帧仅供参考，不能作为当前天气判断'],
} as const;

export function WeatherDataStatus({ status, loading, error }: Props) {
  const copy = loading
    ? ['正在检查', '正在获取天气雷达状态']
    : status?.available === true
      ? freshnessCopy[status.freshness]
      : status?.available === false
        ? unavailableCopy[status.reason]
        : error === null
          ? ['尚未检查', '打开状态页后检查天气雷达状态']
          : ['检查失败', '天气雷达状态检查失败，可以重新获取数据'];
  const frameTime =
    status?.available === true
      ? `${new Intl.DateTimeFormat('zh-CN', {
          dateStyle: 'short',
          timeStyle: 'medium',
          timeZone: 'UTC',
        }).format(new Date(status.frameTime))} UTC`
      : '当前没有可用帧时间';
  const attribution =
    status?.available === true
      ? status.attribution
      : {
          label: 'Weather radar by RainViewer',
          url: 'https://www.rainviewer.com/',
        };

  return (
    <section className="weather-data-status" role="region" aria-label="天气数据" aria-live="polite">
      <header className="weather-status-heading">
        <div>
          <h3>天气数据</h3>
          <span>可选能力</span>
        </div>
        <strong className="weather-status-badge">{copy[0]}</strong>
      </header>
      <p>
        供应商 <strong>RainViewer</strong>
      </p>
      <dl className="weather-status-details">
        <div>
          <dt>雷达帧时间</dt>
          <dd>{frameTime}</dd>
        </div>
        <div>
          <dt>状态说明</dt>
          <dd>{copy[1]}</dd>
        </div>
      </dl>
      <p>雷达帧时间不代表所有区域的精确观测时间。</p>
      <a
        className="weather-status-attribution"
        href={attribution.url}
        target="_blank"
        rel="noreferrer"
      >
        {attribution.label}
      </a>
    </section>
  );
}
```

可用状态使用 `Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'UTC' })` 格式化 `frameTime`，并在结果后追加 `UTC`。

- [ ] **Step 4: 在状态页组合天气卡片和双重重试**

把 `DataStatusPage` 的天气输入扩展为：

```tsx
type Props = {
  statuses: SourceStatus[];
  connectionState: RealtimeConnectionState;
  flightCount: number;
  lastUpdatedAt: string | null;
  weatherRadarStatus: WeatherRadarStatus | null;
  weatherRadarLoading: boolean;
  weatherRadarError: string | null;
  onBack: () => void;
  onRetry: () => void;
  onRetryWeather: () => void;
};
```

在 `data-source-section` 中将 `<WeatherDataStatus />` 放到 `.provider-list` 之后。重试按钮使用以下处理，不让一个回调阻止另一个同步触发：

```tsx
const retryAll = () => {
  onRetry();
  onRetryWeather();
};

<button
  className="primary-button retry-button"
  type="button"
  aria-busy={weatherRadarLoading}
  onClick={retryAll}
>
  <RefreshCw size={15} /> 重新获取数据
</button>;
```

- [ ] **Step 5: 按 Ardot 基线增加响应式样式**

新增 `.weather-data-status`、`.weather-status-heading`、`.weather-status-badge`、`.weather-status-details` 和 `.weather-status-attribution` 样式。PC 卡片跟随来源列表宽度；手机媒体查询把详情改为单列，并确保链接最小高度为 `44 px`：

```css
.weather-data-status {
  margin-top: 16px;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--surface);
}

.weather-status-details {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 16px;
}

@media (max-width: 720px) {
  .weather-status-details {
    grid-template-columns: minmax(0, 1fr);
  }

  .weather-status-attribution {
    min-height: 44px;
  }
}
```

颜色使用现有 CSS 变量；不能创建只靠红、黄、绿区分的状态。

- [ ] **Step 6: 运行组件测试并确认通过**

Run:

```bash
pnpm test:unit -- apps/web/src/components/weather-data-status.test.tsx
```

Expected: 新增测试全部 PASS。

- [ ] **Step 7: 提交展示组件**

```bash
git add apps/web/src/components/weather-data-status.tsx apps/web/src/components/weather-data-status.test.tsx apps/web/src/components/data-status-page.tsx apps/web/src/app/globals.css
git commit -m "feat: show weather data status"
```

### Task 3: 主动检查天气状态并保持地图图层关闭

**Files:**

- Modify: `apps/web/src/components/app-shell.tsx:55-96,248-258`
- Modify: `apps/web/src/components/app-shell.test.tsx`

**Interfaces:**

- Consumes: Task 2 的 `DataStatusPage` 新增天气 props 和现有 `useWeatherRadar(enabled)`。
- Produces: `useWeatherRadar(mapLayers.weatherRadar || statusPageOpen)`；状态页主动检查、地图图层独立、双重重试行为。

- [ ] **Step 1: 写主动检查和地图隔离的失败测试**

在 `app-shell.test.tsx` 增加：

```tsx
it('checks weather when status page opens without enabling the map layer', async () => {
  const user = userEvent.setup();
  render(<AppShell initialData={demoData} mapEnabled={false} />);

  expect(useWeatherRadarMock).toHaveBeenLastCalledWith(false);
  await user.click(screen.getByRole('button', { name: '实时位置，部分覆盖' }));

  expect(useWeatherRadarMock).toHaveBeenLastCalledWith(true);
  expect(flightMapProps.current).toMatchObject({ weatherRadar: null });
});

it('retries weather from the data status page', async () => {
  const user = userEvent.setup();
  render(<AppShell initialData={demoData} mapEnabled={false} />);
  await user.click(screen.getByRole('button', { name: '实时位置，部分覆盖' }));
  await user.click(screen.getByRole('button', { name: '重新获取数据' }));
  expect(weatherRadarState.retry).toHaveBeenCalledTimes(1);
});
```

扩展现有天气失败测试，先开启天气图层再注入错误；另加断言：只因状态页主动检查失败时，不显示地图级「航班数据不受影响」提示。

- [ ] **Step 2: 运行聚焦测试并确认失败**

Run:

```bash
pnpm test:unit -- apps/web/src/components/app-shell.test.tsx
```

Expected: FAIL，主动打开状态页后 Hook 仍收到 `false`，或天气重试未被调用。

- [ ] **Step 3: 扩大天气请求条件并传入状态页**

将 Hook 调用改为：

```tsx
const weatherRadarRequested = mapLayers.weatherRadar || statusPageOpen;
const weatherRadar = useWeatherRadar(weatherRadarRequested);
```

状态页组合改为：

```tsx
<DataStatusPage
  statuses={sourceStatuses}
  connectionState={connectionState}
  flightCount={flights.length}
  lastUpdatedAt={lastUpdatedAt}
  weatherRadarStatus={weatherRadar.status}
  weatherRadarLoading={weatherRadar.loading}
  weatherRadarError={weatherRadar.error}
  onBack={closeStatusPage}
  onRetry={retry}
  onRetryWeather={weatherRadar.retry}
/>
```

地图 props 和图例条件保持现有 `mapLayers.weatherRadar` 判断，不得改为 `weatherRadarRequested`。

- [ ] **Step 4: 限制地图级失败提示只响应图层开启意图**

把现有失败 effect 改为先检查地图图层是否开启：

```tsx
useEffect(() => {
  if (!mapLayers.weatherRadar) return;
  if (weatherRadar.error === null && weatherRadar.status?.available !== false) return;
  setMapLayers((current) => ({ ...current, weatherRadar: false }));
  setMapMessage('天气雷达暂时不可用，航班数据不受影响。');
}, [mapLayers.weatherRadar, weatherRadar.error, weatherRadar.status]);
```

这样状态页主动检查失败只显示天气卡片状态，不污染返回地图后的系统提示。

- [ ] **Step 5: 运行聚焦测试并确认通过**

Run:

```bash
pnpm test:unit -- apps/web/src/components/app-shell.test.tsx apps/web/src/components/weather-data-status.test.tsx
```

Expected: 两个文件全部 PASS；默认雷达关闭和已有图层失败测试继续通过。

- [ ] **Step 6: 提交主动检查行为**

```bash
git add apps/web/src/components/app-shell.tsx apps/web/src/components/app-shell.test.tsx
git commit -m "feat: check weather on data status page"
```

### Task 4: 补齐状态页 E2E 与视觉回归

**Files:**

- Modify: `tests/e2e/ui-controls.spec.ts`
- Modify: `tests/e2e/weather-radar.spec.ts`
- Create: `.ardot-qa/weather-data-status/implementation-desktop.png`
- Create: `.ardot-qa/weather-data-status/implementation-mobile.png`

**Interfaces:**

- Consumes: Task 1 的 Ardot 截图、Task 2 的天气卡片和 Task 3 的主动请求条件。
- Produces: PC/手机真实用户流程、天气失败隔离和无水平溢出回归证据。

- [ ] **Step 1: 写状态页主动检查 E2E**

在 `ui-controls.spec.ts` 的状态页测试开始前注册 `/api/v1/weather/radar` mock，记录请求次数并返回 `latest` 状态：

```ts
let weatherRequests = 0;
await page.route('**/api/v1/weather/radar', async (route) => {
  weatherRequests += 1;
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      available: true,
      providerId: 'rainviewer',
      frameId: 'frame-1783929600',
      frameTime: new Date(Date.now() - 5 * 60_000).toISOString(),
      freshness: 'latest',
      tileTemplate: '/api/v1/weather/radar/tiles/frame-1783929600/{z}/{x}/{y}.png',
      attribution: {
        label: 'Weather radar by RainViewer',
        url: 'https://www.rainviewer.com/',
      },
    }),
  });
});
```

打开状态页后断言：

```ts
await expect(page.getByRole('region', { name: '天气数据' })).toContainText('最新');
await expect(page.getByRole('link', { name: 'Weather radar by RainViewer' })).toBeVisible();
expect(weatherRequests).toBeGreaterThan(0);
await expect(page.getByRole('region', { name: '天气雷达图例' })).toHaveCount(0);
```

- [ ] **Step 2: 写不可用状态不影响航班总体健康的 E2E**

在 `weather-radar.spec.ts` 增加只打开状态页、不打开雷达图层的用例。Mock 返回 `UPSTREAM_UNAVAILABLE`，然后断言天气卡片显示「暂不可用」，页面顶部航班总体健康文案与 mock 航班来源一致，并且不存在地图级「航班数据不受影响」提示。

- [ ] **Step 3: 运行 PC 与手机聚焦 E2E**

Run:

```bash
pnpm exec playwright test tests/e2e/ui-controls.spec.ts tests/e2e/weather-radar.spec.ts --project=desktop --project=mobile
```

Expected: PC 与手机项目全部 PASS；手机状态页 `scrollWidth === clientWidth === 390`。

- [ ] **Step 4: 生成实现截图并与 Ardot 核对**

Run:

```bash
CAPTURE_DATA_STATUS_QA=1 pnpm exec playwright test tests/e2e/ui-controls.spec.ts --project=desktop --project=mobile
```

将状态页实现截图保存或复制为：

```text
.ardot-qa/weather-data-status/implementation-desktop.png
.ardot-qa/weather-data-status/implementation-mobile.png
```

逐项核对卡片位置、间距、状态标签、RainViewer 署名、手机换行和无水平溢出。发现偏差时先修复实现并重跑聚焦测试。

- [ ] **Step 5: 提交 E2E 与视觉检查记录**

```bash
git add tests/e2e/ui-controls.spec.ts tests/e2e/weather-radar.spec.ts .ardot-qa/weather-data-status
git commit -m "test: verify weather data status"
```

### Task 5: 更新实施记录并完成全量验证

**Files:**

- Modify: `docs/AGENTS.md`
- Modify: `docs/superpowers/plans/2026-07-13-weather-data-status.md`

**Interfaces:**

- Consumes: Tasks 1–4 的实现、测试结果和视觉核对产物。
- Produces: 已勾选的实施记录和通过仓库门禁的可交付分支。

- [ ] **Step 1: 更新文档状态**

在 `docs/AGENTS.md` 的文档索引保留本计划链接，并把状态说明中的天气雷达描述更新为：

```text
已实现地图雷达图层和状态页独立天气数据检查，并完成 1440 × 900 与 390 × 844 视觉核对
```

勾选本计划中所有已完成步骤；如果实现与计划不同，在对应 Task 下写明实际选择和原因。

- [ ] **Step 2: 运行格式检查**

Run:

```bash
pnpm format:check
```

Expected: `All matched files use Prettier code style!`

- [ ] **Step 3: 运行完整验证**

Run:

```bash
pnpm verify
```

Expected: lint、typecheck、unit/component、integration、build 和 Playwright E2E 全部通过；只有仓库已有的条件性 skip 可以保留。

- [ ] **Step 4: 检查工作区与提交范围**

Run:

```bash
git status --short
git diff --check
```

Expected: 只包含本 Task 的文档勾选和状态说明，无 `next-env.d.ts` 等开发服务器生成改动，无空白错误。

- [ ] **Step 5: 提交最终实施记录**

```bash
git add docs/AGENTS.md docs/superpowers/plans/2026-07-13-weather-data-status.md
git commit -m "docs: complete weather data status"
```

Expected: 提交成功，随后 `git status --short` 无输出。
