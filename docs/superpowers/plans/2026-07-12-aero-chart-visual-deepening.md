# 航空图表视觉深化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Ardot `main_deep` 页面完成全部核心页面的浅色航空图表视觉深化，经确认后同步到 Next.js + MapLibre 前端，并完成桌面端与手机端验证。

**Architecture:** 实施分为 Ardot 设计门和前端实现门。前 3 个任务只修改 Ardot `main_deep（16:1）` 并产出视觉核对截图；设计确认后，后续任务通过语义化 CSS 变量、聚焦的 React 组件和 MapLibre 图层配置同步视觉，不修改服务端契约或数据适配层。

**Tech Stack:** Ardot MCP、Next.js 16、React 19、TypeScript 5.9、MapLibre GL JS、Vitest、Testing Library、Playwright、pnpm workspace。

## Global Constraints

- 基线设计保留在 Ardot `main（0:1）`，深化设计只放在 `main_deep（16:1）`。
- 不引入深色主题、账号、AI 航线规划、订票、值机、延误预测或虚构统计。
- 浏览器只访问本项目 API 与 WebSocket，不直接访问第三方数据源。
- 不展示统一领域模型未提供的字段；推断路线必须标记为「推断」或展示置信度。
- 地图实现继续使用 MapLibre GL JS，航线继续使用真实大圆插值并处理日期变更线。
- 桌面端主要验收视口为 1440 × 900，手机端主要验收视口为 390 × 844。
- 手机端主要触控区域不小于 44 × 44 px。
- 正文与背景至少达到 WCAG AA 对比度，状态不得只依赖颜色。
- 前端修改遵循 TDD；每个行为变更先写失败测试，再做最小实现。
- 每个任务完成后提交一次；最终运行 `pnpm verify` 和 `pnpm format:check`。

---

## 文件与设计单元

### Ardot

- `main（0:1）`：当前已确认基线，只读。
- `main_deep（16:1）`：视觉深化工作页。
- `Aero Chart Tokens`：语义颜色、间距、圆角和状态变量。
- `.ardot-qa/visual-deepening/`：桌面端与手机端核对截图，不提交 Git。

### 前端

- `apps/web/src/app/globals.css`：全局语义变量、布局、组件状态和响应式样式。
- `apps/web/src/lib/map-style.ts`：默认浅色底图风格。
- `apps/web/src/components/flight-map.tsx`：航班、机场、航线和选中对象 MapLibre 图层。
- `apps/web/src/components/app-shell.tsx`：导航、地图安全区和页面组合。
- `apps/web/src/components/search-box.tsx`：搜索入口、分组结果和移动搜索状态。
- `apps/web/src/components/flight-panel.tsx`：航班摘要详情。
- `apps/web/src/components/flight-details-page.tsx`：完整航班详情。
- `apps/web/src/components/airport-explorer.tsx`：机场列表、详情和手机端流程。
- `apps/web/src/components/route-explorer.tsx`：航线选择、概览和匹配结果。
- `apps/web/src/components/layer-filter-panel.tsx`：筛选与图层。
- `apps/web/src/components/data-status.tsx`：顶部实时状态入口。
- `apps/web/src/components/data-status-panel.tsx`：数据覆盖与来源状态。
- `apps/web/src/components/system-notice.tsx`：加载、空结果、断线、降级和过期提示。
- `apps/web/src/components/map-controls.tsx`：桌面与手机地图控制。
- `apps/web/src/components/app-shell.test.tsx`：跨组件用户行为测试。
- `apps/web/src/app/layout.test.tsx`：页面语义和基础可访问性测试。
- `apps/web/src/lib/map-style.test.ts`：地图风格配置测试。
- `tests/e2e/*.spec.ts`：桌面端、手机端和异常状态 E2E。
- `docs/product-design.md`：最终视觉核对记录。
- `docs/AGENTS.md`：设计与实施状态索引。

---

### Task 1: 建立 Ardot 视觉基础与共用组件

**Files:**

- Modify: Ardot 文件 `702710471706421` 的 `Aero Chart Tokens`
- Modify: Ardot 页面 `main_deep（16:1）`
- Reference: `docs/superpowers/specs/2026-07-12-aero-chart-visual-deepening-design.md`

**Interfaces:**

