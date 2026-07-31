# Project Architecture

**Status:** Approved 2026-07-30 ("APPROVE FOUNDATION"). This document is the canonical record of the folder-tree architecture for this repository, superseding the in-conversation proposal it was derived from.

**Scope of this pass:** foundation scaffolding only. No product features, no dependencies installed.

---

## Assumptions this architecture rests on

1. **Stack = exactly what CLAUDE.md declares**: Node + Express + TypeScript backend, React + CRA + TypeScript frontend, Sequelize/Postgres. No code exists yet to confirm this independently.
2. **The portal system (owner of `/system`) is not yet deployed.** `/system` does not exist and is not created by this pass.
3. **Git is not yet available** on the development machine at the time of this pass (confirmed via `git --version` failing, and two `winget install --id Git.Git` attempts failing because the installer requires an interactive UAC elevation this environment can't grant). Installation is being handled separately by the project owner. Because of this, the git-dependent parts of CLAUDE.md's process (commits, `git diff`-based size checks, session audit via git log) are **not yet operable** — see Deviations below.
4. **`intelligence/` (top-level) is an open question, not a decision.** CLAUDE.md names it as a reserved folder but does not resolve whether it or `backend/src/intelligence/` is canonical (CLAUDE.md line 75). Choosing between them is an architecture-layer-structure decision, which CLAUDE.md's Autonomy Model reserves for escalation (CLAUDE.md line 140). It is intentionally not created.
5. **No requirements beyond CLAUDE.md and the approved proposal were supplied**, so nothing outside CLAUDE.md's named folders was added (no `/data`, `/notebooks`, `/models`, etc.).

## Deviations from CLAUDE.md, logged per CLAUDE.md line 365

- **Git initialization and commits are deferred.** CLAUDE.md's Tooling Assumptions state "Git is present" (line 629); it is not, in this environment, at the time of this foundation pass. All work in this pass is tracked in `PROGRESS.md` instead of commit history until git is installed and `git init` can run.
- **`/tmp/autonomy_log.json` is not written**, per CLAUDE.md's own note that the writer doesn't exist yet (line 462) — the equivalent information (assumptions, confidence, files touched) lives in the `PROGRESS.md` entry for this change instead.

## Rejected/excluded folders and why

| Folder | Why excluded |
|---|---|
| `system/` | Portal-generated. CLAUDE.md line 76: "DO NOT manually edit." Not created by Claude, ever. |
| `execution/` | Reserved for legacy pre-Node Python scripts (CLAUDE.md line 74). No such code exists in this repo. |
| `intelligence/` (top-level) | Ambiguous vs. `backend/src/intelligence/` (CLAUDE.md line 75); unresolved architecture decision, flagged for escalation rather than picked silently. |
| `.claude/` | Already exists as Claude Code's own harness config (`settings.local.json`), created outside any Claude-authored change. DRI-owned (CLAUDE.md line 10) — not modified here. |
| `tmp/` | Created on demand by whichever script first needs it (e.g. the escalation writer). Pre-scaffolding an always-empty, never-committed folder serves no purpose. |

---

## Folder-by-folder reference

### `directives/`
- **Purpose:** SOPs/runbooks — what to build and how success is verified, written before code.
- **Belongs:** Human-readable `.md` files: goals, inputs, outputs, edge cases, safety constraints, verification.
- **Never:** Business logic, executable code, secrets.
- **Rule:** CLAUDE.md lines 40, 69.
- **Status:** NOW — populated in this pass with `00-project-setup.md`.
- **Verification:** Required sections present; referenced files/scripts exist; markdown lints clean (CLAUDE.md lines 250-252).

### `backend/`
- **Purpose:** Node/Express/TypeScript execution layer.
- **Belongs (once code lands):** `src/services/`, `src/services/agents/`, `src/intelligence/`, `src/scripts/`, `src/seeds/`, `src/routes/`, `src/models/`, `src/config/`, `src/middleware/`.
- **Never:** Frontend UI code, hardcoded secrets, untyped `any` without justification.
- **Rule:** CLAUDE.md lines 42, 53-61.
- **Status:** Foundation only — empty, no `package.json`, no dependencies.
- **Verification:** `tsc --noEmit` passes; new business logic ships with ≥1 happy-path unit test.

### `frontend/`
- **Purpose:** React/CRA/TypeScript UI layer.
- **Belongs (once code lands):** `src/pages/`, `src/components/`, `src/routes/`, `src/services/`, `src/contexts/`, `src/styles/`.
- **Never:** Backend business logic/secrets, unjustified `dangerouslySetInnerHTML`.
- **Rule:** CLAUDE.md lines 42, 62-67.
- **Status:** Foundation only — empty, no `package.json`, no dependencies.
- **Verification:** `tsc --noEmit` passes; CRA build succeeds; Playwright coverage tracked once UI exists.

### `scripts/`
- **Purpose:** Repo-root operational scripts.
- **Belongs:** Single-responsibility scripts.
- **Never:** Orchestration logic; production writes without an explicit env check.
- **Rule:** CLAUDE.md lines 68, 361.
- **Status:** Foundation only — empty until the first script is needed.
- **Verification:** One documented job per script; secret-string grep before commit; idempotency check if it has side effects.

### `tests/`
- **Purpose:** Automated verification layer (E2E lives here; unit/integration live near code).
- **Belongs:** `systemV2/` Playwright flows; future API contract/visual-regression tests.
- **Never:** Anything touching production.
- **Rule:** CLAUDE.md lines 43, 70.
- **Status:** Foundation only — empty until the first testable feature exists.
- **Verification:** Test run exits 0; counted against the ~70/20/10 pyramid target.

### `docs/`
- **Purpose:** In-repo documentation shipped with the codebase.
- **Belongs:** This file, screenshot-review HTML, `sessions/` changelogs.
- **Never:** Secrets; decisions that belong in a directive instead.
- **Rule:** CLAUDE.md lines 71, 524.
- **Status:** Foundation — contains this document now.
- **Verification:** `generateSessionChangelog.js` produces valid per-session HTML (once that script exists).

### `config/`
- **Purpose:** Root-level shared configuration, separated from code (12-factor).
- **Belongs:** Env-driven config templates, non-secret shared settings.
- **Never:** Hardcoded hostnames/credentials/environment values; any actual secret.
- **Rule:** CLAUDE.md line 355.
- **Status:** Foundation only — empty until `backend`/`frontend` need shared config.
- **Verification:** No secret-shaped strings before commit.

### `nginx/`
- **Purpose:** Production nginx config for the Docker build.
- **Belongs:** nginx config files for production.
- **Never:** Application logic; embedded secrets.
- **Rule:** CLAUDE.md line 72.
- **Status:** Foundation only — empty until there's a service to front.
- **Verification:** `docker compose config` validates without error.

### `preview-db-init/`
- **Purpose:** Postgres init scripts for the preview-stack Docker images.
- **Belongs:** SQL/shell init scripts, preview environment only.
- **Never:** Production data/credentials, anything run against prod.
- **Rule:** CLAUDE.md line 77.
- **Status:** Foundation only — empty until a Docker preview stack exists.
- **Verification:** Preview stack boots and init scripts run unattended.

---

## Traceability table

| Folder | Justification source | CLAUDE.md line(s) | Status |
|---|---|---|---|
| `directives/` | CLAUDE.md rule (Layer 1) | 40, 69 | NOW — done |
| `backend/` | CLAUDE.md rule + declared stack | 42, 53-61 | Foundation — done (empty) |
| `frontend/` | CLAUDE.md rule + declared stack | 42, 62-67 | Foundation — done (empty) |
| `scripts/` | CLAUDE.md rule | 68 | Foundation — done (empty) |
| `tests/` | CLAUDE.md rule | 43, 70 | Foundation — done (empty) |
| `docs/` | CLAUDE.md rule | 71, 524 | Foundation — done |
| `config/` | CLAUDE.md rule (12-factor) | 355 | Foundation — done (empty) |
| `nginx/` | CLAUDE.md rule | 72 | Foundation — done (empty) |
| `preview-db-init/` | CLAUDE.md rule | 77 | Foundation — done (empty) |
| `system/` | CLAUDE.md rule | 30, 76 | Excluded — generated/DO-NOT-TOUCH |
| `execution/` | CLAUDE.md rule (conditional) | 74 | Excluded — legacy, N/A |
| `intelligence/` (top-level) | CLAUDE.md rule (unresolved) | 75 | Excluded — pending decision |
| `.claude/` | Pre-existing, DRI-owned | 10 | Untouched |
| `tmp/` | CLAUDE.md rule | 73 | Not pre-created — generated on demand |

## Open decision requiring owner input

`intelligence/` (top-level) vs. `backend/src/intelligence/`: CLAUDE.md defines both as valid homes for intelligence subsystem code without resolving which is canonical. Recommendation carried over from the approved proposal: consolidate in `backend/src/intelligence/` until a concrete cross-cutting need forces a split. No top-level `intelligence/` folder should be created until this is explicitly decided.
