# 天气雷达图层实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有航班地图中接入默认关闭的 RainViewer 天气雷达图层，通过服务端安全代理和 24 小时有界缓存展示最新、延迟和历史缓存状态。

**Architecture:** `packages/adapters` 隔离 RainViewer 元数据与 PNG 请求，`apps/api` 的天气雷达模块负责帧注册、新鲜度、缓存和同源 HTTP 契约，`apps/web` 只消费统一契约并管理 MapLibre raster layer。天气状态不进入航班融合或 `SourceStatus`；雷达缓存不写入 PostgreSQL，也不形成历史档案。

**Tech Stack:** pnpm workspace、TypeScript 5.9、Zod 4、Fastify 5、React 19、Next.js 16、MapLibre GL JS 5、Vitest 4、Testing Library、Playwright 1.61、Ardot。

## Global Constraints

- 修改前端前必须先更新 Ardot `main_deep（16:1）` 并确认桌面端 1440 × 900、手机端 390 × 844 设计。
- 首期只接入 RainViewer 免费公共接口，不实现 OpenWeather、Tomorrow.io、中国天气网、和风天气或彩云天气适配器。
- 天气雷达默认关闭，不提供动画、预报、时间轴、历史查询或定时区域抓取。
- 浏览器只能访问本项目 API；不得暴露 RainViewer `host`、原始 `path` 或把供应商地址写入客户端配置。
- 雷达元数据和按需瓦片缓存 TTL 默认 86,400,000 ms，并同时受条目数和总字节数上限约束；容量不足时允许提前淘汰。
- 新鲜度固定为：0–15 分钟 `latest`、15 分钟–2 小时 `delayed`、2–24 小时 `historical-cache`、超过 24 小时不可用。
- `historical-cache` 必须显示「非当前天气」，不能表述为当前观测。
- RainViewer 瓦片最大缩放级别为 7；代理必须校验帧、XYZ 坐标、HTTPS 主机、PNG 类型、响应大小和超时。
- 天气故障不得修改航班来源状态，不得阻塞航班、机场、航线和 WebSocket 功能。
- 默认测试不得访问公网；公网验证只通过显式 `pnpm smoke:weather-radar` 执行。
- 不新增状态管理库、查询缓存库、对象存储 SDK 或图片处理依赖。

## 文件结构

```text
packages/contracts/src/weather-radar.ts       统一雷达状态、错误和契约 schema
packages/adapters/src/rainviewer.ts           RainViewer 元数据与 PNG 适配器
apps/api/src/weather-radar-cache.ts            24 小时有界帧和瓦片缓存
apps/api/src/weather-radar-service.ts          当前状态、降级和代理编排
apps/api/src/routes/weather-radar.ts           Fastify 状态与瓦片路由
apps/api/src/smoke-weather-radar.ts             显式公网冒烟入口
apps/web/src/lib/use-weather-radar.ts           前端启停、加载和错误状态
apps/web/src/lib/weather-radar-layer.ts         MapLibre raster source/layer 同步
apps/web/src/components/weather-radar-legend.tsx 紧凑图例和来源署名
tests/e2e/weather-radar.spec.ts                 桌面端、手机端和降级流程
```

---

### Task 1: 完成 Ardot 天气雷达设计门

**Files:**

- Modify: Ardot 文件 `hangban`，页面 `main_deep（16:1）`
- Modify: `docs/AGENTS.md`
- Modify: `docs/superpowers/plans/2026-07-13-weather-radar-overlay.md`
- Visual evidence: `.ardot-qa/weather-radar/`（忽略目录，不提交）

**Interfaces:**

- Consumes: 已确认的「地图左下角紧凑图例」视觉方向和 `latest | delayed | historical-cache` 状态语义。
- Produces: 前端实施可直接核对的桌面端、手机端、加载、延迟、历史缓存和不可用状态。

- [x] **Step 1: 在 Ardot 补齐桌面端图层状态**

在 `main_deep（16:1）` 的 `06 / Filters and Layers` 区域复制现有桌面图层面板，完成以下状态：

```text
天气雷达关闭：开关关闭，无图例
天气雷达加载：开关保持开启意图，显示小型加载指示
天气雷达最新：开关开启，地图左下角显示紧凑图例和「最新」
天气雷达延迟：图例显示「数据延迟」和帧时间
天气雷达历史缓存：图例显示「非当前天气 · X 小时前」，雷达透明度降低
天气雷达不可用：开关恢复关闭，显示「天气雷达暂时不可用」
```

- [x] **Step 2: 在 Ardot 补齐手机端状态**

创建 390 × 844 手机地图与图层面板状态。紧凑图例不得遮挡定位按钮、图层按钮和航迹回看控件；航迹回看出现时图例上移。

- [x] **Step 3: 视觉核对并保存证据**

核对：

```text
桌面视口：1440 × 900
手机视口：390 × 844
雷达位于底图之上、机场/航迹/航班之下
默认雷达透明度：约 55%
历史缓存透明度：低于最新状态
署名：Weather radar by RainViewer，可清晰辨认
```

将截图保存到 `.ardot-qa/weather-radar/desktop.png` 和 `.ardot-qa/weather-radar/mobile.png`。

- [x] **Step 4: 记录设计门结果**

在 `docs/AGENTS.md` 把天气雷达状态改为：

```markdown
| 天气雷达 | `main_deep（16:1）` 已确认桌面端与手机端设计，等待实施 |
```

- [x] **Step 5: 检查并提交设计门记录**

Run: `pnpm exec prettier --check docs/AGENTS.md docs/superpowers/plans/2026-07-13-weather-radar-overlay.md`

Expected: `All matched files use Prettier code style!`

```bash
git add docs/AGENTS.md docs/superpowers/plans/2026-07-13-weather-radar-overlay.md
git commit -m "docs: confirm weather radar visuals"
```

---

### Task 2: 定义天气雷达契约和配置

**Files:**

- Create: `packages/contracts/src/weather-radar.ts`
- Create: `packages/contracts/src/weather-radar.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/config/src/index.ts`
- Modify: `packages/config/src/config.test.ts`
- Modify: `.env.example`

**Interfaces:**

- Consumes: 无。
- Produces: `weatherRadarStatusSchema`、`WeatherRadarStatus`、`WeatherRadarAvailableStatus`、`WeatherRadarFreshness`，以及 `RuntimeConfig` 的天气雷达配置字段。

