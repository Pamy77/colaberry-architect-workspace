# Directive 03: Trust Spine for Data Processing (STORY-011)

## Goal

Make the upload → clean → KPI pipeline reliable and auditable: every processing
step carries a unique identifier and an explicit status, every step is logged
with a timestamp under one correlation id, a transient failure retries without
duplicating data, and a re-submitted identical upload is answered from the
previous run instead of being processed again.

Satisfies REQ-017 (SAFE, must) — "ensure data accuracy and integrity throughout
the process" — and the project guardrail of the same wording.

## Inputs

- `POST /api/upload` multipart request, field name `file` (unchanged from
  directive 01)
- `backend/src/services/processingAudit.ts` — the standalone trust-spine module:
  - `newRun(runId?)` — mints a run (correlation id); adopts an explicit id if
    one is supplied
  - `runStep(run, name, fn, opts?)` — runs one step with unique id + status +
    capped exponential-backoff retry
  - `checkIdempotency(run, registry, key)` / `rememberRun(...)` — run-level
    dedupe
  - `deriveIdempotencyKey(buffer, filename)` — `sha256(filename + " " + bytes)`
  - `RecentRuns<T>` — bounded FIFO cache of completed runs
  - `terminalWhenNamed(...names)` — `isRetryable` predicate that treats named
    errors as non-retryable
- `PROCESSING_DEDUP_CACHE_SIZE` — env var, dedupe cache capacity, default 256

## Outputs

- `backend/src/routes/uploadRoute.ts` — the request handler now:
  - creates one run per request and sets `X-Correlation-ID: <runId>` on the
    response
  - executes four steps, each through `runStep` / `checkIdempotency`:
    `receive_upload` → `idempotency_check` → `clean_data` → `calculate_kpis`
  - short-circuits a byte-identical re-upload to the cached response
- Structured JSON log line per step attempt: `event: "processing_step"`, with
  `correlation_id`, `step`, `step_id` (`<runId>-s<seq>`), `step_seq`, `attempt`,
  `status`, `outcome`, `duration_ms`, `error_class` (on failure). Written to
  stdout, same shape/route as the pipeline's other audit lines.
- `logKpiCalculation` (STORY-002, per-KPI evidence levels) is unchanged and
  still fires on success.

## Step model

| step | seq | retry policy | notes |
|---|---|---|---|
| `receive_upload` | s1 | `retries: 0` | records mimeType + size; receipt already happened, nothing to retry |
| `idempotency_check` | s2 | n/a | lookup only; terminal line is `succeeded` (miss) or `duplicate` (hit) |
| `clean_data` | s3 | default (2 retries, 50ms base backoff, doubling) | `ParseError` is terminal (`terminalWhenNamed('ParseError')`) → fast 400; any other throw is transient and retried |
| `calculate_kpis` | s4 | `retries: 0` | `calculateKpis` is total for data-shaped problems, so a throw is a bug — surface it, don't retry |

Status lifecycle per step: `started` → (`failed` → `retrying`)\* → (`succeeded`
\| `gave_up` \| `duplicate`). Every line is independently timestamped.

## Retry without duplicating data

`runStep` only ever re-invokes `fn`. The pipeline's steps (`cleanFile`,
`calculateKpis`) are pure transforms of their input with no external side
effects, so re-running them cannot duplicate anything — the retry is safe by
construction. This invariant is the caller's contract: a step that later
acquires a real side effect (DB write, email, payment) must carry its own
idempotency key before it is wrapped in `runStep`.

## Idempotency (run level)

`deriveIdempotencyKey(buffer, filename)` identifies one upload's content. A hit
in `RecentRuns` (only successful runs are remembered) is logged as
`status: 'duplicate'` on `idempotency_check` — carrying the original run's id —
and the previous `UploadSuccessResponse` is returned with HTTP 200. No parse, no
clean, no KPI calculation, no second audit trail for the work.

