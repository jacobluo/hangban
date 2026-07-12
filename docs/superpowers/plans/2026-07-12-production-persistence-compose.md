# 生产持久化与完整容器实施计划

**实施状态：已完成（2026-07-12）。** 当前目录不是 Git 仓库，因此未执行任务级提交；以下 checkbox 保留原始执行模板，实际证据以文末实施记录为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用 PostgreSQL/PostGIS 与 Redis 替换 `live` 模式的内存状态，拆分独立 ingestor，并提供中间件开发模式、完整容器模式和真实容器测试门禁。

**Architecture:** `demo` 继续使用现有内存 Repository；`live` 强制使用 PostgreSQL/PostGIS 静态数据仓库与 Redis 实时状态仓库。独立 ingestor 是唯一实时航班写入者，API 只读取持久化状态并向 WebSocket 分发 Redis 增量。Docker Compose 同时提供基础设施、完整应用栈和一次性同步任务。

**Tech Stack:** Node.js、TypeScript、pnpm workspace、Fastify、Next.js、`pg`、PostgreSQL 17、PostGIS 3.5、Redis 8.8、官方 Node.js Redis 客户端、Docker Compose、Vitest、Playwright。

## Global Constraints

- PostgreSQL 镜像固定为 `postgis/postgis:17-3.5`；Redis 镜像固定为 `redis:8.8.0-alpine`。
- PostGIS 官方镜像使用 `linux/amd64`；ARM64 开发机通过 Docker Desktop 模拟运行。
- JavaScript/TypeScript 依赖只使用 pnpm，提交根目录 `pnpm-lock.yaml`。
- `demo` 不要求 Docker；`live` 缺少 PostgreSQL、Redis 或迁移时拒绝启动，不回退到 `demo`。
- 浏览器不得持有数据库、Redis 或供应商凭证。
- PostgreSQL 不承载 10 秒级航班位置写入；Redis 不保存机场和城市主数据。
- SQL 必须参数化；日志不得包含连接 URL、密码、原始 SQL 参数或供应商密钥。
- PostgreSQL 和 Redis 本地端口只绑定 `127.0.0.1`。
- 默认单元测试不访问公网；集成测试和 E2E 使用真实本地容器与 fixture 数据。
- 静态同步失败保留上一版本；Redis Pub/Sub 不作为永久事件日志。
- 当前目录不是 Git 仓库。计划中的每个任务以验证检查点结束；初始化 Git 后再按任务边界提交。

---

## 文件结构

```text
compose.yaml                              本地中间件、完整栈和工具 profile
compose.test.yaml                         隔离测试中间件
docker/api.Dockerfile                     API 与 ingestor 共享运行镜像
docker/web.Dockerfile                     Next.js 多阶段镜像
docker/.dockerignore                      容器构建排除规则
packages/persistence/                     PostgreSQL 客户端、迁移和静态数据仓库
packages/realtime-store/                  Redis 航班状态、事件和租约
apps/ingestor/src/run-live.ts              Redis 持久化采集入口
apps/ingestor/src/sync-static-db.ts        PostgreSQL 静态数据导入入口
apps/api/src/external-runtime.ts           live 外部仓库装配
tests/integration/                         真实 PostgreSQL/Redis 测试
tests/fixtures/                            E2E 静态与实时 fixture
scripts/infra                              Compose 管理入口
scripts/verify-with-infra                  真实容器完整门禁
```

### Task 1：基础设施 Compose 与运行配置

**Files:**

- Create: `compose.yaml`
- Create: `compose.test.yaml`
- Create: `scripts/infra`
- Modify: `.env.example`
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `packages/config/src/index.ts`
- Modify: `packages/config/src/config.test.ts`

**Interfaces:**

- Produces: `databaseUrl: string | undefined`、`redisUrl: string | undefined`、`databasePoolMax: number`、`redisKeyPrefix: string`。
- Consumes: 现有 `RuntimeConfig` 与 `DATA_MODE=demo|live`。

- [ ] **Step 1：写配置失败测试**

在 `packages/config/src/config.test.ts` 增加：

```ts
it('requires PostgreSQL and Redis URLs in live mode', () => {
  expect(() => loadConfig({ DATA_MODE: 'live', LIVE_PROVIDERS: 'adsb-lol' })).toThrow(
    'DATABASE_URL and REDIS_URL are required in live mode',
  );
});

it('does not require external stores in demo mode', () => {
  expect(loadConfig({ DATA_MODE: 'demo' })).toMatchObject({
    databaseUrl: undefined,
    redisUrl: undefined,
    databasePoolMax: 10,
    redisKeyPrefix: 'hangban',
  });
});
```

- [ ] **Step 2：运行测试并确认失败**

Run: `pnpm exec vitest run packages/config/src/config.test.ts`

