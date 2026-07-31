# backend/

**Purpose:** Node.js + Express + TypeScript execution layer — all business logic and API surface.

**Belongs here (once code lands):** `src/services/`, `src/services/agents/`, `src/intelligence/`, `src/scripts/`, `src/seeds/`, `src/routes/`, `src/models/`, `src/config/`, `src/middleware/` (CLAUDE.md lines 53-61).

**Never here:** Frontend UI code, hardcoded secrets (CLAUDE.md line 380), untyped `any` without a written justification comment (CLAUDE.md line 120).

**CLAUDE.md rule:** Execution layer (CLAUDE.md lines 42, 53).

**Status:** Foundation only — this folder is scaffolded empty. No code, no `package.json`, no dependencies until a directive calls for a specific feature.

**Verification (once code lands):** `tsc --noEmit` passes; new business logic ships with at least one happy-path unit test (CLAUDE.md line 234).
