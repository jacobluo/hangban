# Flight Tracker MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build a runnable, responsive global real-time flight tracker MVP with a provider adapter layer, HTTP/WebSocket API, and MapLibre interface.

**Architecture:** Use a pnpm TypeScript workspace. A Fastify modular monolith exposes queries and viewport-scoped WebSocket updates, while a separate ingestor package owns provider adapters and fusion. Next.js renders the responsive product UI and consumes only canonical contracts.

**Tech Stack:** pnpm, TypeScript, Next.js, React, MapLibre GL JS, Fastify, WebSocket, Zod, Vitest, Testing Library, Playwright, ESLint, Prettier.

---

## File map

```text
apps/web/                 Next.js UI, MapLibre map and feature panels
apps/api/                 Fastify routes, repositories and WebSocket hub
apps/ingestor/            Provider polling entrypoint
packages/contracts/       Canonical Zod schemas and TypeScript contracts
packages/domain/          Fusion, freshness, spatial and route logic
packages/adapters/        Public provider clients and demo provider
packages/config/          Runtime environment validation
packages/testkit/         Deterministic airports and flights
tests/e2e/                Playwright user journeys
```

### Task 1: Create the pnpm workspace and verification commands

**Files:**

- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `eslint.config.mjs`
- Create: `.prettierrc.json`
- Create: `.gitignore`
- Modify: `scripts/setup`
- Modify: `scripts/lint`
- Modify: `scripts/typecheck`
- Modify: `scripts/test`
- Modify: `scripts/e2e`
- Modify: `scripts/build`
- Modify: `scripts/verify`

- [x] **Step 1: Define root scripts and workspace packages**

```json
{
  "private": true,
  "packageManager": "pnpm@10.30.3",
  "scripts": {
    "dev": "pnpm --parallel --filter @hangban/api --filter @hangban/web dev",
    "lint": "eslint .",
    "typecheck": "pnpm -r typecheck",
    "test": "vitest run",
    "build": "pnpm -r build",
    "e2e": "playwright test",
    "verify": "pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm e2e"
  }
}
```

- [x] **Step 2: Install exact workspace dependencies**

Run: `pnpm install`

Expected: `pnpm-lock.yaml` is created and all workspace packages are linked.

- [x] **Step 3: Run the initial type check**

Run: `pnpm typecheck`

Expected: PASS after each workspace package has a minimal `tsconfig.json` and source entrypoint.

- [x] **Step 4: Record checkpoint**

Git commit is unavailable until this directory is initialized as a Git repository. Keep this task checked in the plan and report the missing repository metadata in the handoff.

### Task 2: Define canonical contracts and deterministic test data

**Files:**

- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/flight.ts`
- Create: `packages/contracts/src/airport.ts`
- Create: `packages/contracts/src/realtime.ts`
- Create: `packages/contracts/src/contracts.test.ts`
- Create: `packages/testkit/package.json`
- Create: `packages/testkit/tsconfig.json`
- Create: `packages/testkit/src/index.ts`

- [x] **Step 1: Write failing schema tests**

```ts
import { describe, expect, it } from 'vitest';
import { flightSchema } from './flight';

