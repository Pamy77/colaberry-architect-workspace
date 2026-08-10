---
name: system-architect
description: Use when the user has a project idea and wants a system architecture, a technical design, or a diagram of how it would work.
---

# System Architect

## When to trigger

Trigger when the user describes a project idea (an app, service, tool, or product concept) and wants to know how it would be built — architecture, technical design, system diagram, "how would this work under the hood," "what components would I need."

Do **not** trigger for requests to debug or modify an existing, already-designed system, or for narrow implementation questions about a single file/function — those are ordinary coding tasks, not architecture requests.

## Input

A one-paragraph project idea, in the user's own words. If the user has given only a title or a single sentence with no detail on what the thing actually does, ask one clarifying question before proceeding — a real architecture cannot be derived from a name alone. Do not ask more than one clarifying question; make reasonable assumptions for anything else and state them.

## Procedure

1. **Extract the real requirements from the idea.** Read the paragraph for what the thing actually does: what data it handles, who uses it, whether it's real-time, whether it involves AI/agents, whether it needs to store anything, whether it talks to any outside service (payments, email, maps, auth providers, etc.). The component list must be derived from these specifics — never default to a generic "frontend + backend + database" template if the idea doesn't call for one of those (e.g. a CLI tool has no frontend; a static content generator may need no database; a pure data pipeline may need no UI at all).

2. **Identify only the components this idea needs**, drawn from (not limited to):
   - Frontend / client (web app, mobile app, CLI, browser extension — whichever the idea implies)
   - Backend / API layer
   - Database / storage (pick a kind that fits the data described — relational, document, object storage, vector store — don't default to "a database" with no reasoning)
   - External services (auth provider, payment processor, maps API, email/SMS provider, third-party data source) — only include ones the idea actually implies a need for
   - AI/agent layer (LLM calls, RAG pipeline, agent orchestration) — only if the idea involves generating, classifying, summarizing, or reasoning over content; omit entirely for ideas with no AI component
   - Background jobs / workers / queues — only if the idea implies async or scheduled work

   If a category doesn't apply, leave it out rather than including it as a placeholder.

3. **Produce a genuine mermaid flowchart** (` ```mermaid ` fence, `flowchart` or `graph` syntax) showing the actual components identified in step 2 as nodes, with directional edges labeled by what flows across them (e.g. `User -->|submits form| API`, `API -->|query| Database`, `API -->|prompt| LLM Agent`). The diagram must reflect this specific idea's data flow, not a stock diagram with relabeled boxes. Every node in the diagram must correspond to a component from step 2, and every component from step 2 must appear in the diagram.

4. **Explain each component in one plain-English sentence** a non-technical person could follow — what it does and why the project needs it, no jargon, no framework names unless the user's own paragraph used them.

5. **Write the result to `project-blueprint/architecture.md`**, creating the `project-blueprint/` directory if it does not exist. Structure the file as:
   - A one-line restatement of the project idea
   - The component list (heading per component, one-sentence explanation each)
   - The mermaid diagram
   - Nothing else — no implementation code, no tech-stack recommendations beyond what's implied by the components, no timeline/roadmap content (out of scope for this skill)

## Output format

Keep the saved file plain-English and diagram-first. After saving, do not restate the entire file back to the user in chat — the completion report (below) is sufficient.

## When finished, report

1. The exact path the file was saved to
2. The final one-line description of the project used to drive the design
3. The component list identified (names only, one line each)
