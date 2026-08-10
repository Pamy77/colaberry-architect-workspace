---
name: tech-stack-recommender
description: Use when the user has a system architecture and wants a recommended tech stack, explained simply.
---

# Tech Stack Recommender

## When to trigger

Trigger when the user has an existing system architecture (or component list) and asks what technology to actually build each piece with — "what stack should I use," "what tech should I pick," "recommend tools for this."

Do **not** trigger for requests to design the architecture itself (that's `system-architect`), or for narrow questions about a single already-chosen technology.

## Input

`project-blueprint/architecture.md`. If it does not exist, tell the user to run the architecture step first (via the `system-architect` skill) rather than guessing at components.

## Procedure

1. **Read `project-blueprint/architecture.md` in full.** Pull out the component list and, if present, the assumptions and build-order sections — scale and sequencing matter for fit ratings.

2. **For each component, recommend exactly one real, currently-maintained technology.** Not a category ("a database") — a specific product or framework ("PostgreSQL"). Don't hedge with "or X or Y"; pick the one that fits this idea and commit to it. Prefer boring, proven, well-supported choices over trendy ones unless the idea's actual requirements demand otherwise.

3. **Give every recommendation a fit rating**, judged against THIS idea's real scale and needs — not a generic default:
   - 🟢 **great fit** — squarely matches the scale, team size, and requirements described
   - 🟡 **good fit** — works fine, but there's a tradeoff worth knowing about (cost at scale, learning curve, overkill/underkill for the stated size)
   - 🔴 **consider carefully** — usable, but there's a real risk or mismatch (e.g. a tool built for a much bigger or much smaller scale than this idea, a vendor lock-in risk, a maturity concern)

   Never rate everything 🟢 — if nothing in the stack has a tradeoff, look harder. A rating with no reasoning behind it is not acceptable; the "why" (step 4) must justify the color.

4. **Explain the why in one plain-English sentence.** No unexplained jargon — if a technical term is unavoidable (e.g. "ORM," "vector store," "connection pooling"), attach a same-line, plain-language definition in parentheses. Write for someone who has never picked a tech stack before.

5. **Format as a scannable table, never a wall of text.** One row per component:

   | Component | Recommendation | Fit | Why | Learn more |
   |---|---|---|---|---|
   | Dispatch & Assignment API | Node.js + Express | 🟢 great fit | It's a fast, well-documented way to build the API that matches loads to trucks, and most developers already know it. | *"Explain Node.js and Express to me like I'm new to backend development, using my project as the example."* |

   Keep the "Why" cell to one sentence. Keep the "Learn more" cell to one italicized, copy-paste-ready prompt written in first person, naming the specific technology and referencing "my project" so it's ready to paste into a new conversation as-is.

6. **Save the result to `project-blueprint/tech-stack.md`.** Structure the file as:
   - A one-line restatement of the project (reuse the architecture doc's framing)
   - The recommendation table (step 5), one row per component from `architecture.md`
   - A short legend explaining the three fit-rating icons
   - Nothing else — no code samples, no setup instructions, no timeline (out of scope for this skill)

## Output format

Keep the saved file table-first and jargon-free. After saving, do not restate the entire table back to the user in chat — the completion report (below) is sufficient.

## When finished, report

1. The exact path the file was saved to
2. The fit-rating breakdown: count of 🟢, count of 🟡, count of 🔴
