# Directive 04: KPI Dashboard (STORY-003)

## Goal

Give a small-business owner a single screen that shows the KPIs calculated from
their most recent upload, clearly and with each number's confidence level; show
a plain "no data yet" message when nothing has been calculated; and never leave
the screen blank or half-broken when the data can't be fetched.

Satisfies REQ-004 (FUNC, must) — "generate a dashboard displaying calculated
KPIs and insights."

## Inputs

- `backend/src/services/latestKpiStore.ts` — in-process holder for the most
  recent `KpiCalculation` (`setLatest` / `getLatest` / `clearLatest`), populated
  by the upload flow.
- `backend/src/routes/dashboardRoute.ts` — `GET /api/kpis`.
- `backend/src/routes/dashboardContract.ts` — Zod contract for the response.
- `frontend/` — Vite + React + TypeScript app (new in this story).
- `frontend/src/services/kpiApi.ts` — `fetchKpis()` client (timeout + retry).

## Outputs

### Backend

- `GET /api/kpis` returns one of:
  - `{ "status": "no_data", "generatedAt": null }` — nothing calculated yet.
  - `{ "status": "ok" | "needs_clarification", "generatedAt": <ISO>,
     "filename": <string>, "kpis": [...], "clarificationsNeeded": [...],
     "summary": {...} }` — the latest calculation. `kpis` / `clarificationsNeeded`
     / `summary` are exactly the shapes from `directives/02-kpi-calculation.md`
     (the contract reuses `KpiResultSchema`).
  - `500 { "status": "error", "errorClass": "DashboardUnavailable", "message": ... }`
    if reading the store throws.
- Every request emits a structured `dashboard_access` audit line
  (`event: "dashboard_access"`, `correlation_id`, `outcome`,
  `context: { hasData, kpiCount, ... }`) and returns the same id as
  `X-Correlation-ID`. This is the STORY-003 Trust criterion ("logs dashboard
  access and interactions").
- `uploadRoute.ts` calls `setLatest(...)` after a successful KPI calculation and
  on the duplicate-upload short-circuit, so "latest" always reflects the file
  the user just uploaded.

### Frontend

- `frontend/` — Vite + React + TypeScript. Dev server on `:3000`, proxies
  `/api` → `http://localhost:3001`.
- `src/pages/Dashboard.tsx` renders four states:
  - **loading** — the fetch is in flight.
  - **error** — the fetch failed after retries: a message plus a "Try again"
    button (`role="alert"`). Failure path "Dashboard fails to load".
  - **no-data** — `status: "no_data"`: "No KPIs yet. Upload an Excel or CSV
    file…".
  - **loaded** — a meta line (filename, time, row counts), any clarification
    questions, then a grid of `KpiCard`s (label, unit-formatted value,
    evidence-level pill, evidence note).
- `src/services/kpiApi.ts` — `fetchKpis()`:
  - explicit per-attempt timeout via `AbortController` (default 8s).
  - capped retries (default 2) with linear backoff.
  - 4xx and unrecognised/legacy bodies are terminal (no retry); timeout,
    network error, and 5xx are retried.
  - on exhaustion, throws `DashboardLoadError` with a user-facing message.

## Where KPIs come from (walking-skeleton shortcut)

There is no database yet. `latestKpiStore` is a single in-process value: the
last calculation, overwritten by each new upload, lost on restart. After a
restart the dashboard shows "no data" until the next upload. This is the same
in-memory-cache pattern as STORY-011's `RecentRuns`. Durable, per-user KPI
history is a later persistence story (STORY-014); do not add a database here.

Consequence: the dashboard is single-tenant. Two users hitting the same backend
share one "latest". Acceptable for the r1 demo scope; revisit when auth /
multi-tenancy lands.

## Edge cases

- No upload yet → `no_data` → "no KPIs" message (acceptance #2).
- Upload produced `needs_clarification` → dashboard still shows the partial
  KPIs, plus the clarification questions in their own panel.
- Backend down / network error / timeout → `fetchKpis` retries, then the
  dashboard shows the error state with "Try again" (acceptance failure path
  "Dashboard fails to load").
- Backend reachable but returns a body the frontend doesn't recognise →
  terminal error state, no retry storm.
- `getLatest()` throws → `GET /api/kpis` returns a typed 500 and logs a
  `dashboard_access` failure line.

## Failure modes handled vs not handled

Handled: dashboard fails to load (retry + explicit error state + typed 500),
incorrect KPI display (values are unit-formatted from the typed contract, not
free-text; evidence level shown on every card so a low-confidence number is not
read as fact), UI errors on an unexpected response (shallow shape guard →
terminal error state rather than a crash or blank screen).

Not handled (documented, deferred): durable KPI history and multi-tenant
isolation (STORY-014 persistence + a later auth story); currency other than USD
in `KpiCard` formatting; live refresh / websockets (the dashboard fetches once
on mount and on "Try again").

## Safety constraints

- No secrets in the frontend bundle or in log lines (`dashboard_access` carries
  counts and a correlation id, no file contents).
- `dangerouslySetInnerHTML` is not used; all KPI text renders through React's
  default escaping.
- The dashboard never invents a number: it only renders what `GET /api/kpis`
  returns, and shows the backend's evidence level and clarification questions
  as-is (project guardrail: "ensure data accuracy and integrity throughout").

## Verification

- `backend/src/routes/dashboardRoute.test.ts` — no-data path, latest-KPIs-after-upload
  path, `dashboard_access` audit line + correlation id, typed 500 when the store
  read throws.
- `frontend/src/pages/Dashboard.test.tsx` — KPI cards render clearly (happy
  path), clarification questions listed, "no data" message shown (and no cards),
  error state + "Try again" refetches (failure path).
- `frontend/src/services/kpiApi.test.ts` — 200 parse, 5xx retried then succeeds,
  4xx terminal, give-up after cap with a friendly message, timeout aborts,
  unrecognised body terminal.
- `tsc --noEmit` clean in both `backend/` and `frontend/`. Backend `jest` suite
  and frontend `vitest` suite both green. `vite build` succeeds.
