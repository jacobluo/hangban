# 地图交互细节优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复选中机场辨识度、航线机场选择器裁切和机场周边航班返回路径，并把天气雷达图例标题改为「天气雷达降水图」。

**Architecture:** 保持现有 `AppShell` 视图状态、MapLibre GeoJSON 数据源和面板组件结构。地图用独立的选中机场光环、点和标签图层表达焦点；航线选择器用显式打开状态解除父面板裁切；机场来源上下文由 `AppShell` 持有，并通过 `FlightPanel` 的可选返回动作恢复。

**Tech Stack:** TypeScript、React、Next.js、MapLibre GL JS、Vitest、Testing Library、Playwright、pnpm workspace。

## Global Constraints

- 普通机场标记、机场与航班领域契约、数据适配层均保持不变。
- 地图图例可见标题使用「天气雷达降水图」；图层开关和可访问名称继续使用「天气雷达」。
- 从机场周边航班进入详情时，返回按钮与关闭按钮都恢复原机场上下文。
- 从其他入口进入航班详情时，不建立机场返回上下文。
- 轨迹回看继续使用 0–15 分钟估算位置，不修改时长、算法或播放行为。
- 视觉变更必须检查 1440 × 900 和 390 × 844。
- 不新增依赖，不修改第三方数据源或浏览器安全边界。

---

## 文件结构

- `apps/web/src/components/flight-map.tsx`：定义选中机场的 MapLibre 图层和层级。
- `apps/web/src/components/route-explorer.tsx`：向航线构建面板暴露选择器打开状态。
- `apps/web/src/components/weather-radar-legend.tsx`：承载图例可见标题。
- `apps/web/src/components/flight-panel.tsx`：展示可选的机场上下文返回动作。
- `apps/web/src/components/app-shell.tsx`：记录、清除和恢复机场来源上下文。
- `apps/web/src/app/globals.css`：选中机场之外的面板、返回动作和响应式样式。
- `apps/web/src/components/*.test.tsx`：组件和 MapLibre 图层回归测试。
- `tests/e2e/airport-route.spec.ts`、`tests/e2e/ui-controls.spec.ts`：真实用户路径和双视口回归。
- `.ardot-qa/`：保存更新后设计与实现的桌面端、手机端视觉检查产物。

### Task 1: 同步 Ardot 原型基线

**Files:**

- Update: Ardot `hangban` / `main_deep（16:1）`
- Create: `.ardot-qa/2026-07-14-map-interaction-polish/` 下的原型截图

**Interfaces:**

- Consumes: `docs/superpowers/specs/2026-07-14-map-interaction-polish-design.md`
- Produces: 可供前端还原的选中机场、机场上下文返回和图例标题设计基线

- [x] **Step 1: 更新共用机场标记状态**

在 `main_deep（16:1）` 的共用机场标记组件中增加或更新 `selected` 变体：9 px 橙色实心点、2 px 白色描边、18 px 半透明橙色光环和橙色机场代码。普通变体保持不变。

- [x] **Step 2: 更新机场与航班详情画板**

在桌面端与手机端机场画板中补充从周边航班进入航班详情后的「返回 PEK 周边航班」动作；保留右上角关闭动作，并标注两者都恢复机场上下文。

- [x] **Step 3: 更新航线选择器与雷达图例画板**

确认航线机场选择器越过面板底边时不裁切、选项列表内部滚动；把地图图例可见标题改为「天气雷达降水图」，不改图层开关名称。

- [x] **Step 4: 导出双视口截图并核对**

导出 1440 × 900 和 390 × 844 画板截图到 `.ardot-qa/2026-07-14-map-interaction-polish/`。确认没有重叠、裁切、文本溢出或小于 44 × 44 px 的手机端主要触控区域。

- [x] **Step 5: 提交原型检查记录**

```bash
git add .ardot-qa/2026-07-14-map-interaction-polish
git commit -m "docs: confirm map interaction polish prototype"
```

Expected: 提交只包含本轮原型视觉检查产物，不包含前端源码。

### Task 2: 强化选中机场地图焦点

**Files:**

- Modify: `apps/web/src/components/flight-map.tsx`
- Test: `apps/web/src/components/flight-map.test.tsx`

**Interfaces:**

- Consumes: `airportsToGeoJson(airports, selectedAirport)` 产生的 `selected: 0 | 1`
- Produces: `airport-selection-halo`、`airport-points`、`airport-selected-label`、`airport-labels` 图层

- [x] **Step 1: 写失败的 MapLibre 图层测试**

把 `FakeMap.addLayer` 的参数类型扩展为可检查的图层对象，并新增断言：