- Consumes: 已确认语义颜色、间距、圆角、字体和状态规则。
- Produces: 后续画板复用的导航、状态入口、搜索、地图标记、面板、列表项、指标、筛选项和抽屉组件。

- [x] **Step 1: 读取设计上下文并确认页面**

使用 Ardot MCP 读取文件信息、编辑器状态、`main（0:1）` 顶层画板和 `main_deep（16:1）` 顶层节点。

Expected: 文件名为 `hangban`；`main` 只读；所有新节点的父页面为 `16:1`。

- [x] **Step 2: 建立页面分区**

在 `main_deep` 中建立以下命名分区，水平间距统一为 160 px，分区标题使用独立文本节点：

```text
00 / Foundations
01 / Global Live
02 / Search
03 / Flight Detail
04 / Airport
05 / Route
06 / Filters and Layers
07 / Data and System States
```

Expected: 页面结构可通过 Ardot `batch_read` 按名称检索，各分区不重叠。

- [x] **Step 3: 补齐设计变量**

使用 `apply_variables` 合并以下语义变量，不使用 `replace: true`：

```text
Canvas #F4F7FA
Ocean #E9F0F6
Land #F8FAFC
Surface #FFFFFF
Ink #102A43
Ink Muted #627D98
Border #C9D5DF
Border Subtle #DDE6ED
Action #0F62FE
Selected #FF6F3D
Healthy #159947
Warning #B77900
Critical #C93737
```

同时建立 `Space 4/8/12/16/24/32/48` 和 `Radius 4/8/12` 数值变量。

Expected: `fetch_variables` 返回全部变量，既有变量未被删除。

- [x] **Step 4: 创建共用组件及状态**

在 `00 / Foundations` 中建立并命名以下 reusable 组件：

```text
Navigation / Desktop
Realtime Status / Healthy|Warning|Critical
Search / Desktop|Mobile
Search Result / Flight|Airport|City|Selected
Aircraft / Default|Hover|Selected|Delayed|Stale
Airport Marker / Default|Selected|Low Coverage
Map Control / Default|Active|Disabled
Identity Header / Flight|Airport
Metric / Default|Unavailable
Coverage Block / Healthy|Warning|Critical
Panel / Desktop
Drawer / Mobile / Collapsed|Half|Full
Notice / Loading|Empty|Warning|Critical
```

Expected: 状态通过组件属性和语义变量表达，不复制后手工改色。

- [x] **Step 5: 核对组件布局**

调用 `capture_layout`，分别检查 `00 / Foundations` 和组件容器的重叠、裁切与文本溢出。

Expected: `problemsOnly: true` 不返回问题；所有文本使用可用字体。

- [x] **Step 6: 保存核对截图**

将 Foundations 截图保存到：

```text
.ardot-qa/visual-deepening/00-foundations.webp
```

Expected: 截图中变量、组件和状态可同时比较，无孤立或未命名节点。

- [x] **Step 7: Commit**

Ardot 设计不写入 Git；在计划中勾选 Task 1，提交计划进度：

```bash
git add docs/superpowers/plans/2026-07-12-aero-chart-visual-deepening.md
git commit -m "design: establish aero chart foundations"
```

---

### Task 2: 深化全球实时地图、搜索和航班详情画板

**Files:**

- Modify: Ardot 页面 `main_deep（16:1）`
- Reference: Ardot 页面 `main（0:1）` 的 `Desktop / Aero Chart Map` 与 `Mobile / Aero Chart Map`
- Output: `.ardot-qa/visual-deepening/01-global-live-desktop.webp`
- Output: `.ardot-qa/visual-deepening/01-global-live-mobile.webp`

**Interfaces:**

- Consumes: Task 1 的变量和共用组件。
- Produces: 已确认的全球实时、搜索、航班摘要与完整详情深化画板。

- [x] **Step 1: 创建全球实时桌面画板**

复制基线桌面画板到 `01 / Global Live`，命名为 `Deep / Desktop / Global Live`，保持 1440 × 900。替换为 Task 1 组件，并应用以下布局：顶栏 64 px；搜索框宽 420 px、高 52 px；右侧详情宽 360 px；地图填充剩余区域。

Expected: 选中航班位于地图内容安全区中心，面板不覆盖搜索框和回看条。