Expected: FAIL，`RuntimeConfig` 尚无外部存储配置，`live` 尚未校验 URL。

- [ ] **Step 3：实现配置契约**

在 `packages/config/src/index.ts` 增加并映射：

```ts
DATABASE_URL: optionalNonemptyString,
REDIS_URL: optionalNonemptyString,
DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
REDIS_KEY_PREFIX: z.string().trim().regex(/^[a-z0-9:_-]+$/i).default('hangban'),
```

`DATA_MODE=live` 时同时要求 `DATABASE_URL` 与 `REDIS_URL`。错误信息固定为 `DATABASE_URL and REDIS_URL are required in live mode`。

- [ ] **Step 4：创建 Compose 文件**

`compose.yaml` 的基础服务使用以下结构：

```yaml
services:
  postgres:
    image: postgis/postgis:17-3.5
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-hangban}
      POSTGRES_USER: ${POSTGRES_USER:-hangban}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}
    ports:
      - '127.0.0.1:${POSTGRES_PORT:-5432}:5432'
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB']
      interval: 5s
      timeout: 3s
      retries: 20

  redis:
    image: redis:8.8.0-alpine
    command: ['redis-server', '--requirepass', '${REDIS_PASSWORD}', '--appendonly', 'yes']
    ports:
      - '127.0.0.1:${REDIS_PORT:-6379}:6379'
    volumes:
      - redis-data:/data
    healthcheck:
      test: ['CMD', 'redis-cli', '-a', '${REDIS_PASSWORD}', 'ping']
      interval: 5s
      timeout: 3s
      retries: 20

volumes:
  postgres-data:
  redis-data:
```

`compose.test.yaml` 使用端口 55432/56379、`tmpfs` 和固定测试凭证，只供本机测试，不复用日常卷。

- [ ] **Step 5：增加基础设施命令**

`scripts/infra` 只接受 `up|down|status|logs|reset`。`reset` 必须额外要求 `--confirm-delete-data`，否则退出码为 2。根脚本增加：

```json
{
  "infra:up": "scripts/infra up",
  "infra:down": "scripts/infra down",
  "infra:status": "scripts/infra status",
  "infra:logs": "scripts/infra logs"
}
```

- [ ] **Step 6：验证基础设施**

Run:

```bash
POSTGRES_PASSWORD=local-postgres REDIS_PASSWORD=local-redis pnpm infra:up
POSTGRES_PASSWORD=local-postgres REDIS_PASSWORD=local-redis pnpm infra:status
```

Expected: `postgres` 与 `redis` 状态均为 healthy；端口只监听 `127.0.0.1`。

- [ ] **Step 7：运行聚焦门禁并记录检查点**

Run: `pnpm exec vitest run packages/config/src/config.test.ts && pnpm typecheck`

Expected: PASS。

### Task 2：PostgreSQL 客户端与版本化迁移

**Files:**

- Create: `packages/persistence/package.json`
- Create: `packages/persistence/tsconfig.json`
- Create: `packages/persistence/src/index.ts`
- Create: `packages/persistence/src/client.ts`
- Create: `packages/persistence/src/migrate.ts`
- Create: `packages/persistence/src/migrate.test.ts`
- Create: `packages/persistence/migrations/0001_static_data.sql`
- Create: `apps/ingestor/src/migrate-db.ts`
- Modify: `apps/ingestor/package.json`
- Modify: `package.json`

**Interfaces:**

- Produces: `createPostgresPool(options): Pool`、`checkPostgres(pool): Promise<void>`、`migrateDatabase(pool, directory): Promise<MigrationResult>`。
- Consumes: Task 1 的 `DATABASE_URL` 和 `DATABASE_POOL_MAX`。

- [ ] **Step 1：安装依赖并建立包边界**

Run:

```bash
pnpm --filter @hangban/persistence add pg
pnpm --filter @hangban/persistence add -D @types/pg vitest
```

`packages/persistence/package.json` 导出 `./src/index.ts`，脚本提供 `typecheck` 与 `build`。

- [ ] **Step 2：写迁移失败测试**

`packages/persistence/src/migrate.test.ts` 使用注入式 `MigrationClient`，覆盖：

```ts
it('rejects a changed checksum for an applied migration', async () => {
  await expect(
    validateAppliedMigration(
      { name: '0001.sql', checksum: 'old' },
      { name: '0001.sql', checksum: 'new' },
    ),
  ).rejects.toThrow('MIGRATION_CHECKSUM_MISMATCH');
});
```

另测迁移按文件名排序、重复执行跳过和 advisory lock 始终释放。

- [ ] **Step 3：运行测试并确认失败**

Run: `pnpm exec vitest run packages/persistence/src/migrate.test.ts`

