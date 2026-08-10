---
name: executive-dashboard-brief
description: Use when the user asks to turn a data-quality result, failed refresh, pipeline incident, KPI variance, or technical investigation into an executive dashboard update. Produces a concise leadership brief containing status, business impact, verified evidence, decision needed, owner, and next update time.
---

# Executive Dashboard Brief

## When to trigger

Trigger when the user asks to translate a technical data/pipeline finding into a leadership-facing update — e.g. "write an exec brief for this," "turn this quality report into a dashboard status update," "summarize this incident for Ali/Ram," "what do we tell leadership about the dashboard."

Do **not** trigger for requests to run the underlying investigation itself — that's `data-quality-gate` (dataset/publish-readiness validation) or `etl-failure-triage` (pipeline failure diagnosis). This skill consumes their output; it does not reproduce their checks.

## Inputs

1. **Source report(s)** — required: a data-quality report, ETL triage report, KPI variance finding, or equivalent technical investigation. If the user has not supplied or pointed to one, ask for it before proceeding. Do not draft a brief from memory or assumption.
2. **Business impact, owner, and timing** — only if explicitly stated by the user or present in the source report. Never inferred.

## Procedure

1. Read the supplied report(s) in full. Do not modify them.
2. Extract only what the report(s) state as fact (evidence-backed findings, statuses, ranked causes with cited evidence). Anything the report labels as a hypothesis, open question, or "next test" is not a verified fact.
3. Separate the extracted material into two buckets:
   - **Verified facts** — directly stated in the source report(s) with evidence.
   - **Unresolved questions** — open items, unconfirmed hypotheses, pending diagnostics, or anything the source report flags as not yet confirmed.
4. Do not invent or estimate anything the source report(s) do not state, including:
   - **Financial/business impact** — only state it if a report or the user gives a number or concrete effect. Otherwise write "Not yet quantified" (or equivalent) in the brief rather than guessing.
   - **Root cause** — state only causes the source report ranks with cited evidence; do not upgrade a hypothesis to a stated cause.
   - **Owner** — only name an owner if the source report, directive, or user states one. Otherwise write "Unassigned" / "Pending assignment."
   - **Timing** — only state a next-update time if given. Otherwise write "Not yet scheduled."
5. Strip raw logs, line numbers, stack traces, query text, and other implementation-level detail. Translate technical findings into plain business language; a fact can be carried forward without its technical evidence citation.
6. Determine the dashboard status: state explicitly whether the dashboard/data should remain **blocked** from publication or is **cleared**, based on the source report's own recommendation (e.g. a `data-quality-gate` BLOCK/PUBLISH verdict, or an unresolved `etl-failure-triage` incident). Do not soften or reverse a BLOCK verdict from the source report.
7. Fill out `template.md` (read it before writing) with the extracted, filtered content. Do not add sections beyond what the template defines.

## Output format

Produce the brief using the exact structure in `template.md`:

- **Status**
- **Business Impact**
- **What We Know**
- **What We Do Not Know**
- **Decision or Action Needed**
- **Owner**
- **Next Update**

Keep it short enough for a leadership audience to read in under a minute — no raw logs, no query text, no line-number citations. Where information is genuinely unavailable, say so explicitly rather than omitting the field or filling it with a guess.
