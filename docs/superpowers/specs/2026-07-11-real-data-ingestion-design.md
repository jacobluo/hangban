# 真实航班与机场数据接入设计

## 1. 目标

在现有数据适配层、融合逻辑、内存仓库和 WebSocket 分发能力之上，接入可配置的真实航班位置与机场静态数据。

本阶段完成以下结果：

- `demo` 模式继续提供稳定的本地开发与自动化测试数据。
- `live` 模式只展示真实数据，不自动混入或切换到演示航班。
- ADSB.lol 和 Airplanes.live 可匿名启用。
- OpenSky 支持匿名访问，也支持可选的 OAuth 2.0 Client Credentials。
- OurAirports 数据可通过独立命令同步、校验并安全替换。
- 单个数据源失败不影响其他来源；全部来源失败时保留最后成功数据，并持续更新来源状态。
- 默认自动化测试不访问公网；真实来源通过显式冒烟命令验证。

## 2. 已确认边界

### 2.1 数据模式

只保留两种运行模式：

| 模式   | 行为                                   |
| ------ | -------------------------------------- |
| `demo` | 只启用演示数据和演示运动逻辑           |
| `live` | 只启用已配置的真实来源，不注入演示航班 |

`live` 模式不会自动修改为 `demo`。全部真实来源不可用时：

1. 保留最后一次成功写入的航班。
2. 根据数据年龄将航班标记为延迟或过期。
3. 更新各来源的最近请求状态和安全错误摘要。
4. 从未获得成功快照时返回空航班集合，机场静态数据继续可用。

### 2.2 免费接口的覆盖限制

ADSB.lol 和 Airplanes.live 的公开端点以中心点和最大 250 海里半径查询为主，不适合按固定周期拉取完整全球快照。Airplanes.live 免费接口还有明确的请求频率和每日额度限制。

因此，本阶段采用视野驱动采集：

- 根据活跃 WebSocket 地图视野生成采集单元。
- 对相邻和重复视野进行空间网格归并。
- 为每个供应商分别执行限速、缓存和退避。
- 世界级低缩放视野只展示已缓存的真实数据和当前覆盖状态。
- 不把局部覆盖描述为完整全球覆盖。

免费接口不能承诺全球航班每 10 秒完整更新。达到该目标前，需要与供应商确认生产授权、feeder 访问或商业数据服务。

### 2.3 UI 边界

本阶段复用已确认的数据状态面板，不调整页面结构和视觉样式。状态面板继续展示来源、健康状态、最近成功时间和错误说明。新增 UI 或状态布局前，必须先更新 Ardot 原型图并完成设计确认。

## 3. 数据源设计

### 3.1 ADSB.lol

使用公开的 `/v2/lat/{lat}/lon/{lon}/dist/{radius}` 端点。

适配器负责：

- 将查询边界转换为不超过 250 海里的中心点查询。
- 解析秒或毫秒时间戳。
- 处理可空坐标、空呼号、地面高度和供应商哨兵值。
- 转换英尺、节和英尺每分钟到统一单位。
- 保留注册号和机型等统一模型支持的字段。
- 将 HTTP 429、超时、无效 JSON 和响应校验失败转换为稳定错误码。

ADSB.lol 数据按 ODbL 使用。生产接入前需要确认署名、再分发和稳定性安排。

### 3.2 Airplanes.live

使用公开的 `/v2/point/{lat}/{lon}/{radius}` 端点，半径不超过 250 海里。

Airplanes.live 与 ADSB.lol 的响应形态相近，但适配器保持独立的供应商标识、端点配置和契约样本。单个进程的默认最小请求间隔设为 180 秒，使持续运行的基础请求量不超过每日 480 次；配置不得突破官方每秒 1 次的频率上限。

### 3.3 OpenSky

使用 `/api/states/all`，按边界提交 `lamin`、`lomin`、`lamax` 和 `lomax`。

认证方式：

- 未配置凭证时使用匿名请求，并遵守较低配额。
- 同时配置 Client ID 和 Client Secret 时，使用 OAuth 2.0 Client Credentials 获取 Bearer Token。
- Token 缓存在服务端内存中，并在过期前刷新。
- 收到 401 时清除 Token，重新获取一次并重试原请求。
- 凭证不得进入浏览器、日志、测试 fixture 或文档示例值。

OpenSky 状态数组按官方字段位置进行校验。缺少有效 ICAO 24 位地址、呼号或坐标的记录不进入融合候选集。

### 3.4 OurAirports

机场同步读取 OurAirports 每晚更新的 `airports.csv`。该数据集为 Public Domain。

导入条件：

