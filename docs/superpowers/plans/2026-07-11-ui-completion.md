# 航迹 UI 功能完成计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成产品设计和 User Case 中定义的全部首期 UI 功能，使每个可见控件都有真实行为，并覆盖正常、加载、空结果、断线、降级和过期状态。

**Architecture:** 保留单页地图工作台，由 `AppShell` 负责页面级状态，MapLibre 组件通过受控属性和命令引用响应缩放、定位、对象聚焦与图层切换。筛选、航线选择、完整详情、数据状态和短时回看拆成独立组件；纯筛选与位置计算放入 `lib`，便于单元测试。

**Tech Stack:** pnpm、TypeScript、Next.js、React、MapLibre GL JS、Vitest、Testing Library、Playwright。

---

## 文件结构

```text
apps/web/src/components/
  app-shell.tsx                 页面级状态与视图编排
  flight-map.tsx                地图图层、对象聚焦和命令接口
  map-controls.tsx              图层、定位和缩放按钮
  layer-filter-panel.tsx        图层开关与航班筛选
  data-status-panel.tsx         来源状态与重试说明
  flight-panel.tsx              地图中的航班摘要
  flight-details-page.tsx       完整航班详情与返回地图
  airport-explorer.tsx          机场筛选、列表与详情
  route-explorer.tsx            起终点选择、校验与结果
  playback-control.tsx          0–15 分钟短时位置回看
  system-notice.tsx             加载、断线、空视野和过期状态
apps/web/src/lib/
  flight-filters.ts             可靠字段筛选
  flight-playback.ts            基于航向与地速回推演示位置
  use-realtime-flights.ts       快照、WebSocket、重连与手动重试
tests/e2e/ui-controls.spec.ts   可见控件与状态端到端流程
tests/e2e/system-states.spec.ts 网络和空数据状态
```

### Task 1：建立 UI 状态模型与纯函数

**Files:**

- Create: `apps/web/src/lib/flight-filters.ts`
- Create: `apps/web/src/lib/flight-filters.test.ts`
- Create: `apps/web/src/lib/flight-playback.ts`
- Create: `apps/web/src/lib/flight-playback.test.ts`

- [x] **Step 1：先写筛选与回看失败测试**

```ts
expect(filterFlights(flights, { maxAltitudeM: 9_000, freshness: ['live'], airline: '' })).toEqual(
  expect.arrayContaining([expect.objectContaining({ callsign: 'MU5102' })]),
);
expect(projectFlightsBack([flight], 15)[0]?.longitude).not.toBe(flight.longitude);
```

- [x] **Step 2：确认测试因模块不存在而失败**

Run: `pnpm vitest run apps/web/src/lib/flight-filters.test.ts apps/web/src/lib/flight-playback.test.ts`

Expected: FAIL，提示无法导入待实现模块。

- [x] **Step 3：实现明确的 UI 状态类型和纯函数**

```ts
export type FlightFilters = {
  maxAltitudeM: number;
  freshness: Array<Flight['freshness']>;
  airline: string;
};

export function filterFlights(flights: Flight[], filters: FlightFilters): Flight[];
export function projectFlightsBack(flights: Flight[], minutes: number): Flight[];
```

筛选只使用统一模型内稳定存在的高度、新鲜度和航空公司字段。回看范围限制在 0–15 分钟，并对经纬度做合法范围修正。

- [x] **Step 4：运行纯函数测试**

Run: `pnpm vitest run apps/web/src/lib/flight-filters.test.ts apps/web/src/lib/flight-playback.test.ts`

Expected: PASS。

### Task 2：完成 MapLibre 地图控制和图层

**Files:**

- Modify: `apps/web/src/components/flight-map.tsx`
- Create: `apps/web/src/components/map-controls.tsx`
- Create: `apps/web/src/components/layer-filter-panel.tsx`
- Test: `apps/web/src/components/app-shell.test.tsx`

- [x] **Step 1：写地图控制与筛选组件测试**

```tsx
await user.click(screen.getByRole('button', { name: '地图图层' }));
expect(screen.getByRole('dialog', { name: '筛选与图层' })).toBeVisible();
await user.click(screen.getByRole('checkbox', { name: '机场与代码' }));
await user.click(screen.getByRole('button', { name: '应用筛选' }));
expect(screen.getByText(/已显示 \d+ 架航班/)).toBeVisible();
```

