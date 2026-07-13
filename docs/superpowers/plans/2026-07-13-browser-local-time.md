# 浏览器本地时间展示实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** 将所有面向访客的当前观测时间改为浏览器本地时区，并明确显示 `GMT±N`，同时保持服务端契约、存储、缓存和时间计算使用 UTC。

**Architecture:** 在 Web 端新增纯格式化函数和 `BrowserTime` 组件。纯函数通过 `Intl.DateTimeFormat(...).formatToParts()` 生成稳定格式；组件在 SSR 与首次 hydration 时显示占位，挂载后读取浏览器时区，并通过语义化 `<time>` 保留原始 UTC。所有业务组件只负责传入 ISO 时间，时间差和排序逻辑保持不变。

**Tech Stack:** Next.js 16、React 19、TypeScript、Vitest、Testing Library、Playwright、Ardot。

## 全局约束

- 浏览器之外的数据契约继续使用带 `Z` 或显式偏移的 ISO 8601。
- 不修改航班、天气的新鲜度、缓存、排序和回看计算。
- 不把浏览器时区用于未来的机场计划起降时间。
- 单元测试和 E2E 显式使用 `Asia/Shanghai`，避免依赖执行机器时区。
- `.pnpm-store/` 和本地 `.env` 不纳入提交。

### 任务 1：同步 Ardot 时间示例

**设计文件：**

- 修改：Ardot 文件 `hangban`（ID `702710471706421`）的 `main_deep` 页面（ID `16:1`）
- 产物：`.ardot-qa/browser-local-time/design-desktop.png`
- 产物：`.ardot-qa/browser-local-time/design-mobile.png`

**步骤 1：定位全部 UTC 示例**

在 `main_deep` 页面搜索包含 `UTC` 的文字节点，分别核对桌面端和手机端，不按已知节点列表推断遗漏。

**步骤 2：修改示例文案**

将紧凑示例从 `08:20 UTC` 改为 `16:20 GMT+8`，完整示例从 `2026/7/13 06:20:00 UTC` 改为 `2026/7/13 14:20:00 GMT+8`。其他时间按相同的 `+8` 偏移换算；不改变布局，除非文字发生截断。

**步骤 3：视觉核对**

分别捕获桌面端和手机端设计截图，确认时区标签完整、无截断，保存到 `.ardot-qa/browser-local-time/`。

### 任务 2：测试先行新增统一时间模块

**文件：**

- 新增：`apps/web/src/lib/browser-time.test.ts`
- 新增：`apps/web/src/lib/browser-time.ts`
- 新增：`apps/web/src/components/browser-time.test.tsx`
- 新增：`apps/web/src/components/browser-time.tsx`

**步骤 1：编写纯函数失败测试**

覆盖 `Asia/Shanghai` 的紧凑格式、完整格式、纽约冬夏偏移、UTC 提示、无效输入。期望示例为 `23:20 GMT+8` 和 `2026/7/13 23:20:00 GMT+8`。

**步骤 2：验证 RED**

运行：`pnpm vitest run apps/web/src/lib/browser-time.test.ts`

预期：因 `browser-time` 模块尚不存在而失败。

**步骤 3：实现最小纯函数**

实现 `formatBrowserTime` 和 `formatUtcTitle`。使用 `formatToParts()` 固定字段顺序，同时让 `Intl` 负责 IANA 时区和夏令时偏移。

**步骤 4：验证 GREEN**

运行：`pnpm vitest run apps/web/src/lib/browser-time.test.ts`

预期：全部通过。

**步骤 5：编写组件失败测试**

验证 SSR 占位、挂载后的本地时间、`dateTime`、UTC `title` 和无效输入空状态。

**步骤 6：验证 RED**

运行：`pnpm vitest run apps/web/src/components/browser-time.test.tsx`

预期：因 `BrowserTime` 组件尚不存在而失败。

**步骤 7：实现最小组件**

使用 `useSyncExternalStore` 让服务端快照返回未就绪、客户端快照返回已就绪。渲染语义化 `<time>`；测试可显式传入时区，生产调用默认读取浏览器时区。

**步骤 8：验证 GREEN**

