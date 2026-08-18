---
name: plain-english-recap
description: Rewrites a technical change, error, or decision (code diff, stack trace, architecture choice) as a short plain-language recap for non-technical stakeholders. Use when the user asks to "explain this simply," "summarize for execs/non-technical people," or after finishing technical work that a non-engineer (e.g. Ram, Ali, a client) needs to understand. Do NOT use for writing code, debugging, or any request where the audience is a developer who wants technical detail.
---

# Plain English Recap

## Instructions

### Step 1: Identify the audience
Confirm (or assume, if obvious from context) who this is for — a business stakeholder, a client, an exec. Never assume they know terms like "API," "schema," "commit," "idempotent," or "refactor."

### Step 2: Extract the three things that matter
From the technical material, pull out only:
1. **What changed or happened** — in one sentence, no jargon
2. **Why it matters to them** — the business/user-facing effect
3. **What happens next** (if anything) — an action, a wait, or nothing needed from them

Discard implementation detail (file names, function names, library choices) unless the user specifically asked for it.

### Step 3: Replace jargon with analogies
Every technical term gets either dropped or swapped for a plain-language equivalent or short analogy (e.g. "idempotency key" → "a safeguard so re-running this doesn't send the email twice"). If no clean analogy exists, describe the effect instead of naming the mechanism.

### Step 4: Keep it short
Default to 3-6 sentences or a short bulleted list. Do not pad with caveats, disclaimers, or restated context the reader already has.

### Step 5: Offer the technical version on request
End only if asked: a one-line pointer that the technical detail is available if they want it. Don't include it unprompted — that defeats the purpose.