```tsx
it('renders the selected airport with a halo, orange point, and always-visible label', async () => {
  render(<FlightMap {...baseProps} airports={[pek]} selectedAirport={pek} />);
  await waitFor(() => expect(mapInstances).toHaveLength(1));
  mapInstances[0]!.emit('load');

  expect(mapInstances[0]!.addLayer).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'airport-selection-halo',
      filter: ['==', ['get', 'selected'], 1],
      paint: expect.objectContaining({ 'circle-radius': 18, 'circle-color': '#ff6f3d' }),
    }),
  );
  expect(mapInstances[0]!.addLayer).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'airport-selected-label',
      filter: ['==', ['get', 'selected'], 1],
      paint: expect.objectContaining({ 'text-color': '#ff6f3d' }),
    }),
  );
});
```

- [x] **Step 2: 运行测试并确认按预期失败**

Run: `pnpm vitest run apps/web/src/components/flight-map.test.tsx`

Expected: FAIL，缺少 `airport-selection-halo` 和 `airport-selected-label` 图层。

- [x] **Step 3: 实现选中机场图层**

在普通机场点之前增加光环；把机场点样式改为按 `selected` 分支；在普通标签之前增加无 `minzoom` 的选中标签：

```tsx
map.addLayer({
  id: 'airport-selection-halo',
  type: 'circle',
  source: 'airports',
  filter: ['==', ['get', 'selected'], 1],
  paint: {
    'circle-radius': 18,
    'circle-color': '#ff6f3d',
    'circle-opacity': 0.14,
    'circle-stroke-color': '#ff6f3d',
    'circle-stroke-width': 1.5,
    'circle-stroke-opacity': 0.5,
  },
});
```

`airport-points` 的选中半径为 9、选中填充为 `#ff6f3d`、选中描边为白色；普通样式保持原值。`airport-selected-label` 过滤 `selected === 1`，使用现有代码字段和排版，文字颜色为 `#ff6f3d`。普通 `airport-labels` 过滤 `selected !== 1`，继续从 zoom 2.4 开始显示。

- [x] **Step 4: 更新图层可见性同步**

在初始化和 `layers` effect 中让 `airport-selection-halo`、`airport-selected-label` 与 `layers.airports` 同步；普通标签仍同时受 `layers.airports && layers.labels` 控制，选中标签也尊重 `layers.labels`。

- [x] **Step 5: 运行聚焦测试**

Run: `pnpm vitest run apps/web/src/components/flight-map.test.tsx`

Expected: PASS。

- [x] **Step 6: 提交选中机场修复**

```bash
git add apps/web/src/components/flight-map.tsx apps/web/src/components/flight-map.test.tsx
git commit -m "fix: strengthen selected airport focus"
```

### Task 3: 修复航线机场选择器裁切

**Files:**

- Modify: `apps/web/src/components/route-explorer.tsx`
- Modify: `apps/web/src/app/globals.css`
- Test: `apps/web/src/components/app-shell.test.tsx`

**Interfaces:**

- Consumes: `picker: 'origin' | 'destination' | null`
- Produces: `.route-builder.picker-open` 状态和选择器自身有界滚动区域

- [x] **Step 1: 写失败的打开状态测试**

在现有航线端点测试中加入：

```tsx
const routeBuilder = screen.getByRole('region', { name: '航线探索' });
await user.click(screen.getByRole('button', { name: /选择到达机场/ }));
expect(routeBuilder).toHaveClass('picker-open');
expect(screen.getByRole('listbox', { name: '到达机场选项' })).toBeVisible();
await user.click(screen.getByRole('button', { name: '关闭到达机场选择器' }));
expect(routeBuilder).not.toHaveClass('picker-open');
```

同时读取 `globals.css`，断言 `.route-builder.picker-open` 使用 `overflow: visible`，选择列表仍使用 `overflow: auto`。

- [x] **Step 2: 运行测试并确认按预期失败**

Run: `pnpm vitest run apps/web/src/components/app-shell.test.tsx`

Expected: FAIL，航线面板没有 `picker-open` 类。

- [x] **Step 3: 实现面板打开状态和边界样式**

把航线面板改为：

```tsx
<section
  className={`explorer-panel route-builder${picker === null ? '' : ' picker-open'}`}
  aria-labelledby="route-explorer-title"
>
```

添加样式：

```css
.route-builder.picker-open {
  overflow: visible;
}
.route-builder.picker-open .airport-picker {
  max-height: calc(100dvh - 280px);
}
.route-builder.picker-open .airport-option-list {
  max-height: min(260px, calc(100dvh - 370px));
  overflow: auto;
}
```

手机断点保留 `34dvh` 列表上限，并确保选择器仍位于端点卡片下方。

