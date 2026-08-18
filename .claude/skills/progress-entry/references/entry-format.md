# PROGRESS.md Entry Format Reference

Source of truth: CLAUDE.md § "Logging, Reporting & Progress Tracking". This file expands it with examples.

## Required shape

```markdown
- [x] <task name>
  - Date: YYYY-MM-DD
  - Session: CC-<YYYYMMDD>-<4 random alphanumerics>
  - What changed: <one line>
  - Verification: <test name | deploy URL | "user confirmed" | "TypeScript passes">
  - Notes: <only if blocker, deviation, or non-obvious decision>
```

`Notes` is the only optional line. Everything else is required on every entry.

## Session ID format

Pattern: `^CC-\d{8}-[a-zA-Z0-9]{4}$`

- `\d{8}` is the date as `YYYYMMDD`, matching the `Date:` line above it
- The 4-character suffix must be freshly randomized per session, never copied from an existing entry in the file

## Good vs. bad examples

**Good:**
```markdown
- [x] Add idempotency key to Mandrill transactional send
  - Date: 2026-08-09
  - Session: CC-20260809-7f3a
  - What changed: briefingService.ts now checks (recipient, subject, business_event_id) before sending
  - Verification: unit test `briefingService.dedup.test.ts` passes; `tsc --noEmit` clean
  - Notes: none
```
Why it's good: verification names an actual artifact (a specific test file), not a vibe.

**Bad — vague verification:**
```markdown
- [x] Fix the email bug
  - Date: 2026-08-09
  - Session: CC-20260809-7f3a
  - What changed: fixed it
  - Verification: should work now
```
Two violations: "What changed" isn't specific enough to audit, and "should work now" is a restatement of intent, not evidence. This entry would fail validation.

**Bad — malformed session ID:**
```markdown
  - Session: session-1
```
Doesn't match `CC-YYYYMMDD-XXXX`. Fails validation.

## Banned verification placeholders

The validator rejects (case-insensitive) any Verification line that, after trimming, equals or starts with one of:
- "done"
- "should work"
- "TODO"
- "n/a"
- "" (empty)

These indicate intent, not evidence, per CLAUDE.md's explicit rule: "No `[x]` mark without verification evidence on the same line."

## Catch-up rule

If implementation work happened without incremental entries, write **one** end-of-session entry covering everything, dated for the day the work was actually done (not today, if different) — better logged late than not at all.