- [x] **Step 1: 写契约失败测试**

在 `packages/contracts/src/weather-radar.test.ts` 写入：

```ts
import { describe, expect, it } from 'vitest';

import { weatherRadarStatusSchema } from './weather-radar';

describe('weatherRadarStatusSchema', () => {
  it('accepts an internal tile template and visible attribution', () => {
    expect(
      weatherRadarStatusSchema.parse({
        available: true,
        providerId: 'rainviewer',
        frameId: 'frame-1783929600',
        frameTime: '2026-07-13T08:00:00.000Z',
        freshness: 'latest',
        tileTemplate: '/api/v1/weather/radar/tiles/frame-1783929600/{z}/{x}/{y}.png',
        attribution: { label: 'Weather radar by RainViewer', url: 'https://www.rainviewer.com/' },
      }),
    ).toMatchObject({ available: true, freshness: 'latest' });
  });

  it('rejects an upstream host in tileTemplate', () => {
    expect(() =>
      weatherRadarStatusSchema.parse({
        available: true,
        providerId: 'rainviewer',
        frameId: 'frame-1783929600',
        frameTime: '2026-07-13T08:00:00.000Z',
        freshness: 'latest',
        tileTemplate: 'https://tilecache.rainviewer.com/v2/radar/{z}/{x}/{y}.png',
        attribution: { label: 'Weather radar by RainViewer', url: 'https://www.rainviewer.com/' },
      }),
    ).toThrow();
  });
});
```

- [x] **Step 2: 运行契约测试并确认失败**

Run: `pnpm exec vitest run packages/contracts/src/weather-radar.test.ts`

Expected: FAIL，提示找不到 `./weather-radar`。

- [x] **Step 3: 实现统一契约**

创建 `packages/contracts/src/weather-radar.ts`：

```ts
import { z } from 'zod';

export const weatherRadarFreshnessSchema = z.enum(['latest', 'delayed', 'historical-cache']);

export const weatherRadarUnavailableReasonSchema = z.enum([
  'DISABLED',
  'UPSTREAM_UNAVAILABLE',
  'NO_VALID_FRAME',
  'FRAME_EXPIRED',
]);

export const weatherRadarAvailableStatusSchema = z.object({
  available: z.literal(true),
  providerId: z.literal('rainviewer'),
  frameId: z.string().regex(/^frame-[0-9]+$/),
  frameTime: z.iso.datetime({ offset: true }),
  freshness: weatherRadarFreshnessSchema,
  tileTemplate: z
    .string()
    .regex(/^\/api\/v1\/weather\/radar\/tiles\/frame-[0-9]+\/\{z\}\/\{x\}\/\{y\}\.png$/),
  attribution: z.object({
    label: z.literal('Weather radar by RainViewer'),
    url: z.literal('https://www.rainviewer.com/'),
  }),
});

export const weatherRadarUnavailableStatusSchema = z.object({
  available: z.literal(false),
  providerId: z.literal('rainviewer'),
  reason: weatherRadarUnavailableReasonSchema,
});

export const weatherRadarStatusSchema = z.discriminatedUnion('available', [
  weatherRadarAvailableStatusSchema,
  weatherRadarUnavailableStatusSchema,
]);

export type WeatherRadarFreshness = z.infer<typeof weatherRadarFreshnessSchema>;
export type WeatherRadarAvailableStatus = z.infer<typeof weatherRadarAvailableStatusSchema>;
export type WeatherRadarStatus = z.infer<typeof weatherRadarStatusSchema>;
```

从 `packages/contracts/src/index.ts` 导出：

```ts
export * from './weather-radar';
```

- [x] **Step 4: 写配置失败测试**

在 `packages/config/src/config.test.ts` 增加：

```ts
it('loads bounded weather radar defaults', () => {
  expect(loadConfig({})).toMatchObject({
    weatherRadarEnabled: false,
    rainViewerBaseUrl: 'https://api.rainviewer.com',
    weatherRadarTimeoutMs: 8_000,
    weatherRadarCacheTtlMs: 86_400_000,
    weatherRadarCacheMaxEntries: 2_048,
    weatherRadarCacheMaxBytes: 134_217_728,
    weatherRadarMaxZoom: 7,
  });
});

it('rejects unsafe weather radar limits', () => {
  expect(() => loadConfig({ WEATHER_RADAR_MAX_ZOOM: '8' })).toThrow();
  expect(() => loadConfig({ WEATHER_RADAR_CACHE_MAX_BYTES: '0' })).toThrow();
  expect(() => loadConfig({ RAINVIEWER_BASE_URL: 'http://example.test' })).toThrow();
});
```

- [x] **Step 5: 运行配置测试并确认失败**

Run: `pnpm exec vitest run packages/config/src/config.test.ts`

Expected: FAIL，缺少天气雷达字段，且无效配置未被拒绝。

- [x] **Step 6: 实现配置并更新示例**

在 `packages/config/src/index.ts` 的 `configSchema` 增加：

```ts
WEATHER_RADAR_ENABLED: z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true'),
RAINVIEWER_BASE_URL: z.string().url().refine((value) => new URL(value).protocol === 'https:').default('https://api.rainviewer.com'),
WEATHER_RADAR_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
WEATHER_RADAR_CACHE_TTL_MS: z.coerce.number().int().positive().default(86_400_000),
WEATHER_RADAR_CACHE_MAX_ENTRIES: z.coerce.number().int().positive().default(2_048),
WEATHER_RADAR_CACHE_MAX_BYTES: z.coerce.number().int().positive().default(134_217_728),
WEATHER_RADAR_MAX_ZOOM: z.coerce.number().int().min(0).max(7).default(7),
```

在 `RuntimeConfig` 和 `loadConfig()` 返回值中增加对应 camelCase 字段。`.env.example` 增加：

```dotenv
WEATHER_RADAR_ENABLED=true
RAINVIEWER_BASE_URL=https://api.rainviewer.com
WEATHER_RADAR_TIMEOUT_MS=8000
WEATHER_RADAR_CACHE_TTL_MS=86400000
WEATHER_RADAR_CACHE_MAX_ENTRIES=2048
WEATHER_RADAR_CACHE_MAX_BYTES=134217728
WEATHER_RADAR_MAX_ZOOM=7
```

- [x] **Step 7: 运行聚焦测试和类型检查**

Run: `pnpm exec vitest run packages/contracts/src/weather-radar.test.ts packages/config/src/config.test.ts && pnpm --filter @hangban/contracts typecheck && pnpm --filter @hangban/config typecheck`

