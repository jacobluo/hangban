# 生产持久化与完整容器设计

## 1. 目标

本阶段把当前单实例内存实现改造为可在本地复现的生产持久化结构，并提供两种运行方式：

- 日常开发只使用容器运行 PostgreSQL/PostGIS 与 Redis，应用在宿主机保持热更新。
- 集成测试、演示和生产预演使用 Docker Compose 运行完整应用栈。

`live` 模式必须实际读写 PostgreSQL/PostGIS 与 Redis。`demo` 模式继续使用内存实现，不要求 Docker。首期容量目标仍为约 1,000 个并发连接和 10 秒级位置更新；该目标需要后续负载测试证明。

## 2. 范围

### 2.1 本阶段包含

- PostgreSQL 17 + PostGIS 3.5 本地容器、健康检查和持久化卷。
- Redis 8.8 本地容器、密码、健康检查和持久化卷。
- 版本化 SQL migration 和显式迁移命令。
- 机场、城市和别名的 PostgreSQL 数据模型、事务导入与查询 Repository。
- 航班快照、空间索引、来源状态、分布式锁和 Pub/Sub 的 Redis 实现。
- 独立 ingestor 写入 Redis，API 从 PostgreSQL 与 Redis 读取数据。
- API readiness、运行期降级和稳定错误语义。
- API、ingestor、Web、多阶段镜像及完整 Compose profile。
- 使用真实 PostgreSQL/PostGIS 与 Redis 的集成测试和 E2E。

### 2.2 暂不包含

- MinIO 或其他对象存储。
- Prometheus、Grafana、Loki、Jaeger 或托管可观测平台。
- Kubernetes、云负载均衡器和多区域部署。
- 长期航班轨迹仓库、数据湖或分析数据库。
- 账号、权限或后台管理界面。
- 机场多语言名称的新外部数据源；本阶段只迁移现有 OurAirports 与 GeoNames 数据能力。

## 3. 技术选型

### 3.1 PostgreSQL/PostGIS

本地镜像固定为 `postgis/postgis:17-3.5`。该版本使用 PostgreSQL 17、PostGIS 3.5 和传统数据卷路径 `/var/lib/postgresql/data`。Compose 不使用 `latest` 或 `master` 标签。

官方镜像当前只发布 `linux/amd64`，因此 ARM64 开发机通过 Compose `platform: linux/amd64` 使用 Docker Desktop 模拟运行。生产部署也使用同一架构镜像，避免本地与生产采用不同 PostGIS 发行版。

应用使用 `pg` 连接池和显式 SQL，不引入 ORM。空间查询、批量 upsert 和索引行为保持可见，避免 ORM 对 PostGIS 类型和函数的限制。

### 3.2 Redis

本地镜像固定为 `redis:8.8.0-alpine`。Redis 8 采用多许可证模式，生产部署前需要完成许可证复核。本阶段不使用 Redis Stack 模块。

应用使用官方 Node.js Redis 客户端。普通命令、Pub/Sub 和分布式锁使用独立连接，避免订阅连接阻塞普通命令。

### 3.3 迁移

迁移文件为按序号排列的 SQL 文件，由项目内迁移执行器通过 `pg` 执行。执行器使用 PostgreSQL advisory lock 防止并发迁移，并在 `schema_migrations` 中保存文件名和 SHA-256 校验值。已经执行的迁移文件不得修改。

生产进程不在启动时自动迁移。`migrate` 一次性容器或 `pnpm db:migrate` 必须先成功，API 与 ingestor 才能启动。

## 4. 代码边界

新增两个 workspace 包：

```text
packages/
  persistence/
    migrations/          # 版本化 SQL
    src/client.ts        # pg 连接池与健康检查
    src/migrate.ts       # 迁移执行器
    src/airport-store.ts # 机场、城市、搜索和 bbox 查询
    src/static-sync.ts   # staging 与事务导入
  realtime-store/
    src/client.ts        # Redis 普通、订阅和发布连接
    src/flight-store.ts  # 航班快照、GEO 与来源状态
    src/events.ts        # 增量事件发布与订阅
    src/lease.ts         # ingestor 分布式租约
```

现有 Repository 接口继续作为业务层端口。内存实现供 `demo` 和单元测试使用；PostgreSQL 与 Redis 实现只存在于基础设施包。浏览器仍只访问本项目 API 与 WebSocket。

## 5. PostgreSQL 数据模型

启用以下扩展：

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

### 5.1 `cities`

- `geonames_id bigint PRIMARY KEY`
- `name text NOT NULL`
- `ascii_name text NOT NULL`
- `localized_name text`
- `country char(2) NOT NULL`
- `population bigint NOT NULL CHECK (population >= 0)`
- `location geography(Point, 4326) NOT NULL`
- `source_updated_at timestamptz`
- `imported_at timestamptz NOT NULL`

