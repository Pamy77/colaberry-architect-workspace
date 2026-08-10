---
name: etl-failure-triage
description: Use when the user asks why an ETL or ELT pipeline, scheduled load, SQL job, data refresh, or ingestion process failed or produced suspicious output. Reviews logs and run metadata, ranks likely causes, cites evidence, and recommends the next safe diagnostic steps.
---

# ETL Failure Triage

## When to trigger

Trigger when the user is asking why a pipeline, scheduled load, SQL job, data refresh, or ingestion process failed or produced suspicious output, and can point to a log, run output, or failure description.

Do not trigger for requests to write new pipeline code, design a new ETL job from scratch, or implement a fix the user has already diagnosed themselves — this skill diagnoses an observed failure, it does not build or repair pipelines.

## Inputs

1. **Failure evidence** — required: a log excerpt, run output, error message, or failure description. If none is supplied, ask for it before proceeding. Do not guess at what failed.
2. **Run metadata** — if supplied (run ID, schedule, retry policy, row counts, timestamps, prior-run history), read it and use it as corroborating evidence. If not supplied, proceed on the log/description alone and note in the report that metadata was unavailable.

## Procedure

1. Read the failure evidence and the run metadata (if supplied). Do not modify either file.
2. Read `references/common-failures.md` — it catalogs common ETL/ELT failure classes, their typical log signatures, and the appropriate next diagnostic step for each. Read it once per session; no need to reread if already loaded earlier in this conversation.
3. Separate observed facts (what the log/metadata literally shows) from hypotheses (what might explain those facts). Never present a hypothesis as a fact.
4. For every likely cause, cite the specific log line(s), timestamp(s), or metadata field(s) that support it. A cause with no cited evidence does not get listed as "likely" — mention it only as an open question in Next Tests, if at all.
5. Rank causes most-to-least likely based on the strength and directness of the cited evidence.
6. For each ranked cause, give exactly one concrete next diagnostic step — a read-only check (query a table, inspect a lookup/config value, check a schedule window) that would confirm or rule it out.
7. **Do not modify pipeline code. Do not rerun or trigger the job. Do not claim a root cause without evidence** — if the evidence is inconclusive, say so plainly and recommend the diagnostic that would resolve the ambiguity.

## Output format

Return, in this order:

- **Incident Summary** — one or two sentences: what job, what run, what was observed.
- **Evidence** — bullet list of observed facts, each with its source (log line/timestamp or metadata field).
- **Ranked Causes** — numbered list, most likely first, each with its supporting evidence cited inline.
- **Next Tests** — one concrete, safe, read-only diagnostic step per ranked cause.
- **Escalation Recommendation** — whether this needs escalation per this repo's Escalation Protocol (e.g. a schema/contract change, a production data fix) or can be resolved directly by the on-call engineer, with one line of reasoning.

Keep the report evidence-driven and procedural, not narrative.