Expected: PASS。

- [x] **Step 8: 提交契约和配置**

```bash
git add packages/contracts/src/weather-radar.ts packages/contracts/src/weather-radar.test.ts packages/contracts/src/index.ts packages/config/src/index.ts packages/config/src/config.test.ts .env.example
git commit -m "feat: define weather radar contracts"
```

---

### Task 3: 实现 RainViewer 适配器

**Files:**

- Create: `packages/adapters/src/rainviewer.ts`
- Create: `packages/adapters/src/rainviewer.test.ts`
- Modify: `packages/adapters/src/index.ts`

**Interfaces:**

- Consumes: `RuntimeConfig.rainViewerBaseUrl`、`RuntimeConfig.weatherRadarTimeoutMs`。
- Produces: `WeatherRadarProvider`、`WeatherRadarProviderFrame`、`WeatherRadarProviderError`、`createRainViewerProvider()`。

- [x] **Step 1: 写元数据与 PNG 校验失败测试**

创建 `packages/adapters/src/rainviewer.test.ts`，覆盖：

```ts
import { describe, expect, it, vi } from 'vitest';

import { createRainViewerProvider } from './rainviewer';

describe('RainViewer provider', () => {
  it('selects the newest valid past frame', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            version: '2.0',
            generated: 1_783_929_700,
            host: 'https://tilecache.rainviewer.com',
            radar: {
              past: [
                { time: 1_783_929_000, path: '/v2/radar/older' },
                { time: 1_783_929_600, path: '/v2/radar/newest' },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const provider = createRainViewerProvider({
      baseUrl: 'https://api.rainviewer.com',
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 100,
      maxTileBytes: 1024,
    });

    await expect(provider.fetchLatestFrame()).resolves.toEqual({
      providerId: 'rainviewer',
      frameId: 'frame-1783929600',
      frameTime: '2026-07-13T08:00:00.000Z',
      upstreamHost: 'https://tilecache.rainviewer.com',
      upstreamPath: '/v2/radar/newest',
    });
  });

  it('rejects a non-PNG tile response', async () => {
    const provider = createRainViewerProvider({
      baseUrl: 'https://api.rainviewer.com',
      fetchImpl: vi.fn(
        async () => new Response('not png', { headers: { 'content-type': 'text/plain' } }),
      ) as typeof fetch,
      timeoutMs: 100,
      maxTileBytes: 1024,
    });
    await expect(
      provider.fetchTile(
        { upstreamHost: 'https://tilecache.rainviewer.com', upstreamPath: '/v2/radar/frame' },
        7,
        1,
        2,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
```

- [x] **Step 2: 运行适配器测试并确认失败**

Run: `pnpm exec vitest run packages/adapters/src/rainviewer.test.ts`

Expected: FAIL，提示找不到 `./rainviewer`。

- [x] **Step 3: 实现适配器接口和错误类型**

在 `packages/adapters/src/rainviewer.ts` 定义：

```ts
export type WeatherRadarProviderFrame = {
  providerId: 'rainviewer';
  frameId: string;
  frameTime: string;
  upstreamHost: string;
  upstreamPath: string;
};

export type WeatherRadarTile = {
  bytes: Uint8Array;
  contentType: 'image/png';
};

export interface WeatherRadarProvider {
  fetchLatestFrame(): Promise<WeatherRadarProviderFrame>;
  fetchTile(
    frame: Pick<WeatherRadarProviderFrame, 'upstreamHost' | 'upstreamPath'>,
    z: number,
    x: number,
    y: number,
  ): Promise<WeatherRadarTile>;
}

export class WeatherRadarProviderError extends Error {
  constructor(
    public readonly code: 'TIMEOUT' | 'UPSTREAM_ERROR' | 'INVALID_RESPONSE',
    message: string,
  ) {
    super(message);
    this.name = 'WeatherRadarProviderError';
  }
}
```

使用 Zod 校验元数据：`host` 必须是 `https://tilecache.rainviewer.com`，`path` 必须匹配 `/v2/radar/<token>`，`time` 必须为正整数。瓦片 URL 固定为：

```ts
`${frame.upstreamHost}${frame.upstreamPath}/512/${z}/${x}/${y}/2/1_1.png`;
```

`fetchTile()` 必须在读取后验证 `content-type` 为 `image/png` 且 `bytes.byteLength <= maxTileBytes`。元数据和瓦片请求都使用 `AbortSignal.timeout(timeoutMs)`，对外只抛稳定错误类型。

- [x] **Step 4: 补齐安全与边界测试**

在同一测试文件增加以下测试；`metadataResponse()` 只负责把传入对象包装为 JSON `Response`，不得修改被测数据：

```ts
function metadataResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

it.each([
  ['http host', { host: 'http://tilecache.rainviewer.com', radar: { past: [] } }],
  ['foreign host', { host: 'https://example.test', radar: { past: [] } }],
  ['empty frames', { host: 'https://tilecache.rainviewer.com', radar: { past: [] } }],
])('rejects invalid metadata: %s', async (_name, payload) => {
  const provider = createRainViewerProvider({
    baseUrl: 'https://api.rainviewer.com',
    fetchImpl: vi.fn(async () => metadataResponse(payload)) as typeof fetch,
    timeoutMs: 100,
    maxTileBytes: 4,
  });
  await expect(provider.fetchLatestFrame()).rejects.toMatchObject({
    code: 'INVALID_RESPONSE',
  });
});

it('ignores an invalid older frame and selects the valid frame', async () => {
  const provider = createRainViewerProvider({
    baseUrl: 'https://api.rainviewer.com',
    fetchImpl: vi.fn(async () =>
      metadataResponse({
        version: '2.0',
        generated: 1_783_929_700,
        host: 'https://tilecache.rainviewer.com',
        radar: {
          past: [
            { time: 1_783_929_000, path: 'https://example.test/invalid' },
            { time: 1_783_929_600, path: '/v2/radar/valid' },
          ],
        },
      }),
    ) as typeof fetch,
    timeoutMs: 100,
    maxTileBytes: 4,
  });
  await expect(provider.fetchLatestFrame()).resolves.toMatchObject({
    frameId: 'frame-1783929600',
    upstreamPath: '/v2/radar/valid',
  });
});

it('rejects a PNG larger than maxTileBytes', async () => {
  const provider = createRainViewerProvider({
    baseUrl: 'https://api.rainviewer.com',
    fetchImpl: vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3, 4, 5]), {
          headers: { 'content-type': 'image/png' },
        }),
    ) as typeof fetch,
    timeoutMs: 100,
    maxTileBytes: 4,
  });
  await expect(
    provider.fetchTile(
      {
        upstreamHost: 'https://tilecache.rainviewer.com',
        upstreamPath: '/v2/radar/frame',
      },
      7,
      1,
      2,
    ),
  ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});

it.each([
  [Response.error(), 'UPSTREAM_ERROR'],
  [new DOMException('timed out', 'AbortError'), 'TIMEOUT'],
])('normalizes request failure', async (failure, code) => {
  const fetchImpl = vi.fn(async () => {
    if (failure instanceof Error) throw failure;
    return failure;
  });
  const provider = createRainViewerProvider({
    baseUrl: 'https://api.rainviewer.com',
    fetchImpl: fetchImpl as typeof fetch,
    timeoutMs: 100,
    maxTileBytes: 4,
  });
  await expect(provider.fetchLatestFrame()).rejects.toMatchObject({ code });
});
```