Expected: FAIL，迁移 API 尚不存在。

- [ ] **Step 4：实现客户端与迁移器**

`createPostgresPool` 固定设置：

```ts
new Pool({ connectionString, max, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000 });
```

`migrateDatabase`：

1. `SELECT pg_advisory_lock(hashtext('hangban:migrations'))`。
2. 创建 `schema_migrations(name text primary key, checksum text not null, applied_at timestamptz not null)`。
3. 计算每个 SQL 文件 SHA-256。
4. 校验已执行文件 checksum。
5. 每个新文件在事务内执行并登记。
6. `finally` 调用 `pg_advisory_unlock`。

- [ ] **Step 5：创建初始 SQL migration**

`0001_static_data.sql` 完整创建 `postgis`、`pg_trgm`、`cities`、`city_aliases`、`airports`、`airport_aliases`、`static_imports`，以及规格中的主键、外键、GiST、trigram GIN 和条件唯一索引。所有时间字段使用 `timestamptz`，经纬度使用 `geography(Point, 4326)`。

- [ ] **Step 6：增加迁移命令**

`apps/ingestor/src/migrate-db.ts` 加载配置、建立连接池、运行迁移、输出：

```json
{ "event": "database.migrated", "applied": 1, "skipped": 0 }
```

根脚本增加 `"db:migrate": "pnpm --filter @hangban/ingestor db:migrate"`。

- [ ] **Step 7：真实数据库验证**

Run:

```bash
DATABASE_URL=postgresql://hangban:local-postgres@127.0.0.1:5432/hangban pnpm db:migrate
DATABASE_URL=postgresql://hangban:local-postgres@127.0.0.1:5432/hangban pnpm db:migrate
```

Expected: 第一次 `applied >= 1`，第二次 `applied = 0`；`SELECT PostGIS_Version()` 成功。

- [ ] **Step 8：运行聚焦门禁并记录检查点**

Run: `pnpm exec vitest run packages/persistence/src && pnpm --filter @hangban/persistence typecheck`

Expected: PASS。

### Task 3：静态机场与城市事务导入

**Files:**

- Create: `packages/persistence/src/static-sync.ts`
- Create: `packages/persistence/src/static-sync.test.ts`
- Create: `apps/ingestor/src/sync-static-db.ts`
- Modify: `apps/ingestor/package.json`
- Modify: `package.json`

**Interfaces:**

- Produces: `syncStaticData(pool, { airports, cities, sourceVersion }): Promise<StaticSyncSummary>`。
- Consumes: `Airport[]`、`GeoCityRecord[]`、Task 2 schema。

- [ ] **Step 1：写事务导入失败测试**

使用注入式 SQL client 验证：

```ts
it('rolls back and preserves the previous version when alias insertion fails', async () => {
  const client = failingClientAt('INSERT_CITY_ALIASES');
  await expect(syncStaticData(client, fixture)).rejects.toThrow('STATIC_SYNC_FAILED');
  expect(client.commands).toContain('ROLLBACK');
  expect(client.commands).not.toContain('COMMIT');
});
```

另测确定性 `airport_key`、同一来源失效记录删除、空数据拒绝和重复导入幂等。

- [ ] **Step 2：运行测试并确认失败**

Run: `pnpm exec vitest run packages/persistence/src/static-sync.test.ts`

Expected: FAIL，静态导入实现尚不存在。

- [ ] **Step 3：实现 staging 与事务切换**

`syncStaticData`：

1. 拒绝空机场或空城市集合。
2. 创建事务级临时 staging 表。
3. 每批最多 1,000 行参数化写入。
4. 使用 `ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography` 写位置。
5. upsert 正式表与别名表。
6. 按 `source` 删除本轮不存在的记录。
7. 写 `static_imports` 记录数和版本。
8. 成功提交；任何错误回滚并转换为 `STATIC_SYNC_FAILED`。

机场键函数固定为：ICAO → IATA → SHA-256(`source|country|name|latitude|longitude`)。

- [ ] **Step 4：增加 CLI**

`sync-static-db.ts` 从 `AIRPORTS_DATA_PATH` 和 `GEONAMES_DATA_PATH` 读取现有 JSON，通过现有 schema 校验后调用 `syncStaticData`。根脚本增加：

```json
{ "data:db:sync": "pnpm --filter @hangban/ingestor data:db:sync" }
```

成功日志：

```json
{ "event": "static-data.synced", "airports": 32538, "cities": 234888 }
```

- [ ] **Step 5：真实全量导入验证**

Run:

```bash
DATABASE_URL=postgresql://hangban:local-postgres@127.0.0.1:5432/hangban pnpm data:db:sync
```

Expected: 当前本地数据得到 32,538 条机场和 234,888 条城市；无 staging 表残留。

