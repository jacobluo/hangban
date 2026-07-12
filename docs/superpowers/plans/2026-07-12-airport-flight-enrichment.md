# 机场与航班信息补全实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让前端按当前地图视野展示真实机场、支持全球中英文机场搜索，并使用 ADSBdb 异步补齐航班基础元数据。

**Architecture:** OurAirports 与 GeoNames 分别同步为经过契约校验的本地文件，API 启动时构建机场代码、文本和空间索引。实时位置周期提交后把航班交给有界元数据补全器，ADSBdb 结果只填补缺失字段，并通过现有仓库和 WebSocket 增量更新前端。

**Tech Stack:** pnpm workspace、TypeScript、Zod、Fastify、React、Next.js、MapLibre GL JS、Vitest、Playwright、Ardot。

## 全局约束

- 数据模式保持 `demo | live`，不得新增自动混合模式。
- 浏览器不得直接调用 OurAirports、GeoNames 或 ADSBdb。
- 机场 bbox 响应默认不超过 100 条，最大不超过 200 条。
- 全球搜索每类结果不超过 20 条。
- ADSBdb 补全不得阻塞航班位置采集和 WebSocket 连接。
- ADSBdb 起终点必须标记为推断信息，不能描述为官方飞行计划。
- 登机口、延误原因、前序航班、官方到离港板不进入本计划。
- UI 实现必须还原已确认的 Ardot 节点 `12:2`、`12:210`、`12:307`、`12:515`、`12:612`、`12:685` 和 `12:724`。
- 当前目录不是 Git 仓库，任务不包含提交、分支或 PR 步骤。

---

## 文件结构

```text
packages/contracts/src/airport.ts                 扩展机场公开字段和列表契约
packages/contracts/src/flight.ts                  增加字段级来源契约
packages/config/src/index.ts                      GeoNames 与 ADSBdb 配置
packages/adapters/src/geonames.ts                 GeoNames 城市和别名解析
packages/adapters/src/adsbdb.ts                   ADSBdb 航空器与呼号查询
packages/ingestion/src/metadata-enricher.ts       有界航班元数据补全器
apps/ingestor/src/sync-cities.ts                  GeoNames 原子同步命令
apps/api/src/airport-index.ts                     机场代码、文本和空间索引
apps/api/src/airport-data.ts                      加载机场和城市文件
apps/api/src/routes/airports.ts                   bbox 机场列表接口
apps/api/src/routes/search.ts                     全球中英文搜索
apps/api/src/flight-enrichment.ts                 API 补全生命周期
apps/web/src/lib/use-airports.ts                  视野机场和全局搜索状态
apps/web/src/components/airport-explorer.tsx      已确认机场探索交互
apps/web/src/components/flight-details-page.tsx   补全与推断信息表达
```

### Task 1：扩展机场、航班和配置契约

**Files:**

- Modify: `packages/contracts/src/airport.ts`
- Modify: `packages/contracts/src/flight.ts`
- Modify: `packages/contracts/src/contracts.test.ts`
- Modify: `packages/config/src/index.ts`
- Modify: `packages/config/src/config.test.ts`
- Modify: `.env.example`

**Interfaces:**

- Produces: `AirportListResponse`、`FlightFieldSource`、GeoNames 和 ADSBdb 运行配置。
- Consumes: 现有 `Airport`、`Flight`、`Bbox` 和 `RuntimeConfig`。

- [x] **Step 1：写机场列表与字段来源失败测试**

```ts
expect(
  airportListResponseSchema.parse({
    airports: [
      {
        iata: 'SZX',
        icao: 'ZGSZ',
        name: "Shenzhen Bao'an International Airport",
        city: 'Shenzhen',
        localizedCity: '深圳',
        country: 'CN',
        latitude: 22.6393,
        longitude: 113.8107,
        elevationM: 4,
        type: 'large_airport',
      },
    ],
    nextCursor: 'cursor-2',
    totalInViewport: 28,
  }),
).toMatchObject({ totalInViewport: 28 });
expect(
  flightSchema.parse({
    ...flight,
    fieldSources: [
      { field: 'origin', providerId: 'adsbdb', observedAt, inferred: true, confidence: 0.68 },
    ],
  }),
).toMatchObject({ inferredFields: ['origin'] });
```