- [x] **Step 4: 运行聚焦测试**

Run: `pnpm vitest run apps/web/src/components/app-shell.test.tsx`

Expected: PASS。

- [x] **Step 5: 提交选择器修复**

```bash
git add apps/web/src/components/route-explorer.tsx apps/web/src/app/globals.css apps/web/src/components/app-shell.test.tsx
git commit -m "fix: prevent route airport picker clipping"
```

### Task 4: 调整天气雷达图例标题

**Files:**

- Modify: `apps/web/src/components/weather-radar-legend.tsx`
- Test: `apps/web/src/components/weather-radar-legend.test.tsx`

**Interfaces:**

- Consumes: `WeatherRadarLegend` 现有雷达状态
- Produces: 可见标题「天气雷达降水图」

- [x] **Step 1: 写失败的标题测试**

```tsx
render(<WeatherRadarLegend radar={radar('latest')} playbackActive={false} />);
expect(screen.getByText('天气雷达降水图')).toBeVisible();
expect(screen.getByLabelText('天气雷达图例')).toBeVisible();
```

- [x] **Step 2: 运行测试并确认按预期失败**

Run: `pnpm vitest run apps/web/src/components/weather-radar-legend.test.tsx`

Expected: FAIL，找不到「天气雷达降水图」。

- [x] **Step 3: 修改可见标题**

```tsx
<strong>天气雷达降水图</strong>
```

不修改图例 `aria-label`、图层选项和错误文案。

- [x] **Step 4: 运行聚焦测试**

Run: `pnpm vitest run apps/web/src/components/weather-radar-legend.test.tsx`

Expected: PASS。

- [x] **Step 5: 提交标题调整**

```bash
git add apps/web/src/components/weather-radar-legend.tsx apps/web/src/components/weather-radar-legend.test.tsx
git commit -m "fix: clarify weather radar legend title"
```

### Task 5: 恢复机场周边航班来源上下文

**Files:**

- Modify: `apps/web/src/components/app-shell.tsx`
- Modify: `apps/web/src/components/flight-panel.tsx`
- Modify: `apps/web/src/app/globals.css`
- Test: `apps/web/src/components/app-shell.test.tsx`
- Test: `tests/e2e/airport-route.spec.ts`

**Interfaces:**

- Consumes: `AirportExplorer.onFlightSelect(flight)` 和当前 `selectedAirport`
- Produces: `FlightPanel.returnLabel?: string`、`FlightPanel.onReturn?: () => void` 与机场上下文恢复行为

- [x] **Step 1: 写失败的组件回归测试**

从机场页选择 PEK，再点击一个周边航班，断言上下文动作存在并可恢复：

```tsx
await user.click(screen.getByRole('tab', { name: '机场' }));
await user.click(screen.getByRole('button', { name: /北京首都国际机场/ }));
await user.click(screen.getByRole('button', { name: /CA981/ }));
expect(screen.getByRole('button', { name: '返回 PEK 周边航班' })).toBeVisible();
await user.click(screen.getByRole('button', { name: '返回 PEK 周边航班' }));
expect(screen.getByRole('heading', { name: 'PEK' })).toBeVisible();
expect(screen.getByText('周边实时航班')).toBeVisible();
```

另一个测试重新进入航班详情并点击「关闭航班详情」，断言同样恢复 PEK。现有全局搜索航班测试继续断言关闭后不出现机场上下文动作。

- [x] **Step 2: 运行测试并确认按预期失败**

Run: `pnpm vitest run apps/web/src/components/app-shell.test.tsx`

Expected: FAIL，缺少「返回 PEK 周边航班」。

- [x] **Step 3: 扩展航班摘要接口**

把 `FlightPanel` 属性改为：

```tsx
type Props = {
  flight: Flight;
  onClose: () => void;
  onOpenDetails: () => void;
  returnLabel?: string;
  onReturn?: () => void;
};
```

当两个可选属性同时存在时，在 `.panel-heading` 中渲染：

```tsx
<button className="context-back" type="button" onClick={onReturn}>
  <ArrowLeft size={16} /> {returnLabel}
</button>
```

导入 `ArrowLeft`，并为按钮增加清晰的悬停、键盘焦点和手机端 44 px 触控样式。

- [x] **Step 4: 在 AppShell 记录和恢复上下文**

新增：

```tsx
const [flightReturnAirport, setFlightReturnAirport] = useState<Airport | null>(null);
```

普通 `chooseFlight` 先清空 `flightReturnAirport`。新增 `chooseNearbyFlight`，在切换到 `live` 前保存当前机场。新增 `returnFromFlight`：有来源机场时恢复 `view='airports'`、`selectedAirport`、`mobileAirportDetailOpen=true` 并聚焦机场；没有来源时只清空当前航班。

