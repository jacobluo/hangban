# 航迹

「航迹」是面向公众的全球实时航班 Web 站点。当前 MVP 提供实时地图、航班搜索与详情、机场探索、机场周边航班和航线探索，不包含账号体系、机场时刻表或延误预测。

## 本地运行

环境要求：

- Node.js 24 LTS 或兼容版本。
- pnpm 10。
- Docker Compose，用于 `live` 中间件、完整容器模式和完整验证。
- Chromium，用于 Playwright 端到端测试。

安装依赖后，可按需要启动演示模式或真实数据模式。

### 演示模式

```bash
pnpm install
pnpm dev
```

Web 开发服务固定使用 Next.js webpack 模式。当前 Node 25 环境下 Turbopack 冷启动会出现持续高 CPU 和分钟级首屏等待；该设置只影响 `pnpm dev`，不改变生产构建与启动方式。

默认地址：

- Web：`http://127.0.0.1:3000`
- API：`http://127.0.0.1:4000`
- API 健康检查：`http://127.0.0.1:4000/health`

默认 `DATA_MODE=demo`，使用确定性的演示航班和机场数据，不访问第三方服务。API 每 10 秒推进一次演示航班位置。

生产环境应设置 `NEXT_PUBLIC_MAP_STYLE_URL` 指向自有或已获授权的 MapLibre 样式服务；留空时使用的 OpenStreetMap 公共栅格底图仅用于本地开发与演示。

### 真实数据模式

日常开发使用本机 Node.js 进程和容器中间件：

```bash
pnpm install
pnpm infra:up
pnpm db:migrate
pnpm data:db:sync
pnpm dev
pnpm dev:ingestor
```

`.env` 中设置 `DATA_MODE=live`、`DATABASE_URL`、`REDIS_URL` 和供应商配置。`live` 强制使用 PostgreSQL/PostGIS 保存机场与城市静态数据，使用 Redis 保存实时航班、空间索引、来源状态和增量事件；缺少中间件时拒绝启动，不回退到 `demo`。独立 ingestor 是唯一实时航班写入者，API 不再访问第三方航班数据源。

完整容器模式：

```bash
docker compose --profile stack up --build
docker compose --profile tools run --rm sync-airports
docker compose --profile tools run --rm sync-cities
```

`postgres` 与 `redis` 默认启动；`stack` 包含 migrate、API、ingestor 和 Web，`tools` 是一次性静态同步任务。PostgreSQL 与 Redis 端口只绑定 `127.0.0.1`。Redis 8 用于当前本地与生产基线，正式部署前仍需按部署和分发方式复核其许可证。

机场和城市同步命令先下载、校验并写入临时文件，成功后才替换目标文件。OurAirports 提供机场主数据；GeoNames 提供中文、英文和 ASCII 城市别名。下载、解析或校验失败时保留上一版本。相对数据路径以应用根目录解析。

GeoNames 多语言别名压缩包约 200 MB，默认同步超时为 4 小时。网络较快或较慢时可通过 `GEONAMES_SYNC_TIMEOUT_MS` 调整；失败日志中的 `reason` 是脱敏后的稳定原因码。

免费数据源存在覆盖范围、请求频率和使用条款限制，世界视野不代表完整全球覆盖。ADSBdb 起终点属于公开路线信息推断，不作为官方飞行计划展示。

真实来源冒烟测试会访问公网，只检查 `LIVE_DEFAULT_BBOXES` 生成的一个小范围采集单元：

```bash
DATA_MODE=live \
LIVE_PROVIDERS=adsb-lol \
LIVE_DEFAULT_BBOXES=116,39,117,40 \
pnpm smoke:live
```

该命令不属于默认 `pnpm verify`。通过条件是：至少一个启用来源在本轮完成真实上游请求，且所有启用来源本轮合计解析出至少 1 条航班记录。仅获得成功但为空的响应不会通过。失败输出稳定错误码，不输出凭证或上游响应正文。