- [x] **Step 2：运行契约测试并确认失败**

Run: `pnpm vitest run packages/contracts/src/contracts.test.ts`

Expected: FAIL，机场列表和字段来源 schema 尚不存在。

- [x] **Step 3：实现公开契约**

```ts
export const airportListResponseSchema = z.object({
  airports: z.array(airportSchema),
  nextCursor: z.string().min(1).nullable(),
  totalInViewport: z.number().int().nonnegative(),
});

export const flightFieldSourceSchema = z.object({
  field: z.enum(['airline', 'aircraftType', 'registration', 'origin', 'destination']),
  providerId: z.string().min(1),
  observedAt: z.iso.datetime({ offset: true }),
  inferred: z.boolean(),
  confidence: z.number().min(0).max(1),
});
```

`airportSchema` 增加可选 `localizedCity`；`flightSchema` 增加默认空数组 `fieldSources`。当 `origin` 或 `destination` 的来源为推断时，对应字段必须进入 `inferredFields`。

- [x] **Step 4：写配置失败测试**

```ts
const config = loadConfig({
  GEONAMES_CITIES_URL: 'https://download.test/cities500.zip',
  GEONAMES_ALTERNATE_NAMES_URL: 'https://download.test/alternateNamesV2.zip',
  ADSBDB_BASE_URL: 'https://api.adsbdb.test/v0',
});
expect(config.adsbdbConcurrency).toBe(4);
expect(config.adsbdbAircraftCacheTtlMs).toBe(86_400_000);
```

- [x] **Step 5：实现并校验配置**

增加：

```text
GEONAMES_CITIES_URL
GEONAMES_ALTERNATE_NAMES_URL
GEONAMES_DATA_PATH
ADSBDB_BASE_URL
ADSBDB_CONCURRENCY=4
ADSBDB_TIMEOUT_MS=5000
ADSBDB_AIRCRAFT_CACHE_TTL_MS=86400000
ADSBDB_ROUTE_CACHE_TTL_MS=21600000
ADSBDB_NEGATIVE_CACHE_TTL_MS=300000
```

数值必须为正整数；并发范围为 `1..16`；相对文件路径继续按应用根解析。

- [x] **Step 6：运行契约和配置测试**

Run: `pnpm vitest run packages/contracts/src/contracts.test.ts packages/config/src/config.test.ts`

Expected: PASS。

### Task 2：同步和解析 GeoNames 城市别名

**Files:**

- Create: `packages/adapters/src/geonames.ts`
- Create: `packages/adapters/src/geonames.test.ts`
- Modify: `packages/adapters/src/index.ts`
- Create: `apps/ingestor/src/sync-cities.ts`
- Create: `apps/ingestor/src/sync-cities.test.ts`
- Modify: `apps/ingestor/package.json`
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `data/.gitkeep`

**Interfaces:**

- Produces: `GeoCityRecord[]` 和 `syncGeoNames()`。
- Consumes: Task 1 的 GeoNames 配置。

- [x] **Step 1：安装 ZIP 流读取依赖**

Run: `pnpm --filter @hangban/adapters add yauzl`

Expected: 只更新 `packages/adapters/package.json` 和根 `pnpm-lock.yaml`。

- [x] **Step 2：写城市与中文别名解析失败测试**

```ts
expect(
  joinGeoNames(citiesText, alternateNamesText).find((city) => city.name === 'Shenzhen'),
).toMatchObject({
  geonamesId: 1795565,
  country: 'CN',
  localizedName: '深圳',
  aliases: expect.arrayContaining(['Shenzhen', '深圳']),
});
```

- [x] **Step 3：实现受限 ZIP 解析和别名过滤**

```ts
export type GeoCityRecord = {
  geonamesId: number;
  name: string;
  asciiName: string;
  localizedName?: string;
  aliases: string[];
  country: string;
  latitude: number;
  longitude: number;
  population: number;
};
```