- [x] **Step 5: 导出并运行测试**

从 `packages/adapters/src/index.ts` 增加：

```ts
export * from './rainviewer';
```

Run: `pnpm exec vitest run packages/adapters/src/rainviewer.test.ts && pnpm --filter @hangban/adapters typecheck`

Expected: PASS。

- [x] **Step 6: 提交适配器**

```bash
git add packages/adapters/src/rainviewer.ts packages/adapters/src/rainviewer.test.ts packages/adapters/src/index.ts
git commit -m "feat: add RainViewer adapter"
```

---

### Task 4: 实现 24 小时有界缓存和雷达模块

**Files:**

- Create: `apps/api/src/weather-radar-cache.ts`
- Create: `apps/api/src/weather-radar-cache.test.ts`
- Create: `apps/api/src/weather-radar-service.ts`
- Create: `apps/api/src/weather-radar-service.test.ts`

**Interfaces:**

- Consumes: `WeatherRadarProvider` 和统一 `WeatherRadarStatus`。
- Produces: `WeatherRadarService`、`createWeatherRadarService()`、`createDisabledWeatherRadarService()`。

- [x] **Step 1: 写缓存失败测试**

在 `apps/api/src/weather-radar-cache.test.ts` 验证：

```ts
it('evicts by total bytes and expires entries at 24 hours', () => {
  let now = 0;
  const cache = createWeatherRadarCache({
    ttlMs: 86_400_000,
    maxEntries: 2,
    maxBytes: 4,
    now: () => now,
  });
  cache.setTile('a', new Uint8Array([1, 2]));
  cache.setTile('b', new Uint8Array([3, 4]));
  expect(cache.getTile('a')).toEqual(new Uint8Array([1, 2]));
  cache.setTile('c', new Uint8Array([5, 6]));
  expect(cache.getTile('b')).toBeNull();
  now = 86_400_001;
  expect(cache.getTile('a')).toBeNull();
});
```

- [x] **Step 2: 运行缓存测试并确认失败**

Run: `pnpm exec vitest run apps/api/src/weather-radar-cache.test.ts`

Expected: FAIL，提示找不到缓存模块。

- [x] **Step 3: 实现缓存**

`createWeatherRadarCache()` 必须提供：

```ts
type WeatherRadarCache = {
  setFrame(frame: WeatherRadarProviderFrame): void;
  getFrame(frameId: string): WeatherRadarProviderFrame | null;
  remainingTtlMsForFrame(frameId: string): number | null;
  newestFrame(): WeatherRadarProviderFrame | null;
  setTile(key: string, bytes: Uint8Array): void;
  getTile(key: string): Uint8Array | null;
  clear(): void;
  stats(): { entries: number; bytes: number };
};
```

帧和瓦片都记录 `storedAt`、`lastUsedAt`；每次读更新 LRU。删除过期条目后，再按最久未使用顺序淘汰，直到同时满足 `maxEntries` 和 `maxBytes`。返回 `Uint8Array` 副本，避免调用方修改缓存内容。

- [x] **Step 4: 写雷达模块失败测试**

在 `apps/api/src/weather-radar-service.test.ts` 使用注入时钟和 fake provider 验证：

```ts
it.each([
  [14 * 60_000, 'latest'],
  [15 * 60_000, 'delayed'],
  [2 * 60 * 60_000, 'historical-cache'],
])('classifies a frame aged %i ms as %s', async (ageMs, freshness) => {
  const now = new Date('2026-07-13T08:00:00.000Z');
  const provider = providerReturningFrame(new Date(now.getTime() - ageMs));
  const service = createWeatherRadarService(validOptions({ provider, now: () => now }));
  await expect(service.status()).resolves.toMatchObject({ available: true, freshness });
});

it('uses cached data for at most 24 hours after upstream failure', async () => {
  let now = new Date('2026-07-13T08:00:00.000Z');
  let upstreamFails = false;
  const frame = {
    providerId: 'rainviewer' as const,
    frameId: 'frame-1783929600',
    frameTime: now.toISOString(),
    upstreamHost: 'https://tilecache.rainviewer.com',
    upstreamPath: '/v2/radar/current',
  };
  const provider: WeatherRadarProvider = {
    async fetchLatestFrame() {
      if (upstreamFails) throw new WeatherRadarProviderError('UPSTREAM_ERROR', 'down');
      return frame;
    },
    async fetchTile() {
      return { bytes: new Uint8Array([137, 80, 78, 71]), contentType: 'image/png' };
    },
  };
  const service = createWeatherRadarService(validOptions({ provider, now: () => now }));

  await expect(service.status()).resolves.toMatchObject({
    available: true,
    freshness: 'latest',
  });
  upstreamFails = true;
  now = new Date(frame.frameTime);
  now.setHours(now.getHours() + 23);
  await expect(service.status()).resolves.toMatchObject({
    available: true,
    freshness: 'historical-cache',
  });
  now = new Date(frame.frameTime);
  now.setMilliseconds(now.getMilliseconds() + 86_400_001);
  await expect(service.status()).resolves.toEqual({
    available: false,
    providerId: 'rainviewer',
    reason: 'FRAME_EXPIRED',
  });
});
```

- [x] **Step 5: 运行模块测试并确认失败**

