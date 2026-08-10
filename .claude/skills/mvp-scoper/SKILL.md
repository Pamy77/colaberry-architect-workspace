---
name: mvp-scoper
description: Use when the user wants to know what to build first, see what their idea could look like, and get a short pitch for it.
allowed-tools: Read, Write, Bash
---

# MVP Scoper

## When to trigger

Trigger when the user has a scoped idea and wants to know what to build **first** — "what's the MVP," "what should I build in week 1," "show me what this would look like," "give me something I can pitch." This skill turns prior architecture/stack work into something concrete: a build checklist, a visual mockup, and a one-page pitch.

Do **not** trigger for requests to design the architecture itself (`system-architect`) or to pick technologies (`tech-stack-recommender`) — this skill consumes their output, it doesn't replace them.

## Input

`project-blueprint/architecture.md` and `project-blueprint/tech-stack.md`. Both are required:

- If `architecture.md` is missing, tell the user to run the `system-architect` skill first — do not guess at components.
- If `tech-stack.md` is missing, tell the user to run the `tech-stack-recommender` skill first — do not guess at technologies.

Never invent components or technologies that aren't in these two files. If the idea needs something neither file covers, say so instead of filling the gap silently.

## Procedure

### 1. Read the grounding docs

Read `project-blueprint/architecture.md` and `project-blueprint/tech-stack.md` in full. Pull out: the one-line project idea, the component list with their plain-English purpose, the build-order (if present), and the recommendation table (technology + fit per component).

### 2. Write `project-blueprint/mvp-plan.md`

Read `template.md` (in this skill's own directory) and fill it in — do not freelance a different structure.

- **The smallest real slice** is the minimum set of components, wired together end-to-end, that proves the core idea works — not every component, not a polished product. Prefer the architecture doc's own Phase 1 / build-order if it already defines one; otherwise derive it using the same logic (what's on the critical path for the day-one priority).
- Every checklist item names a real component from `architecture.md` and the real technology assigned to it in `tech-stack.md`. No generic tasks.
- List what's explicitly deferred and why — this is what keeps Week 1 small.

### 3. Build the mockup and write `project-blueprint/mockup.html`

One self-contained HTML file — inline `<style>`, no external stylesheets, fonts, or CDN scripts (nothing to fetch, must open straight from disk). Pick whichever the idea calls for: a landing page (if the idea is something you'd market to sign people up) or the core in-app screen (if the idea is a tool people log into and use). Whichever you pick, it must look like a real screen from this real product:

- Real sample content specific to this idea — actual entity names, actual sample rows/cards drawn from the project's own domain (e.g. for a trucking dispatch app: real-looking load IDs, driver names, truck numbers, statuses like "In Transit" / "Delivered" — not "Item 1," not lorem ipsum).
- Real visual design: a coherent color palette, spacing, typography hierarchy, and icons (inline SVG or unicode/emoji glyphs — no icon-font CDN). Not gray wireframe boxes, not placeholder rectangles.
- Enough layout to read as a finished screen: a header/nav, a primary content area with the real sample content, and whatever secondary elements (sidebar, stat tiles, buttons) the screen would actually have.

### 4. Build the one-pager and generate `project-blueprint/one-pager.pdf`

Draft the pitch content first, in marketing voice, not technical voice:

- What it does — one punchy line, not a technical description
- Who needs it — name the actual user from `architecture.md`
- One sentence on why it matters
- A few short supporting lines/benefits with icons — scannable, not paragraphs

Then produce a single-page PDF from that content:

1. Compose it as a small standalone HTML file in the scratchpad directory (not in `project-blueprint/` — it's a intermediate, only the PDF ships), styled for print (one page, print-friendly margins, `@media print` if needed).
2. Check what's already available on this machine before reaching for anything new: a system Chrome/Edge/Chromium binary (for headless `--print-to-pdf`), or an already-installed Python library (e.g. `reportlab`, `weasyprint`) or Node library (e.g. `puppeteer`) — check `node_modules`/the Python environment rather than assuming. Use whichever already exists.
3. Run **exactly one command** that converts that HTML (or an equivalent script) into `project-blueprint/one-pager.pdf`. This is the only Bash usage this skill needs — do not use Bash for anything else in this procedure.
4. If nothing usable already exists, say so explicitly before installing anything — a new dependency is a deliberate add, not a drive-by `npm install`/`pip install`, per this repo's rules. Prefer the system-browser print-to-PDF route first since it needs no new dependency at all.
5. Never save the one-pager as a renamed `.md` or `.html` file — it must be a real, single-page PDF.

## Output format

Three files land in `project-blueprint/`: `mvp-plan.md`, `mockup.html`, `one-pager.pdf`. Nothing else ships there from this skill (the scratch HTML used to render the PDF stays in the scratchpad directory). Do not restate the full checklist or mockup content back to the user in chat — the completion report below is sufficient.

## When finished, report

1. Every file created, with its exact path
2. One line on what each file contains
3. Which tool/command generated the PDF