仅保留城市类记录与语言 `zh`、`zh-CN`、`zh-Hans`、`zh-Hant`、`en` 及规范化 ASCII 名。过滤历史名称和空名称；每个城市别名去重并设置数量上限。ZIP 解压总字节设上限，拒绝路径穿越和意外文件名。

- [x] **Step 4：写同步失败保留旧文件测试**

```ts
await writeFile(target, JSON.stringify([oldCity]));
await expect(syncGeoNames({ target, fetchImpl: failingFetch })).rejects.toThrow();
expect(JSON.parse(await readFile(target, 'utf8'))).toEqual([oldCity]);
```

- [x] **Step 5：实现下载、校验和原子替换**

复用机场同步的超时、外部取消、响应字节上限、唯一临时文件和双错误保真模式。输出文件先通过 `GeoCityRecord[]` schema，再原子替换。

- [x] **Step 6：增加命令并运行测试**

```json
{
  "data:cities:sync": "pnpm --filter @hangban/ingestor data:cities:sync"
}
```

Run: `pnpm vitest run packages/adapters/src/geonames.test.ts apps/ingestor/src/sync-cities.test.ts`

Expected: PASS。

### Task 3：建立机场搜索与空间索引

**Files:**

- Create: `apps/api/src/airport-index.ts`
- Create: `apps/api/src/airport-index.test.ts`
- Modify: `apps/api/src/airport-data.ts`
- Modify: `apps/api/src/airport-data.test.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/memory-repository.ts`

**Interfaces:**

- Produces: `AirportIndex.queryViewport()`、`AirportIndex.search()`、`AirportIndex.findByCode()`。
- Consumes: `Airport[]` 和 `GeoCityRecord[]`。

- [x] **Step 1：写深圳多语言关联失败测试**

```ts
const index = createAirportIndex([szx], [shenzhenCity]);
expect(index.search('深圳', 20)[0]?.airport.iata).toBe('SZX');
expect(index.search('shenzhen', 20)[0]?.airport.iata).toBe('SZX');
expect(index.search('ZGSZ', 20)[0]?.airport.iata).toBe('SZX');
```

- [x] **Step 2：写 bbox、抽稀和游标失败测试**

```ts
const first = index.queryViewport({ bbox: [113, 22, 114, 23], zoom: 8, limit: 2 });
expect(first.airports).toHaveLength(2);
expect(first.nextCursor).not.toBeNull();
expect(first.airports.every((airport) => isInsideBbox(airport, bbox))).toBe(true);
```

世界视野测试必须证明只返回大型机场且不超过 100 条；非法、过期和被篡改的 cursor 返回稳定错误。

- [x] **Step 3：实现规范化文本与城市关联**

规范化包含 Unicode NFKC、大小写、空白和标点折叠。只做同国名称或别名完全匹配；未匹配时保留 OurAirports 原始城市名，不用最近城市兜底，避免不完整城市数据造成错误本地化。

- [x] **Step 4：实现有界空间索引和稳定游标**

使用固定地理网格保存机场 ID，bbox 只扫描相交网格。结果按机场类型、代码稳定排序；cursor 对排序键和查询摘要签名，不保存服务器进程指针。

- [x] **Step 5：扩展仓库边界**

仓库提供机场索引对象，不再让路由对 `allAirports()` 做无限制扫描。保留 `findAirport()` 兼容现有详情接口。

- [x] **Step 6：运行索引和 API 数据加载测试**

Run: `pnpm vitest run apps/api/src/airport-index.test.ts apps/api/src/airport-data.test.ts`

Expected: PASS。

### Task 4：实现机场 bbox API 与全球搜索

**Files:**

- Modify: `apps/api/src/routes/airports.ts`
- Modify: `apps/api/src/routes/search.ts`
- Modify: `apps/api/src/api.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/start-api.ts`

**Interfaces:**

- Produces: `GET /api/v1/airports` 和扩展后的 `GET /api/v1/search`。
- Consumes: Task 3 的 `AirportIndex`。