## 常用命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
pnpm verify
pnpm format:check
pnpm data:airports:sync
pnpm data:cities:sync
pnpm db:migrate
pnpm data:db:sync
pnpm infra:up
pnpm dev:ingestor
pnpm smoke:live
```

`pnpm verify` 要求 Docker 可用，会创建唯一命名的隔离 PostgreSQL/PostGIS 与 Redis，执行迁移和 fixture 导入，再运行 lint、类型检查、单元测试、真实中间件集成测试、生产构建及桌面/手机 E2E。脚本退出时自动清理测试容器和卷，不访问航班数据供应商公网。

## Workspace

```text
apps/web/          Next.js 与 MapLibre 界面
apps/api/          Fastify HTTP 与 WebSocket 服务
apps/ingestor/     数据采集进程
packages/contracts/ 统一 Zod 契约
packages/domain/   融合、空间和航线逻辑
packages/adapters/ 第三方数据源适配器
packages/ingestion/ 采集范围、调度、融合周期和来源状态
packages/config/   环境配置校验
packages/persistence/ PostgreSQL/PostGIS 客户端、迁移和机场仓库
packages/realtime-store/ Redis 航班状态、事件和租约
packages/testkit/  确定性演示数据
tests/e2e/         Playwright 用户流程
docs/              产品、架构和 User Case
```

## 数据边界

- 浏览器只访问本项目 API 和 WebSocket，不直接访问航班数据供应商。
- ADSB.lol、OpenSky、Airplanes.live、ADSBdb、OurAirports 和 GeoNames 位于服务端适配器或同步边界之后。
- API 根据 `DATA_MODE` 选择内存演示运行时或外部存储运行时，只有 `demo` 推进演示航班位置。
- `live` 模式的单次请求失败不会用空集合覆盖上次成功航班；数据状态展示最近一次请求结果和最后成功时间。
- 生产接入前必须复核供应商条款、配额、认证和再分发限制。
- 机场周边航班不等于到港或离港班次。
- 航线匹配不等于官方完整班次表。

## 环境变量

参考 [`.env.example`](.env.example)。浏览器可见配置只允许公开的本项目 API 地址，不得包含供应商密钥。

| 配置                                                  | 作用                                                           |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| `DATA_MODE`                                           | 只接受 `demo` 或 `live`，默认 `demo`。                         |
| `LIVE_PROVIDERS`                                      | 逗号分隔的数据源：`adsb-lol`、`airplanes-live`、`opensky`。    |
| `LIVE_DEFAULT_BBOXES`                                 | 分号分隔的边界框，每项为 `west,south,east,north`。             |
| `DATABASE_URL`、`REDIS_URL`                           | `live` 必需的 PostgreSQL/PostGIS 与 Redis 连接。               |
| `DATABASE_POOL_MAX`、`REDIS_KEY_PREFIX`               | 数据库连接池上限与 Redis 键前缀。                              |
| `INGEST_INTERVAL_MS`                                  | 独立 ingestor 的轮询间隔。                                     |
| `INGESTOR_LEASE_TTL_MS`、`INGESTOR_LEASE_RENEW_MS`    | ingestor 主实例租约及续期间隔。                                |
| `PROVIDER_TIMEOUT_MS`                                 | 单个数据源请求超时。                                           |
| `PROVIDER_CACHE_TTL_MS`                               | 相同来源与采集单元的缓存时间。                                 |
| `ADSB_LOL_BASE_URL`、`AIRPLANES_LIVE_BASE_URL`        | readsb 数据源的服务端基础 URL。                                |
| `OPENSKY_BASE_URL`、`OPENSKY_TOKEN_URL`               | OpenSky API 与 OAuth 2.0 Token 地址。                          |
| `OPENSKY_CLIENT_ID`、`OPENSKY_CLIENT_SECRET`          | 可选 OpenSky OAuth 2.0 凭证，必须同时设置或同时省略。          |
| `AIRPORTS_DATA_PATH`                                  | 机场 JSON 文件的读取和同步目标路径；相对路径以应用根目录解析。 |
| `OURAIRPORTS_CSV_URL`                                 | OurAirports CSV 下载地址。                                     |
| `GEONAMES_CITIES_URL`、`GEONAMES_ALTERNATE_NAMES_URL` | GeoNames 城市和多语言别名下载地址。                            |
| `GEONAMES_DATA_PATH`                                  | 城市别名 JSON 文件路径。                                       |
| `GEONAMES_SYNC_TIMEOUT_MS`                            | GeoNames 批量同步超时，默认 `14400000`（4 小时）。             |
| `ADSBDB_BASE_URL`                                     | ADSBdb 服务端基础 URL。                                        |
| `ADSBDB_CONCURRENCY`、`ADSBDB_TIMEOUT_MS`             | ADSBdb 有界并发和请求超时。                                    |
| `ADSBDB_*_CACHE_TTL_MS`                               | 航空器、路线和失败结果缓存时间。                               |

OpenSky 未配置凭证时使用匿名请求。供应商凭证只允许存在于服务端环境变量或密钥系统，不得写入浏览器配置、文档、日志或提交文件。

## 项目文档

- [产品与界面设计](docs/product-design.md)
- [生产架构设计](docs/architecture.md)
- [User Case](docs/user-cases.md)
- [MVP 实施规格](docs/superpowers/specs/2026-07-11-flight-tracker-mvp-design.md)
- [MVP 实施计划](docs/superpowers/plans/2026-07-11-flight-tracker-mvp.md)
- [真实数据接入规格](docs/superpowers/specs/2026-07-11-real-data-ingestion-design.md)
- [真实数据接入计划](docs/superpowers/plans/2026-07-11-real-data-ingestion.md)
- [机场与航班信息补全规格](docs/superpowers/specs/2026-07-12-airport-flight-enrichment-design.md)
- [机场与航班信息补全计划](docs/superpowers/plans/2026-07-12-airport-flight-enrichment.md)