运行：`pnpm vitest run apps/web/src/lib/browser-time.test.ts apps/web/src/components/browser-time.test.tsx`

预期：全部通过且无 hydration 警告。

### 任务 3：替换业务组件中的可见 UTC 时间

**文件：**

- 修改：`apps/web/src/components/data-status-page.tsx`
- 修改：`apps/web/src/components/data-status.tsx`
- 修改：`apps/web/src/components/flight-panel.tsx`
- 修改：`apps/web/src/components/flight-details-page.tsx`
- 修改：`apps/web/src/components/route-explorer.tsx`
- 修改：`apps/web/src/components/weather-radar-legend.tsx`
- 修改：`apps/web/src/components/weather-data-status.tsx`
- 修改：`apps/web/src/components/playback-control.tsx`
- 修改：对应的 `*.test.tsx`

**步骤 1：更新一个状态组件的失败测试**

先把 `data-status-page.test.tsx` 和 `weather-data-status.test.tsx` 的可见时间断言改为 `Asia/Shanghai` 本地时间，并断言 `<time>` 元数据。

**步骤 2：验证 RED**

运行：`pnpm vitest run apps/web/src/components/data-status-page.test.tsx apps/web/src/components/weather-data-status.test.tsx`

预期：现有组件仍显示 UTC，断言失败。

**步骤 3：替换状态组件**

使用 `BrowserTime` 替换状态页、顶部状态和天气数据卡片的字符串截取；保留原有缺失时间文案。

**步骤 4：更新剩余组件测试并验证 RED**

为航班详情、航线探索、天气图例和回看刻度补充或更新可见时间测试，然后运行对应测试，确认旧 UTC 文案导致失败。

**步骤 5：替换剩余组件**

统一传入原始 ISO 时间；回看控制只把计算出的目标时间改为 ISO 后交给组件展示。不得修改时间差计算。

**步骤 6：源码审计**

运行：`rg -n "slice\\(11|toISOString\\(\\).*UTC| UTC|timeZone: 'UTC'" apps/web/src`

预期：业务源码中不再存在生成可见 UTC 时间的逻辑；测试夹具中的 ISO UTC 数据允许保留。

**步骤 7：组件回归**

运行：`pnpm vitest run apps/web/src`

预期：Web 单元与组件测试全部通过。

### 任务 4：固定 E2E 浏览器时区并更新文档

**文件：**

- 修改：`playwright.config.ts`
- 修改：相关 `tests/e2e/*.spec.ts`
- 修改：`docs/product-design.md`
- 修改：`docs/architecture.md`
- 修改：`docs/AGENTS.md`

**步骤 1：编写 E2E 预期**

把 Playwright 浏览器上下文固定为 `Asia/Shanghai`，更新状态页、天气图例和详情中与 UTC 相关的断言，要求显示 `GMT+8`。

**步骤 2：同步产品与架构文档**

记录“传输与存储 UTC、浏览器展示本地时区”的边界，并在文档索引标记该能力已实现。

**步骤 3：格式与类型检查**

运行：`pnpm format:check`、`pnpm typecheck`。

预期：全部通过。

### 任务 5：双视口验收与全量验证

**文件：**

- 产物：`.ardot-qa/browser-local-time/implementation-desktop.png`
- 产物：`.ardot-qa/browser-local-time/implementation-mobile.png`

**步骤 1：运行聚焦 E2E**

运行天气雷达、数据状态、航班详情和手机端相关 Playwright 用例，确认 `GMT+8` 文案、布局和交互。

**步骤 2：视觉核对**

在 `1440 × 900` 和 `390 × 844`、`Asia/Shanghai` 浏览器上下文中截图，确认无截断、重叠和 hydration 警告。

**步骤 3：全量验证**

运行：`pnpm verify`

运行：`pnpm format:check`

预期：全部通过。

### 任务 6：提交并推送

**步骤 1：检查变更范围**

运行 `git status --short` 和 `git diff --check`，确认不包含 `.env`、`.pnpm-store/` 或无关文件。

**步骤 2：提交实现**

提交信息：`feat: display times in browser timezone`

**步骤 3：推送当前分支**

运行 `git push origin main`，确认远端包含规格、计划、Ardot 对应实现和测试。