- [x] **Step 1：写 bbox API 失败测试**

```ts
const response = await app.inject({
  method: 'GET',
  url: '/api/v1/airports?bbox=113,22,114,23&zoom=8&limit=20',
});
expect(response.json()).toMatchObject({
  airports: [expect.objectContaining({ iata: 'SZX' })],
  totalInViewport: expect.any(Number),
});
```

- [x] **Step 2：实现参数上限、游标和稳定错误**

`bbox` 使用统一 schema；`zoom` 限制为 `0..24`；`limit` 默认 100、最大 200；响应通过 Task 1 的公开契约解析后返回。

- [x] **Step 3：写全球中文搜索失败测试**

```ts
for (const query of ['深圳', 'shenzhen', 'SZX', 'ZGSZ']) {
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/search?q=${encodeURIComponent(query)}`,
  });
  expect(response.json().airports[0].iata).toBe('SZX');
}
```

- [x] **Step 4：实现统一搜索排序和结果上限**

搜索机场使用索引；航班同时支持呼号、航司、注册号和起终点。响应增加匹配类型和可选 `matchedAlias`，但不返回完整别名表。

- [x] **Step 5：按模式加载真实机场索引**

`live` 必须加载 OurAirports 和 GeoNames；GeoNames 缺失时允许英文与代码搜索启动，但来源状态标记为降级。`demo` 使用 testkit 机场和内置最小城市别名，保持离线测试。

- [x] **Step 6：运行 API 测试**

Run: `pnpm --filter @hangban/api test && pnpm --filter @hangban/api typecheck`

Expected: PASS。

### Task 5：实现 ADSBdb 适配器

**Files:**

- Create: `packages/adapters/src/adsbdb.ts`
- Create: `packages/adapters/src/adsbdb.test.ts`
- Modify: `packages/adapters/src/index.ts`
- Modify: `packages/adapters/package.json`

**Interfaces:**

- Produces: `FlightMetadataProvider` 和 `createAdsbdbProvider()`。
- Consumes: Task 1 的 ADSBdb 配置和字段来源类型。

- [x] **Step 1：写航空器查询失败测试**

```ts
expect(await provider.fetchAircraft('780a61')).toEqual({
  providerId: 'adsbdb',
  icao24: '780a61',
  registration: 'B-2482',
  aircraftType: 'B748',
  manufacturer: 'Boeing',
});
```

- [x] **Step 2：写呼号路线失败测试**

```ts
expect(await provider.fetchCallsign('CA981')).toMatchObject({
  airline: 'Air China',
  origin: 'PEK',
  destination: 'JFK',
  inferred: true,
});
```

- [x] **Step 3：实现响应校验和 URL 构造**

对 ICAO24、注册号和呼号进行白名单校验与 URL 编码。供应商的 404 转换为 `not-found`，429 保留 `Retry-After`，其他响应转换为稳定 `ProviderError`。不记录原始响应。

- [x] **Step 4：验证版权和字段边界**

适配器只在运行时使用允许展示的字段；不把 ADSBdb 响应重新发布为独立数据库。路线来源在领域模型中始终标记 `inferred: true`。

- [x] **Step 5：运行适配器测试**

Run: `pnpm vitest run packages/adapters/src/adsbdb.test.ts && pnpm --filter @hangban/adapters typecheck`

Expected: PASS。

### Task 6：实现有界航班元数据补全器

**Files:**

- Create: `packages/ingestion/src/metadata-enricher.ts`
- Create: `packages/ingestion/src/metadata-enricher.test.ts`
- Modify: `packages/ingestion/src/index.ts`
- Modify: `packages/ingestion/package.json`

**Interfaces:**

- Produces: `createFlightMetadataEnricher()`。
- Consumes: Task 5 的 `FlightMetadataProvider`。

- [x] **Step 1：写非阻塞观察失败测试**

```ts
const accepted = enricher.observe([positionOnlyFlight]);
expect(accepted).toBeUndefined();
expect(provider.fetchAircraft).toHaveBeenCalledTimes(1);
await enricher.whenIdle();
expect(onFlightEnriched).toHaveBeenCalledWith(expect.objectContaining({ registration: 'B-2482' }));
```

- [x] **Step 2：写并发、缓存和负缓存失败测试**

测试必须证明：并发不超过 4；相同 ICAO24 和呼号合并请求；航空器缓存 24 小时；路线缓存 6 小时；404 和失败负缓存 5 分钟；LRU 有明确容量上限。

- [x] **Step 3：写融合保护失败测试**

ADSBdb 不能覆盖已有可靠字段；路线冲突时保留现有值；写入起终点时同步增加 `inferredFields` 和 `fieldSources`。

- [x] **Step 4：实现队列、缓存和生命周期**

```ts
export type FlightMetadataEnricher = {
  observe(flights: readonly Flight[]): void;
  whenIdle(): Promise<void>;
  stats(): { queued: number; inFlight: number; cacheEntries: number };
  stop(): void;
};
```

停止后不得启动新请求；晚到响应不得回写；只处理仍存在于最近一次观察集合中的航班。

- [x] **Step 5：运行补全器测试**

Run: `pnpm vitest run packages/ingestion/src/metadata-enricher.test.ts && pnpm --filter @hangban/ingestion typecheck`

Expected: PASS。

### Task 7：接入 API 补全生命周期和实时更新

**Files:**

- Create: `apps/api/src/flight-enrichment.ts`
- Create: `apps/api/src/flight-enrichment.test.ts`
- Modify: `apps/api/src/live-ingestion.ts`
- Modify: `apps/api/src/memory-repository.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/realtime/broadcaster.test.ts`

**Interfaces:**

- Produces: API 运行时的补全控制器。
- Consumes: Task 6 的补全器和现有仓库/broadcaster。

- [x] **Step 1：写位置先提交、元数据后更新测试**

```ts
await liveIngestion.runNow();
expect(repository.findFlight('CA981')).toMatchObject({ registration: undefined });
await enrichment.whenIdle();
expect(repository.findFlight('CA981')).toMatchObject({ registration: 'B-2482', origin: 'PEK' });
```

- [x] **Step 2：实现按 ID 的条件合并**

仓库增加 `mergeFlightMetadata(flightId, patch, expectedIcao24)`；航班已删除或 ICAO24 不一致时拒绝晚到结果。位置字段和 `observedAt` 不由元数据补全器修改。

- [x] **Step 3：接入 live 运行时**

每次真实周期提交位置快照后调用 `observe()`。`demo` 不访问 ADSBdb。Fastify `onClose` 停止补全器并清理队列。

- [x] **Step 4：验证 WebSocket 增量**

完整 Flight 指纹已经覆盖新增字段；增加集成测试证明元数据变化产生一次 `flight.upsert`，相同补全结果不重复发送。

- [x] **Step 5：运行 API 聚焦测试**

Run: `pnpm vitest run apps/api/src/flight-enrichment.test.ts apps/api/src/live-ingestion.test.ts apps/api/src/realtime/broadcaster.test.ts`

Expected: PASS。

### Task 8：实现前端视野机场和全球搜索

**Files:**

- Modify: `apps/web/src/lib/api-client.ts`
- Create: `apps/web/src/lib/use-airports.ts`
- Create: `apps/web/src/lib/use-airports.test.tsx`
- Modify: `apps/web/src/lib/demo-data.ts`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/components/app-shell.tsx`
- Modify: `apps/web/src/components/search-box.tsx`
- Modify: `apps/web/src/components/flight-map.tsx`
- Modify: `apps/web/src/components/app-shell.test.tsx`