- [x] **Step 2: 建立地图视觉层级**

在 Ardot 示意地图中应用 Ocean、Land、Border 和 Border Subtle；普通航班使用 Action 且透明度 72%；选中航班使用 24–28 px 光晕、白色描边和 Selected 图标；其他航班降低至 40%。已飞航迹使用 Selected 实线，未飞航迹使用 Action 虚线。

Expected: 无需阅读详情即可识别当前航班、已飞部分和未飞部分。

- [x] **Step 3: 深化桌面搜索状态**

在 `02 / Search` 创建 `Deep / Desktop / Search Results`，包含 Flight、Airport、City 分组和键盘选中态；最多展示 8 条结果；无结果画板保留关键字和「修改搜索」「返回地图」动作。

Expected: 搜索结果与搜索框等宽，不使用黄色文本背景。

- [x] **Step 4: 深化航班摘要与完整详情**

在 `03 / Flight Detail` 创建桌面摘要和完整详情。摘要按航班身份、航线关系、飞行指标、数据说明排序；完整详情增加元数据补全与推断说明。移除无可靠数据支持的计划时刻或装饰图表。

Expected: ADSBdb 补全信息与实时位置字段在标题或说明中明确区分；推断路线出现「推断」。

- [x] **Step 5: 创建对应手机画板**

创建 390 × 844 的 `Deep / Mobile / Global Live`、`Search Results`、`Flight Drawer / Collapsed|Half|Full` 和 `Full Flight Detail`。搜索结果与对象详情不得同时占用同一抽屉；地图控制保持在抽屉最高位置上方。

Expected: 所有主要控件至少 44 × 44 px；三个抽屉停靠状态视觉稳定。

- [x] **Step 6: 截图与设计确认**

批量截图本任务全部桌面与手机画板，检查 1440 × 900 和 390 × 844。

Expected: 无重叠、裁切、文本溢出或不可达操作；获得设计确认后才进入 Task 3。

- [x] **Step 7: Commit**

```bash
git add docs/superpowers/plans/2026-07-12-aero-chart-visual-deepening.md
git commit -m "design: deepen global flight experience"
```

---

### Task 3: 深化机场、航线、筛选和系统状态画板

**Files:**

- Modify: Ardot 页面 `main_deep（16:1）`
- Output: `.ardot-qa/visual-deepening/04-airport-*.webp`
- Output: `.ardot-qa/visual-deepening/05-route-*.webp`
- Output: `.ardot-qa/visual-deepening/06-filters-*.webp`
- Output: `.ardot-qa/visual-deepening/07-states-*.webp`

**Interfaces:**

- Consumes: Task 1 共用组件与 Task 2 地图层级。
- Produces: 全部核心页面的已确认 Ardot 深化设计，解除前端实现门。

- [ ] **Step 1: 深化机场探索**

在 `04 / Airport` 创建桌面视野列表、全球中文搜索、机场选中详情和对应手机画板。桌面使用 320 px 左侧列表、地图和按需出现的 340 px 右侧详情；手机采用列表到详情的连续流程。

Expected: 机场详情固定显示「周边航班不等同于到港或离港班次」；覆盖不足使用「当前未获得记录」而非 `0`。

- [ ] **Step 2: 深化航线探索**

在 `05 / Route` 创建未完整选择、已选择、无匹配航班和对应手机画板。起终点选择器结构对称；未选择完整时不绘制航线；已选择时显示大圆航线、距离、方向、匹配数、更新时间和覆盖度。

Expected: 不出现排班总数、准点率或未获得的计划数据。

- [ ] **Step 3: 深化筛选与图层**

在 `06 / Filters and Layers` 中将图层与筛选分组。采用即时生效模型，只保留「重置筛选」；展示高度双端范围、航空公司多选和数据质量选项。创建桌面 320 px 面板和手机全高抽屉。

Expected: 不出现同时存在的「应用」按钮；触控区域至少 44 × 44 px。

- [ ] **Step 4: 深化数据覆盖与系统状态**

在 `07 / Data and System States` 创建正常、部分降级、全部来源不可用、加载、视野无航班、搜索无结果、网络断开、数据过期和定位拒绝画板。

Expected: 每个状态包含文字和图标或结构差异；全部来源不可用时仍保留地图和机场静态信息。