- [ ] **Step 6：运行聚焦门禁并记录检查点**

Run: `pnpm exec vitest run packages/persistence/src/static-sync.test.ts && pnpm typecheck`

Expected: PASS。

### Task 4：PostgreSQL 机场查询 Repository

**Files:**

- Create: `packages/persistence/src/airport-store.ts`
- Create: `packages/persistence/src/airport-store.test.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/routes/airports.ts`
- Modify: `apps/api/src/routes/search.ts`
- Modify: `apps/api/src/api.test.ts`

**Interfaces:**

- Produces: `PostgresAirportStore`，实现 `findByCode`、`search`、`queryViewport` 和 `nearbyFlights` 所需的静态查询端口。
- Consumes: Task 2/3 schema 和现有 `AirportListResponse`、search 契约。

- [ ] **Step 1：先抽取异步静态查询端口**

将机场 Repository 方法改为异步：

```ts
export interface AirportStore {
  findByCode(code: string): Promise<Airport | undefined>;
  search(query: string, limit: number): Promise<AirportSearchMatch[]>;
  queryViewport(query: AirportViewportQuery): Promise<AirportListResponse>;
}
```

内存实现以 `Promise.resolve` 包装现有 `AirportIndex`，现有 HTTP 契约不变。

- [ ] **Step 2：写 PostgreSQL 查询失败测试**

真实集成测试至少断言：

```ts
expect((await store.search('深圳', 20))[0]?.airport.iata).toBe('SZX');
expect((await store.search('ZGSZ', 20))[0]?.matchType).toBe('code');
expect(
  (await store.queryViewport({ bbox: [113, 22, 114, 23], zoom: 8, limit: 20 })).airports,
).toEqual(expect.arrayContaining([expect.objectContaining({ iata: 'SZX' })]));
```

另测非法 cursor、代码精确匹配排序、低 zoom 只返回大型机场和参数化查询。

- [ ] **Step 3：运行测试并确认失败**

Run: `pnpm exec vitest run packages/persistence/src/airport-store.test.ts`

Expected: FAIL，`PostgresAirportStore` 尚不存在。

- [ ] **Step 4：实现 SQL 查询**

- bbox 使用 `ST_Intersects(location, ST_MakeEnvelope($1,$2,$3,$4,4326)::geography)`。
- 搜索先比较 IATA/ICAO 精确值，再搜索机场名称、城市名、中文城市名和别名。
- 排序固定为代码精确、城市精确、名称/别名包含、机场类型、代码。
- cursor 编码查询摘要、排序键和 offset；签名不匹配返回 `INVALID_CURSOR`。
- 所有 limit 在应用层和 SQL 层限制为 1–200。

- [ ] **Step 5：迁移 API 路由到异步端口**

`routes/airports.ts` 与 `routes/search.ts` 只依赖 `AirportStore`，数据库错误映射为稳定 `STATIC_DATA_UNAVAILABLE`，不返回 SQL 或连接信息。

- [ ] **Step 6：验证现有和真实查询**

Run:

```bash
pnpm exec vitest run apps/api/src packages/persistence/src/airport-store.test.ts
```

Expected: 内存测试和 PostgreSQL 集成测试均 PASS。

- [ ] **Step 7：记录检查点**

Run: `pnpm typecheck && pnpm lint`

Expected: PASS。

### Task 5：Redis 航班状态、空间索引与事件

**Files:**

- Create: `packages/realtime-store/package.json`
- Create: `packages/realtime-store/tsconfig.json`
- Create: `packages/realtime-store/src/index.ts`
- Create: `packages/realtime-store/src/client.ts`
- Create: `packages/realtime-store/src/flight-store.ts`
- Create: `packages/realtime-store/src/events.ts`
- Create: `packages/realtime-store/src/flight-store.test.ts`
- Create: `packages/realtime-store/src/events.test.ts`

**Interfaces:**

- Produces: `createRedisConnections`、`RedisFlightStore.commitCycle`、`snapshotByBbox`、`sourceStatuses`、`publishChanges`、`subscribeChanges`。
- Consumes: `Flight`、`SourceStatus`、`Bbox` 和统一实时事件契约。

- [ ] **Step 1：安装依赖并建立包边界**

Run:

```bash
pnpm --filter @hangban/realtime-store add redis @hangban/contracts@workspace:*
pnpm --filter @hangban/realtime-store add -D vitest
```

- [ ] **Step 2：写真实 Redis 失败测试**

覆盖：

```ts
await store.commitCycle({ flights: [ca981], statuses: [healthy], observedAt });
expect(await store.snapshotByBbox([110, 20, 130, 50])).toEqual([ca981]);

await store.commitCycle({ flights: [], statuses: [healthy], observedAt: later });
expect(await store.snapshotByBbox([110, 20, 130, 50])).toEqual([]);
```

