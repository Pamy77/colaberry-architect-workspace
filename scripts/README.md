# scripts/

**Purpose:** Repo-root operational scripts (deploy helpers, ad-hoc data pulls, weekly reports).

**Belongs here:** Single-responsibility scripts — one script, one job. Same convention as `backend/src/scripts/`.

**Never here:** Orchestration logic (CLAUDE.md line 79), production writes without an explicit environment check (CLAUDE.md line 645).

**CLAUDE.md rule:** CLAUDE.md line 68, single-responsibility principle at line 361.

**Status:** `headless_verify.sh` - runs backend + frontend typecheck/tests deterministically,
then uses a headless (`claude -p`) call with no tool access to triage the combined output into
a short pass/fail summary. Wired into git via `.githooks/pre-push`, which blocks `git push` on
failure. One-time setup per clone: `git config core.hooksPath .githooks`.

**Verification:** Each script does one documented thing; grep for secret-shaped strings before commit; idempotency check against the operation table (CLAUDE.md lines 304-312) if the script has side effects.