Run: `pnpm exec vitest run apps/api/src/weather-radar-cache.test.ts apps/api/src/weather-radar-service.test.ts`

Expected: FAIL，提示找不到 `createWeatherRadarService`。

- [x] **Step 6: 实现雷达模块**

定义：

```ts
export type WeatherRadarService = {
  status(): Promise<WeatherRadarStatus>;
  tile(
    frameId: string,
    z: number,
    x: number,
    y: number,
  ): Promise<{ bytes: Uint8Array; cacheMaxAgeSeconds: number }>;
  clear(): void;
};

export function createWeatherRadarService(options: {
  enabled: boolean;
  provider: WeatherRadarProvider;
  cache: WeatherRadarCache;
  now?: () => Date;
  maxZoom: number;
}): WeatherRadarService;

export function createDisabledWeatherRadarService(): WeatherRadarService;
```

`status()` 优先尝试最新上游帧；失败时读取 `newestFrame()`。可用响应的 `tileTemplate` 固定生成为：

```ts
`/api/v1/weather/radar/tiles/${frame.frameId}/{z}/{x}/{y}.png`;
```

边界使用半开区间：年龄 `< 15 分钟` 为 `latest`，`< 2 小时` 为 `delayed`，`<= 24 小时` 为 `historical-cache`，`> 24 小时` 为 `FRAME_EXPIRED`。`tile()` 先校验 `0 <= z <= maxZoom` 和 `0 <= x,y < 2 ** z`，再按 `${frameId}:${z}:${x}:${y}` 查询缓存；未命中时只允许使用缓存帧注册信息请求 provider。成功结果同时返回 CDN 可复用秒数，其上限取 300 秒、帧缓存剩余 TTL 与距离帧时间 24 小时边界的剩余时长三者最小值。

- [x] **Step 7: 覆盖主要失败路径**

测试必须覆盖：

```text
enabled=false 不调用 provider
重复 tile 请求只调用上游一次
未知 frameId 被拒绝
z=8 被拒绝
x 或 y 超出 2 ** z 被拒绝
缓存返回副本
上游失败但无缓存返回 UPSTREAM_UNAVAILABLE
```

- [x] **Step 8: 运行聚焦测试和 API 类型检查**

Run: `pnpm exec vitest run apps/api/src/weather-radar-cache.test.ts apps/api/src/weather-radar-service.test.ts && pnpm --filter @hangban/api typecheck`

Expected: PASS。

- [x] **Step 9: 提交缓存和模块**

```bash
git add apps/api/src/weather-radar-cache.ts apps/api/src/weather-radar-cache.test.ts apps/api/src/weather-radar-service.ts apps/api/src/weather-radar-service.test.ts
git commit -m "feat: cache current weather radar"
```

---

### Task 5: 暴露安全的天气雷达 HTTP 接口

**Files:**

- Create: `apps/api/src/routes/weather-radar.ts`
- Create: `apps/api/src/routes/weather-radar.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/external-runtime.ts`

**Interfaces:**

- Consumes: `WeatherRadarService.status()` 和 `WeatherRadarService.tile()`。
- Produces: `GET /api/v1/weather/radar` 与 `GET /api/v1/weather/radar/tiles/:frameId/:z/:x/:y.png`。

- [x] **Step 1: 写路由失败测试**

创建 `apps/api/src/routes/weather-radar.test.ts`，用 `buildApp()` 注入 fake service：

```ts
it('returns an internal tile template without upstream details', async () => {
  const app = buildTestApp({ weatherRadarService: availableRadarService() });
  const response = await app.inject({ method: 'GET', url: '/api/v1/weather/radar' });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    available: true,
    tileTemplate: '/api/v1/weather/radar/tiles/frame-1783929600/{z}/{x}/{y}.png',
  });
  expect(response.body).not.toContain('tilecache.rainviewer.com');
});

it('returns cacheable PNG bytes', async () => {
  const app = buildTestApp({
    weatherRadarService: tileRadarService(new Uint8Array([137, 80, 78, 71])),
  });
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/weather/radar/tiles/frame-1783929600/7/1/2.png',
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toContain('image/png');
  expect(response.headers['cache-control']).toBe('public, max-age=300, must-revalidate');
});
```

- [x] **Step 2: 运行路由测试并确认失败**

Run: `pnpm exec vitest run apps/api/src/routes/weather-radar.test.ts`

Expected: FAIL，路由返回 404 或 `BuildAppOptions` 不接受天气模块。

- [x] **Step 3: 实现路由**

`registerWeatherRadarRoutes(app, service)` 注册两个接口。参数使用 Zod schema：

```ts
const tileParametersSchema = z.object({
  frameId: z.string().regex(/^frame-[0-9]+$/),
  z: z.coerce.number().int().min(0).max(7),
  x: z.coerce.number().int().nonnegative(),
  y: z.coerce.number().int().nonnegative(),
});
```

状态接口使用 `weatherRadarStatusSchema.parse()` 校验响应。瓦片接口设置：

```ts
reply
  .header('content-type', 'image/png')
  .header('cache-control', `public, max-age=${cacheMaxAgeSeconds}, must-revalidate`)
  .send(Buffer.from(bytes));
```

`cacheMaxAgeSeconds` 由天气雷达模块根据服务端有效期计算；路由不解析 `frameId` 时间戳。不得使用 `stale-if-error`，避免 CDN 在帧或服务端缓存失效后继续复用瓦片。

参数无效返回 `400 WEATHER_RADAR_REQUEST_INVALID`；未知或过期帧返回 `404 WEATHER_RADAR_FRAME_UNAVAILABLE`；上游不可用返回 `503 WEATHER_RADAR_UPSTREAM_UNAVAILABLE`。错误体不包含上游 URL、正文或堆栈。

- [x] **Step 4: 接入 `buildApp()`**

给 `BuildAppOptions` 增加：

```ts
weatherRadarService?: WeatherRadarService;
```

默认值使用 `createDisabledWeatherRadarService()`，并调用：

```ts
void registerWeatherRadarRoutes(app, weatherRadarService);
```

- [x] **Step 5: 在 demo 和 external runtime 创建模块**

提取 `createConfiguredWeatherRadarService(config)`，内部创建 RainViewer provider、缓存和 service。`createApiRuntime()` 与 `createExternalApiRuntime()` 都把结果传给 `buildApp()`；天气能力与 `DATA_MODE` 解耦。

API 关闭时调用 `weatherRadarService.clear()`。不得在启动时主动访问 RainViewer；第一次状态请求才进行上游调用。