- [x] **Step 2：确认组件测试失败**

Run: `pnpm vitest run apps/web/src/components/app-shell.test.tsx`

Expected: FAIL，当前图层按钮不打开面板。

- [x] **Step 3：实现地图命令和受控图层**

```ts
export type FlightMapHandle = {
  zoomIn(): void;
  zoomOut(): void;
  flyTo(longitude: number, latitude: number, zoom?: number): void;
};

export type MapLayers = {
  flights: boolean;
  airports: boolean;
  tracks: boolean;
  labels: boolean;
};
```

地图增加机场 GeoJSON 图层、机场选择事件、选中航班航迹、动态航线路径和图层可见性更新。放大、缩小按钮调用 MapLibre；定位使用浏览器 Geolocation，拒绝授权时显示可关闭提示。

- [x] **Step 4：实现筛选面板**

面板包含航班、机场与代码、最近航迹、地图标签开关，高度上限、新鲜度和航空公司筛选，以及「重置」和「应用筛选」按钮。关闭、Escape 和遮罩点击均恢复地图操作。

- [x] **Step 5：运行组件测试**

Run: `pnpm vitest run apps/web/src/components/app-shell.test.tsx`

Expected: PASS。

### Task 3：完成数据加载、断线重连和系统状态

**Files:**

- Create: `apps/web/src/lib/use-realtime-flights.ts`
- Create: `apps/web/src/components/system-notice.tsx`
- Create: `apps/web/src/components/data-status-panel.tsx`
- Modify: `apps/web/src/components/data-status.tsx`
- Modify: `apps/web/src/components/app-shell.tsx`
- Test: `apps/web/src/components/app-shell.test.tsx`

- [x] **Step 1：写状态面板和重试测试**

```tsx
await user.click(screen.getByRole('button', { name: '实时数据状态' }));
expect(screen.getByRole('dialog', { name: '数据覆盖与服务状态' })).toBeVisible();
expect(screen.getByText('Airplanes.live')).toBeVisible();
expect(screen.getByText('部分区域更新延迟')).toBeVisible();
```

- [x] **Step 2：确认测试失败**

Run: `pnpm vitest run apps/web/src/components/app-shell.test.tsx`

Expected: FAIL，当前数据状态不是按钮且没有详情面板。

- [x] **Step 3：实现实时数据 Hook**

```ts
export type RealtimeConnectionState = 'loading' | 'online' | 'reconnecting' | 'offline';

export function useRealtimeFlights(
  initialData: AppData,
  enabled: boolean,
): {
  flights: Flight[];
  sourceStatuses: SourceStatus[];
  connectionState: RealtimeConnectionState;
  lastUpdatedAt: string | null;
  retry(): void;
};
```

Hook 负责首次快照、WebSocket 订阅、增量新增与删除、指数退避重连和手动重试。JSON 解析失败只忽略当前消息，不中断页面。

- [x] **Step 4：实现系统提示和数据状态面板**

加载时显示「正在连接实时航班网络」；重连时保留最后位置并显示秒数；离线时提供「重新连接」；空视野显示扩大范围提示；过期航班降低透明度。数据状态面板逐项显示来源、状态、最后成功时间和说明。

- [x] **Step 5：运行组件测试**

Run: `pnpm vitest run apps/web/src/components/app-shell.test.tsx`

Expected: PASS。

### Task 4：完成航班摘要与完整详情

**Files:**

- Modify: `apps/web/src/components/flight-panel.tsx`
- Create: `apps/web/src/components/flight-details-page.tsx`
- Modify: `apps/web/src/components/app-shell.tsx`
- Modify: `apps/web/src/app/globals.css`
- Test: `apps/web/src/components/app-shell.test.tsx`

- [x] **Step 1：写完整详情往返测试**

```tsx
await user.click(screen.getByRole('button', { name: '查看完整详情' }));
expect(screen.getByRole('heading', { name: '实时飞行数据' })).toBeVisible();
await user.click(screen.getByRole('button', { name: '返回地图' }));
expect(screen.getByRole('heading', { name: 'CA981' })).toBeVisible();
```