- [ ] **Step 5: 执行完整 Ardot 布局检查**

对 `main_deep` 全部顶层画板运行 `capture_layout`，再批量截图每个分区的桌面与手机画板。

Expected: 不存在重叠、裁切、文本溢出、未命名节点和不可用字体。

- [ ] **Step 6: Ardot 设计评审门**

逐屏对照 `main` 与 `main_deep`，记录设计确认结论。未确认时只修改 Ardot，不修改前端源码。

Expected: 产品负责人明确确认 `main_deep` 可以作为前端同步基线。

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/plans/2026-07-12-aero-chart-visual-deepening.md
git commit -m "design: complete responsive visual deepening"
```

---

### Task 4: 建立前端语义变量与基础组件样式

**Files:**

- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/app/layout.test.tsx`
- Modify: `apps/web/src/components/app-shell.test.tsx`

**Interfaces:**

- Consumes: 已确认的 Ardot Tokens 和组件状态。
- Produces: CSS 变量 `--canvas`、`--ocean`、`--land`、`--surface`、`--ink`、`--ink-muted`、`--border`、`--border-subtle`、`--action`、`--selected`、`--healthy`、`--warning`、`--critical`，供后续任务使用。

- [ ] **Step 1: 写失败测试**

在 `layout.test.tsx` 增加对页面主区域语义的断言，在 `app-shell.test.tsx` 增加实时状态入口与地图主区域的可访问名称断言：

```tsx
expect(screen.getByRole('main', { name: '全球实时航班地图' })).toBeInTheDocument();
expect(screen.getByRole('button', { name: /实时位置/ })).toBeInTheDocument();
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm exec vitest run apps/web/src/app/layout.test.tsx apps/web/src/components/app-shell.test.tsx
```

Expected: FAIL，缺少对应 `aria-label` 或实时状态按钮名称。

- [ ] **Step 3: 添加语义变量与基础样式**

在 `globals.css` 的 `:root` 中定义：

```css
:root {
  --canvas: #f4f7fa;
  --ocean: #e9f0f6;
  --land: #f8fafc;
  --surface: #ffffff;
  --ink: #102a43;
  --ink-muted: #627d98;
  --border: #c9d5df;
  --border-subtle: #dde6ed;
  --action: #0f62fe;
  --selected: #ff6f3d;
  --healthy: #159947;
  --warning: #b77900;
  --critical: #c93737;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
}
```

将全局背景、文本、描边、焦点环和按钮状态改用语义变量，不进行页面级布局重写。

- [ ] **Step 4: 添加语义与可访问名称**

在 `app-shell.tsx` 为地图主区域添加 `role="main" aria-label="全球实时航班地图"`；确保实时状态组件呈现为按钮并包含状态文本。

- [ ] **Step 5: 运行聚焦测试**

Run:

```bash
pnpm exec vitest run apps/web/src/app/layout.test.tsx apps/web/src/components/app-shell.test.tsx
```

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/globals.css apps/web/src/app/layout.test.tsx apps/web/src/components/app-shell.tsx apps/web/src/components/app-shell.test.tsx
git commit -m "style: establish aero chart visual tokens"
```

---

### Task 5: 同步 MapLibre 底图与对象层级

**Files:**

- Modify: `apps/web/src/lib/map-style.test.ts`
- Modify: `apps/web/src/lib/map-style.ts`
- Modify: `apps/web/src/components/flight-map.tsx`
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**

- Consumes: Task 4 CSS 语义变量和现有 `greatCircleGeometry()`。
- Produces: `resolveMapStyle()` 的浅色底图配置，以及普通、选中、延迟、过期航班和航线图层。

- [ ] **Step 1: 写地图风格失败测试**

在 `map-style.test.ts` 断言默认风格包含 `#e9f0f6` 背景、低饱和栅格和低于 0.36 的栅格透明度：

```ts
const style = resolveMapStyle();
expect(typeof style).toBe('object');
if (typeof style === 'object') {
  expect(style.layers[0]).toMatchObject({ paint: { 'background-color': '#e9f0f6' } });
  expect(style.layers[1]).toMatchObject({
    paint: { 'raster-saturation': -0.9, 'raster-opacity': 0.3 },
  });
}
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm exec vitest run apps/web/src/lib/map-style.test.ts`

