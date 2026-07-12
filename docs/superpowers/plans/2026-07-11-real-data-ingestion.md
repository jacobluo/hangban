# 真实航班与机场数据接入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `DATA_MODE=live` 使用可配置的 ADSB.lol、Airplanes.live、OpenSky 和 OurAirports 真实数据，并在来源失败时保留最后成功状态而不混入演示航班。

**Architecture:** 新增 `packages/ingestion` 作为采集计划、限速、周期执行和状态转换的共享模块。适配器继续只负责供应商请求与字段转换；API 在内存部署下内嵌采集协调器，独立 ingestor 复用相同模块并为后续 Redis 部署保留边界。

**Tech Stack:** pnpm workspace、TypeScript、Zod、Fastify、WebSocket、Vitest、csv-parse、Node.js Fetch API。

---

## 文件结构

```text
packages/contracts/src/realtime.ts             扩展数据源状态契约
packages/config/src/index.ts                    解析真实来源、OAuth 和机场路径配置
packages/adapters/src/readsb.ts                 ADSB.lol 与 Airplanes.live 公共响应转换
packages/adapters/src/adsb-lol.ts               ADSB.lol 点查询适配器
packages/adapters/src/airplanes-live.ts          Airplanes.live 点查询适配器
packages/adapters/src/opensky-token.ts           OpenSky OAuth Token 缓存
packages/adapters/src/opensky.ts                 OpenSky 匿名与 Bearer 请求
packages/adapters/src/provider-factory.ts        按配置创建真实来源
packages/adapters/src/ourairports.ts             OurAirports CSV 转换
packages/ingestion/src/scope-planner.ts          视野拆分、网格归并和采集单元
packages/ingestion/src/provider-scheduler.ts     每来源缓存、限速和退避
packages/ingestion/src/run-cycle.ts              多来源采集、融合和状态转换
apps/api/src/live-ingestion.ts                   API 内嵌采集生命周期
apps/api/src/airport-data.ts                     已同步机场文件加载
apps/api/src/realtime/hub.ts                     暴露活跃订阅范围
apps/ingestor/src/index.ts                       单次和持续采集入口
apps/ingestor/src/smoke-live.ts                  显式公网冒烟命令
apps/ingestor/src/sync-airports.ts               OurAirports 原子同步命令
data/.gitkeep                                    机场数据输出目录
.env.example                                     无凭证配置样例
```

当前目录不是 Git 仓库，因此计划不包含提交步骤。每个任务完成后更新 checkbox，并运行对应聚焦测试。

### Task 1：扩展来源状态和运行配置

**Files:**

- Modify: `packages/contracts/src/realtime.ts`
- Modify: `packages/contracts/src/contracts.test.ts`
- Modify: `packages/config/src/index.ts`
- Modify: `packages/config/src/config.test.ts`
- Create: `.env.example`

- [x] **Step 1：先写来源状态契约失败测试**

```ts
expect(
  sourceStatusSchema.parse({
    providerId: 'opensky',
    state: 'degraded',
    lastAttemptAt: '2026-07-11T08:00:10.000Z',
    lastSuccessAt: '2026-07-11T08:00:00.000Z',
    lastRecordCount: 120,
    errorCode: 'RATE_LIMITED',
    message: '请求频率受限',
  }),
).toMatchObject({ errorCode: 'RATE_LIMITED', lastRecordCount: 120 });
```

- [x] **Step 2：运行契约测试并确认失败**

Run: `pnpm vitest run packages/contracts/src/contracts.test.ts`

Expected: FAIL，`lastAttemptAt`、`lastRecordCount` 和 `errorCode` 尚未进入 schema。

- [x] **Step 3：扩展稳定状态字段**

```ts
const providerErrorCodeSchema = z.enum([
  'RATE_LIMITED',
  'AUTH_FAILED',
  'TIMEOUT',
  'INVALID_RESPONSE',
  'UPSTREAM_ERROR',
]);

export const sourceStatusSchema = z.object({
  providerId: z.string().min(1),
  state: z.enum(['healthy', 'degraded', 'down']),
  lastAttemptAt: z.iso.datetime({ offset: true }).optional(),
  lastSuccessAt: z.iso.datetime({ offset: true }).nullable(),
  lastRecordCount: z.number().int().nonnegative().optional(),
  errorCode: providerErrorCodeSchema.optional(),
  message: z.string().optional(),
});
```