`location` 使用 GiST 索引；国家和规范化名称使用组合索引。

### 5.2 `city_aliases`

- `geonames_id bigint REFERENCES cities ON DELETE CASCADE`
- `alias text NOT NULL`
- `normalized_alias text NOT NULL`
- `source text NOT NULL`
- `PRIMARY KEY (geonames_id, normalized_alias)`

`normalized_alias` 使用 trigram GIN 索引。

### 5.3 `airports`

- `airport_key text PRIMARY KEY`
- `iata char(3)`
- `icao varchar(4)`
- `name text NOT NULL`
- `city text NOT NULL`
- `localized_city text`
- `country char(2) NOT NULL`
- `elevation_m integer`
- `airport_type text NOT NULL`
- `location geography(Point, 4326) NOT NULL`
- `source text NOT NULL`
- `source_updated_at timestamptz`
- `imported_at timestamptz NOT NULL`

`airport_key` 优先使用 ICAO，其次使用 IATA；无代码机场使用来源、国家、名称和坐标生成确定性 SHA-256 键。IATA 和 ICAO 建立条件唯一索引，`location` 建立 GiST 索引。

### 5.4 `airport_aliases`

- `airport_key text REFERENCES airports ON DELETE CASCADE`
- `alias text NOT NULL`
- `normalized_alias text NOT NULL`
- `source text NOT NULL`
- `PRIMARY KEY (airport_key, normalized_alias)`

本阶段写入现有英文名称、代码、城市名称与现有城市别名。新增机场中文名称来源需要单独设计，不在本规格内。

## 6. 静态数据导入

`sync-airports` 和 `sync-cities` 是一次性任务，不进入实时采集周期。

每次导入执行以下步骤：

1. 下载或读取指定输入文件。
2. 在应用边界执行契约校验。
3. 使用 `COPY` 或有界批次写入 staging 表。
4. 在单个事务内 upsert 正式表和别名表。
5. 删除同一来源中本轮已不存在的记录。
6. 更新数据版本、记录数、来源时间和导入时间。
7. 提交后发布静态数据版本更新事件。

任一步骤失败时回滚事务并保留上一版本。API 不主动下载静态数据。

建议同步频率：机场每天或每周一次，GeoNames 城市和别名每周一次。

## 7. Redis 数据模型

所有键使用可配置前缀，默认 `hangban`：

```text
hangban:flight:<id>
hangban:flights:geo
hangban:flights:active
hangban:source-statuses
hangban:events
hangban:lock:ingestor
```

- 航班记录保存统一 `Flight` JSON，并设置有界 TTL。
- `hangban:flights:geo` 使用 Redis GEO 保存经纬度。
- `hangban:flights:active` 保存当前有效航班 ID。
- 来源状态保存统一 `SourceStatus` JSON。
- `hangban:events` 只发布 `flight.upsert`、`flight.remove` 和 `source.status` 等增量事件。
- `hangban:lock:ingestor` 使用带令牌的租约；续期和释放必须校验令牌。

单轮采集结果通过 Lua 或等价原子事务提交：写入航班、更新 GEO、移除失效成员、更新来源状态并发布变化事件。Pub/Sub 不承担持久日志；API 重连后从当前 Redis 状态重建快照。

## 8. 应用数据流

### 8.1 ingestor

独立 ingestor 是 `live` 模式唯一的实时航班写入者：

1. 竞争 Redis 分布式租约。
2. 规划采集范围并调用 ADSB.lol、OpenSky 和 Airplanes.live。
3. 执行限速、缓存、退避、规范化、去重和融合。
4. 使用 ADSBdb 补齐允许的缺失元数据。
5. 原子写入 Redis 快照、GEO 索引和来源状态。
6. 发布增量事件并续期租约。

未取得租约的实例保持待机。持有租约期间失去 Redis 连接时，不提交本轮结果；重连后重新竞争租约。

### 8.2 API

- 机场搜索、详情和 bbox 查询读取 PostgreSQL/PostGIS。
- 首次航班快照使用 Redis `GEOSEARCH BYBOX`。
- API 订阅 Redis Pub/Sub，并按各 WebSocket 订阅 bbox 过滤事件。
- API 不再直接调用航班供应商。
- Redis 暂时不可用时，机场查询继续使用 PostgreSQL；实时接口返回稳定不可用状态。
- PostgreSQL 暂时不可用时，实时 WebSocket 可短时继续，机场查询返回稳定错误码。

## 9. 模式与配置

`demo` 使用内存 Repository，不要求数据库环境变量。`live` 必须配置：

```env
DATABASE_URL=postgresql://hangban:password@127.0.0.1:5432/hangban
REDIS_URL=redis://:password@127.0.0.1:6379
DATABASE_POOL_MAX=10
REDIS_KEY_PREFIX=hangban
```