Expected: FAIL，当前背景为 `#eaf2f8` 且栅格参数不同。

- [ ] **Step 3: 更新默认地图风格**

将默认背景更新为 Ocean，栅格使用：

```ts
paint: {
  'raster-opacity': 0.3,
  'raster-saturation': -0.9,
  'raster-contrast': 0.06,
  'raster-brightness-min': 0.08,
  'raster-brightness-max': 0.94,
}
```

外部 `NEXT_PUBLIC_MAP_STYLE_URL` 行为保持不变。

- [ ] **Step 4: 更新航班和航线图层**

在 `flight-map.tsx` 中为 GeoJSON properties 增加 `selected` 和 `freshness`；普通航班透明度为 0.72，选中状态通过独立 halo circle layer、白色描边 plane image 和 Selected 色表达；选中时其他航班透明度为 0.4。保持已飞实线与未飞虚线图层分离。

- [ ] **Step 5: 验证地图聚焦行为**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/map-style.test.ts apps/web/src/lib/map-geometry.test.ts apps/web/src/components/app-shell.test.tsx
```

Expected: PASS；日期变更线测试保持通过。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/map-style.ts apps/web/src/lib/map-style.test.ts apps/web/src/components/flight-map.tsx apps/web/src/app/globals.css
git commit -m "style: deepen map object hierarchy"
```

---

### Task 6: 同步导航、搜索与地图控制

**Files:**

- Modify: `apps/web/src/components/app-shell.test.tsx`
- Modify: `apps/web/src/components/app-shell.tsx`
- Modify: `apps/web/src/components/search-box.tsx`
- Modify: `apps/web/src/components/data-status.tsx`
- Modify: `apps/web/src/components/map-controls.tsx`
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**

- Consumes: `SourceStatus[]`、`RealtimeConnectionState` 和 Task 4 语义变量。
- Produces: 64 px 顶栏、实时状态入口、分组搜索结果和统一地图控制。

- [ ] **Step 1: 写失败测试**

在 `app-shell.test.tsx` 增加：

```tsx
expect(screen.getByText('航班')).toBeInTheDocument();
expect(screen.getByText('机场')).toBeInTheDocument();
expect(screen.getByText('城市')).toBeInTheDocument();
expect(screen.getByRole('button', { name: '打开图层与筛选' })).toHaveAccessibleName();
```

测试先输入可同时返回不同对象类型的 fixture 关键字。

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm exec vitest run apps/web/src/components/app-shell.test.tsx`

Expected: FAIL，结果未按对象类型呈现分组标题，或控制按钮缺少准确名称。

- [ ] **Step 3: 实现搜索分组和状态入口**

在 `search-box.tsx` 根据结果类型生成 `航班 / 机场 / 城市` 分组，保持现有选择回调签名不变。`data-status.tsx` 显示总体状态、最后更新时间和覆盖提示；手机端只显示状态点但保留完整 `aria-label`。

- [ ] **Step 4: 统一地图控制**

为定位、图层、放大和缩小按钮提供精确可访问名称；CSS 设置桌面 40 × 40 px、手机 44 × 44 px；手机媒体查询隐藏缩放加减按钮。

- [ ] **Step 5: 运行测试**

Run: `pnpm exec vitest run apps/web/src/components/app-shell.test.tsx`

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/app-shell.tsx apps/web/src/components/app-shell.test.tsx apps/web/src/components/search-box.tsx apps/web/src/components/data-status.tsx apps/web/src/components/map-controls.tsx apps/web/src/app/globals.css
git commit -m "style: refine navigation and map tools"
```

---

### Task 7: 同步航班摘要与完整详情

**Files:**

- Modify: `apps/web/src/components/app-shell.test.tsx`
- Modify: `apps/web/src/components/flight-panel.tsx`
- Modify: `apps/web/src/components/flight-details-page.tsx`
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**

- Consumes: 现有 `Flight` 与 `Airport` 类型，不扩展服务端契约。
- Produces: 航班身份、航线关系、飞行指标、可信度区块和手机抽屉层级。

- [ ] **Step 1: 写失败测试**

新增断言：