- [x] **Step 4：先写两种模式和凭证配对失败测试**

```ts
expect(loadConfig({ DATA_MODE: 'demo' }).dataMode).toBe('demo');
expect(
  loadConfig({ DATA_MODE: 'live', LIVE_PROVIDERS: 'adsb-lol,airplanes-live' }).liveProviders,
).toEqual(['adsb-lol', 'airplanes-live']);
expect(() =>
  loadConfig({
    DATA_MODE: 'live',
    LIVE_PROVIDERS: 'opensky',
    OPENSKY_CLIENT_ID: 'client-only',
  }),
).toThrow();
expect(() => loadConfig({ DATA_MODE: 'hybrid' })).toThrow();
```

- [x] **Step 5：运行配置测试并确认失败**

Run: `pnpm vitest run packages/config/src/config.test.ts`

Expected: FAIL，真实来源配置和 OpenSky 凭证尚未定义。

- [x] **Step 6：实现显式配置模型**

```ts
export type LiveProviderId = 'adsb-lol' | 'airplanes-live' | 'opensky';

export type RuntimeConfig = {
  dataMode: 'demo' | 'live';
  liveProviders: LiveProviderId[];
  liveDefaultBboxes: Bbox[];
  ingestIntervalMs: number;
  providerTimeoutMs: number;
  providerCacheTtlMs: number;
  adsbLolBaseUrl: string;
  airplanesLiveBaseUrl: string;
  openSkyBaseUrl: string;
  openSkyTokenUrl: string;
  openSkyClientId?: string;
  openSkyClientSecret?: string;
  airportsDataPath: string;
  ourAirportsCsvUrl: string;
};
```

`LIVE_DEFAULT_BBOXES` 使用分号分隔的 `west,south,east,north`。`live` 模式默认启用 `adsb-lol`，且最终来源列表不得为空。Airplanes.live 的默认缓存 TTL 不小于 180 秒。

- [x] **Step 7：增加安全配置样例**

```dotenv
DATA_MODE=demo
LIVE_PROVIDERS=adsb-lol
LIVE_DEFAULT_BBOXES=100,20,130,50
INGEST_INTERVAL_MS=10000
PROVIDER_TIMEOUT_MS=8000
PROVIDER_CACHE_TTL_MS=30000
ADSB_LOL_BASE_URL=https://api.adsb.lol/v2
AIRPLANES_LIVE_BASE_URL=https://api.airplanes.live/v2
OPENSKY_BASE_URL=https://opensky-network.org/api
OPENSKY_TOKEN_URL=https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token
OPENSKY_CLIENT_ID=
OPENSKY_CLIENT_SECRET=
AIRPORTS_DATA_PATH=data/airports.json
OURAIRPORTS_CSV_URL=https://davidmegginson.github.io/ourairports-data/airports.csv
```

- [x] **Step 8：运行契约和配置测试**

Run: `pnpm vitest run packages/contracts/src/contracts.test.ts packages/config/src/config.test.ts`

Expected: PASS。

### Task 2：修正 ADSB.lol 与 Airplanes.live 契约

**Files:**

- Create: `packages/adapters/src/readsb.ts`
- Create: `packages/adapters/src/readsb.test.ts`
- Modify: `packages/adapters/src/adsb-lol.ts`
- Modify: `packages/adapters/src/airplanes-live.ts`
- Modify: `packages/adapters/src/adapters.test.ts`
- Modify: `packages/adapters/src/provider.ts`
- Modify: `packages/domain/src/normalize.ts`

- [x] **Step 1：写毫秒时间戳和地面高度失败测试**