另测 TTL、跨日期变更线 bbox、原子移除、错误 JSON 隔离、来源状态和 key prefix。

- [ ] **Step 3：运行测试并确认失败**

Run: `pnpm exec vitest run packages/realtime-store/src/flight-store.test.ts`

Expected: FAIL，Redis store 尚不存在。

- [ ] **Step 4：实现 Redis 客户端和 Lua 提交**

创建 command、publisher、subscriber 三条连接。`commitCycle` 使用 Lua 原子完成：

1. `SET prefix:flight:<id> <json> PX <ttl>`。
2. `GEOADD prefix:flights:geo longitude latitude id`。
3. 更新 `prefix:flights:active`。
4. 删除上轮存在、本轮不存在的航班键和 GEO 成员。
5. 写入 `prefix:source-statuses`。
6. 返回新增、修改和移除 ID，应用层发布统一事件。

`snapshotByBbox` 使用 `GEOSEARCH ... BYBOX`，日期变更线 bbox 拆成两次查询并去重。

- [ ] **Step 5：实现事件订阅**

发布前使用 contracts schema 校验；订阅端遇到无效 JSON 时记录稳定 `INVALID_REALTIME_EVENT` 并跳过，不中断后续消息。

- [ ] **Step 6：运行真实 Redis 集成测试**

Run: `pnpm exec vitest run packages/realtime-store/src`

Expected: PASS；测试完成后没有 `hangban-test:*` 键。

- [ ] **Step 7：记录检查点**

Run: `pnpm --filter @hangban/realtime-store typecheck && pnpm lint`

Expected: PASS。

### Task 6：Redis 分布式租约与独立 ingestor 写入

**Files:**

- Create: `packages/realtime-store/src/lease.ts`
- Create: `packages/realtime-store/src/lease.test.ts`
- Create: `apps/ingestor/src/run-live.ts`
- Create: `apps/ingestor/src/run-live.test.ts`
- Modify: `apps/ingestor/src/index.ts`
- Modify: `apps/ingestor/package.json`
- Modify: `packages/config/src/index.ts`
- Modify: `packages/config/src/config.test.ts`

**Interfaces:**

- Produces: `RedisLease.acquire`、`renew`、`release` 和长期运行 `startExternalIngestor`。
- Consumes: Task 5 `RedisFlightStore`、现有 provider scheduler、ADSBdb enricher。

- [ ] **Step 1：增加租约配置失败测试**

配置新增：

```ts
INGESTOR_LEASE_TTL_MS: z.coerce.number().int().min(15_000).default(30_000),
INGESTOR_LEASE_RENEW_MS: z.coerce.number().int().min(5_000).default(10_000),
```

测试要求 renew 小于 TTL 的一半或等于 10 秒/30 秒默认值；无效组合拒绝启动。

- [ ] **Step 2：写真实租约失败测试**

```ts
expect(await primary.acquire()).toBe(true);
expect(await standby.acquire()).toBe(false);
expect(await standby.release()).toBe(false);
await primary.release();
expect(await standby.acquire()).toBe(true);
```

另测错误令牌不能续期、TTL 到期接管和连接断开后停止提交。

- [ ] **Step 3：运行测试并确认失败**

Run: `pnpm exec vitest run packages/realtime-store/src/lease.test.ts apps/ingestor/src/run-live.test.ts`

Expected: FAIL，租约和外部 ingestor 入口尚不存在。

- [ ] **Step 4：实现带令牌租约**

- acquire: `SET key token NX PX ttl`。
- renew/release: Lua 先比较 token 再 `PEXPIRE` 或 `DEL`。
- 续期失败立即使 controller 进入 standby，不再调用 `commitCycle`。

- [ ] **Step 5：实现外部 ingestor**

`startExternalIngestor`：

1. 建立 Redis 连接并竞争租约。
2. 获得租约后运行现有 `runCycle`。
3. ADSBdb 补全完成后写统一 Redis store。
4. 每 10 秒续期；未持有租约时每 5 秒重试。
5. SIGTERM/SIGINT 停止新周期，等待当前周期有界完成，释放租约并关闭连接。

API 内嵌采集暂时保留，Task 7 切换后删除 `live` 装配。

- [ ] **Step 6：真实双实例验证**

同时启动两个 fixture ingestor，断言只有一个实例写入；停止主实例后，待机实例在一个 TTL 周期内接管。

- [ ] **Step 7：记录检查点**

Run: `pnpm exec vitest run packages/realtime-store/src apps/ingestor/src && pnpm typecheck`

Expected: PASS。

### Task 7：API 外部仓库装配、readiness 与运行期降级

**Files:**