**Interfaces:**

- Produces: 当前视野机场、全球搜索和继续加载状态。
- Consumes: Task 4 的机场与搜索 API。

- [x] **Step 1：写视野切换和取消旧请求失败测试**

```ts
rerender({ bbox: shenzhenBbox });
rerender({ bbox: londonBbox });
resolveShenzhenResponse();
expect(result.current.airports).not.toContainEqual(expect.objectContaining({ iata: 'SZX' }));
```

- [x] **Step 2：实现 `useAirports`**

Hook 管理 `viewport | search` 两种状态；bbox 变化使用 AbortController；继续加载追加同一查询游标；搜索词清空时恢复最近视野结果。错误时保留上一成功机场列表。

- [x] **Step 3：让地图机场完全来自 API**

首页运行数据不再从 `demoData.airports` 固定注入 4 个机场。`FlightMap` 的同一 `moveend` 同时更新航班订阅和机场 bbox，不增加第二套地图监听。

- [x] **Step 4：实现全局搜索并保持选择状态**

搜索输入使用 250 ms 延迟和最少 1 个非空字符；请求失败不清除当前机场和航班选择。结果展示匹配类型和中文城市名。

- [x] **Step 5：运行组件测试**

Run: `pnpm vitest run apps/web/src/lib/use-airports.test.tsx apps/web/src/components/app-shell.test.tsx`