- 排除 `closed_airport`、`heliport`、`seaplane_base` 和 `balloonport`。
- 坐标必须位于合法经纬度范围。
- 至少具有有效 IATA 或 ICAO 代码。
- 导入 `large_airport`、`medium_airport` 和 `small_airport`，并允许通过配置只保留有定期服务或中大型机场。

字段映射：

| OurAirports 字段          | 统一机场字段 |
| ------------------------- | ------------ |
| `iata_code`               | `iata`       |
| `icao_code` 或 `gps_code` | `icao`       |
| `name`                    | `name`       |
| `municipality`            | `city`       |
| `iso_country`             | `country`    |
| `latitude_deg`            | `latitude`   |
| `longitude_deg`           | `longitude`  |
| `elevation_ft`            | `elevationM` |
| `type`                    | `type`       |

同步流程采用「下载到临时文件 → CSV 解析 → 运行时校验 → 数量下限检查 → 原子替换」。任何步骤失败时保留上次成功文件。

## 4. 模块边界

### 4.1 `packages/config`

配置层负责解析并验证：

- `DATA_MODE`
- `LIVE_PROVIDERS`
- `LIVE_DEFAULT_BBOXES`
- `INGEST_INTERVAL_MS`
- `PROVIDER_TIMEOUT_MS`
- `PROVIDER_CACHE_TTL_MS`
- `ADSB_LOL_BASE_URL`
- `AIRPLANES_LIVE_BASE_URL`
- `OPENSKY_BASE_URL`
- `OPENSKY_TOKEN_URL`
- `OPENSKY_CLIENT_ID`
- `OPENSKY_CLIENT_SECRET`
- `AIRPORTS_DATA_PATH`
- `OURAIRPORTS_CSV_URL`

OpenSky Client ID 与 Client Secret 必须同时提供或同时省略。`live` 模式至少需要启用一个真实来源。

### 4.2 `packages/adapters`

适配器包增加以下独立模块：

- Provider factory：根据配置创建启用的数据源。
- OAuth Token provider：负责 OpenSky Token 获取、缓存和刷新。
- 请求调度器：按供应商执行最小请求间隔、超时和退避。
- 空间采集计划：将边界转换为受限半径查询单元。
- OurAirports CSV parser：将单行外部数据转换为统一机场模型。

适配器只处理供应商认证、请求、响应校验和字段转换，不承担跨来源融合或仓库存储。

### 4.3 `apps/api`

API 启动时根据模式选择运行方式：

- `demo`：使用现有演示仓库种子和 10 秒运动逻辑。
- `live`：机场使用已同步文件，航班初始为空；启动真实采集协调器。

采集协调器：

1. 读取活跃 WebSocket 订阅边界。
2. 生成去重后的空间采集单元。
3. 调用已启用供应商。
4. 规范化并融合有效记录。
5. 原子替换仓库中的最新航班和来源状态。
6. 通过现有实时 Hub 发布新增、更新和移除事件。

当前内存部署由 API 内嵌采集。接入 Redis 后，协调器迁移到独立 ingestor，API 的公开契约不变。

### 4.4 `apps/ingestor`

独立采集进程复用 Provider factory、调度器和 `runCycle`：

- 支持单次执行，便于冒烟测试和任务调度。
- 支持持续轮询，便于后续独立部署。
- 输出结构化周期摘要，不输出凭证或原始授权头。

在没有共享 Redis 或数据库时，独立进程不承担本地 API 的数据写入；本地 `live` 模式使用 API 内嵌采集。

## 5. 来源状态模型

`SourceStatus` 在现有字段基础上增加可选观测字段：

```ts
type SourceStatus = {
  providerId: string;
  state: 'healthy' | 'degraded' | 'down';
  lastAttemptAt?: string;
  lastSuccessAt: string | null;
  lastRecordCount?: number;
  errorCode?: 'RATE_LIMITED' | 'AUTH_FAILED' | 'TIMEOUT' | 'INVALID_RESPONSE' | 'UPSTREAM_ERROR';
  message?: string;
};
```

状态规则：

- `healthy`：最近请求成功，响应通过校验。
- `degraded`：请求成功但存在无效记录，或最近一次请求失败但仍有未过期的最后成功数据。
- `down`：从未成功，或最后成功数据已经超过过期阈值。

错误信息只使用稳定错误码和面向用户的安全摘要，不包含 URL 查询中的敏感参数、内部路径、响应正文或堆栈。

## 6. 采集与缓存策略

### 6.1 空间采集单元

采集计划将地图边界按固定网格归并。每个查询单元包含中心点、半径、缓存键和边界范围。

- ADSB.lol 与 Airplanes.live 半径上限为 250 海里。
- OpenSky 直接使用合法边界框。
- 跨日期变更线的视野拆成两个合法边界框。
- 相同单元在缓存 TTL 内不重复请求。
- 没有活跃订阅时只采集配置的默认区域；未配置默认区域时停止航班请求。

