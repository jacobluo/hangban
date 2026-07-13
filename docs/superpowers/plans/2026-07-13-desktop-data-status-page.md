# 桌面端数据状态整页实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 PC 端实时状态入口从地图右侧栏改为符合 Ardot `16:1970` 的独立整页，同时保留手机全高页面和返回地图上下文。

**Architecture:** `AppShell` 继续持有状态页开关，地图与状态页使用互斥的页面层级，不新增 Next.js 路由。现有 `DataStatusPanel` 重构为 `DataStatusPage`，只消费已有实时状态输入；CSS 提供桌面双栏和手机单列全高布局。

**Tech Stack:** Next.js 16、React 19、TypeScript、Vitest、Testing Library、Playwright、CSS。

## Global Constraints

- PC 验收视口为 `1440 × 900`，手机验收视口为 `390 × 844`。
- 不展示 Ardot 中无法由当前契约验证的 `12,842`、`8 s`、`87%` 或区域覆盖率。
- 返回地图后保留地图视野、筛选和选中对象。
- 状态不能只通过颜色表达；主要手机触控区域不小于 `44 × 44 px`。
- 不修改数据适配层、实时事件、数据库或数据源契约。
- 不提交 `.env.example`、`.pnpm-store/` 或 `.ardot-qa/` 检查产物。

---

## 文件结构

- `apps/web/src/components/data-status-page.tsx`：独立状态页的语义、指标、数据源和返回操作。
- `apps/web/src/components/app-shell.tsx`：打开、关闭、地图互斥和触发器焦点恢复。
- `apps/web/src/components/app-shell.test.tsx`：状态页打开、关闭、键盘返回和地图上下文回归。
- `apps/web/src/app/globals.css`：桌面双栏、手机单列与全高滚动布局。
- `tests/e2e/ui-controls.spec.ts`：桌面和手机真实交互、尺寸与无水平溢出。
- `docs/product-design.md`：实现与视觉核对记录。

### Task 1: 建立状态页行为回归测试

**Files:**

- Modify: `apps/web/src/components/app-shell.test.tsx`
- Modify: `tests/e2e/ui-controls.spec.ts`

**Interfaces:**

- Consumes: `AppShell({ initialData, mapEnabled })`。
- Produces: 独立页面容器 `aria-label="数据覆盖与服务状态"`、返回操作 `aria-label="返回地图"`。

- [ ] **Step 1: 修改组件测试，表达独立页面行为**

将旧的 `role="dialog"` 断言替换为以下用户行为：

```tsx
await user.click(screen.getByRole('button', { name: '实时位置，部分覆盖' }));

expect(screen.getByRole('region', { name: '数据覆盖与服务状态' })).toBeVisible();
expect(screen.queryByRole('main', { name: '全球实时航班地图' })).not.toBeVisible();

await user.click(screen.getByRole('button', { name: '返回地图' }));
expect(screen.getByRole('main', { name: '全球实时航班地图' })).toBeVisible();
```

增加 `Escape` 返回断言，并在打开状态页前选择 `CA981`，返回后断言 `CA981` 摘要仍存在。

- [ ] **Step 2: 运行组件测试，确认因旧侧栏实现失败**

Run:

```bash
pnpm test:unit apps/web/src/components/app-shell.test.tsx
```

Expected: FAIL，无法找到独立 `region` 或地图仍可见。

- [ ] **Step 3: 修改 E2E 断言，表达响应式验收标准**

打开实时状态后断言：

```ts
const statusPage = page.getByRole('region', { name: '数据覆盖与服务状态' });
await expect(statusPage).toBeVisible();
await expect(page.getByRole('main', { name: '全球实时航班地图' })).toBeHidden();
```

PC 断言状态页宽度等于视口宽度，手机断言 `scrollWidth <= clientWidth`；关闭后继续执行现有筛选和航班详情流程，证明上下文未丢失。

- [ ] **Step 4: 提交失败测试**

```bash
git add apps/web/src/components/app-shell.test.tsx tests/e2e/ui-controls.spec.ts
git commit -m "test: require full-page data status"
```

### Task 2: 实现独立数据状态页

**Files:**

- Create: `apps/web/src/components/data-status-page.tsx`
- Delete: `apps/web/src/components/data-status-panel.tsx`
- Modify: `apps/web/src/components/app-shell.tsx`
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**

- Consumes: `statuses: SourceStatus[]`、`connectionState: RealtimeConnectionState`、`flightCount: number`、`lastUpdatedAt: string | null`、`onBack(): void`、`onRetry(): void`。
- Produces: `DataStatusPage` 独立页面组件；页面容器使用 `className="data-status-page"` 与 `aria-labelledby="data-status-title"`。

- [ ] **Step 1: 创建页面组件**

将当前状态计算和数据源详情迁移到 `DataStatusPage`，根结构为：