Expected: PASS。

### Task 9：按已确认原型还原机场和航班 UI

**Files:**

- Modify: `apps/web/src/components/airport-explorer.tsx`
- Modify: `apps/web/src/components/flight-details-page.tsx`
- Modify: `apps/web/src/components/flight-panel.tsx`
- Modify: `apps/web/src/components/system-notice.tsx`
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/components/app-shell.test.tsx`
- Modify: `tests/e2e/airport-route.spec.ts`
- Modify: `tests/e2e/system-states.spec.ts`
- Create: `tests/e2e/airport-search.spec.ts`

**Interfaces:**

- Produces: 与 Ardot 节点一致的桌面端和手机端体验。
- Consumes: Task 8 的前端状态和 Task 7 的补全航班。

- [x] **Step 1：写原型行为失败测试**

覆盖：当前视野数量、继续加载、`深圳` 全球搜索、清除搜索、机场加载/空结果/错误、航班资料补全中、资料不可用、推断路线说明。

- [x] **Step 2：还原桌面端机场原型**

严格参考 `12:2` 和 `12:307`。默认列表只显示当前视野；搜索结果显示匹配依据；继续加载显示 `已显示 / 总数`。

- [x] **Step 3：还原手机端机场原型**

严格参考 `12:210` 和 `12:515`。保持底部抽屉、44 × 44 px 触控区域和地图上下文；不得把全部机场一次性渲染到抽屉。

- [x] **Step 4：还原航班补全和状态原型**

严格参考 `12:612`、`12:685` 和 `12:724`。推断路线使用黄色说明条；加载和失败状态明确说明实时位置不受影响。

- [x] **Step 5：执行视觉检查**

检查 1440 × 900 和 390 × 844；保存截图到 `.ardot-qa/airport-flight-enrichment/`，与确认稿逐屏比较。仅修复实现与原型差异，不改变已确认设计。

- [x] **Step 6：运行 Web 与 E2E 测试**

Run: `pnpm --filter @hangban/web test && pnpm e2e`

Expected: 桌面端与手机端全部通过。

### Task 10：更新文档并完成离线与真实验证

**Files:**

- Modify: `README.md`
- Modify: `docs/AGENTS.md`
- Modify: `docs/product-design.md`
- Modify: `docs/architecture.md`
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-07-12-airport-flight-enrichment-design.md`
- Modify: this plan

**Interfaces:**

- Consumes: Tasks 1–9 的最终命令和行为。
- Produces: 可复现的运行说明与验收记录。

- [x] **Step 1：记录同步和运行顺序**

```bash
pnpm data:airports:sync
pnpm data:cities:sync
DATA_MODE=live LIVE_PROVIDERS=adsb-lol pnpm dev
```

说明 GeoNames 署名、同步频率、ADSBdb 推断语义和失败降级。

- [x] **Step 2：运行完整离线门禁**

Run: `pnpm verify && pnpm format:check`

Expected: lint、typecheck、单元/组件测试、build、桌面和手机 E2E、格式检查全部通过；默认门禁不访问公网。

- [x] **Step 3：同步真实数据并验证中文搜索**