- [x] **Step 6: 补齐路由故障测试**

增加完整用例：

```text
功能关闭返回 available=false, reason=DISABLED
非法 frameId 返回 400
z=8 返回 400
坐标超界返回 400
未知帧返回 404
上游错误返回 503 且不泄漏内部信息
天气路由失败后 /api/v1/map/snapshot 仍返回 200
```

- [x] **Step 7: 运行 API 测试和类型检查**

Run: `pnpm exec vitest run apps/api/src/routes/weather-radar.test.ts apps/api/src/weather-radar-service.test.ts apps/api/src/weather-radar-cache.test.ts && pnpm --filter @hangban/api typecheck`

Expected: PASS。

- [x] **Step 8: 提交 HTTP 接口**

```bash
git add apps/api/src/routes/weather-radar.ts apps/api/src/routes/weather-radar.test.ts apps/api/src/app.ts apps/api/src/external-runtime.ts
git commit -m "feat: proxy weather radar tiles"
```

---

### Task 6: 实现前端天气雷达状态

**Files:**

- Modify: `apps/web/src/lib/api-client.ts`
- Create: `apps/web/src/lib/use-weather-radar.ts`
- Create: `apps/web/src/lib/use-weather-radar.test.tsx`
- Modify: `apps/web/src/lib/map-settings.ts`
- Modify: `apps/web/src/lib/flight-filters.test.ts`
- Modify: `apps/web/src/components/app-shell.tsx`
- Modify: `apps/web/src/components/app-shell.test.tsx`
- Modify: `apps/web/src/components/flight-map.tsx`（仅增加 Task 7 使用的 props seam）
- Modify: `apps/web/src/components/layer-filter-panel.tsx`（仅增加 Task 7 使用的 props seam）

**Interfaces:**

- Consumes: `WeatherRadarStatus` 和 `GET /api/v1/weather/radar`。
- Produces: `useWeatherRadar()`；`MapLayers.weatherRadar`；传给地图的 `WeatherRadarAvailableStatus | null`。

- [x] **Step 1: 写 hook 失败测试**

创建 `apps/web/src/lib/use-weather-radar.test.tsx`，覆盖：

```ts
it('does not fetch until enabled and exposes a resolved internal tile URL', async () => {
  const fetchImpl = vi.fn(
    async () =>
      new Response(JSON.stringify(availableStatus()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  const { result, rerender } = renderHook(
    ({ enabled }) => useWeatherRadar(enabled, { fetchImpl: fetchImpl as typeof fetch }),
    { initialProps: { enabled: false } },
  );
  expect(fetchImpl).not.toHaveBeenCalled();
  rerender({ enabled: true });
  await waitFor(() => expect(result.current.status?.available).toBe(true));
  expect(result.current.tileTemplate).toBe(
    'http://127.0.0.1:4000/api/v1/weather/radar/tiles/frame-1783929600/{z}/{x}/{y}.png',
  );
});
```

- [x] **Step 2: 运行 hook 测试并确认失败**

Run: `pnpm exec vitest run apps/web/src/lib/use-weather-radar.test.tsx`

Expected: FAIL，提示找不到 hook。

- [x] **Step 3: 扩展 API client**

在 `apps/web/src/lib/api-client.ts` 增加：

```ts
export async function fetchWeatherRadarStatus(
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<WeatherRadarStatus> {
  const response = await fetchImpl(
    `${apiBaseUrl}/api/v1/weather/radar`,
    signal === undefined ? undefined : { signal },
  );
  if (!response.ok) throw new Error('天气雷达暂时不可用');
  return weatherRadarStatusSchema.parse(await response.json());
}

export function resolveApiUrl(path: string): string {
  return new URL(path, `${apiBaseUrl}/`).toString().replaceAll('%7B', '{').replaceAll('%7D', '}');
}
```

保留 MapLibre 瓦片模板中的 `{z}`、`{x}`、`{y}` 占位符，不使用 URL 编码后的形式。

- [x] **Step 4: 实现 hook**

`useWeatherRadar(enabled, dependencies?)` 返回：

```ts
type WeatherRadarState = {
  status: WeatherRadarStatus | null;
  radar: WeatherRadarAvailableStatus | null;
  tileTemplate: string | null;
  loading: boolean;
  error: string | null;
  retry(): void;
};
```

`enabled=false` 时取消请求并清空错误；`enabled=true` 时创建 `AbortController` 请求一次。`available=false` 映射为「天气雷达暂时不可用」。组件卸载或关闭图层时必须中止请求。

- [x] **Step 5: 扩展受控图层状态**

修改 `MapLayers`：

```ts
export type MapLayers = {
  baseMap: boolean;
  weatherRadar: boolean;
  flights: boolean;
  airports: boolean;
  tracks: boolean;
  labels: boolean;
};
```

`defaultMapLayers.weatherRadar` 固定为 `false`。更新筛选测试，确认重置后天气雷达关闭。

- [x] **Step 6: 在 AppShell 编排启停和错误回退**

调用：

```ts
const weatherRadar = useWeatherRadar(mapLayers.weatherRadar);
```

当请求失败或返回 `available=false` 时，将 `mapLayers.weatherRadar` 恢复为 `false`，并把 `mapMessage` 设置为「天气雷达暂时不可用，航班数据不受影响。」。传给 `FlightMap`：

```tsx
weatherRadar={mapLayers.weatherRadar ? weatherRadar.radar : null}
weatherRadarTileTemplate={weatherRadar.tileTemplate}
```

传给 `LayerFilterPanel`：

```tsx
weatherRadarLoading={weatherRadar.loading}
```

- [x] **Step 7: 运行前端状态测试**

Run: `pnpm exec vitest run apps/web/src/lib/use-weather-radar.test.tsx apps/web/src/components/app-shell.test.tsx apps/web/src/lib/flight-filters.test.ts && pnpm --filter @hangban/web typecheck`

Expected: PASS。

- [x] **Step 8: 提交前端状态**

```bash
git add apps/web/src/lib/api-client.ts apps/web/src/lib/use-weather-radar.ts apps/web/src/lib/use-weather-radar.test.tsx apps/web/src/lib/map-settings.ts apps/web/src/lib/flight-filters.test.ts apps/web/src/components/app-shell.tsx apps/web/src/components/app-shell.test.tsx apps/web/src/components/flight-map.tsx apps/web/src/components/layer-filter-panel.tsx
git commit -m "feat: manage weather radar state"
```