describe('flightSchema', () => {
  it('rejects a latitude outside the WGS 84 range', () => {
    expect(() => flightSchema.parse({ id: 'f1', latitude: 91 })).toThrow();
  });
});
```

- [x] **Step 2: Verify the contract test fails**

Run: `pnpm vitest run packages/contracts/src/contracts.test.ts`

Expected: FAIL because `flightSchema` does not exist.

- [x] **Step 3: Implement schemas and inferred types**

Define canonical `Flight`, `Airport`, `RouteSummary`, `SourceStatus`, `MapSnapshot`, `RealtimeClientMessage` and `RealtimeServerMessage` schemas. Require coordinates, UTC timestamps, source IDs, freshness state and confidence.

- [x] **Step 4: Add deterministic fixtures**

Create PEK, PVG, HND, SIN and JFK airports plus flights CA981, UA858, MU587 and CZ699. All timestamps derive from a provided clock so tests remain deterministic.

- [x] **Step 5: Verify contracts pass**

Run: `pnpm vitest run packages/contracts/src/contracts.test.ts`

Expected: PASS.

### Task 3: Implement normalization, fusion and spatial queries with TDD

**Files:**

- Create: `packages/domain/package.json`
- Create: `packages/domain/tsconfig.json`
- Create: `packages/domain/src/normalize.ts`
- Create: `packages/domain/src/fusion.ts`
- Create: `packages/domain/src/freshness.ts`
- Create: `packages/domain/src/spatial.ts`
- Create: `packages/domain/src/routes.ts`
- Create: `packages/domain/src/domain.test.ts`

- [x] **Step 1: Write failing fusion tests**

```ts
it('uses the freshest valid position for the same ICAO24 aircraft', () => {
  const result = fuseFlights([olderFlight, newerFlight], fixedNow);
  expect(result).toHaveLength(1);
  expect(result[0].latitude).toBe(newerFlight.latitude);
  expect(result[0].sources).toEqual(['adsb-lol', 'opensky']);
});
```

- [x] **Step 2: Verify domain tests fail**

Run: `pnpm vitest run packages/domain/src/domain.test.ts`

Expected: FAIL because `fuseFlights` and spatial functions do not exist.

- [x] **Step 3: Implement minimal domain functions**

Implement `normalizeProviderFlight`, `fuseFlights`, `classifyFreshness`, `isInsideBbox`, `distanceKm`, `nearbyFlights` and `matchRouteFlights`. Use ICAO24 as the primary identity and do not infer a route when origin or destination is missing.

- [x] **Step 4: Add failure and boundary tests**

Cover invalid coordinates, missing ICAO24, stale positions, antimeridian-aware bounding boxes, airport radius boundaries and same-origin/destination route rejection.

- [x] **Step 5: Verify domain tests pass**

Run: `pnpm vitest run packages/domain/src/domain.test.ts`

Expected: PASS.

### Task 4: Implement provider adapters and runtime configuration with TDD

**Files:**

- Create: `packages/config/package.json`
- Create: `packages/config/tsconfig.json`
- Create: `packages/config/src/index.ts`
- Create: `packages/config/src/config.test.ts`
- Create: `packages/adapters/package.json`
- Create: `packages/adapters/tsconfig.json`
- Create: `packages/adapters/src/provider.ts`
- Create: `packages/adapters/src/http-provider.ts`
- Create: `packages/adapters/src/adsb-lol.ts`
- Create: `packages/adapters/src/opensky.ts`
- Create: `packages/adapters/src/airplanes-live.ts`
- Create: `packages/adapters/src/demo.ts`
- Create: `packages/adapters/src/adapters.test.ts`

- [x] **Step 1: Write failing configuration and adapter tests**

```ts
it('defaults to demo mode without provider credentials', () => {
  expect(loadConfig({ NODE_ENV: 'test' }).dataMode).toBe('demo');
});