- Create: `apps/api/src/external-runtime.ts`
- Create: `apps/api/src/external-runtime.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/start-api.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/routes/map.ts`
- Modify: `apps/api/src/routes/status.ts`
- Modify: `apps/api/src/realtime/broadcaster.ts`
- Modify: `apps/api/src/realtime/socket.ts`
- Modify: `apps/api/src/api.test.ts`

**Interfaces:**

- Produces: `createExternalApiRuntime(config)`、`GET /ready` 和 Redis 事件到 WebSocket 的转换。
- Consumes: Task 4 `PostgresAirportStore`、Task 5 `RedisFlightStore` 与事件订阅。

- [ ] **Step 1：写装配失败测试**

覆盖：

```ts
await expect(createExternalApiRuntime(liveConfigWithoutStores)).rejects.toThrow(
  'EXTERNAL_STORES_REQUIRED',
);
```

另测 `demo` 不创建外部连接，`live` 不调用 `createLiveProviders`，关闭 API 会关闭 pg/Redis 连接。

- [ ] **Step 2：写 readiness 与降级失败测试**

```ts
expect(await app.inject({ method: 'GET', url: '/ready' })).toMatchObject({ statusCode: 200 });
redisHealth.fail();
expect(await app.inject({ method: 'GET', url: '/ready' })).toMatchObject({ statusCode: 503 });
expect(await app.inject({ method: 'GET', url: '/api/v1/search?q=SZX' })).toMatchObject({
  statusCode: 200,
});
```

PostgreSQL 故障时机场接口返回 503 和 `STATIC_DATA_UNAVAILABLE`；Redis 故障时地图接口返回 503 和 `REALTIME_DATA_UNAVAILABLE`。

- [ ] **Step 3：运行测试并确认失败**

Run: `pnpm exec vitest run apps/api/src/external-runtime.test.ts apps/api/src/api.test.ts`

Expected: FAIL，外部装配与 `/ready` 尚不存在。

- [ ] **Step 4：实现 live 外部装配**

- `demo` 沿用 `createApiRuntime`、内存机场索引和 demo 航班。
- `live` 创建 pg pool、PostgresAirportStore、RedisFlightStore 和 subscriber。
- 删除 API `live` 模式的 provider 创建、内嵌 scheduler 和 metadata enricher。
- `/api/v1/map/snapshot` 从 Redis bbox 查询。
- Redis 事件通过现有 hub/broadcaster 分发；订阅重连后重新读取当前快照。

- [ ] **Step 5：实现健康端点**

- `/health` 始终只返回进程状态。
- `/ready` 并行执行 PostgreSQL `SELECT 1`、最新 migration checksum 检查和 Redis `PING`。
- 2 秒内未完成视为 unavailable；响应不含连接地址。

- [ ] **Step 6：运行真实外部 API 集成测试**

Run: `pnpm exec vitest run apps/api/src packages/persistence/src/airport-store.test.ts packages/realtime-store/src`

Expected: PASS。

- [ ] **Step 7：记录检查点**

Run: `pnpm lint && pnpm typecheck && pnpm test`

Expected: PASS。

### Task 8：完整应用镜像与 Compose profile

**Files:**

- Create: `docker/api.Dockerfile`
- Create: `docker/web.Dockerfile`
- Create: `docker/.dockerignore`
- Modify: `apps/web/next.config.ts`
- Modify: `compose.yaml`
- Modify: `package.json`

**Interfaces:**

- Produces: `migrate`、`api`、`ingestor`、`web`、`sync-airports`、`sync-cities` 服务。
- Consumes: Tasks 1–7 的命令、健康端点和环境变量。

- [ ] **Step 1：写镜像结构检查失败测试**

新增 `tests/integration/container-config.test.ts`，解析 Compose YAML 并断言：

- `postgres` 与 `redis` 没有 profile。
- `api|ingestor|web|migrate` 包含 `stack` profile。
- `sync-airports|sync-cities` 包含 `tools` profile。
- API/ingestor 依赖 migrate 成功和中间件 healthy。
- ingestor、migrate、同步任务没有 ports。
- 所有应用服务声明非 root 用户。

- [ ] **Step 2：运行测试并确认失败**

Run: `pnpm exec vitest run tests/integration/container-config.test.ts`

Expected: FAIL，完整栈服务尚未定义。

- [ ] **Step 3：实现 API/ingestor 多阶段镜像**

`docker/api.Dockerfile` 阶段：

1. 使用固定 Node.js 24 LTS slim 基础镜像并启用 Corepack。
2. 复制 workspace manifests，执行 `pnpm fetch`。
3. 复制源码，离线安装并构建相关 workspace。
4. 使用 `pnpm deploy --prod` 生成最小运行目录。
5. 最终阶段创建 UID/GID 10001 的 `hangban` 用户并设置 `USER hangban`。