```ts
const snapshot = parseReadsbSnapshot('airplanes-live', {
  now: 1_783_756_800_000,
  ac: [
    {
      hex: '780001',
      flight: 'CA981 ',
      lat: 40,
      lon: 116,
      alt_baro: 'ground',
      gs: 500,
      track: 68,
      r: 'B-2482',
      t: 'B748',
    },
  ],
});
expect(snapshot.observedAt).toBe('2026-07-11T08:00:00.000Z');
expect(snapshot.flights[0]).toMatchObject({
  altitudeM: 0,
  registration: 'B-2482',
  aircraftType: 'B748',
});
```

- [x] **Step 2：运行测试并确认旧解析器失败**

Run: `pnpm vitest run packages/adapters/src/readsb.test.ts`

Expected: FAIL，`parseReadsbSnapshot` 尚不存在。

- [x] **Step 3：实现共享 readsb 响应转换**

```ts
export function normalizeEpoch(value: number): string {
  const milliseconds = value > 10_000_000_000 ? value : value * 1_000;
  return new Date(milliseconds).toISOString();
}

export function parseReadsbSnapshot(providerId: string, raw: unknown): ProviderSnapshot {
  // 使用 Zod 校验 now、ac 和单架航空器字段。
  // 丢弃缺少有效 hex、呼号或坐标的记录。
  // 将 "ground" 转为 0 m，其他未知高度转为 null。
}
```

同时把 `registration` 和 `aircraftType` 加入 `ProviderFlight`，并由 `normalizeProviderFlight` 映射到统一 `Flight`。

`ProviderErrorCode` 增加 `AUTH_FAILED`；`ProviderError` 增加可选 `retryAfterMs`，供调度器处理 HTTP 429。

- [x] **Step 4：写供应商 URL 失败测试**

```ts
expect(requestedUrl).toBe('https://api.adsb.lol/v2/lat/40/lon/116/dist/250');
expect(airplanesRequestedUrl).toBe('https://api.airplanes.live/v2/point/40/116/250');
```

- [x] **Step 5：实现独立端点构造并复用解析器**

ADSB.lol 使用 `/lat/.../lon/.../dist/...`，Airplanes.live 使用 `/point/.../.../...`。两者都从小范围 `GeoScope` 计算中心点和向上取整后的半径，半径限制为 `1..250` 海里。

- [x] **Step 6：运行适配器测试**

Run: `pnpm vitest run packages/adapters/src/readsb.test.ts packages/adapters/src/adapters.test.ts packages/domain/src/domain.test.ts`

Expected: PASS。

### Task 3：实现 OpenSky OAuth 2.0 与匿名请求

**Files:**

- Create: `packages/adapters/src/opensky-token.ts`
- Create: `packages/adapters/src/opensky-token.test.ts`
- Modify: `packages/adapters/src/opensky.ts`
- Modify: `packages/adapters/src/http-provider.ts`
- Modify: `packages/adapters/src/adapters.test.ts`

- [x] **Step 1：写 Token 缓存失败测试**

```ts
const manager = createOpenSkyTokenManager({
  clientId: 'client',
  clientSecret: 'secret',
  fetchImpl,
  now: () => new Date('2026-07-11T08:00:00.000Z'),
});
expect(await manager.getToken()).toBe('token-a');
expect(await manager.getToken()).toBe('token-a');
expect(fetchImpl).toHaveBeenCalledTimes(1);
```

响应 fixture：

```json
{ "access_token": "token-a", "expires_in": 1800, "token_type": "Bearer" }
```

- [x] **Step 2：运行 Token 测试并确认失败**

Run: `pnpm vitest run packages/adapters/src/opensky-token.test.ts`

Expected: FAIL，Token manager 尚不存在。

- [x] **Step 3：实现 Token 获取、缓存和提前刷新**

```ts
export type OpenSkyTokenManager = {
  getToken(): Promise<string>;
  invalidate(): void;
};
```

使用 `URLSearchParams` 发送 `grant_type=client_credentials`，缓存到 `expires_in - 60` 秒。Token 响应和请求头不进入错误信息。

- [x] **Step 4：写匿名、Bearer 和 401 重试测试**