Run: `pnpm data:airports:sync && pnpm data:cities:sync`

验证：`深圳`、`shenzhen`、`SZX`、`ZGSZ` 均返回 SZX；bbox 只返回视野机场；无临时文件残留。

- [x] **Step 4：验证真实 ADSBdb 补全**

启动 live 模式并选择具有 ICAO24 和呼号的真实航班。验证位置先出现，随后航空器资料更新；若 ADSBdb 无该记录，验证「未获得数据」状态且位置继续更新。

验收记录：2026-07-12 通过项目适配器查询真实 ICAO24 `780A61` 与呼号 `CA981`，分别得到注册号 `B-KQM`、机型 `B77W`、制造商 Boeing，以及推断路线 `PEK → JFK`；路线结果保留 `inferred: true`。

- [x] **Step 5：回归 demo 与资源边界**

未设置 `DATA_MODE` 时运行 `pnpm dev`，验证 demo、机场搜索和现有 E2E 不回归。记录机场索引数量、ADSBdb 队列和缓存数量，确认有界。

## 计划自检

- 机场同步、中文别名、索引、API、前端和视觉实现分别由 Tasks 2–4、8–9 覆盖。
- ADSBdb 适配、缓存补全、API 生命周期和 WebSocket 更新分别由 Tasks 5–7 覆盖。
- `深圳`、`shenzhen`、`SZX`、`ZGSZ` 四种搜索方式由 Tasks 3、4、8、10 重复验证。
- UI 只实现已确认 Ardot 节点，符合「先更新原型，再修改前端」规则。
- 免费来源失败不会阻塞实时位置，且推断路线不会被描述为官方事实。
- 没有登机口、延误原因、前序航班或账号体系的隐藏扩展。

## 真实数据验收记录

- 已使用真实 GeoNames 深圳记录（ID `1795565`）加载 live API，验证 `深圳`、`shenzhen`、`SZX`、`ZGSZ` 均返回 SZX；`113,22,114,23` bbox 仅返回边界内机场。
- 烟测发现并修复了不完整城市集把珠海、惠州误标为深圳的问题；现在只接受同国名称或别名完全匹配，并有回归测试。
- GeoNames 官方镜像在当前网络下实测约 25 KB/s；改由外部服务器下载后完成本地全量导入。最终生成 32,538 条机场记录和 234,888 条城市记录，并验证原子替换、ZIP 边界、中文名称、同名城市消歧和失败保留旧文件。

## GeoNames 慢速镜像修复

- [x] 将约 202 MB 别名包的同步超时改为可配置，并采用适合官方慢速镜像的默认值。
- [x] CLI 失败时输出稳定、脱敏的原因码，不再只输出通用失败事件。
- [x] 运行聚焦测试、完整离线门禁和格式检查。

## Next.js 开发模式冷启动修复

- [x] 固化 Web 开发脚本必须使用 webpack 的回归测试。
- [x] 将 `next dev` 切换到 webpack，生产 build/start 保持不变。
- [x] 验证首次 HTML 响应恢复到秒级，并运行完整质量门禁。

## 浏览器扩展水合兼容修复

- [x] 为根布局顶层属性水合兼容增加回归测试。
- [x] 仅在 `<body>` 边界抑制扩展注入属性造成的水合警告，不忽略子树错误。
- [x] 运行 Web 聚焦测试、完整质量门禁和格式检查。

## GeoNames 官方别名格式修复

- [x] 使用深圳官方真实别名行覆盖“无首选标记”和历史名称字段。
- [x] 优先首选中文名，无首选标记时回退到第一个非历史中文名。
- [x] 重新生成全量城市数据并验证中文、英文和代码搜索。
- [x] 运行完整质量门禁和格式检查。

## 全量机场索引启动性能修复

- [x] 增加大城市集与机场集的索引构建性能回归测试。
- [x] 使用有界城市查找表替代逐机场线性扫描全部城市。
- [x] 验证全量 live API 启动、四种深圳搜索和视野机场查询。
- [x] 运行完整质量门禁和格式检查。