```tsx
<section className="data-status-page" role="region" aria-labelledby="data-status-title">
  <div className="data-status-container">
    <header className="data-status-heading">
      <button ref={backButtonRef} className="back-to-map" aria-label="返回地图" onClick={onBack}>
        <ArrowLeft size={17} /> 返回地图
      </button>
      <div>
        <h1 id="data-status-title">数据覆盖与服务状态</h1>
        <p>查看实时数据源、覆盖范围和数据新鲜度</p>
      </div>
      <div className={`overall-health ${connectionState}`} role="status">
        …
      </div>
    </header>
    <div className="status-metrics">…</div>
    <div className="data-status-content">
      <section aria-labelledby="provider-status-title">…</section>
      <aside aria-labelledby="coverage-boundary-title">…</aside>
    </div>
  </div>
</section>
```

组件挂载后聚焦返回按钮；监听 `Escape` 并调用 `onBack`。覆盖说明明确当前航班数仅反映当前已获得记录，不生成平均延迟或区域覆盖率。

- [ ] **Step 2: 在 AppShell 中切换页面层级**

将 `statusPanelOpen` 更名为 `statusPageOpen`。所有状态入口调用统一的 `openStatusPage()`，记录触发元素；打开时关闭筛选和完整航班详情。地图区域仅在状态页关闭时渲染：

```tsx
{statusPageOpen ? (
  <DataStatusPage … onBack={closeStatusPage} />
) : (
  <section className="map-stage" role="main" aria-label="全球实时航班地图">…</section>
)}
```

`closeStatusPage()` 关闭页面并在下一个动画帧恢复触发器焦点，不修改 `view`、`selectedFlight`、`filters`、`mapLayers` 或地图 ref。

- [ ] **Step 3: 实现桌面和手机布局**

新增样式：

```css
.data-status-page {
  position: fixed;
  z-index: 30;
  inset: var(--topbar-height) 0 0;
  overflow: auto;
  background: var(--map-sky);
}
.data-status-container {
  width: min(1312px, calc(100% - 64px));
  margin: 0 auto;
  padding: 36px 0 48px;
}
.data-status-content {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(360px, 1fr);
  gap: 20px;
}
```

在 `max-width: 700px` 下使用 `inset: 0`、单列布局、`16 px` 横向间距和至少 `44 px` 的返回、重试按钮。删除 `.data-status-panel` 对通用 `.detail-panel` 的依赖。

- [ ] **Step 4: 运行组件测试并修正实现**

Run:

```bash
pnpm test:unit apps/web/src/components/app-shell.test.tsx
```

Expected: PASS，所有 `AppShell` 测试通过。

- [ ] **Step 5: 运行类型和格式检查**

Run:

```bash
pnpm typecheck
pnpm exec prettier --check apps/web/src/components/data-status-page.tsx apps/web/src/components/app-shell.tsx apps/web/src/components/app-shell.test.tsx apps/web/src/app/globals.css tests/e2e/ui-controls.spec.ts
```

Expected: exit code `0`。

- [ ] **Step 6: 提交实现**

```bash
git add apps/web/src/components/data-status-page.tsx apps/web/src/components/data-status-panel.tsx apps/web/src/components/app-shell.tsx apps/web/src/app/globals.css
git commit -m "fix: render data status as full page"
```

### Task 3: 验证响应式页面并记录结果

**Files:**

- Modify: `tests/e2e/ui-controls.spec.ts`
- Modify: `docs/product-design.md`
- Modify: `docs/superpowers/plans/2026-07-13-desktop-data-status-page.md`

**Interfaces:**

- Consumes: Playwright `desktop` 与 `mobile` projects。
- Produces: 可复现的响应式回归断言和文档验收记录。

- [ ] **Step 1: 运行相关 E2E**

Run:

```bash
pnpm e2e tests/e2e/ui-controls.spec.ts
```

Expected: desktop 与 mobile 均通过，状态页打开、返回和后续流程正常。

- [ ] **Step 2: 在 `1440 × 900` 与 `390 × 844` 核对页面**

保存检查截图到忽略目录 `.ardot-qa/data-status-page/`，检查：

- PC 状态页占据完整应用内容区，不出现 `360 px` 右侧侧栏。
- 数据源与覆盖说明形成稳定双栏，内容没有裁切。
- 手机状态页占满视口、可纵向滚动、无水平溢出。
- 返回操作和重试操作在手机端不小于 `44 × 44 px`。

- [ ] **Step 3: 更新产品设计记录**

在 `docs/product-design.md` 记录实现视口、Ardot 节点、有意不复刻的示意指标和截图路径。

- [ ] **Step 4: 运行完整门禁**

Run:

```bash
pnpm verify
pnpm format:check
```

Expected: lint、typecheck、unit、integration、build、E2E 和格式检查全部通过。

- [ ] **Step 5: 完成交付审计并提交**

逐项核对本计划、spec 和当前 Git diff；确认没有 `.env.example`、`.pnpm-store/` 或 `.ardot-qa/` 文件进入暂存区。

```bash
git add tests/e2e/ui-controls.spec.ts docs/product-design.md docs/superpowers/plans/2026-07-13-desktop-data-status-page.md
git commit -m "docs: verify full-page data status"
```
