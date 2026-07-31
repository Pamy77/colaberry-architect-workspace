# config/

**Purpose:** Root-level shared configuration, kept separate from code per the 12-factor principles CLAUDE.md adopts.

**Belongs here:** Env-driven config templates, non-secret shared settings.

**Never here:** Hostnames, credentials, or environment-specific values hardcoded (CLAUDE.md line 355); actual secret values of any kind (CLAUDE.md lines 380-381).

**CLAUDE.md rule:** CLAUDE.md line 355.

**Status:** Foundation only — empty until `backend`/`frontend` exist and need shared config.

**Verification:** No secret-shaped strings present (grep for common credential patterns before each commit).