```tsx
expect(screen.getByRole('heading', { name: 'CA981' })).toBeInTheDocument();
expect(screen.getByText(/数据来源/)).toBeInTheDocument();
expect(screen.getByText(/推断/)).toBeInTheDocument();
expect(screen.getByRole('button', { name: '查看完整详情' })).toBeInTheDocument();
```

使用包含 `route.inferred === true` 的 fixture。

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm exec vitest run apps/web/src/components/app-shell.test.tsx`

Expected: FAIL，缺少新的标题层级或可信度文案。

- [ ] **Step 3: 重排航班摘要**

`flight-panel.tsx` 按身份、航线、两列指标、可信度和唯一主操作排序；不可用字段显示「未获得数据」或隐藏，不用虚构值。

- [ ] **Step 4: 重排完整详情**

`flight-details-page.tsx` 使用相同信息顺序；将 ADSBdb 补全信息放入「补充资料」，将推断路线放入带说明的「路线推断」。不新增计划时刻、延误或趋势数据。

- [ ] **Step 5: 实现响应式抽屉样式**

在 CSS 中定义收起、半展开和全展开状态；现有状态管理若只有开关，则保持行为不变并先实现半展开默认态，另将三停靠点交互作为同任务内的显式状态，测试点击拖动把手或展开按钮后的用户可见内容。

- [ ] **Step 6: 运行测试**

Run: `pnpm exec vitest run apps/web/src/components/app-shell.test.tsx`

Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/flight-panel.tsx apps/web/src/components/flight-details-page.tsx apps/web/src/components/app-shell.test.tsx apps/web/src/app/globals.css
git commit -m "style: clarify flight information hierarchy"
```

---

### Task 8: 同步机场与航线探索

**Files:**

- Modify: `apps/web/src/components/app-shell.test.tsx`
- Modify: `apps/web/src/components/airport-explorer.tsx`
- Modify: `apps/web/src/components/airport-picker.tsx`
- Modify: `apps/web/src/components/route-explorer.tsx`
- Modify: `apps/web/src/app/globals.css`
- Modify: `tests/e2e/airport-route.spec.ts`
- Modify: `tests/e2e/airport-search.spec.ts`

**Interfaces:**

- Consumes: 现有机场搜索、视野机场和航线匹配 API。
- Produces: 当前视野与全球搜索区分、机场连续流程和对称航线选择器。

- [ ] **Step 1: 写机场失败测试**

增加：

```tsx
expect(screen.getByText(/当前视野/)).toBeInTheDocument();
expect(screen.getByText('周边航班不等同于到港或离港班次')).toBeInTheDocument();
expect(screen.queryByText(/^0 架$/)).not.toBeInTheDocument();
```

- [ ] **Step 2: 写航线失败测试**

增加：

```tsx
expect(screen.getByRole('button', { name: '交换起点和终点' })).toBeInTheDocument();
expect(screen.getByText(/基于公开航班信息和实时位置归并/)).toBeInTheDocument();
```

- [ ] **Step 3: 运行测试并确认失败**

Run: `pnpm exec vitest run apps/web/src/components/app-shell.test.tsx`

Expected: FAIL，缺少明确说明或交换按钮名称。

- [ ] **Step 4: 实现机场层级**

将机场代码作为列表主扫描锚点，明确显示当前视野数量和全球搜索状态。未获得周边记录时显示「当前未获得记录」。手机端选择机场后隐藏列表并打开详情抽屉。

- [ ] **Step 5: 实现航线层级**

将起终点改为对称选择器，交换操作只交换两个机场；未完整选择时不传递活动航线到地图；匹配结果显示距离、方向、匹配数、更新时间和覆盖说明。

- [ ] **Step 6: 更新 E2E**

在桌面与手机项目中断言机场说明、交换按钮和航线覆盖说明可见，保持已有 PEK/JFK 工作流。

- [ ] **Step 7: 运行测试**

Run:

