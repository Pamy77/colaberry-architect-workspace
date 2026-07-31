# frontend/

**Purpose:** React + CRA + TypeScript UI layer.

**Belongs here (once code lands):** `src/pages/`, `src/components/`, `src/routes/`, `src/services/`, `src/contexts/`, `src/styles/` (CLAUDE.md lines 62-67).

**Never here:** Backend business logic or secrets, `dangerouslySetInnerHTML` without justification (CLAUDE.md line 376).

**CLAUDE.md rule:** Execution layer (CLAUDE.md lines 42, 62).

**Status:** Foundation only — this folder is scaffolded empty. No code, no `package.json`, no dependencies until a directive calls for a specific feature.

**Verification (once code lands):** `tsc --noEmit` passes; CRA build succeeds; Playwright coverage tracked once UI exists (CLAUDE.md line 244).