---

### Task 7: 渲染 MapLibre 雷达层和紧凑图例

**Files:**

- Create: `apps/web/src/lib/weather-radar-layer.ts`
- Create: `apps/web/src/lib/weather-radar-layer.test.ts`
- Create: `apps/web/src/components/weather-radar-legend.tsx`
- Create: `apps/web/src/components/weather-radar-legend.test.tsx`
- Modify: `apps/web/src/components/app-shell.tsx`
- Modify: `apps/web/src/components/flight-map.tsx`
- Create: `apps/web/src/components/flight-map.test.tsx`
- Modify: `apps/web/src/components/layer-filter-panel.tsx`
- Modify: `apps/web/src/components/app-shell.test.tsx`
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**

- Consumes: `WeatherRadarAvailableStatus`、绝对 `tileTemplate`、`MapLayers.weatherRadar`。
- Produces: MapLibre source `weather-radar`、layer `weather-radar-raster`、`WeatherRadarLegend`。

- [x] **Step 1: 写 MapLibre 同步失败测试**

创建 `apps/web/src/lib/weather-radar-layer.test.ts`，使用最小 fake map 验证：

```ts
it('adds radar below routes and lowers opacity for historical cache', () => {
  const map = fakeMap();
  syncWeatherRadarLayer(map, historicalRadar(), absoluteTileTemplate());
  expect(map.addSource).toHaveBeenCalledWith('weather-radar', {
    type: 'raster',
    tiles: [absoluteTileTemplate()],
    tileSize: 512,
    maxzoom: 7,
  });
  expect(map.addLayer).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'weather-radar-raster',
      type: 'raster',
      paint: { 'raster-opacity': 0.35, 'raster-fade-duration': 0 },
    }),
    'planned-route',
  );
});
```

- [x] **Step 2: 运行图层测试并确认失败**

Run: `pnpm exec vitest run apps/web/src/lib/weather-radar-layer.test.ts`

Expected: FAIL，提示找不到图层模块。

- [x] **Step 3: 实现 MapLibre 图层同步**

导出：

```ts
export function syncWeatherRadarLayer(
  map: MapLibreMap,
  radar: WeatherRadarAvailableStatus | null,
  tileTemplate: string | null,
): void;
```

规则：

```text
radar 或 tileTemplate 为 null：删除 weather-radar-raster，再删除 weather-radar source
source 不存在：添加 raster source，tileSize=512，maxzoom=7
layer 不存在：优先在 planned-route 之前添加 raster layer；没有航迹锚点时回退到 airport-points 之前
latest/delayed opacity=0.55
historical-cache opacity=0.35
frame 或模板变化：删除旧 layer/source 后按新模板重建
```

不要删除或重建整个地图实例。

- [x] **Step 4: 写图例失败测试**

创建 `apps/web/src/components/weather-radar-legend.test.tsx`：

```tsx
it('marks historical cache as non-current weather and exposes attribution', () => {
  render(<WeatherRadarLegend radar={historicalRadar()} playbackActive={false} />);
  expect(screen.getByText(/非当前天气/)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Weather radar by RainViewer' })).toHaveAttribute(
    'href',
    'https://www.rainviewer.com/',
  );
});
```

- [x] **Step 5: 实现紧凑图例**

`WeatherRadarLegend` 接受：

```ts
type Props = {
  radar: WeatherRadarAvailableStatus;
  playbackActive: boolean;
};
```

使用 `Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' })` 显示帧时间。文案固定为：

```text
latest：最新 · HH:mm
delayed：数据延迟 · HH:mm
historical-cache：非当前天气 · X 小时前
```

图例包含五段连续色标、弱/中/强标签和 `target="_blank" rel="noreferrer"` 的 RainViewer 链接。

- [x] **Step 6: 接入 FlightMap**

给 `FlightMap` 增加 props：

```ts
weatherRadar: WeatherRadarAvailableStatus | null;
weatherRadarTileTemplate: string | null;
```

地图 `load` 完成且机场图层已经创建后调用 `syncWeatherRadarLayer()`；props 更新时再次调用。组件 JSX 在地图容器后渲染：

```tsx
{
  weatherRadar === null ? null : (
    <WeatherRadarLegend radar={weatherRadar} playbackActive={playbackMinutes > 0} />
  );
}
```

如果 `FlightMap` 不应知道 `playbackMinutes`，则由 `AppShell` 在 `FlightMap` 同级渲染图例，并将 `playbackMinutes > 0` 传给图例；保持 `FlightMap` 只负责 MapLibre。

- [x] **Step 7: 启用图层面板开关**

把天气雷达加入 `layerOptions`：

```ts
{ key: 'weatherRadar', label: '天气雷达' }
```

删除原有禁用项。`weatherRadarLoading=true` 时对应开关禁用并显示「天气雷达加载中」可访问名称；其他图层开关不受影响。

- [x] **Step 8: 同步已确认样式**

在 `globals.css` 增加 `.weather-radar-legend`、`.weather-radar-scale` 和 `.weather-radar-attribution`。要求：

```text
桌面宽度约 240 px，左下角定位
手机端不超过可用宽度，触控区域不小于 44 px
playbackActive 时通过修饰类上移
背景使用现有白色半透明面板、蓝灰描边和阴影变量
历史缓存文案具有高于普通辅助文本的对比度
```

- [x] **Step 9: 运行组件、图层和类型测试**

Run: `pnpm exec vitest run apps/web/src/lib/weather-radar-layer.test.ts apps/web/src/components/weather-radar-legend.test.tsx apps/web/src/components/app-shell.test.tsx && pnpm --filter @hangban/web typecheck`

Expected: PASS。

- [x] **Step 10: 提交地图和图例**

```bash
git add apps/web/src/lib/weather-radar-layer.ts apps/web/src/lib/weather-radar-layer.test.ts apps/web/src/components/weather-radar-legend.tsx apps/web/src/components/weather-radar-legend.test.tsx apps/web/src/components/flight-map.tsx apps/web/src/components/layer-filter-panel.tsx apps/web/src/components/app-shell.test.tsx apps/web/src/app/globals.css
git commit -m "feat: render weather radar overlay"
```

---

### Task 8: 增加 E2E、冒烟入口和交付文档

**Files:**

