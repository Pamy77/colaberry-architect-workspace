# Common ETL/ELT Failure Classes

Reference catalog for the `etl-failure-triage` skill. For each failure class: how it typically shows up in logs, what counts as confirming evidence, and the safe next diagnostic step (never a fix, never a rerun).

## Schema / contract mismatch

**Symptom:** validation step logs a warning or error before the transform step runs; mentions a column name, an unexpected or missing value, or a violated rule (non-null, enum, type).

**Evidence:** a `schema_validation_*` or `ContractViolation` log event naming the column, the rule violated, and the affected row(s).

**Next diagnostic step:** compare the flagged column's values in the source extract against the contract/schema definition to confirm whether the source changed or the contract is stale.

## Mapping / lookup failure

**Symptom:** a transform step that resolves a code or key against a reference/lookup table throws an error for a specific input value.

**Evidence:** a `MappingError` (or equivalent) log event naming the lookup table, the input value that failed to resolve, and the row(s) affected.

**Next diagnostic step:** query the lookup/reference table directly for the failing value to confirm whether the entry is missing, misspelled, or the input is genuinely invalid (e.g. null/blank).

## Type conversion error

**Symptom:** a cast or parse step fails on a specific value (e.g. text where a number was expected, an unparseable date).

**Evidence:** a `ConversionError`/`TypeError`-class log line naming the field, the raw value, and the target type.

**Next diagnostic step:** inspect the raw source value for that row to confirm it's malformed vs. a parser/format-string mismatch.

## Null / required-field violation

**Symptom:** a required column is empty for one or more rows, caught either at validation or at insert (`NOT NULL` constraint violation).

**Evidence:** the validation or insert log line naming the column and row(s).

**Next diagnostic step:** check the source system or upstream extract for whether the field was populated at the source, to distinguish an extraction bug from a genuine source gap.

## Duplicate key / unique constraint violation

**Symptom:** an insert/upsert step logs a conflict on a unique or primary key.

**Evidence:** the insert log line naming the key, the value, and how the conflict was handled (rejected, skipped, or blocked the batch).

**Next diagnostic step:** query the target table for existing rows with that key to confirm whether this is a true duplicate delivery or a key-reuse bug upstream.

## Timeout / connection failure

**Symptom:** a step logs a timeout or connection-refused/reset error against a database, API, or queue.

**Evidence:** the log line's `error_class` (`TimeoutError`, `UpstreamUnavailable`) and the target system, with duration if logged.

**Next diagnostic step:** check the target system's own status/health endpoint or recent incident history for the run window.

## Upstream rate limiting

**Symptom:** repeated 429-style responses or a `RateLimitError` from an external API step.

**Evidence:** the log line's status code/error class and the call volume immediately preceding it.

**Next diagnostic step:** check the upstream API's rate-limit documentation or dashboard against the pipeline's actual call volume for the window.

## Partial or truncated extract

**Symptom:** extract step completes "successfully" but the row count is far below the expected/historical volume.

**Evidence:** the `extract_complete` log line's row count compared against run-metadata history for prior runs.

**Next diagnostic step:** check the source system for a partial export, an early-terminated query, or a changed extract window.

## Retry exhaustion

**Symptom:** the same error repeats across multiple attempts with an increasing `attempt` counter, ending in a "retries exhausted" or dead-letter event.

**Evidence:** two or more log lines with identical `error_class`/root error and different `attempt` values, followed by a terminal failure event.

**Next diagnostic step:** confirm the underlying condition from the first attempt is still present (e.g. re-check the lookup table or source value) — a repeating identical error across retries means the fault is not transient and blind retrying will not resolve it.

## Clock / timezone skew

**Symptom:** freshness or scheduling checks fail even though the data looks otherwise current, or timestamps appear in an unexpected order.

**Evidence:** compare the logged timestamps' timezone/offset against the expected timezone for the source and the scheduler.

**Next diagnostic step:** check whether the source system and the pipeline are using the same timezone convention (UTC vs. local) for the timestamp field in question.

## Auth / permission failure

**Symptom:** a step fails immediately with a 401/403-class error or an explicit auth error class.

**Evidence:** the log line's `error_class` (`AuthError`) and the target system/credential name (never the credential value itself).

**Next diagnostic step:** check the credential's expiry/rotation status in the secrets store — do not attempt to read or log the secret itself.

## Resource exhaustion

**Symptom:** a step fails or the process is killed with an out-of-memory or disk-full signature, often with no specific business-logic error.

**Evidence:** an OOM-kill log line, a disk-space error, or a step that fails at a consistent row-count threshold across runs.

**Next diagnostic step:** check the host/container's resource metrics (memory, disk) for the run window against its configured limits.
