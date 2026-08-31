# Directive 01: Upload & Data-Cleaning Pipeline (STORY-001)

## Goal

Accept an Excel/CSV file over HTTP, validate it, parse and clean its rows, and report the outcome to the caller — synchronously, within a single request/response cycle.

## Inputs

- `POST /api/upload` multipart request, field name `file`
- `backend/src/routes/uploadContract.ts` — size/row/extension limits and response schemas (Zod)
- `backend/src/services/dataCleaningService.ts` — standalone parse+clean module (`cleanFile`)

## Outputs

- `backend/src/routes/uploadRoute.ts` — mounts `POST /api/upload`, calls `cleanFile()` directly in the request handler
- Structured JSON logs: `file_upload` and `data_cleaning` events (success/failure)
- `UploadSuccessResponseSchema` / `UploadErrorResponseSchema` response contracts

## Known architectural shortcut — read before changing scale assumptions

`uploadRoute.ts` calls `cleanFile()` **in-process, synchronously, inside the HTTP request handler** — no job queue, no worker, no timeout boundary between "accept the upload" and "finish cleaning it." This was the right call for an MVP-scale story (closed 2026-08-19), but it means the upload endpoint's request-handling capacity is directly coupled to file-parsing cost: a large `.xlsx` load (`ExcelJS.Workbook.xlsx.load` is CPU-bound) or a burst of concurrent uploads will block the Node event loop for the whole process, not just the one request.

**Guards currently in place** (as of 2026-08-23, session `CC-20260823-h9wz`):
- `UPLOAD_MAX_BYTES` (`uploadContract.ts`) — multer-enforced upload size cap, default 10MB, env-configurable.
- `UPLOAD_MAX_ROWS` (`uploadContract.ts`) → passed into `cleanFile(buffer, filename, maxDataRows)` (`dataCleaningService.ts`) — caps data-row count independently of byte size, default 50,000, env-configurable. This exists because a narrow, many-row CSV can hit the row cap long before the byte cap, and row count (not bytes) is what drives synchronous parse+clean time.

**Revisit trigger:** if real usage needs files or row counts near/above these caps, or concurrent-upload volume becomes non-trivial, move cleaning off the request thread (background job + status polling, or a worker thread) rather than raising the caps indefinitely. Raising `UPLOAD_MAX_BYTES` / `UPLOAD_MAX_ROWS` without that change just moves the same blocking-event-loop risk to a bigger threshold.

## Edge Cases

- Unsupported file extension → 400 `ValidationError` (checked before buffering, via multer `fileFilter`)
- No file attached → 400 `ValidationError`
- Malformed/corrupt file content (valid extension, unparseable bytes) → `ParseError` from `cleanFile`, mapped to 400 `ValidationError`
- Data-row count over `UPLOAD_MAX_ROWS` → `ParseError`, mapped to 400 `ValidationError`
- Rows with missing cells → flagged (not dropped), returned in `cleaning.flaggedRows`
- Fully empty rows → silently dropped
- Upload interrupted mid-transfer → not explicitly tested; relies on Express/multer's own connection-drop handling (known gap, logged in `PROGRESS.md`, not a tracked acceptance criterion)

## Safety Constraints

- No disk writes (multer memory storage only)
- No secrets involved in this pipeline
- Both caps must stay env-configurable, never hardcoded past this file's documented defaults

## Verification

- `backend/src/services/dataCleaningService.test.ts` — happy path (CSV, XLSX), whitespace/empty-row handling, missing-cell flagging, malformed/corrupt/empty/unsupported-extension failure paths, row-cap boundary and over-cap failure
- `backend/src/routes/uploadRoute.test.ts` — full HTTP round-trip for accept, unsupported type, no file, and malformed-content cases
- `tsc --noEmit` clean