### 6.2 限速和退避

每个供应商独立维护：

- 最小请求间隔。
- 连续失败次数。
- 下一次允许请求时间。
- 最近成功快照。

HTTP 429 使用指数退避并尊重 `Retry-After`。认证失败在凭证未变化前不高频重试。超时和上游错误使用带上限的指数退避。一个供应商的退避不阻塞其他供应商。

### 6.3 最后成功数据

仓库只在完成整个采集周期和融合后替换航班集合。失败周期不会用空集合覆盖最后成功数据。

数据年龄由统一新鲜度规则计算：

- 新鲜：保持正常视觉强调。
- 延迟：降低强调并显示更新时间。
- 过期：继续保留最后位置，但明确标记为过期。

## 7. 测试策略

### 7.1 契约和单元测试

使用脱敏后的官方响应样本覆盖：

- ADSB.lol 与 Airplanes.live 的秒/毫秒时间戳。
- `alt_baro: "ground"`、缺失坐标、空呼号和可选机型字段。
- OpenSky 状态数组字段位置和空值。
- OAuth Token 缓存、提前刷新和 401 单次重试。
- 429、`Retry-After`、超时、无效 JSON 和响应结构变化。
- 空间单元生成、日期变更线拆分、缓存键和请求去重。
- OurAirports CSV 转换、单位转换和无效记录丢弃。
- 来源状态从正常到降级、过期和恢复的转换。

所有网络测试通过注入的 `fetch` 实现运行，不访问真实公网。

### 7.2 API 与实时集成测试

集成测试验证：

- `live` 启动时不包含演示航班。
- 真实采集结果可通过地图快照、搜索、详情和航线接口读取。
- 仓库替换后 WebSocket 收到增量和来源状态事件。
- 单源失败时其他来源结果继续写入。
- 全部来源失败时保留最后成功航班。
- 从未成功时返回空航班集合和明确来源状态。

### 7.3 真实来源冒烟测试

增加显式命令：

```bash
pnpm smoke:live
pnpm data:airports:sync
```

`smoke:live` 只请求一个小范围采集单元。通过条件是：至少一个启用来源在本轮完成真实上游请求，且所有启用来源本轮合计解析出至少 1 条航班记录。成功但为空的响应不满足冒烟验证要求。该命令不属于默认 CI，失败时输出来源和稳定错误码，不输出响应正文或凭证。

## 8. 运行与安全

- 浏览器只访问本项目 API 和 WebSocket。
- 供应商凭证只存在于服务端环境变量或密钥系统。
- `.env` 和真实凭证不提交到仓库。
- 日志不输出 Authorization、Client Secret、Token 或完整供应商响应。
- 外部响应在适配器边界使用 Zod 校验。
- 真实数据不能用于飞行安全、空管或机场运行决策。
- 投入生产前需要再次核对各供应商的使用条款、署名、配额和再分发要求。

## 9. 文档与配置样例

仓库增加无凭证的 `.env.example`，只包含配置名和安全占位符。README 说明：

- 如何保持 `demo` 模式。
- 如何启用匿名真实来源。
- 如何配置 OpenSky OAuth 2.0。
- 如何同步 OurAirports。
- 如何运行真实来源冒烟测试。
- 免费来源的覆盖和速率限制。

## 10. 完成定义

本阶段完成需同时满足：

- `DATA_MODE=demo` 的现有行为和测试保持通过。
- `DATA_MODE=live` 不生成或混入任何演示航班。
- ADSB.lol、Airplanes.live 和 OpenSky 均可通过配置启用。
- OpenSky 无凭证与 OAuth 2.0 两种方式均有契约测试。
- 单源失败、全部失败、限流、认证失败和恢复均有状态测试。
- 真实采集结果进入 API 快照和 WebSocket。
- OurAirports 同步命令生成通过校验的机场数据文件，失败时保留旧版本。
- `pnpm smoke:live` 能在显式启用网络时验证至少一个公开来源完成真实上游请求，且所有启用来源本轮合计解析出至少 1 条航班记录。
- 产品和架构文档说明真实覆盖边界，不宣称免费来源提供完整全球实时数据。
- `pnpm verify` 与 `pnpm format:check` 通过。

## 11. 参考来源

- ADSB.lol API：<https://api.adsb.lol/>
- ADSB.lol 开放数据说明：<https://www.adsb.lol/docs/open-data/api/>
- Airplanes.live API Guide：<https://airplanes.live/api-guide/>
- OpenSky REST API：<https://openskynetwork.github.io/opensky-api/rest.html>
- OurAirports Open Data：<https://ourairports.com/data/>
- OurAirports Data Dictionary：<https://ourairports.com/help/data-dictionary.html>
