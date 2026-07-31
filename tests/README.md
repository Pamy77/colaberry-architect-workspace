# tests/

**Purpose:** Automated verification layer. Unit/integration tests live near the code they test; end-to-end tests live here.

**Belongs here:** `systemV2/` Playwright flows; future API contract and visual-regression tests.

**Never here:** Anything that touches production (CLAUDE.md line 239).

**CLAUDE.md rule:** Verification layer (CLAUDE.md lines 43, 70).

**Status:** Foundation only — empty until the first testable feature exists.

**Verification:** Test run exits 0; counted against the ~70/20/10 unit/integration/E2E pyramid target (CLAUDE.md lines 264-268).
