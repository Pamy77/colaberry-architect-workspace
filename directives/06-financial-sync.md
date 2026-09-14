# Directive 06: Financial Data Synchronization (STORY-005)

## Goal

Pull financial records from Google Sheets and QuickBooks into the system so KPI
calculation and reporting work from accurate, current data.

Satisfies REQ-006 (CONSTRAINT, must integrate with Google Sheets and
QuickBooks, among others) and REQ-015 (FUNC, must handle recurring-revenue and
business-fact data, among others) for STORY-005's financial-data scope
specifically — REQ-006's other integrations (Excel/Slack/Gmail/Outlook/Dropbox/
Google Drive) and REQ-015's other data domains (customer feedback, inventory,
subscription history) are out of scope here and land with their own stories.

## Blocked-by note

`.colaberry/plan.json` currently lists STORY-005 and STORY-006 as blocking
each other (a cycle: `STORY-005 <- [STORY-006]`, `STORY-006 <- [STORY-005]`).
Confirmed with the project owner 2026-09-14 that this is a data bug upstream,
not a real dependency — STORY-006 (subscription plans) is explicitly deferred
per the active task brief, and this story proceeds without it. Not corrected
in `plan.json` directly since that file is platform-owned and overwritten on
sync (per this repo's `CLAUDE.md`).

## Inputs (new, this story)

- `backend/src/services/financialSyncSources.ts` — the `SyncSource` adapter
  interface plus the Google Sheets and QuickBooks adapters (dry-run/fixture-
  backed; see "Delivery" below — no real credentials exist yet).
- `backend/src/services/financialSyncService.ts` — orchestration: runs each
  configured source through its adapter, an integrity check, and an idempotent
  upsert into the record store; returns a typed per-source + overall result.
- `backend/src/services/financialRecordStore.ts` — in-memory store of synced
  records, same walking-skeleton pattern as `latestKpiStore.ts` /
  `pendingAlertStore.ts` (not a database; durable persistence is a later
  story).
- `backend/src/routes/syncRoute.ts` / `syncContract.ts` — `POST /api/sync/run`,
  zod-validated response, following the `alertsRoute.ts` / `alertsContract.ts`
  pattern.
- Env: `SYNC_TIMEOUT_MS` (default 10000), `SYNC_RETRIES` (default 2) — reusing
  `processingAudit.runStep`'s existing timeout/retry mechanism, not inventing
  a new one.

## What "accurately reflected" means

For each source, a fetch returns zero or more `SyncRecord`s:

```
SyncRecord = {
  source: 'google_sheets' | 'quickbooks';
  externalId: string;        // the source's own row/transaction id
  fields: Record<string,string>;
  fetchedAt: string;         // ISO-8601
}
```

A record is "accurately reflected" once it is stored under the deterministic
key `(source, externalId)`: the current fetch's `fields` replace whatever was
stored under that key before (upsert), so the system always shows the
source's latest value for that record, never a stale or duplicated copy.

## Data integrity check (guardrail: "ensure data accuracy and integrity throughout the process")

Before a fetched record is stored, it must have a non-empty `externalId` and
at least one non-empty field. A record failing this is not stored — and not
silently dropped either: it is counted in the sync result as `rejected` with
a reason, the same "flag, don't discard invisibly" pattern
`dataCleaningService.ts` uses for malformed rows. A source where every record
fails integrity is a source-level failure with `reason: 'data_integrity'`,
not a silent zero-record success.

## Outputs

- `POST /api/sync/run` response, per source:
  `{ source, outcome: 'ok' | 'partial' | 'failed', recordsFetched, recordsStored, recordsRejected, reason? }`,
  plus an overall `status` derived from the sources (`ok` only if every source
  is `ok`; `partial` if at least one is `ok`; `failed` if none are).
- Structured audit lines (Trust acceptance criterion — "every synchronization
  attempt must be logged with a timestamp and status"): a `sync_attempt` line
  per source (`started` then `succeeded` / `failed` / `partial`, via
  `processingAudit.runStep`, timestamp + correlation id included by that
  helper already), plus one `sync_run` summary line for the whole call.
- `X-Correlation-ID` response header, same convention as `alertsRoute.ts`.

## Idempotency

Upsert by `(source, externalId)` — re-running a sync for unchanged source
data restores the same stored value, not a duplicate row. Re-running after a
partial failure simply re-fetches and re-upserts everything; sources are
independent and stateless per call, so no partial-run resumption token is
needed — upsert is naturally safe to repeat.

## Retry

Each source fetch goes through `processingAudit.runStep` with an explicit
timeout (`SYNC_TIMEOUT_MS`) and capped retries (`SYNC_RETRIES`), identical in
shape to how `notificationService.sendKpiAlert` retries each channel. A
source that exhausts its retries is `failed` for that source only — it does
not roll back or block records already stored from other sources, or from
earlier syncs. Acceptance #2 ("retries... without data loss") reads as: a
retry recovers the failing source's data once it succeeds, and a source that
never recovers does not corrupt or discard data that already synced
correctly.

## Delivery (walking-skeleton shortcut — no credentials)

Both adapters are dry-run: they read a local fixture file standing in for the
real API response shape (`backend/src/services/__fixtures__/googleSheetsSample.json`,
`.../quickbooksSample.json`) and return it as `SyncRecord[]`, logging that
they're in dry-run mode. This exercises fetch → integrity check → upsert →
audit end to end with no OAuth client, no API key, nothing real called.

**Harden pass (follow-up, not this story):** real adapters behind an env gate
(`GOOGLE_SHEETS_CREDENTIALS_JSON` / `QUICKBOOKS_*`), same "real credential
present but real client not built yet → warn and stay dry-run" pattern
`emailTransport.ts` already uses, so nothing untested ships and nothing
silently fails open.

## Trigger

`POST /api/sync/run` — called by hand, by a scheduler, or (future) after
subscription setup. Not wired into any other route in this story, so nothing
else changes behavior by this landing.

## Edge cases

- A source with zero records → `ok`, 0 fetched/stored, not an error.
- A source where every record fails integrity → `failed`,
  `reason: 'data_integrity'`, not a silent `ok`.
- Same record synced twice, unchanged → same stored value, not duplicated.
- Same record synced twice, changed upstream → stored value updates to the
  newer fetch (last-write-wins is correct here: the source of truth is the
  external system, not sync history).
- One source fails, the other succeeds → overall `status: partial`; the
  succeeding source's data is still stored (no data loss).
- Every source fails → overall `status: failed`; previously-synced records
  are untouched, not cleared.

## Failure modes handled vs not handled

Handled (the five failure paths this story must cover): **API authentication
failure** and **network timeout** (`runStep`'s timeout + capped retry around
each adapter's fetch; failure recorded per source; one source's failure
doesn't block another's success); **data format mismatch** and **data
integrity check failure** (the integrity check above — malformed/incomplete
records are rejected and counted, not silently accepted or silently
dropped); **partial data sync** (per-source independence — the response's
per-source `outcome` plus overall `partial` status makes a partial run
visible rather than misreported as a full `ok`).

Not handled (documented, deferred): real Google Sheets/QuickBooks API calls
(dry-run only until credentials exist); durable/cross-process record storage
(in-memory walking-skeleton store, same limitation as
`latestKpiStore`/`pendingAlertStore` — a restart clears it); reconciling the
same real-world record if it legitimately appears in both source systems
(each record is keyed per-source, so this doesn't collide today, but
cross-source dedup is out of scope); an "undo this sync" action for the
project's insights-undo guardrail — each stored record carries `fetchedAt` so
a future undo has a timestamp to work from, but no undo capability is built
in this story (that guardrail's real home is the insights/dashboard layer
downstream, STORY-014).

## Safety constraints

- No secrets in code, logs, or fixtures. When real adapters land, credentials
  are read from env and redacted in every log line, same as the
  Mandrill/Slack pattern.
- Timeout and retry counts stay env-configurable, never hardcoded past the
  documented defaults.
- A rejected record's raw fields may appear in the `rejected` audit detail for
  debugging — this is the user's own uploaded/synced data, not a third-party
  secret, so this mirrors `dataCleaningService`'s flagged-row logging, not a
  leak.

## Verification (to be filled in as the walking skeleton lands)

- Unit tests for `financialSyncService`: happy path (both sources ok), one
  source fails and retries into success, one source exhausts retries
  (partial), integrity check rejects a malformed record, idempotent re-run
  (same key/same value → no duplicate; changed value → updated in place).
- `backend/src/routes/syncRoute.test.ts`: `POST /api/sync/run` response
  shape, per-source outcomes, overall status derivation, correlation id
  header.
- `tsc --noEmit` clean; no regressions in the existing suite.