- [x] **Step 2：确认测试失败**

Run: `pnpm vitest run apps/web/src/components/app-shell.test.tsx`

Expected: FAIL，当前摘要没有详情入口。

- [x] **Step 3：实现摘要入口和完整详情页**

完整详情延续 Ardot 的航班身份、起终点、实时指标、90 分钟趋势图、观测事件、航空器字段、来源、置信度和更新时间。所有缺失字段显示「未获得数据」，不生成计划时刻、延误或到离港状态。返回地图保留视野和选中航班。

- [x] **Step 4：完成手机端详情布局**

390 px 视口使用单列指标和简化趋势图，返回按钮保持 44 × 44 px 点击范围，页面不产生横向滚动。

- [x] **Step 5：运行组件测试**

Run: `pnpm vitest run apps/web/src/components/app-shell.test.tsx`

Expected: PASS。

### Task 5：完成机场探索和地图联动

**Files:**

- Modify: `apps/web/src/components/airport-explorer.tsx`
- Modify: `apps/web/src/components/app-shell.tsx`
- Modify: `apps/web/src/components/flight-map.tsx`
- Test: `apps/web/src/components/app-shell.test.tsx`

- [x] **Step 1：写机场筛选和地图选择测试**

```tsx
await user.click(screen.getByRole('tab', { name: '机场' }));
await user.click(screen.getByRole('button', { name: '热门机场' }));
expect(screen.getByRole('button', { name: /纽约约翰·肯尼迪国际机场/ })).toBeVisible();
await user.click(screen.getByRole('button', { name: /北京首都国际机场/ }));
expect(screen.getByRole('heading', { name: 'PEK' })).toBeVisible();
```

- [x] **Step 2：确认测试失败**

Run: `pnpm vitest run apps/web/src/components/app-shell.test.tsx`

Expected: FAIL，当前筛选按钮没有状态变化。

- [x] **Step 3：实现机场筛选**

「全部」展示当前数据集；「附近」按地图中心与机场距离排序，并标明排序依据；「热门」优先展示大型机场。列表为空时显示搜索或扩大范围入口。

- [x] **Step 4：实现地图联动**

从搜索、机场列表或地图机场图层选择机场时，地图聚焦对应坐标并突出机场标记。手机端在列表和详情底部抽屉之间返回，不丢失所选筛选。

- [x] **Step 5：运行组件测试**

Run: `pnpm vitest run apps/web/src/components/app-shell.test.tsx`

Expected: PASS。

### Task 6：完成航线选择、校验与地图结果

**Files:**

- Modify: `apps/web/src/components/route-explorer.tsx`
- Create: `apps/web/src/components/airport-picker.tsx`
- Modify: `apps/web/src/components/app-shell.tsx`
- Modify: `apps/web/src/components/flight-map.tsx`
- Test: `apps/web/src/components/app-shell.test.tsx`

- [x] **Step 1：写航线重选和空结果测试**

```tsx
await user.click(screen.getByRole('button', { name: '选择到达机场' }));
await user.click(screen.getByRole('option', { name: /上海浦东国际机场/ }));
expect(screen.getByText('PEK → PVG')).toBeVisible();
expect(screen.getByText('当前没有匹配的在途航班')).toBeVisible();
```

- [x] **Step 2：确认测试失败**

Run: `pnpm vitest run apps/web/src/components/app-shell.test.tsx`

Expected: FAIL，当前起终点按钮不会打开选择器。

- [x] **Step 3：实现机场选择器和校验**

选择器支持代码、名称和城市过滤，起终点可清除、重选和交换。起终点相同时显示「起点和终点不能相同」，不更新航线结果。

- [x] **Step 4：实现动态航线结果**

RouteExplorer 根据当前起终点计算大圆距离和匹配航班；地图只强调匹配航班并绘制动态大圆近似线。列表、数量和地图使用同一结果集合，空结果仍保留航线和说明。

- [x] **Step 5：运行组件测试**

Run: `pnpm vitest run apps/web/src/components/app-shell.test.tsx`

Expected: PASS。

### Task 7：完成 15 分钟回看、快捷键和可访问性