API 和 ingestor 使用同一镜像，不同 Compose command。

- [ ] **Step 4：实现 Web 多阶段镜像**

启用 Next.js `output: 'standalone'`。最终镜像只复制 `.next/standalone`、`.next/static` 和 `public`，使用非 root 用户，命令为 `node server.js`。

- [ ] **Step 5：补齐 Compose profile 和依赖**

容器内部配置：

```env
DATABASE_URL=postgresql://hangban:${POSTGRES_PASSWORD}@postgres:5432/hangban
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379
API_HOST=0.0.0.0
WEB_ORIGIN=http://127.0.0.1:3000
```

`migrate` 成功退出后 API/ingestor 才启动；Web 等待 API `/ready` 健康。

- [ ] **Step 6：构建并启动完整栈**

Run:

```bash
docker compose --profile stack build
docker compose --profile stack up -d
docker compose ps
curl -fsS http://127.0.0.1:4000/ready
curl -fsS http://127.0.0.1:3000/
```

Expected: 所有常驻服务 healthy；migrate 状态为 exited 0；页面与 readiness 可访问。

- [ ] **Step 7：验证工具 profile**

Run:

```bash
docker compose --profile tools run --rm sync-airports
docker compose --profile tools run --rm sync-cities
```

Expected: 两个任务退出码 0，不创建常驻容器或开放端口。

- [ ] **Step 8：记录检查点**

Run: `pnpm exec vitest run tests/integration/container-config.test.ts && pnpm build`

Expected: PASS。

### Task 9：真实中间件测试编排与 E2E 切换

**Files:**

- Create: `tests/integration/setup.ts`
- Create: `tests/integration/postgres.test.ts`
- Create: `tests/integration/redis.test.ts`
- Create: `tests/fixtures/seed-external.ts`
- Create: `scripts/verify-with-infra`
- Modify: `playwright.config.ts`
- Modify: `package.json`
- Modify: `.codebuddy/rules/testing.mdc`

**Interfaces:**

- Produces: `pnpm test:integration`、`pnpm e2e:external`、更新后的 `pnpm verify`。
- Consumes: `compose.test.yaml`、migration、fixture seed 和完整外部 API。

- [ ] **Step 1：实现隔离测试编排脚本**

`scripts/verify-with-infra`：

1. 使用唯一 `COMPOSE_PROJECT_NAME=hangban-test-$$`。
2. `docker compose -f compose.test.yaml up -d --wait`。
3. 导出测试 `DATABASE_URL` 和 `REDIS_URL`。
4. 运行 migration 和 fixture seed。
5. 运行集成测试、build 和外部 E2E。
6. `trap` 中执行 `docker compose ... down -v --remove-orphans`。

任何步骤失败也必须清理测试容器和卷。

- [ ] **Step 2：写集成测试**

PostgreSQL 测试必须覆盖：

- migration 从空库执行和重复执行。
- 事务导入与失败回滚。
- `深圳|shenzhen|SZX|ZGSZ` 搜索。
- bbox 和 PostGIS 索引查询。

Redis 测试必须覆盖：

- snapshot、TTL、GEO bbox 和失效删除。
- Pub/Sub 顺序与无效事件隔离。
- 两实例租约竞争和接管。

- [ ] **Step 3：实现 E2E fixture seed**

`seed-external.ts` 向 PostgreSQL 导入 testkit 机场/城市，向 Redis 写入 testkit 航班和来源状态。不得访问 ADSB.lol、OpenSky、Airplanes.live 或 ADSBdb。

- [ ] **Step 4：切换 Playwright 外部模式**

`playwright.config.ts` 的 webServer 使用：

```bash
DATA_MODE=live pnpm start:e2e
```

环境指向测试 PostgreSQL/Redis。现有桌面与手机流程保持不变，并增加 Redis 中断时的实时不可用 E2E；PostgreSQL 中断测试放在 API 集成层，避免并行 E2E 破坏共享环境。

- [ ] **Step 5：更新根门禁**

根脚本：

```json
{
  "test:unit": "vitest run --exclude tests/integration/**",
  "test:integration": "vitest run tests/integration",
  "e2e:external": "playwright test",
  "verify": "scripts/verify-with-infra"
}
```

Docker 不可用时输出 `DOCKER_REQUIRED_FOR_VERIFY` 并退出 1，不静默跳过真实中间件测试。

- [ ] **Step 6：运行完整门禁**

Run: `pnpm verify`

Expected: lint、typecheck、单元测试、真实 PostgreSQL/Redis 集成测试、build、桌面和手机 E2E 全部 PASS；结束后没有 `hangban-test-*` 容器或卷。

- [ ] **Step 7：记录检查点**

Run: `docker ps -a --filter name=hangban-test && docker volume ls --filter name=hangban-test`

