# Command Center

The single site that shows what the Small Business KPI Copilot is, what it's meant to move, and how far along it is. Built first, before any part of the KPI Copilot system itself — see `docs/workflow-plan.md` for the underlying plan.

**Open it:** double-click `index.html`, or `start index.html` from this folder. Static HTML/CSS/vanilla JS, no build step, no dependencies, works from `file://`.

## Status

All 9 tabs are built: Overview, Outcomes, Users and use case, Guardrails, Systems, Project management, AI agents, Knowledge base, Data model. Every card drills down one level, including cards with nothing behind them yet (Outcomes' empty state, a role with no linked story, an owner with no registered skills) — those go to a page that says what's missing and, where relevant, what has to happen before it's filled in.

The **Data model** tab is a draft for review, not tables that have been created — nothing has been built against that schema.

## How it's structured

- `assets/data.js` — the single source of data: requirements, releases, stories, systems, roles, owners, and the draft data model. Every tab reads from here; nothing is hardcoded into a page. Cross-references that aren't literally stated in the plan (which story implements which requirement, which role a story belongs to) are computed from exact matches (an owner field equal to a role name, a requirement's own wording) and tagged **explicit** or **inferred** everywhere they're shown, so a derived link is never presented as a stated fact. `sample` holds illustrative, clearly-fake data, kept separate so it can never be mistaken for real data.
- `assets/tokens.css` — the one place to change colors. No brand palette has been chosen for this project yet, so this currently holds a neutral placeholder set.
- `assets/styles.css` — shared layout/components (cards, stat tiles, status dots, tab nav, timeline, gantt bars, chat panel, entity cards).
- `assets/common.js` — shared shell every page calls into: topbar, tab nav, the Sample/Real switch, date helpers, and the `detail.html?type=...&id=...` link builder.
- `assets/app.js`, `outcomes.js`, `users.js`, `guardrails.js`, `systems.js`, `pm.js`, `agents.js`, `kb.js`, `datamodel.js` — one render script per tab.
- `detail.html` + `assets/detail.js` — a single generic detail-view template, parameterized by `?type=&id=`, that every card on every tab drills down into (`type` is one of `requirement`, `story`, `release`, `system`, `role`, `owner`, `entity`, or `outcomes-empty`). One template instead of dozens of near-identical files — still a real, linkable page per item.

## Sample / Real switch

Top-right toggle, global across all 9 tabs, persisted in `localStorage` (defaults to **Real** so nobody demos sample data by accident). Real mode shows only what the project has actually produced — on day one, almost nothing. Sample mode fills in illustrative made-up data, and every sample value is tagged `SAMPLE` inline plus a banner at the top of the page.

## Knowledge base tab specifics

- **Ask about this project** is a deterministic keyword search over the data in `data.js` (requirements, stories, releases, systems, roles) — explicitly labelled as that, not a general AI assistant. It cites which tab a match came from, or says "I can't answer that from the data on this page" when nothing matches.
- **Notes** persist to `localStorage` in the current browser only — labelled as such, since there's no backend yet to sync them anywhere else.

## Next

Point the data at the real system as it gets built: `data.js` is the only file that should need editing as releases ship, systems connect, and outcome targets get defined — no tab should need rewriting to show real data once it exists.