**Files:**

- Create: `apps/web/src/components/playback-control.tsx`
- Modify: `apps/web/src/components/search-box.tsx`
- Modify: `apps/web/src/components/app-shell.tsx`
- Modify: `apps/web/src/app/globals.css`
- Test: `apps/web/src/components/app-shell.test.tsx`

- [x] **Step 1：写回看和键盘测试**

```tsx
fireEvent.change(screen.getByRole('slider', { name: '航迹回看时间' }), { target: { value: '15' } });
expect(screen.getByText('15 分钟前')).toBeVisible();
fireEvent.keyDown(window, { key: 'k', metaKey: true });
expect(screen.getByRole('searchbox')).toHaveFocus();
```

- [x] **Step 2：确认测试失败**

Run: `pnpm vitest run apps/web/src/components/app-shell.test.tsx`

Expected: FAIL，当前回看条没有滑块语义且快捷键不生效。

- [x] **Step 3：实现短时回看**

使用范围滑块选择 0–15 分钟，地图使用 `projectFlightsBack` 展示演示位置；「返回实时」恢复 0 分钟。文案明确这是短时位置估算，不作为长期历史轨迹。

- [x] **Step 4：完成键盘和焦点行为**

`⌘ K` 和 `Ctrl K` 聚焦搜索框；Escape 依次关闭搜索结果、弹层和抽屉。所有图标按钮有名称、焦点环和至少 44 × 44 px 点击范围；状态不只使用颜色表达。

- [x] **Step 5：运行组件测试**

Run: `pnpm vitest run apps/web/src/components/app-shell.test.tsx`

Expected: PASS。

### Task 8：补齐桌面、手机和系统状态 E2E

**Files:**

- Create: `tests/e2e/ui-controls.spec.ts`
- Create: `tests/e2e/system-states.spec.ts`
- Modify: `tests/e2e/live-map.spec.ts`
- Modify: `tests/e2e/airport-route.spec.ts`
- Modify: `tests/e2e/mobile.spec.ts`

- [x] **Step 1：写全部可见控件 E2E**

覆盖图层开关、筛选应用/重置、缩放、定位拒绝、完整详情往返、数据状态、机场筛选、航线重选和 15 分钟回看。

- [x] **Step 2：写异常状态 E2E**

使用 Playwright 路由中止快照请求，断开 WebSocket，验证页面保留初始地图、显示重连提示且「重新连接」可操作；使用高海拔筛选验证「当前筛选暂无航班」。

- [x] **Step 3：运行桌面和手机 E2E**

Run: `pnpm e2e`

Expected: 所有桌面和手机项目通过，手机专用测试只在桌面项目按预期跳过。

### Task 9：视觉与最终验证

**Files:**

- Modify: `docs/product-design.md`
- Modify: `docs/AGENTS.md`
- Modify: this plan

- [x] **Step 1：捕获原生尺寸页面状态**

使用 Playwright 捕获 1440 × 900 和 390 × 844 的全球地图、筛选、航班摘要、完整详情、机场、航线和数据状态；截图保存到 `/tmp`，不写入仓库。

- [x] **Step 2：与 Ardot 逐项比较**

同时使用 `view_image` 查看 Ardot 原图和最新实现图，记录并修复文案、布局、字体、颜色、控件、间距、图标、地图占比和手机抽屉差异。

- [x] **Step 3：运行完整验证**

Run: `pnpm verify && pnpm format:check`

Expected: lint、类型检查、全部单元/组件测试、构建、E2E 和格式检查通过。

- [x] **Step 4：更新文档与计划状态**

产品文档明确短时回看边界和各状态行为；本计划所有完成项均勾选，未完成项不得标记完成。

## 计划自检

- UC-01 至 UC-10 均有对应实现和验证任务。
- 所有当前可见的按钮、开关、滑块和筛选都有真实状态变化。
- 正常、加载、空结果、空视野、断线、降级和过期状态均有界面与测试。
- 机场周边和航线匹配继续遵守非官方班次数据边界。
- 账号、收藏同步、机场时刻表和长期轨迹仍不在首期范围。
- 当前目录不是 Git 仓库，计划不包含无法执行的提交步骤。
