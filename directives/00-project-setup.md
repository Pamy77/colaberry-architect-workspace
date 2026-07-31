# Directive 00: Project Setup & Scaffolding (Foundation)

## Goal

Establish the governance-layer scaffolding approved in the Week 3 architecture review, before any feature code lands. This directive covers the foundation pass only — no product features, no dependencies.

## Inputs

- `CLAUDE.md` (root) — the operating contract this directive implements
- The approved folder-tree architecture (proposed and approved 2026-07-30)

## Outputs

- Nine top-level folders, each with a short README explaining purpose, contents, exclusions, and the CLAUDE.md rule that supports it: `directives/`, `backend/`, `frontend/`, `scripts/`, `tests/`, `docs/`, `config/`, `nginx/`, `preview-db-init/`
- `docs/ARCHITECTURE.md` — the full architecture documentation
- `PROGRESS.md` — initialized per the CLAUDE.md hard gate
- `.gitignore`

## Explicitly excluded from this pass

- `system/` — portal-owned, generated externally. Never created or edited by Claude (CLAUDE.md line 76).
- `execution/` — reserved for legacy pre-Node Python code. No such code exists in this repo, so this folder is not created (CLAUDE.md line 74).
- `intelligence/` (top-level) — CLAUDE.md leaves ambiguous whether this or `backend/src/intelligence/` is canonical (CLAUDE.md line 75). Not created; flagged for an explicit decision before either path is used.
- `.claude/` — already exists as Claude Code's own harness config (`settings.local.json`, created outside this session). Owned by the DRI per CLAUDE.md line 10; not modified here.
- `tmp/` — scratch space created on demand by whichever script first needs it (e.g. the escalation writer); not pre-scaffolded (CLAUDE.md line 73).

## Edge Cases

- None — this is static scaffolding with no runtime behavior.

## Safety Constraints

- No secrets committed.
- No dependencies installed (`npm install`, `pip install`, etc.).
- No folders created beyond the approved list above.
- Existing files (`CLAUDE.md`, `.claude/settings.local.json`) left untouched.

## Verification

- `Get-ChildItem` confirms all nine folders exist, each containing a `README.md`.
- `docs/ARCHITECTURE.md` and `PROGRESS.md` exist and are non-empty.
- No `backend/frontend` code, `package.json`, or lockfiles present (confirms "no product features, no dependencies" was honored).
