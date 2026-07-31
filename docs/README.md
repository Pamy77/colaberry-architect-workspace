# docs/

**Purpose:** In-repo documentation that ships with the codebase — architecture notes, integration guides, system docs, plus generated per-session HTML changelogs.

**Belongs here:** Markdown docs (see `ARCHITECTURE.md` in this folder), screenshot-review HTML, session changelogs under `sessions/`.

**Never here:** Secrets; decisions that should instead live in a directive or in code.

**CLAUDE.md rule:** CLAUDE.md lines 71, 524.

**Status:** Foundation — contains `ARCHITECTURE.md` now; `sessions/` will appear once the per-session changelog script runs.

**Verification:** `node scripts/generateSessionChangelog.js <SessionID>` produces a valid HTML file keyed to that session (once that script exists).