```ts
expect(anonymousRequest.headers.get('authorization')).toBeNull();
expect(authenticatedRequest.headers.get('authorization')).toBe('Bearer token-a');
expect(requestsAfter401.map((request) => request.headers.get('authorization'))).toEqual([
  'Bearer token-a',
  'Bearer token-b',
]);
```

- [x] **Step 5：扩展 HTTP 请求选项并实现 OpenSky 重试**

```ts
type FetchJsonOptions = {
  fetchImpl: typeof fetch;
  url: string;
  timeoutMs?: number;
  headers?: HeadersInit;
  retryUnauthorized?: () => Promise<HeadersInit>;
};
```

`fetchJson` 将 401 映射为 `AUTH_FAILED`；只在提供 `retryUnauthorized` 时重新请求一次。OpenSky 未配置凭证时不发送 Authorization。

- [x] **Step 6：运行 OpenSky 聚焦测试**

Run: `pnpm vitest run packages/adapters/src/opensky-token.test.ts packages/adapters/src/adapters.test.ts`

Expected: PASS。

### Task 4：建立共享采集模块和视野计划

**Files:**

- Create: `packages/ingestion/package.json`
- Create: `packages/ingestion/tsconfig.json`
- Create: `packages/ingestion/src/index.ts`
- Create: `packages/ingestion/src/scope-planner.ts`
- Create: `packages/ingestion/src/scope-planner.test.ts`
- Create: `packages/ingestion/src/provider-scheduler.ts`
- Create: `packages/ingestion/src/provider-scheduler.test.ts`

- [x] **Step 1：写空间计划失败测试**

```ts
expect(
  planScopes([
    [100, 20, 130, 50],
    [101, 21, 129, 49],
  ]),
).toEqual(
  expect.arrayContaining([expect.objectContaining({ cacheKey: expect.stringMatching(/^cell:/) })]),
);
expect(planScopes([[170, 20, -170, 40]]).every((scope) => scope.bbox[0] <= scope.bbox[2])).toBe(
  true,
);
expect(planScopes([[100, 20, 130, 50]]).every((scope) => scope.radiusNm <= 250)).toBe(true);
```

- [x] **Step 2：运行测试并确认模块不存在**

Run: `pnpm vitest run packages/ingestion/src/scope-planner.test.ts`

Expected: FAIL，`@hangban/ingestion` 尚未建立。

- [x] **Step 3：实现日期变更线拆分、网格归并和采集单元**

先建立 workspace 包：

```json
{
  "name": "@hangban/ingestion",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "tsc --noEmit"
  },
  "dependencies": {
    "@hangban/adapters": "workspace:*",
    "@hangban/contracts": "workspace:*",
    "@hangban/domain": "workspace:*"
  }
}
```

再实现采集单元：

```ts
export type CollectionScope = {
  bbox: Bbox;
  latitude: number;
  longitude: number;
  radiusNm: number;
  cacheKey: string;
};

export function planScopes(bboxes: Bbox[]): CollectionScope[];
```

对重复网格使用 `Map<string, CollectionScope>` 去重。每个单元能被 250 海里圆覆盖；超大视野拆成多个单元，并设置每周期最大单元数，优先保留最近活跃视野。

- [x] **Step 4：写缓存、限速和 Retry-After 失败测试**

```ts
expect(await scheduler.fetch(provider, scope)).toEqual(firstSnapshot);
expect(await scheduler.fetch(provider, scope)).toEqual(firstSnapshot);
expect(provider.fetchSnapshot).toHaveBeenCalledTimes(1);

await expect(scheduler.fetch(rateLimitedProvider, scope)).rejects.toMatchObject({
  code: 'RATE_LIMITED',
});
expect(scheduler.nextAllowedAt('airplanes-live')).toBe(Date.parse('2026-07-11T08:03:00.000Z'));
```

- [x] **Step 5：实现每来源调度状态**

```ts
export type ProviderPolicy = {
  minIntervalMs: number;
  cacheTtlMs: number;
  maxBackoffMs: number;
};

export function createProviderScheduler(options: {
  policies: Record<string, ProviderPolicy>;
  now?: () => Date;
}): ProviderScheduler;
```