```bash
pnpm exec vitest run apps/web/src/components/app-shell.test.tsx
pnpm exec playwright test tests/e2e/airport-route.spec.ts tests/e2e/airport-search.spec.ts
```

Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/airport-explorer.tsx apps/web/src/components/airport-picker.tsx apps/web/src/components/route-explorer.tsx apps/web/src/components/app-shell.test.tsx apps/web/src/app/globals.css tests/e2e/airport-route.spec.ts tests/e2e/airport-search.spec.ts
git commit -m "style: deepen airport and route exploration"
```

---

### Task 9: 同步筛选、数据覆盖与系统状态

**Files:**

- Modify: `apps/web/src/components/app-shell.test.tsx`
- Modify: `apps/web/src/components/layer-filter-panel.tsx`
- Modify: `apps/web/src/components/data-status-panel.tsx`
- Modify: `apps/web/src/components/system-notice.tsx`
- Modify: `apps/web/src/app/globals.css`
- Modify: `tests/e2e/system-states.spec.ts`
- Modify: `tests/e2e/ui-controls.spec.ts`

**Interfaces:**

- Consumes: `FlightFilters`、`MapLayers`、`SourceStatus[]` 和 `RealtimeConnectionState`。
- Produces: 即时筛选模型、来源状态列表和全局状态语义。

- [ ] **Step 1: 写失败测试**

增加：

```tsx
expect(screen.queryByRole('button', { name: '应用' })).not.toBeInTheDocument();
expect(screen.getByRole('button', { name: '重置筛选' })).toBeInTheDocument();
expect(screen.getByText(/最后成功时间/)).toBeInTheDocument();
expect(screen.getByText(/当前航班数不代表全球实际在途总数/)).toBeInTheDocument();
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm exec vitest run apps/web/src/components/app-shell.test.tsx`

Expected: FAIL，当前筛选需要应用按钮或缺少覆盖说明。

- [ ] **Step 3: 改为即时筛选模型**

`layer-filter-panel.tsx` 每次字段变化立即调用既有 `onApply(nextFilters, nextLayers)`；移除「应用」，保留「重置筛选」并恢复 `defaultFlightFilters` 与 `defaultMapLayers`。

- [ ] **Step 4: 深化数据覆盖面板**

`data-status-panel.tsx` 顶部显示总体结论、最后成功时间和覆盖提示；每个来源显示最近结果、最后成功时间、记录数、错误类型和缓存语义。不得输出内部错误栈。

- [ ] **Step 5: 统一系统状态**

`system-notice.tsx` 为 loading、empty、warning 和 critical 提供文本与图标差异；全部来源不可用时说明地图和机场静态信息仍可使用。

- [ ] **Step 6: 更新 E2E 并运行**

Run:

```bash
pnpm exec vitest run apps/web/src/components/app-shell.test.tsx
pnpm exec playwright test tests/e2e/system-states.spec.ts tests/e2e/ui-controls.spec.ts
```

Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/layer-filter-panel.tsx apps/web/src/components/data-status-panel.tsx apps/web/src/components/system-notice.tsx apps/web/src/components/app-shell.test.tsx apps/web/src/app/globals.css tests/e2e/system-states.spec.ts tests/e2e/ui-controls.spec.ts
git commit -m "style: unify filters and data states"
```

---

### Task 10: 完成响应式、动效与无障碍门禁

**Files:**

- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/components/app-shell.test.tsx`
- Modify: `tests/e2e/mobile.spec.ts`
- Modify: `tests/e2e/live-map.spec.ts`
- Modify: `tests/e2e/ui-controls.spec.ts`

**Interfaces:**

- Consumes: Tasks 4–9 的全部组件和页面状态。
- Produces: 1440 × 900 与 390 × 844 稳定布局、键盘焦点和 reduced-motion 行为。

- [ ] **Step 1: 写失败测试**

在组件测试中验证键盘搜索与关闭面板；在 E2E 中计算主要按钮 bounding box，断言宽高不小于 44 px：

```ts
const box = await page.getByRole('button', { name: '打开图层与筛选' }).boundingBox();
expect(box?.width).toBeGreaterThanOrEqual(44);
expect(box?.height).toBeGreaterThanOrEqual(44);
```

- [ ] **Step 2: 运行聚焦测试并确认失败**

Run:

```bash
pnpm exec vitest run apps/web/src/components/app-shell.test.tsx
pnpm exec playwright test tests/e2e/mobile.spec.ts
```

Expected: 至少一个触控尺寸或键盘焦点断言 FAIL。

- [ ] **Step 3: 完成桌面布局规则**

在 CSS 中固定顶栏 64 px、左侧 320–360 px、右侧 340–380 px；两侧面板同时出现时保证地图最小有效宽度 640 px；宽度不足时优先折叠左侧列表。

- [ ] **Step 4: 完成手机布局规则**

390 × 844 下保证搜索框、地图控制和抽屉互不遮挡；隐藏桌面回看条与缩放按钮；复杂筛选使用全高抽屉；处理安全区和软键盘可用高度。

- [ ] **Step 5: 添加动效与 reduced motion**

使用 160–220 ms 面板过渡、150–200 ms 状态过渡，并添加：

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

- [ ] **Step 6: 运行响应式 E2E**

Run:

```bash
pnpm exec playwright test tests/e2e/mobile.spec.ts tests/e2e/live-map.spec.ts tests/e2e/ui-controls.spec.ts
```

Expected: 桌面与手机项目全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/globals.css apps/web/src/components/app-shell.test.tsx tests/e2e/mobile.spec.ts tests/e2e/live-map.spec.ts tests/e2e/ui-controls.spec.ts
git commit -m "style: complete responsive accessibility pass"
```

