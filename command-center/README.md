# Command Center

The single site that shows what the Small Business KPI Copilot is, what it's meant to move, and how far along it is. Built first, before any part of the KPI Copilot system itself — see `docs/workflow-plan.md` for the underlying plan.

**Open it:** this now fetches its data at runtime, so it must be served over HTTP — browsers block `fetch()` against local files opened directly. From the **repo root** (not this folder):

```
python -m http.server 8000
```

then open `http://localhost:8000/command-center/`. Any other static file server works the same way, as long as it serves the repo root (so `../.colaberry/*.json` resolves from inside `command-center/`). Opening `index.html` by double-clicking will show a clear error explaining why, instead of a blank page.

## Status

All 9 tabs are built: Overview, Outcomes, Users and use case, Guardrails, Systems, Project management, AI agents, Knowledge base, Data model. Every card drills down one level, including cards with nothing behind them yet (Outcomes' empty state, a role with no linked story, an owner with no registered skills).

The **Data model** tab is a draft for review, not tables that have been created — nothing has been built against that schema.

## How it's structured

- **`.colaberry/plan.json`** (repo root) — the structural plan: product info, timeline, releases, stories, requirements, guardrails, roles, owners, tab config, the draft data model, and the sample/illustrative dataset. This is what `docs/workflow-plan.md` says the project *is* — it doesn't change as work actually happens.
- **`.colaberry/progress.json`** (repo root) — the mutable real-world state: each system's actual connection status and last-checked time, and the list of features that are actually live. This is what the project has *produced so far*.
- **`.colaberry/manifest.json`** (repo root) — generation timestamps for the two files above. Every tab reads this and shows "Data as of \<date\> · N days old," with a visible warning once either file is more than a week old.
- `assets/common.js` — fetches all three files at runtime (`fetch('../.colaberry/plan.json')`, etc.), merges plan + progress into one `CC.DATA` object, and owns the shared page shell: topbar, tab nav, the freshness banner, and the Sample/Real switch. If the fetch fails (most commonly: opened via `file://` instead of a server), it shows an explanatory error instead of a blank page.
- `assets/tokens.css` — the one place to change colors. No brand palette has been chosen for this project yet, so this currently holds a neutral placeholder set.
- `assets/styles.css` — shared layout/components (cards, stat tiles, status dots, tab nav, timeline, gantt bars, chat panel, entity cards).
- `assets/app.js`, `outcomes.js`, `users.js`, `guardrails.js`, `systems.js`, `pm.js`, `agents.js`, `kb.js`, `datamodel.js` — one render script per tab. Each reads `CC.DATA` only from inside its render function (never at the top of the file), since that data isn't available until the runtime fetch resolves.
- `detail.html` + `assets/detail.js` — a single generic detail-view template, parameterized by `?type=&id=`, that every card on every tab drills down into (`type` is one of `requirement`, `story`, `release`, `system`, `role`, `owner`, `entity`, or `outcomes-empty`).

Cross-references not literally stated in the plan (which story implements which requirement, which role a story belongs to) live in `plan.json`, computed from exact matches (an owner field equal to a role name, a requirement's own wording) and tagged **explicit** or **inferred** everywhere they're shown, so a derived link is never presented as a stated fact.

## Sample / Real switch

Top-right toggle, global across all 9 tabs, persisted in `localStorage` (defaults to **Real** so nobody demos sample data by accident). Real mode shows only what `progress.json` actually says has happened — on day one, almost nothing. Sample mode fills in the illustrative data from `plan.json`'s `sample` block, and every sample value is tagged `SAMPLE` inline plus a banner at the top of the page.

## Knowledge base tab specifics

- **Ask about this project** is a deterministic keyword search over the loaded data (requirements, stories, releases, systems, roles) — explicitly labelled as that, not a general AI assistant. It cites which tab a match came from, or says "I can't answer that from the data on this page" when nothing matches.
- **Notes** persist to `localStorage` in the current browser only — labelled as such, since there's no backend yet to sync them anywhere else.

## Keeping the data current

Edit `.colaberry/plan.json` as the plan changes (new stories, new requirements) and `.colaberry/progress.json` as real progress happens (a system actually connects, a feature actually ships) — then bump the matching timestamp in `.colaberry/manifest.json` so the freshness banner stays honest. No tab needs editing to reflect either kind of change; that's the point of reading both files at runtime instead of hard-coding them.