调度器缓存以 `providerId + cacheKey` 为键。429 优先使用 `retryAfterMs`，其他错误指数退避；一个来源的状态不阻塞其他来源。Airplanes.live 的 `minIntervalMs` 和 `cacheTtlMs` 均取配置值与 180,000 ms 的较大值，确保多个视野也不会提高供应商总请求频率。

- [x] **Step 6：运行空间和调度测试**

Run: `pnpm vitest run packages/ingestion/src/scope-planner.test.ts packages/ingestion/src/provider-scheduler.test.ts`

Expected: PASS。

### Task 5：实现 Provider factory 和周期状态机

**Files:**

- Create: `packages/adapters/src/provider-factory.ts`
- Create: `packages/adapters/src/provider-factory.test.ts`
- Create: `packages/ingestion/src/run-cycle.ts`
- Create: `packages/ingestion/src/run-cycle.test.ts`
- Delete: `apps/ingestor/src/run-cycle.ts`
- Delete: `apps/ingestor/src/run-cycle.test.ts`
- Modify: `packages/adapters/src/index.ts`
- Modify: `packages/ingestion/src/index.ts`

- [x] **Step 1：写 Provider factory 失败测试**

```ts
const providers = createLiveProviders({
  liveProviders: ['adsb-lol', 'opensky'],
  adsbLolBaseUrl: 'https://adsb.test/v2',
  openSkyBaseUrl: 'https://opensky.test/api',
  openSkyTokenUrl: 'https://auth.test/token',
  providerTimeoutMs: 5_000,
});
expect(providers.map((provider) => provider.providerId)).toEqual(['adsb-lol', 'opensky']);
```

- [x] **Step 2：运行 factory 测试并确认失败**

Run: `pnpm vitest run packages/adapters/src/provider-factory.test.ts`

Expected: FAIL，factory 尚不存在。

- [x] **Step 3：实现严格来源选择**

factory 只创建 `liveProviders` 中列出的来源，不隐式增加 demo。OpenSky 凭证存在时创建共享 Token manager，否则创建匿名适配器。

- [x] **Step 4：写全部失败保留旧数据的周期测试**

```ts
const result = await runCycle({
  providers: [failingProvider],
  scopes: [scope],
  previousFlights: [lastSuccessfulFlight],
  previousStatuses: [healthyStatus],
  scheduler,
  now: () => now,
});
expect(result.flights).toEqual([
  expect.objectContaining({ id: lastSuccessfulFlight.id, freshness: 'stale' }),
]);
expect(result.statuses[0]).toMatchObject({
  providerId: 'failed',
  state: 'down',
  lastSuccessAt: healthyStatus.lastSuccessAt,
});
```

- [x] **Step 5：写部分成功和恢复测试**

```ts
expect(partialResult.flights).toHaveLength(1);
expect(partialResult.statuses).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ providerId: 'healthy', state: 'healthy' }),
    expect.objectContaining({ providerId: 'failed', state: 'degraded' }),
  ]),
);
expect(recoveredResult.statuses[0]).toMatchObject({
  state: 'healthy',
  errorCode: undefined,
});
```

- [x] **Step 6：实现共享 `runCycle`**

```ts
export type RunCycleOptions = {
  providers: FlightPositionProvider[];
  scopes: CollectionScope[];
  previousFlights: Flight[];
  previousStatuses: SourceStatus[];
  scheduler: ProviderScheduler;
  now?: () => Date;
};

export async function runCycle(options: RunCycleOptions): Promise<{
  flights: Flight[];
  statuses: SourceStatus[];
  observedAt: string;
  successfulProviders: number;
}>;
```

每个来源和采集单元使用 `Promise.allSettled`。至少一个来源成功时融合成功候选；全部来源失败时重新计算旧航班新鲜度，但不以空集合覆盖。

- [x] **Step 7：运行 factory 和周期测试**

Run: `pnpm vitest run packages/adapters/src/provider-factory.test.ts packages/ingestion/src/run-cycle.test.ts`