---

### Task 11: 视觉核对、文档同步与完整验证

**Files:**

- Modify: `docs/product-design.md`
- Modify: `docs/AGENTS.md`
- Modify: `docs/superpowers/plans/2026-07-12-aero-chart-visual-deepening.md`
- Output: `.ardot-qa/visual-deepening/implementation-desktop-1440x900.webp`
- Output: `.ardot-qa/visual-deepening/implementation-mobile-390x844.webp`

**Interfaces:**

- Consumes: 已确认 Ardot `main_deep` 和完成的前端实现。
- Produces: 视觉差异记录、完整验证结果和可交付提交。

- [ ] **Step 1: 启动完整本地环境**

Run:

```bash
pnpm infra:up
pnpm dev
```

Expected: Web 为 `http://127.0.0.1:3000`，API `/ready` 返回 200。

- [ ] **Step 2: 桌面端视觉核对**

以 1440 × 900 逐项核对全球实时、搜索、航班摘要、完整详情、机场、航线、筛选、数据覆盖和系统状态，并保存截图。

Expected: 与 `main_deep` 的结构、层级、颜色语义和控件尺寸一致；真实地图与真实数据不要求复刻 Ardot 示意几何和数字。

- [ ] **Step 3: 手机端视觉核对**

以 390 × 844 核对同一组流程，保存截图。

Expected: 无水平滚动、遮挡、裁切或小于 44 × 44 px 的主要触控区域。

- [ ] **Step 4: 更新文档**

在 `docs/product-design.md` 的视觉核对记录中新增本轮日期、视口、Ardot 页面 `main_deep（16:1）`、有意差异和状态覆盖；在 `docs/AGENTS.md` 将视觉深化状态更新为「已实现并完成视觉核对」。

- [ ] **Step 5: 运行完整验证**

确保宿主机 4000 端口未被开发容器占用后运行：

```bash
pnpm verify
pnpm format:check
```

Expected: lint、typecheck、unit、integration、build 和桌面/手机 E2E 全部通过；格式检查通过。

- [ ] **Step 6: 检查提交范围**

Run:

```bash
git status --short
git diff --check
git diff --stat origin/main...HEAD
```

Expected: `.env`、`.ardot-qa/`、测试报告、数据导入文件和依赖目录未进入提交。

- [ ] **Step 7: Commit**

```bash
git add docs/product-design.md docs/AGENTS.md docs/superpowers/plans/2026-07-12-aero-chart-visual-deepening.md
git commit -m "docs: record visual deepening verification"
```

---

## 完成标准

- `main_deep（16:1）` 包含全部核心页面的桌面端与手机端深化画板。
- Ardot Foundations、布局检查和视觉截图完成并取得设计确认。
- 前端只在设计确认后同步，不修改服务端契约和数据来源边界。
- 地图、选中对象、搜索、详情、机场、航线、筛选和状态使用统一视觉语义。
- 数据新鲜度、来源状态、覆盖度、降级和推断边界表达准确。
- 1440 × 900 与 390 × 844 视觉核对通过。
- `pnpm verify` 与 `pnpm format:check` 通过。
- 实施计划中的全部 checkbox 已勾选，所有任务均有独立提交。