`live` 缺少连接配置、数据库版本落后或启动时中间件不可用时，进程拒绝启动，不静默切换到 `demo`。连接 URL、密码、原始 SQL 参数和供应商凭证不得写入日志。

## 10. 健康与降级

- `GET /health` 只表示 API 进程存活。
- `GET /ready` 检查 PostgreSQL 连接、schema 版本和 Redis ping。
- Compose 使用 `pg_isready` 和 `redis-cli ping` 判断中间件健康。
- PostgreSQL 或 Redis 在启动时不可用，`live` API 和 ingestor 启动失败。
- 运行期依赖异常使 readiness 失败，但保留仍可工作的能力，不返回 demo 数据。
- 所有重连使用有上限的指数退避。

## 11. Docker Compose

### 11.1 服务

```text
postgres
redis
migrate
api
ingestor
web
sync-airports
sync-cities
```

PostgreSQL 和 Redis 不设置 profile，供日常开发直接启动。`migrate`、`api`、`ingestor` 和 `web` 使用 `stack` profile；静态同步任务使用 `tools` profile。

### 11.2 日常开发

```bash
docker compose up -d postgres redis
pnpm db:migrate
pnpm dev
pnpm dev:ingestor
```

应用在宿主机运行，保留 TypeScript 和 Next.js 热更新。

### 11.3 完整容器模式

```bash
docker compose --profile stack up --build
```

启动依赖：PostgreSQL 与 Redis 先健康，`migrate` 成功退出，随后启动 API 与 ingestor；API readiness 成功后启动 Web。

### 11.4 静态同步任务

```bash
docker compose --profile tools run --rm sync-airports
docker compose --profile tools run --rm sync-cities
```

同步任务不暴露端口。

### 11.5 镜像要求

- API 和 ingestor 可以复用 workspace 基础镜像，但使用不同命令。
- Web 使用独立多阶段 Dockerfile 和 Next.js production output。
- 最终镜像使用非 root 用户，不包含开发依赖、测试产物、`.env`、原始 ZIP 或 pnpm store。
- 开发端口只绑定 `127.0.0.1`：Web 为 3000，API 为 4000，PostgreSQL 为 5432，Redis 为 6379。
- ingestor、migrate 和同步任务不暴露端口。

## 12. 测试策略

- 单元测试继续使用内存实现或注入式 fake，不要求 Docker。
- PostgreSQL 集成测试覆盖 migration、事务、批量 upsert、中文搜索、同名城市消歧和 `ST_Intersects`。
- Redis 集成测试覆盖 TTL、GEO bbox、原子快照、失效删除、Pub/Sub 和租约竞争。
- API 集成测试使用真实 PostgreSQL/PostGIS 与 Redis，覆盖 `/ready` 和运行期降级。
- E2E 使用真实中间件和 fixture 航班来源，不访问公网供应商。
- `pnpm verify` 在 Docker 可用时启动独立测试容器和临时卷，完成后清理。
- `pnpm smoke:live` 仍是默认门禁之外唯一访问公网供应商的命令。

测试 Compose 使用独立 project name、端口和临时卷，不读取日常开发数据库。

## 13. 安全与运维约束

- PostgreSQL 和 Redis 只绑定本机地址或容器内部网络。
- Redis 必须配置密码，不允许匿名访问。
- SQL 全部参数化，外部输入继续使用运行时 schema 校验。
- `.env`、数据库卷、Redis 卷和原始同步文件不得提交。
- 提供 `infra:up`、`infra:down`、`infra:status` 和 `infra:logs`。
- `infra:reset` 会删除本地数据库和 Redis 数据，必须使用显式确认参数，不作为普通开发命令的隐式步骤。
- 数据库迁移、静态同步和应用日志使用稳定错误码，不记录 secret。

## 14. 验收条件

1. `docker compose up -d postgres redis` 后两个服务健康，数据卷在重启后保留。
2. `pnpm db:migrate` 可在空数据库完成迁移，重复运行不产生变化。
3. `pnpm data:db:sync` 可导入当前 32,538 条机场和 234,888 条城市记录。
4. PostgreSQL 可按 bbox 查询机场，并支持 `深圳`、`shenzhen`、`SZX`、`ZGSZ` 搜索。
5. 独立 ingestor 可把 fixture 航班写入 Redis，API 可读取快照并接收增量。
6. 第二个 ingestor 无法同时取得相同租约；主实例停止后待机实例可接管。
7. `docker compose --profile stack up --build` 可启动完整应用栈。
8. Redis 运行期中断时机场查询继续，实时状态明确不可用；恢复后可重新订阅。
9. PostgreSQL 运行期中断时机场接口返回稳定错误码，实时分发可短时继续。
10. `pnpm verify` 使用真实测试中间件完成集成测试和 E2E，不访问公网供应商。