Expected: PASS。

### Task 6：接入 API 内嵌采集和实时订阅范围

**Files:**

- Modify: `apps/api/package.json`
- Modify: `apps/api/src/realtime/hub.ts`
- Modify: `apps/api/src/realtime/hub.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/index.ts`
- Create: `apps/api/src/live-ingestion.ts`
- Create: `apps/api/src/live-ingestion.test.ts`

- [x] **Step 1：写活跃视野失败测试**

```ts
hub.subscribe('a', [100, 20, 130, 50]);
hub.subscribe('b', [101, 21, 129, 49]);
expect(hub.activeBboxes()).toEqual([
  [100, 20, 130, 50],
  [101, 21, 129, 49],
]);
hub.unsubscribe('a');
expect(hub.activeBboxes()).toHaveLength(1);
```

- [x] **Step 2：实现只读活跃订阅快照**

`activeBboxes()` 返回复制后的数组，调用方不能修改 Hub 内部订阅。

- [x] **Step 3：写 API 采集生命周期失败测试**

```ts
const controller = startLiveIngestion({
  repository,
  hub,
  providers: [provider],
  scheduler,
  defaultBboxes: [[100, 20, 130, 50]],
  intervalMs: 10_000,
  timers: fakeTimers,
});
await controller.runNow();
expect(repository.allFlights()).toEqual([
  expect.objectContaining({ callsign: 'CA981', sources: ['adsb-lol'] }),
]);
expect(repository.sourceStatuses()[0]).toMatchObject({ state: 'healthy' });
controller.stop();
```

- [x] **Step 4：实现内嵌采集控制器**

```ts
export type LiveIngestionController = {
  runNow(): Promise<void>;
  stop(): void;
};
```

每轮读取 `hub.activeBboxes()`；没有活跃视野时使用 `defaultBboxes`。同一轮未完成时跳过下一次触发，避免并发周期。成功后同时替换航班和状态；WebSocket 现有 10 秒指纹机制负责发送增量。

- [x] **Step 5：按模式改造 API 启动**

`demo` 保持现有种子和运动定时器。`live` 使用空航班集合、已加载机场、初始来源状态和真实 provider factory，并在 Fastify `onClose` 中停止采集控制器。

- [x] **Step 6：运行 API 聚焦测试**

Run: `pnpm vitest run apps/api/src/realtime/hub.test.ts apps/api/src/live-ingestion.test.ts apps/api/src/api.test.ts`

Expected: PASS。

### Task 7：同步并加载 OurAirports

**Files:**

- Modify: `packages/adapters/package.json`
- Create: `packages/adapters/src/ourairports.ts`
- Create: `packages/adapters/src/ourairports.test.ts`
- Create: `apps/ingestor/src/sync-airports.ts`
- Create: `apps/ingestor/src/sync-airports.test.ts`
- Create: `apps/api/src/airport-data.ts`
- Create: `apps/api/src/airport-data.test.ts`
- Modify: `.gitignore`
- Create: `data/.gitkeep`

- [x] **Step 1：安装流式 CSV 解析依赖**

Run: `pnpm --filter @hangban/adapters add csv-parse`

Expected: `packages/adapters/package.json` 和根 `pnpm-lock.yaml` 更新，不产生 npm 或 Yarn 锁文件。

- [x] **Step 2：写 CSV 映射失败测试**

```ts
const [airport] = parseOurAirportsCsv(
  [
    'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,iso_country,municipality,scheduled_service,gps_code,icao_code,iata_code',
    '1,ZBAA,large_airport,Beijing Capital International Airport,40.0799,116.6031,116,CN,Beijing,yes,ZBAA,ZBAA,PEK',
  ].join('\n'),
);
expect(airport).toEqual({
  iata: 'PEK',
  icao: 'ZBAA',
  name: 'Beijing Capital International Airport',
  city: 'Beijing',
  country: 'CN',
  latitude: 40.0799,
  longitude: 116.6031,
  elevationM: 35,
  type: 'large_airport',
});
```