Scope / caveats:

- **In-process and per-process.** The cache is a module singleton. A restart
  empties it; an identical upload after a restart reprocesses and is logged as a
  normal (non-duplicate) run. Durable, cross-instance dedupe belongs to the
  persistence story (STORY-014), not here.
- **Bounded.** FIFO eviction at `PROCESSING_DEDUP_CACHE_SIZE` entries (default
  256). Memory cannot grow without limit.
- **Only successful runs are remembered.** A corrected re-upload (different
  bytes → different key) still reprocesses; a re-submit of a file that failed
  permanently fails again (deterministic).

## Edge cases

- Same file uploaded twice in quick succession → second returns 200 with the
  identical body; `idempotency_check` logs `duplicate`.
- Transient error inside `clean_data` → `failed` then `retrying` then
  `succeeded`; response is 200 with one correct result.
- `ParseError` (corrupt file, no rows) → `failed` then `gave_up` (no retry),
  mapped to the existing 400 `ValidationError` shape.
- Retry cap exhausted on a non-`ParseError` error → `gave_up`, error rethrown to
  the generic 500 path.
- Unsupported extension / missing file → rejected by multer/validation *before*
  a run starts; no correlation id, no step lines (no processing began). Logged
  as `file_upload` failure by the error handler, unchanged.
- Per-attempt `timeoutMs` option exists on `runStep` for future async/external
  steps (e.g. STORY-012 calling an external verifier); no current step sets it,
  since the pipeline is CPU-bound and in-process.

## Failure modes handled vs not handled

Handled: duplicate data processing (idempotency key), incomplete logging (every
step emits `started` + a terminal line; a mid-step crash still leaves the
`started` line and the surrounding `failed`/`gave_up`), audit trail missing
(one correlation id links all steps; `X-Correlation-ID` returned to the
client), incorrect error handling (typed `error_class` on every failure line,
`ParseError` vs transient distinguished, no silent swallow), transient
processing error (capped backoff retry).

Not handled here (documented, deferred): durable/replayable audit storage and
cross-process dedupe (STORY-014 persistence); KPI-change verification before
alerting (STORY-012); interruption of synchronous CPU work by `timeoutMs`
(a timer cannot preempt sync code in single-threaded Node — the option only
bites once a step is genuinely async).

## Safety constraints

- No secrets in log lines (the audit lines carry filename, size, row counts,
  step ids — no file contents, no credentials).
- Dedupe cache size stays env-configurable, never hardcoded past the documented
  default.
- The spine adds audit + retry + dedupe only; it does not change what
  `cleanFile` or `calculateKpis` compute. STORY-001 and STORY-002 behaviour and
  contracts are unchanged.
- Processing still runs in-process, synchronously, inside the request handler —
  the same shortcut documented in `01-upload-cleaning-service.md`, with the same
  revisit trigger (move the stage to a background job if real usage approaches
  the row cap).

## Verification

- `backend/src/services/processingAudit.test.ts` — 16 tests: run id uniqueness;
  `runStep` happy path, unique id/status per step, retry-then-succeed (fn called
  exactly once per attempt), retry cap → `gave_up` rethrow, non-retryable error
  not retried, per-attempt timeout; `deriveIdempotencyKey` stability/sensitivity;
  `RecentRuns` roundtrip / FIFO eviction / refresh-on-reinsert / capacity clamp;
  `checkIdempotency` miss + hit + end-to-end duplicate recognition;
  `buildStepEntry` purity.
- `backend/src/routes/uploadRoute.test.ts` — every step logged with a unique id,
  status and valid timestamp under one correlation id; transient error retried
  without doubling rows (`cleanFile` called exactly twice); byte-identical
  re-upload not reprocessed (`cleanFile` called once across two requests),
  distinct correlation ids, `duplicate` line links back to the first run.
- `tsc --noEmit` clean. Full backend suite: 50 tests passing.