- Create: `tests/e2e/weather-radar.spec.ts`
- Create: `apps/api/src/smoke-weather-radar.ts`
- Modify: `apps/api/package.json`
- Modify: `package.json`
- Modify: `docs/AGENTS.md`
- Modify: `docs/product-design.md`
- Modify: `docs/architecture.md`
- Modify: `docs/superpowers/plans/2026-07-13-weather-radar-overlay.md`

**Interfaces:**

- Consumes: 天气雷达 HTTP 接口和已确认 UI。
- Produces: 桌面端/手机端回归覆盖、显式公网冒烟命令和实施状态记录。

- [x] **Step 1: 写 E2E 测试**

创建 `tests/e2e/weather-radar.spec.ts`。在导航前使用 `page.route('**/api/v1/weather/radar', ...)` 返回固定状态，并对同源瓦片路由返回最小 PNG fixture。测试：

```ts
test('weather radar is opt-in and keeps attribution visible', async ({ page }, testInfo) => {
  await mockAvailableRadar(page, { freshness: 'latest' });
  await page.goto('/');
  await expect(page.getByText('Weather radar by RainViewer')).toHaveCount(0);
  await page.getByRole('button', { name: '打开图层与筛选' }).click();
  await page.getByRole('checkbox', { name: '天气雷达' }).check();
  await expect(page.getByText(/最新/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Weather radar by RainViewer' })).toBeVisible();
  if (testInfo.project.name === 'mobile') {
    const legend = page.getByRole('region', { name: '天气雷达图例' });
    await expect
      .poll(async () => (await legend.boundingBox())?.width ?? 999)
      .toBeLessThanOrEqual(358);
  }
});
```

第二个测试返回 `available: false`，断言开关恢复关闭、提示包含「航班数据不受影响」，且地图和航班搜索仍可操作。第三个测试返回 `historical-cache`，断言显示「非当前天气」。

- [x] **Step 2: 运行 E2E 并确认失败或缺少实现**

Run: `pnpm e2e -- tests/e2e/weather-radar.spec.ts`

Expected: 首次运行在实施未完整时 FAIL；完成 Task 2–7 后 PASS。

- [x] **Step 3: 实现显式公网冒烟入口**

`apps/api/src/smoke-weather-radar.ts`：

```ts
import { createRainViewerProvider } from '@hangban/adapters';

const provider = createRainViewerProvider({
  baseUrl: process.env.RAINVIEWER_BASE_URL ?? 'https://api.rainviewer.com',
  timeoutMs: 8_000,
  maxTileBytes: 1_048_576,
});
const frame = await provider.fetchLatestFrame();
const tile = await provider.fetchTile(frame, 2, 2, 1);
process.stdout.write(
  JSON.stringify({
    providerId: frame.providerId,
    frameTime: frame.frameTime,
    tileBytes: tile.bytes.byteLength,
  }) + '\n',
);
```

在 `apps/api/package.json` 增加：

```json
"smoke:weather-radar": "tsx src/smoke-weather-radar.ts"
```

根 `package.json` 增加：

```json
"smoke:weather-radar": "pnpm --filter @hangban/api smoke:weather-radar"
```

该命令不加入 `scripts/verify`。

- [x] **Step 4: 更新状态文档**

实施并完成视觉检查后：

```text
docs/AGENTS.md：天气雷达状态改为「已实现并完成桌面端与手机端视觉核对」
docs/product-design.md：当前实现表增加天气雷达图层、图例和 24 小时历史缓存语义
docs/architecture.md：把天气雷达从「已确认设计」改为「当前实现」，记录有界缓存和代理限制
本计划：逐项勾选实际完成步骤；未执行的公网冒烟必须保持未勾选并说明原因
```

- [x] **Step 5: 运行聚焦验证**

Run: `pnpm exec vitest run packages/contracts/src/weather-radar.test.ts packages/adapters/src/rainviewer.test.ts apps/api/src/weather-radar-cache.test.ts apps/api/src/weather-radar-service.test.ts apps/api/src/routes/weather-radar.test.ts apps/web/src/lib/use-weather-radar.test.tsx apps/web/src/lib/weather-radar-layer.test.ts apps/web/src/components/weather-radar-legend.test.tsx apps/web/src/components/app-shell.test.tsx`

Expected: PASS。

Run: `pnpm e2e -- tests/e2e/weather-radar.spec.ts`

Expected: desktop 与 mobile 项目全部 PASS。

- [x] **Step 6: 运行完整验证**

Run: `pnpm verify`

Expected: lint、typecheck、unit/component、真实中间件集成和 E2E 全部 PASS。

Run: `pnpm format:check`

Expected: `All matched files use Prettier code style!`

公网可用并且明确执行真实来源验证时，再运行：

Run: `pnpm smoke:weather-radar`

Expected: 输出不含凭据的 JSON，包含 `providerId: "rainviewer"`、ISO `frameTime` 和正数 `tileBytes`。

- [ ] 公网 RainViewer 冒烟未执行：该命令不属于默认离线门禁，本次未确认公网来源稳定性。

- [x] **Step 7: 完成视觉核对**

在 1440 × 900 和 390 × 844 原生视口核对：

```text
默认关闭
雷达层位于航班下方
紧凑图例不遮挡地图控件
航迹回看出现时图例上移
历史缓存明确显示「非当前天气」
雷达错误不影响航班操作
```

截图保存到 `.ardot-qa/weather-radar/implementation-desktop.png` 和 `.ardot-qa/weather-radar/implementation-mobile.png`。

- [x] **Step 8: 提交 E2E 和交付记录**

```bash
git add tests/e2e/weather-radar.spec.ts apps/api/src/smoke-weather-radar.ts apps/api/package.json package.json docs/AGENTS.md docs/product-design.md docs/architecture.md docs/superpowers/plans/2026-07-13-weather-radar-overlay.md
git commit -m "test: verify weather radar overlay"
```

#### 最终审查跟进：约束瓦片 CDN 缓存寿命

- [x] 先增加 cache、service 和 route 失败测试，确认动态缓存寿命接口缺失。
- [x] 实现帧缓存剩余 TTL 查询，并让 service 返回受 300 秒、缓存 TTL 和帧 24 小时寿命共同约束的 `cacheMaxAgeSeconds`。
- [x] route 使用 `public, max-age=<dynamic>, must-revalidate`，错误响应不设置成功缓存头。
- [x] 重新运行聚焦测试、天气雷达 E2E、完整门禁与格式检查。
- [x] 提交最终审查修复。