- [x] **Step 3：写无效和关闭机场过滤测试**

```ts
expect(parseOurAirportsCsv(csvWithClosedAndInvalidRows)).toEqual([]);
```

- [x] **Step 4：实现 CSV 解析和 Airport schema 校验**

使用 `csv-parse/sync` 按列名读取。`elevation_ft` 为空时写入 `null`；城市为空时使用机场名称；ICAO 优先使用 `icao_code`，其次使用 4 位 `gps_code`。

- [x] **Step 5：写同步失败保留旧文件测试**

```ts
await writeFile(target, JSON.stringify([oldAirport]));
await expect(syncOurAirports({ target, fetchImpl: failingFetch })).rejects.toThrow();
expect(JSON.parse(await readFile(target, 'utf8'))).toEqual([oldAirport]);
```

- [x] **Step 6：实现临时文件校验和原子替换**

`syncOurAirports` 下载 CSV，解析后要求结果数量达到 1,000 条，再写入同目录临时文件。完成 `airportSchema.array().parse` 后调用 `rename` 替换目标文件，并在 `finally` 清理临时文件。

- [x] **Step 7：实现 API 机场文件加载**

```ts
export async function loadAirportData(path: string): Promise<Airport[]> {
  const raw = JSON.parse(await readFile(path, 'utf8'));
  return airportSchema.array().parse(raw);
}
```

`demo` 模式继续使用 testkit 机场；`live` 模式要求 `AIRPORTS_DATA_PATH` 存在且通过校验，失败时 API 启动失败并输出不含文件内容的错误。

- [x] **Step 8：忽略生成数据并运行测试**

`.gitignore` 增加 `data/airports.json` 和 `data/*.tmp`，保留 `data/.gitkeep`。

Run: `pnpm vitest run packages/adapters/src/ourairports.test.ts apps/ingestor/src/sync-airports.test.ts apps/api/src/airport-data.test.ts`

Expected: PASS。

### Task 8：完成 ingestor、真实冒烟命令和根脚本

**Files:**

- Modify: `apps/ingestor/package.json`
- Modify: `apps/ingestor/src/index.ts`
- Create: `apps/ingestor/src/smoke-live.ts`
- Create: `apps/ingestor/src/smoke-live.test.ts`
- Modify: `package.json`

- [x] **Step 1：写单次采集摘要失败测试**

```ts
const summary = await runIngestorOnce({
  providers: [provider],
  scopes: [scope],
  scheduler,
  now: () => now,
});
expect(summary).toEqual({
  event: 'ingestion.cycle',
  observedAt: now.toISOString(),
  flights: 1,
  providers: [{ providerId: 'adsb-lol', state: 'healthy', records: 1 }],
});
```

- [x] **Step 2：实现单次和持续运行入口**

`pnpm --filter @hangban/ingestor start` 执行一次配置范围采集。`dev` 使用持续轮询；每轮输出一行 JSON 摘要，不输出供应商响应或认证头。

`apps/ingestor/package.json` 增加以下脚本和 workspace 依赖：

```json
{
  "scripts": {
    "smoke:live": "tsx src/smoke-live.ts",
    "data:airports:sync": "tsx src/sync-airports.ts"
  },
  "dependencies": {
    "@hangban/config": "workspace:*",
    "@hangban/ingestion": "workspace:*"
  }
}
```

- [x] **Step 3：写冒烟命令失败语义测试**

```ts
await expect(smokeLive({ providers: [failingProvider], scope })).rejects.toMatchObject({
  code: 'NO_LIVE_PROVIDER_SUCCEEDED',
});
```

- [x] **Step 4：实现显式公网冒烟**

冒烟只使用 `LIVE_DEFAULT_BBOXES` 的第一个计划单元；逐来源打印 provider ID、稳定状态和记录数。至少一个启用来源在本轮完成真实上游请求，且所有启用来源本轮合计记录数大于 0 时，退出码为 0；没有来源完成真实上游请求或合计记录数为 0 时，退出码为 1。

- [x] **Step 5：增加根命令**