it('converts provider failures into a stable provider error', async () => {
  const provider = createHttpProvider({ fetch: async () => new Response('', { status: 429 }) });
  await expect(provider.fetchSnapshot(worldScope)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
});
```

- [x] **Step 2: Verify adapter tests fail**

Run: `pnpm vitest run packages/config packages/adapters`

Expected: FAIL because config and provider functions do not exist.

- [x] **Step 3: Implement provider boundaries**

Use injected `fetch`, per-request timeouts, Zod response parsing and stable error codes. The demo provider must produce moving but deterministic flights without network access.

- [x] **Step 4: Verify adapters pass**

Run: `pnpm vitest run packages/config packages/adapters`

Expected: PASS with no real network calls.

### Task 5: Build the Fastify query API with repository tests

**Files:**

- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/index.ts`
- Create: `apps/api/src/repository.ts`
- Create: `apps/api/src/memory-repository.ts`
- Create: `apps/api/src/routes/search.ts`
- Create: `apps/api/src/routes/flights.ts`
- Create: `apps/api/src/routes/airports.ts`
- Create: `apps/api/src/routes/routes.ts`
- Create: `apps/api/src/routes/map.ts`
- Create: `apps/api/src/routes/status.ts`
- Create: `apps/api/src/api.test.ts`

- [x] **Step 1: Write failing API tests**

```ts
it('returns only flights inside the requested viewport', async () => {
  const app = buildApp({ repository: createTestRepository() });
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/map/snapshot?bbox=100,20,130,50',
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().flights.every((flight: Flight) => flight.longitude >= 100)).toBe(true);
});
```

- [x] **Step 2: Verify API tests fail**

Run: `pnpm vitest run apps/api/src/api.test.ts`

Expected: FAIL because `buildApp` does not exist.

- [x] **Step 3: Implement the memory repository and routes**

Validate all path and query input with Zod. Return canonical contracts and stable `{ code, message }` errors. Search must group flights and airports; airport nearby results must be spatial rather than schedule based.

- [x] **Step 4: Add empty, invalid and degraded tests**

Cover invalid bounding boxes, missing objects, empty search, same-airport route requests and degraded source status.

- [x] **Step 5: Verify API tests pass**

Run: `pnpm vitest run apps/api/src/api.test.ts`

Expected: PASS.

### Task 6: Add viewport-scoped WebSocket updates with TDD

**Files:**

- Create: `apps/api/src/realtime/hub.ts`
- Create: `apps/api/src/realtime/socket.ts`
- Create: `apps/api/src/realtime/hub.test.ts`

- [x] **Step 1: Write the failing subscription test**

```ts
it('emits only changed flights inside the client bbox', () => {
  const hub = createRealtimeHub();
  hub.subscribe('client-1', chinaBbox);
  hub.publish([chinaFlight, atlanticFlight]);
  expect(hub.drain('client-1')).toEqual([{ type: 'flight.upsert', flight: chinaFlight }]);
});
```

- [x] **Step 2: Verify the realtime test fails**

Run: `pnpm vitest run apps/api/src/realtime/hub.test.ts`

Expected: FAIL because the hub does not exist.

- [x] **Step 3: Implement subscription state and heartbeat**

Parse client messages with canonical schemas, cap subscription size, replace old subscriptions on viewport change, send `subscription.ready`, and publish only in-scope upserts/removals.

- [x] **Step 4: Verify realtime tests pass**

Run: `pnpm vitest run apps/api/src/realtime/hub.test.ts`

Expected: PASS.

### Task 7: Create the ingestor process

**Files:**

- Create: `apps/ingestor/package.json`
- Create: `apps/ingestor/tsconfig.json`
- Create: `apps/ingestor/src/run-cycle.ts`
- Create: `apps/ingestor/src/index.ts`
- Create: `apps/ingestor/src/run-cycle.test.ts`

- [x] **Step 1: Write the failing ingestion-cycle test**

```ts
it('continues with healthy providers when one provider fails', async () => {
  const result = await runCycle({ providers: [healthyProvider, failingProvider], repository, now });
  expect(result.statuses).toEqual(
    expect.arrayContaining([{ providerId: 'failed', state: 'down' }]),
  );
  expect(repository.all()).toHaveLength(healthyProviderFlights.length);
});
```

- [x] **Step 2: Verify it fails**

Run: `pnpm vitest run apps/ingestor/src/run-cycle.test.ts`

Expected: FAIL because `runCycle` does not exist.

- [x] **Step 3: Implement polling and partial degradation**

Run providers in parallel with `Promise.allSettled`, normalize fulfilled snapshots, fuse the combined records, write one repository batch and return per-provider health.

- [x] **Step 4: Verify ingestion tests pass**

Run: `pnpm vitest run apps/ingestor/src/run-cycle.test.ts`

Expected: PASS.

### Task 8: Build the responsive Next.js application from the Ardot design

**Files:**

- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/globals.css`
- Create: `apps/web/src/components/app-shell.tsx`
- Create: `apps/web/src/components/flight-map.tsx`
- Create: `apps/web/src/components/search-box.tsx`
- Create: `apps/web/src/components/flight-panel.tsx`
- Create: `apps/web/src/components/airport-explorer.tsx`
- Create: `apps/web/src/components/route-explorer.tsx`
- Create: `apps/web/src/components/data-status.tsx`
- Create: `apps/web/src/lib/api-client.ts`
- Create: `apps/web/src/lib/demo-data.ts`
- Create: `apps/web/src/components/app-shell.test.tsx`

- [x] **Step 1: Write failing component-flow tests**

```tsx
it('opens airport exploration and selects PEK', async () => {
  render(<AppShell initialData={demoData} />);
  await userEvent.click(screen.getByRole('tab', { name: '机场' }));
  await userEvent.click(screen.getByRole('button', { name: /北京首都国际机场/ }));
  expect(screen.getByRole('heading', { name: 'PEK' })).toBeVisible();
  expect(screen.getByText('周边实时航班')).toBeVisible();
});
```

- [x] **Step 2: Verify the component test fails**

Run: `pnpm vitest run apps/web/src/components/app-shell.test.tsx`

Expected: FAIL because the app components do not exist.

- [x] **Step 3: Implement the design system and shell**

Extract the Aero Chart palette, typography, borders, spacing, desktop side panels and mobile bottom sheets into CSS variables and reusable components. Keep the map dominant and use true white surfaces over the pale blue map.

- [x] **Step 4: Implement MapLibre and feature states**

Dynamically load MapLibre on the client, render flights as a GeoJSON symbol/circle layer, update selected state without remounting the map, and expose accessible lists for non-map interaction. Implement global, airport and route tabs plus flight details and data status.

- [x] **Step 5: Verify component tests pass**

Run: `pnpm vitest run apps/web/src/components/app-shell.test.tsx`

Expected: PASS.

### Task 9: Add Playwright journeys and responsive checks

**Files:**

- Create: `playwright.config.ts`
- Create: `tests/e2e/live-map.spec.ts`
- Create: `tests/e2e/airport-route.spec.ts`
- Create: `tests/e2e/mobile.spec.ts`

- [x] **Step 1: Write E2E tests before starting the application**

Cover loading the live map, searching CA981, selecting PEK, exploring PEK→JFK, degraded data status and a 390 × 844 viewport.

- [x] **Step 2: Verify the E2E suite fails**

Run: `pnpm e2e`

Expected: FAIL because the applications are not running or the journeys are incomplete.

- [x] **Step 3: Start the API and Web applications**

Run: `pnpm dev`

Expected: API listens on `127.0.0.1:4000` and Web listens on `127.0.0.1:3000`.

- [x] **Step 4: Fix only behavior required by the E2E tests**

Keep selectors accessible and user-facing. Do not add test-only production methods or bypass the real UI state.

- [x] **Step 5: Verify E2E passes**

Run: `pnpm e2e`

Expected: PASS for desktop and mobile projects.

### Task 10: Production checks, documentation and final verification

**Files:**

- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/AGENTS.md`
- Modify: `docs/architecture.md`
- Modify: `.codebuddy/rules/testing.mdc`
- Modify: `.codebuddy/rules/security.mdc`
- Modify: this plan

- [x] **Step 1: Replace template-specific documentation**

Remove Vue, Express, xterm, tuimux, DeepSeek and editor references. Document actual pnpm commands, environment variables, demo mode and provider boundaries.

- [x] **Step 2: Run focused test suites**

Run: `pnpm test`

Expected: PASS with no real provider network calls.

- [x] **Step 3: Run the full verification gate**

Run: `pnpm verify`

Expected: PASS for lint, typecheck, unit/component tests, builds and Playwright.

- [x] **Step 4: Perform visual comparison**

Capture desktop at 1440 × 900 and mobile at 390 × 844. Compare against the accepted Ardot screenshots for live map, airport and route states. Fix copy, layout, typography, palette, panel sizes, map prominence and mobile overflow.

- [x] **Step 5: Mark every completed checkbox**

No completed task may remain unchecked. Record any intentional deviation with its reason.

## Plan self-review

- Covers every P0 User Case in `docs/user-cases.md`.
- Uses canonical contracts across adapters, API, WebSocket and Web.
- Keeps provider credentials on the server.
- Uses viewport subscriptions and incremental updates rather than global broadcasts.
- Provides deterministic demo mode so local and E2E verification do not depend on external services.
- Contains no unresolved placeholders.

## Execution record

- Completed on 2026-07-11 with pnpm 10.30.3.
- Final `pnpm verify`: lint passed, type checks passed, 31 unit/component tests passed, the production build passed, and Playwright reported 7 passed with 1 intentional desktop skip for the mobile-only viewport test.
- Visual QA covered 1440 × 900 desktop and 390 × 844 mobile airport and route states against the accepted Ardot references.
- The repository intentionally defaults to deterministic demo data. Real provider adapters are present, while production authorization, Redis/PostgreSQL persistence, deployment topology and 1,000-connection load evidence remain environment-specific rollout work described in `docs/architecture.md`.
- The MapLibre OSM raster style is a local-development fallback. Production must configure `NEXT_PUBLIC_MAP_STYLE_URL` with an authorized map service.
- No Git checkpoint was created because the workspace has no Git repository metadata.
