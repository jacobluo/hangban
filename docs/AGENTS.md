# 文档工作指南

本文件是 `docs/` 目录的文档索引和局部工作说明。根目录 `AGENTS.md` 的规则继续生效；本目录记录「航迹」全球实时航班 Web 站点的产品范围、界面方案、技术架构、User Case 和实施记录。

修改产品范围、页面、架构或实施状态时，应同步更新本文件的索引、状态说明和对应主题文档。当前实现支持 `demo` 与 `live` 两种数据模式；文档、自动化测试与 Ardot 设计共同构成后续迭代依据。

## 文档索引

- [`product-design.md`](product-design.md)：产品定位、范围、信息架构、页面和响应式设计规则。
- [`architecture.md`](architecture.md)：生产架构、数据适配层、实时分发、容量与运行保障。
- [`user-cases.md`](user-cases.md)：匿名访客的主要任务、流程和验收条件。
- [`superpowers/specs/2026-07-11-flight-tracker-mvp-design.md`](superpowers/specs/2026-07-11-flight-tracker-mvp-design.md)：本轮 MVP 实施规格。
- [`superpowers/plans/2026-07-11-flight-tracker-mvp.md`](superpowers/plans/2026-07-11-flight-tracker-mvp.md)：可核对的实施步骤与验证记录。
- [`superpowers/plans/2026-07-11-ui-completion.md`](superpowers/plans/2026-07-11-ui-completion.md)：UI 控件、状态、响应式行为与视觉验收记录。
- [`superpowers/specs/2026-07-11-real-data-ingestion-design.md`](superpowers/specs/2026-07-11-real-data-ingestion-design.md)：真实航班与机场数据接入规格、故障语义和安全边界。
- [`superpowers/plans/2026-07-11-real-data-ingestion.md`](superpowers/plans/2026-07-11-real-data-ingestion.md)：真实数据接入步骤、测试和运行验证记录。
- [`superpowers/specs/2026-07-12-airport-flight-enrichment-design.md`](superpowers/specs/2026-07-12-airport-flight-enrichment-design.md)：视野机场、全球中英文搜索和航班元数据补全设计。
- [`superpowers/plans/2026-07-12-airport-flight-enrichment.md`](superpowers/plans/2026-07-12-airport-flight-enrichment.md)：机场与航班信息补全的实施步骤和验证门禁。
- [`superpowers/specs/2026-07-12-production-persistence-compose-design.md`](superpowers/specs/2026-07-12-production-persistence-compose-design.md)：PostgreSQL/PostGIS、Redis、持久化读写和完整容器模式设计。
- [`superpowers/plans/2026-07-12-production-persistence-compose.md`](superpowers/plans/2026-07-12-production-persistence-compose.md)：生产持久化、独立 ingestor、完整容器模式和真实中间件测试实施计划。
- [`superpowers/specs/2026-07-12-aero-chart-visual-deepening-design.md`](superpowers/specs/2026-07-12-aero-chart-visual-deepening-design.md)：全部核心页面的浅色航空图表视觉深化规格、响应式规则和 Ardot 执行边界。
- [`superpowers/plans/2026-07-12-aero-chart-visual-deepening.md`](superpowers/plans/2026-07-12-aero-chart-visual-deepening.md)：Ardot 深化、前端同步、视觉核对和验证门禁的实施步骤。
- [`superpowers/specs/2026-07-13-desktop-data-status-page-design.md`](superpowers/specs/2026-07-13-desktop-data-status-page-design.md)：修复 PC 实时状态入口误用右侧栏的问题，明确桌面整页与手机全高页面规则。
- [`superpowers/plans/2026-07-13-desktop-data-status-page.md`](superpowers/plans/2026-07-13-desktop-data-status-page.md)：桌面数据状态整页、手机全高页面、响应式回归和视觉验收的实施步骤。
- [`superpowers/specs/2026-07-13-weather-radar-overlay-design.md`](superpowers/specs/2026-07-13-weather-radar-overlay-design.md)：RainViewer 天气雷达图层、24 小时短期缓存、代理安全和降级语义设计。
- [`superpowers/specs/2026-07-13-weather-data-status-design.md`](superpowers/specs/2026-07-13-weather-data-status-design.md)：状态页主动检查天气数据、独立新鲜度状态和航班健康统计边界设计。
- [`superpowers/plans/2026-07-13-weather-data-status.md`](superpowers/plans/2026-07-13-weather-data-status.md)：Ardot 状态页更新、天气数据卡片、主动检查、响应式回归和验证步骤。
- [`superpowers/specs/2026-07-13-browser-local-time-design.md`](superpowers/specs/2026-07-13-browser-local-time-design.md)：UTC 数据边界、浏览器时区格式、hydration 处理和时间展示验收规则。
- [`superpowers/plans/2026-07-13-browser-local-time.md`](superpowers/plans/2026-07-13-browser-local-time.md)：Ardot 同步、统一时间组件、业务替换、双视口核对和验证步骤。

## 状态说明

| 内容         | 当前状态                                                         |
| ------------ | ---------------------------------------------------------------- |
| 产品范围     | 已确认首期边界                                                   |
| 桌面端界面   | 已按 Ardot 设计实现并完成 1440 × 900 视觉核对                    |
| 手机端界面   | 已按 Ardot 设计实现并完成 390 × 844 视觉核对                     |
| 视觉深化     | `main_deep（16:1）` 已实现，并完成桌面端与手机端视觉核对         |
| 技术架构     | 生产实施基线                                                     |
| 包管理器     | pnpm workspace，已提交锁文件                                     |
| 应用源码     | 已完成 pnpm workspace MVP                                        |
| 数据源适配器 | 已接入 ADSB.lol、Airplanes.live 和 OpenSky，默认运行 `demo` 模式 |
| 机场数据     | 已实现 OurAirports、GeoNames 同步、视野查询和全球中英文搜索      |
| 航班补充数据 | 已实现 ADSBdb 异步补全、缓存、降级和推断路线说明                 |
| 真实采集     | 独立 ingestor 通过 Redis 租约单写；免费来源只提供局部覆盖        |
| 生产基础设施 | PostgreSQL/PostGIS、Redis、完整 Compose 与真实容器门禁已实现     |
| 天气雷达     | 已实现地图雷达图层和状态页独立天气数据检查，并完成双视口视觉核对 |
| 时间展示     | 当前观测时间按浏览器时区显示，传输、存储和业务计算继续使用 UTC   |

UI 当前包含全球实时地图、统一搜索、航班摘要与完整详情、机场探索、航线探索、筛选与图层、默认关闭的天气雷达、数据状态、短时位置回看，以及加载、空结果、断线和降级状态。首期不包含账号体系。

## 设计文件

- Ardot 文件名：`hangban`
- Ardot 文件 ID：`702710471706421`
- 当前已确认设计页面：`main`（页面 ID `0:1`）
- 视觉深化工作页面：`main_deep`（页面 ID `16:1`）
- 视觉深化页面链接：<https://ardot.tencent.com/file/702710471706421?node_id=16%3A1>

`.ardot-qa/` 保存本地视觉检查截图。该目录是检查产物，不承担界面规格的文字说明。