```json
{
  "scripts": {
    "smoke:live": "pnpm --filter @hangban/ingestor smoke:live",
    "data:airports:sync": "pnpm --filter @hangban/ingestor data:airports:sync"
  }
}
```

- [x] **Step 6：运行 ingestor 测试**

Run: `pnpm vitest run apps/ingestor/src/smoke-live.test.ts packages/ingestion/src/run-cycle.test.ts`

Expected: PASS。

### Task 9：更新文档并完成离线验证

**Files:**

- Modify: `README.md`
- Modify: `docs/AGENTS.md`
- Modify: `docs/architecture.md`
- Modify: `docs/product-design.md`
- Modify: `AGENTS.md`
- Modify: this plan

- [x] **Step 1：记录两种模式和启动顺序**

README 给出可直接执行的顺序：

```bash
pnpm install
pnpm data:airports:sync
DATA_MODE=live LIVE_PROVIDERS=adsb-lol pnpm dev
pnpm smoke:live
```

说明 `live` 不自动切换到 demo，免费来源只提供局部和受限频率覆盖。

- [x] **Step 2：同步架构和产品边界**

架构文档把 `packages/ingestion`、API 内嵌采集和未来 Redis 切换写成当前实现。产品文档说明世界视野可能只展示已缓存真实数据，数据状态反映最近请求结果。

- [x] **Step 3：运行全部离线验证**

Run: `pnpm verify && pnpm format:check`

Expected: lint、类型检查、全部单元和组件测试、构建、桌面和手机 E2E、格式检查全部通过。默认验证不访问供应商公网。

### Task 10：执行真实数据运行验证

**Files:**

- Modify: this plan

- [x] **Step 1：同步真实机场数据**

Run: `pnpm data:airports:sync`

Expected: `data/airports.json` 通过 `airportSchema.array()` 校验，记录数不少于 1,000，命令不留下临时文件。

- [x] **Step 2：运行小范围真实来源冒烟**

Run: `DATA_MODE=live LIVE_PROVIDERS=adsb-lol LIVE_DEFAULT_BBOXES=100,20,130,50 pnpm smoke:live`

Expected: 至少一个来源状态为 `healthy` 或 `degraded`，返回记录数大于 0；若外部服务确实没有该范围数据，改用当前活跃机场附近的小范围重新验证，但不降低解析断言。

- [x] **Step 3：启动 live API 和 Web**

Run: `DATA_MODE=live LIVE_PROVIDERS=adsb-lol LIVE_DEFAULT_BBOXES=100,20,130,50 pnpm dev`

Expected: API 从空航班启动，采集完成后 `/api/v1/map/snapshot` 返回来源为 `adsb-lol` 的真实航班；响应中不存在来源 `demo`。

- [x] **Step 4：验证来源状态和浏览器行为**

检查 `/api/v1/data-sources/status`、地图快照和 WebSocket：

- 最近请求与最近成功时间存在。
- 航班来源不包含 `demo`。
- 停止公网访问后，最后成功航班保留且来源状态转为 `degraded` 或 `down`。
- 机场搜索使用同步后的 OurAirports 数据。

- [x] **Step 5：恢复默认演示启动并回归验证**

Run: `pnpm dev`

Expected: 未设置 `DATA_MODE` 时仍以 demo 模式启动，现有 UI、API 和 E2E 行为不变。

## 计划自检

- Spec 第 2 节的 `demo | live`、无自动切换和免费覆盖限制分别由 Task 1、6、9 和 10 验证。
- 三个航班来源分别由 Task 2、3 和 5 接入。
- 视野规划、限速、缓存和退避由 Task 4 覆盖。
- 最后成功数据和来源状态由 Task 5 和 6 覆盖。
- OurAirports 下载、转换、原子替换和 API 加载由 Task 7 覆盖。
- 默认离线 CI 与显式公网验证分别由 Task 9 和 10 覆盖。
- 安全配置、凭证配对和日志边界由 Task 1、3、8 和文档验收覆盖。
- 当前目录不是 Git 仓库，因此不存在提交、分支合并或 PR 步骤。
