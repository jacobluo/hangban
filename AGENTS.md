# Agent Guide

本仓库用于设计和实现「航迹」全球实时航班 Web 站点。当前包含 pnpm workspace、Fastify API、WebSocket、`demo | live` 两种模式、真实位置采集、OurAirports 与 GeoNames 同步、ADSBdb 元数据补全，以及 Next.js + MapLibre 响应式界面。

## 开始工作前

按以下顺序读取资料：

1. 本文件。
2. [`docs/AGENTS.md`](docs/AGENTS.md) 及任务相关文档。
3. `.codebuddy/rules/workflow.mdc`、`.codebuddy/rules/testing.mdc`、`.codebuddy/rules/security.mdc`。

`.codebuddy/rules/` 定义开发流程、安全和测试约束；产品与架构范围以 `docs/` 为准。

## 当前仓库结构

- `apps/web/`
  - Next.js、React、MapLibre 界面和组件测试。
- `apps/api/`
  - Fastify HTTP API、WebSocket、内存仓库和 API 测试。
- `apps/ingestor/`
  - 数据采集周期与独立运行入口。
- `packages/`
  - 统一契约、领域逻辑、数据源适配器、采集调度、配置和测试数据。
- `tests/e2e/`
  - Playwright 桌面端与手机端用户流程。
- `docs/`
  - 产品、界面、架构、User Case、规格和实施计划。
- `.ardot-qa/`
  - Ardot 界面设计的本地截图与检查产物。它们用于视觉核对，不是前端源码。
- `.codebuddy/rules/`
  - 通用开发流程、安全与测试规则。
- `scripts/`
  - pnpm 开发和验证命令入口。

当前 Ardot 设计文件：

- 文件名：`hangban`
- 文件 ID：`702710471706421`
- 页面：`0:1`

## 已确认的产品边界

- 面向未登录访客，不建设账号体系。
- 核心能力是全球航班实时地图、航班详情、机场探索和航线探索。
- 桌面端与手机端必须同时可用。
- 地图实现采用 MapLibre GL JS。
- 实时位置数据通过服务端数据适配层融合，当前可配置来源包括 ADSB.lol、OpenSky 和 Airplanes.live。
- 机场静态信息来自 OurAirports；城市中文和英文别名来自 GeoNames。`live` API 从 PostgreSQL/PostGIS 查询已导入数据。
- ADSBdb 只补充缺失的航空公司、机型、注册号和推断起终点，不作为实时位置来源。
- 机场页展示机场资料和周边实时航班，不展示到港、离港、延误或登机口等未获得可靠数据支持的信息。
- 首期容量目标约为 1,000 个并发连接，前端数据刷新目标为 10 秒。

更完整的范围与交互见 [`docs/product-design.md`](docs/product-design.md)，架构基线见 [`docs/architecture.md`](docs/architecture.md)。

## 实施约束

- JavaScript/TypeScript 工程统一使用 pnpm 管理，提交根目录 `pnpm-lock.yaml`，禁止混用 npm、Yarn 或 Bun 锁文件。
- 采用 pnpm workspace 组织 Web、API、采集进程和共享包；实际目录以 `docs/architecture.md` 为准。
- 新增产品能力或修改架构边界前，先更新相关文档和实施计划。
- 调整 UI 前必须先更新对应原型图并完成设计确认，再修改前端实现；仅修复实现与已确认原型不一致的问题时，可直接按现有原型还原，并在视觉检查记录中说明。
- 第三方数据源必须由服务端适配器访问；浏览器不得持有供应商密钥或直接依赖供应商响应结构。
- 对外 API 和实时事件只暴露统一领域模型，不向客户端原样传递第三方字段。
- 实时推送按地图视野或区域订阅，并优先发送增量，禁止每 10 秒向所有客户端广播完整全球快照。
- UI 必须明确展示数据新鲜度、来源状态、降级状态和无数据状态。
- 不把推断结果包装成确定事实；航线匹配、覆盖度等推断字段应带有语义说明或置信度。

## 核心命令

```bash
pnpm install
pnpm dev
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

完成生产行为变更前运行与范围匹配的聚焦测试，交付前运行 `pnpm verify` 和 `pnpm format:check`。`pnpm smoke:live` 与 `pnpm data:airports:sync` 会访问公网，不属于默认离线验证。视觉变更同时检查 1440 × 900 桌面视口和 390 × 844 手机视口。

## 文档维护规则

- 使用克制、准确的中文，中文与英文缩写或数字之间保留必要空格。
- 术语统一使用：`航班`、`机场`、`航线`、`实时位置`、`数据适配层`、`数据源`、`覆盖度`。
- 明确区分「当前实现」「已确认设计」「建议实施」和「暂不包含」。
- 修改范围、页面或架构时，同步更新 `docs/AGENTS.md` 的索引和相关文档。
