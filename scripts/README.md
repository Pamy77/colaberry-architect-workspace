# scripts/

**Purpose:** Repo-root operational scripts (deploy helpers, ad-hoc data pulls, weekly reports).

**Belongs here:** Single-responsibility scripts — one script, one job. Same convention as `backend/src/scripts/`.

**Never here:** Orchestration logic (CLAUDE.md line 79), production writes without an explicit environment check (CLAUDE.md line 645).

**CLAUDE.md rule:** CLAUDE.md line 68, single-responsibility principle at line 361.

**Status:** Foundation only — empty until the first operational script is actually needed.

**Verification:** Each script does one documented thing; grep for secret-shaped strings before commit; idempotency check against the operation table (CLAUDE.md lines 304-312) if the script has side effects.