Expected: 无残留测试资源。

### Task 10：文档、故障演练与最终验收

**Files:**

- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/AGENTS.md`
- Modify: `docs/architecture.md`
- Modify: `.env.example`
- Modify: this plan

**Interfaces:**

- Produces: 可复现的开发、完整栈、迁移、同步、测试和故障恢复说明。
- Consumes: Tasks 1–9 的最终命令与运行行为。

- [ ] **Step 1：更新当前实现状态**

文档明确区分：

- `demo` 内存实现。
- `live` PostgreSQL/PostGIS + Redis + 独立 ingestor。
- 日常中间件模式与完整容器模式。
- 静态同步和实时采集职责。
- Redis 8 许可证复核要求。

- [ ] **Step 2：记录标准运行命令**

README 提供：

```bash
pnpm infra:up
pnpm db:migrate
pnpm data:db:sync
pnpm dev
pnpm dev:ingestor
docker compose --profile stack up --build
docker compose --profile tools run --rm sync-airports
docker compose --profile tools run --rm sync-cities
pnpm verify
```

- [ ] **Step 3：执行 Redis 故障演练**

1. 完整栈健康时验证机场和实时接口。
2. `docker compose stop redis`。
3. 验证 `/ready` 为 503、机场查询仍成功、实时接口返回 `REALTIME_DATA_UNAVAILABLE`。
4. `docker compose start redis`。
5. 验证 API 重连、ingestor 重新竞争租约、实时数据恢复且无 demo 数据混入。

- [ ] **Step 4：执行 PostgreSQL 故障演练**

1. `docker compose stop postgres`。
2. 验证 `/ready` 为 503，机场接口返回 `STATIC_DATA_UNAVAILABLE`，Redis 实时分发短时继续。
3. 恢复 PostgreSQL 后验证连接池恢复和搜索正常。

- [ ] **Step 5：执行卷持久化验证**

Run:

```bash
docker compose restart postgres redis
```

Expected: migration、机场/城市数量和 Redis AOF 状态在重启后保留。

- [ ] **Step 6：执行最终门禁**

Run:

```bash
pnpm verify
pnpm format:check
docker compose --profile stack config --quiet
```

Expected: 全部 PASS。

- [ ] **Step 7：完成计划自检**

逐项核对规格 14 节的 10 条验收条件，在本计划对应步骤旁记录实际命令、记录数、测试数量和故障恢复结果。不得用「已实现」替代可复现证据。

## 计划自检

- Tasks 1–2 覆盖 Compose、中间件健康、连接配置和 SQL migration。
- Tasks 3–4 覆盖静态数据导入、PostGIS bbox 和全球搜索。
- Tasks 5–6 覆盖 Redis 快照、GEO、Pub/Sub、租约和独立 ingestor。
- Task 7 覆盖 API 外部装配、readiness 和运行期降级。
- Task 8 覆盖完整容器模式及一次性同步任务。
- Task 9 覆盖真实中间件测试和 E2E。
- Task 10 覆盖文档、故障演练、持久化和最终验收。
- MinIO、可观测平台、Kubernetes、长期轨迹和机场多语言新来源未进入隐藏范围。

## 实施记录

- PostgreSQL/PostGIS 已迁移并导入 32,538 个机场、234,888 个城市；迁移重复执行结果为 `applied=0, skipped=1`。
- Redis 已实现原子航班周期、GEO bbox、日期变更线拆分、TTL、来源状态、Pub/Sub 校验和带令牌租约。
- `live` API 不再内嵌供应商采集；独立 ingestor 负责融合、ADSBdb 补全、Redis 提交和租约续期。
- 完整 Compose 实际启动成功：migrate 退出码 0，API、Web、PostgreSQL 和 Redis healthy，ingestor 常驻运行。
- 最终隔离完整门禁通过：294 项单元测试、9 项真实中间件集成测试、17 项桌面/手机 E2E 通过，1 项按项目视口规则跳过；lint、typecheck、build 和 `format:check` 均通过。
- Redis 故障演练：`/ready=503`、地图快照 `503`、机场搜索 `200`；恢复后 `/ready=200`。
- PostgreSQL 故障演练首次发现空闲连接未监听导致进程退出；修复后结果为 `/ready=503`、地图快照 `200`、机场搜索 `503`，恢复后 Hongqiao 查询返回 SHA。
- PostgreSQL 与 Redis 停止、启动后数据和迁移仍保留，验证了开发卷持久化。
- `sync-airports` 与 `sync-cities` 工具 profile 均实际退出 0；城市任务支持只读挂载 `data/import` 中已下载的 GeoNames 归档，避免重复下载约 200 MB 文件，最终导入 32,538 个机场和 234,888 个城市。