`AirportExplorer.onFlightSelect` 使用 `chooseNearbyFlight`。`FlightPanel` 接收：

```tsx
returnLabel={flightReturnAirport ? `返回 ${flightReturnAirport.iata ?? flightReturnAirport.icao} 周边航班` : undefined}
onReturn={flightReturnAirport ? returnFromFlight : undefined}
onClose={returnFromFlight}
```

顶部页面切换、`chooseAirport` 和非机场入口选择航班时清除 `flightReturnAirport`。

- [x] **Step 5: 运行组件测试**

Run: `pnpm vitest run apps/web/src/components/app-shell.test.tsx`

Expected: PASS，包括返回动作、关闭动作和无上下文入口。

- [x] **Step 6: 增加 Playwright 机场往返测试**

在 `tests/e2e/airport-route.spec.ts` 增加桌面与手机共用流程：搜索或选择 PEK、点击周边 CA981、确认航班详情、点击「返回 PEK 周边航班」、确认 PEK 与周边航班列表恢复。再次进入后点击「关闭航班详情」，确认结果相同。

- [x] **Step 7: 运行 E2E 聚焦测试**

Run: `pnpm exec playwright test tests/e2e/airport-route.spec.ts`

Expected: desktop 和 mobile 项目全部 PASS。

- [x] **Step 8: 提交上下文返回修复**

```bash
git add apps/web/src/components/app-shell.tsx apps/web/src/components/flight-panel.tsx apps/web/src/app/globals.css apps/web/src/components/app-shell.test.tsx tests/e2e/airport-route.spec.ts
git commit -m "fix: restore airport context from nearby flights"
```

### Task 6: 文档、视觉核对与完整验证

**Files:**

- Modify: `docs/product-design.md`
- Modify: `docs/superpowers/plans/2026-07-14-map-interaction-polish.md`
- Create: `.ardot-qa/2026-07-14-map-interaction-polish/desktop-implementation.png`
- Create: `.ardot-qa/2026-07-14-map-interaction-polish/mobile-implementation.png`

**Interfaces:**

- Consumes: Tasks 1–5 的已通过实现
- Produces: 当前实现记录、双视口证据和完整门禁结果

- [x] **Step 1: 运行全部 Web 聚焦测试**

Run: `pnpm vitest run apps/web/src/components/flight-map.test.tsx apps/web/src/components/app-shell.test.tsx apps/web/src/components/weather-radar-legend.test.tsx`

Expected: PASS。

- [x] **Step 2: 运行相关 E2E**

Run: `pnpm exec playwright test tests/e2e/airport-route.spec.ts tests/e2e/ui-controls.spec.ts tests/e2e/weather-radar.spec.ts`

Expected: desktop 和 mobile 项目全部 PASS。

- [x] **Step 3: 完成实现视觉核对**

在 1440 × 900 截取选中机场、航线选择器展开、天气雷达图例和机场上下文返回动作；在 390 × 844 重复关键路径。保存到 `.ardot-qa/2026-07-14-map-interaction-polish/`，确认选择器完整、焦点清晰、返回动作可达且无内容遮挡。

- [x] **Step 4: 更新产品实现记录**

在 `docs/product-design.md` 增加 2026-07-14 小节，明确四项当前实现、双视口核对结果和轨迹回看未变更。不得把尚未运行的门禁写成已通过。

- [x] **Step 5: 运行完整门禁**

Run: `pnpm verify`

Expected: lint、typecheck、unit/component、build 和 E2E 全部通过；条件性外部基础设施测试按仓库配置处理。

- [x] **Step 6: 运行格式检查**

Run: `pnpm format:check`

Expected: PASS。

- [x] **Step 7: 勾选计划并提交交付记录**

把本计划所有已完成步骤改为 `[x]`，记录实际测试数量、跳过项和视觉截图路径，然后执行：

```bash
git add docs/product-design.md docs/superpowers/plans/2026-07-14-map-interaction-polish.md .ardot-qa/2026-07-14-map-interaction-polish
git commit -m "docs: close map interaction polish plan"
```

Expected: 工作区只保留用户原有的无关文件，所有本轮实现和文档均已提交。

实际结果：`pnpm verify` 通过 430 个单元与组件测试、9 个集成测试和 31 个 E2E，1 个桌面项目条件用例跳过；lint、typecheck、production build 与 `pnpm format:check` 均通过。实现截图为 `.ardot-qa/2026-07-14-map-interaction-polish/desktop-implementation.png` 和 `.ardot-qa/2026-07-14-map-interaction-polish/mobile-implementation.png`。
