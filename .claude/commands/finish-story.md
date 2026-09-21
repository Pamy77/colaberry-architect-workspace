---
description: Run the full "when you finish a story" ritual from CLAUDE.md for one story — verify, reconcile progress, log, commit, push
---

You are running the exact closing ritual CLAUDE.md defines under "When you finish
a story" and "Definition of Done," end to end, for one story. Do not do a piece of
this and stop — either finish all the steps below, or stop and tell me exactly why
you can't and what's missing.

## 0. Which story

Arguments: $ARGUMENTS

If $ARGUMENTS names a STORY-nnn id, use it. If it's empty or ambiguous, ask me
which story before doing anything else — do not guess from "recent commits" or
"whatever looks unfinished."

## 1. Read the claim and the plan

- Read that story's entry in `.colaberry/plan.json` (`stories[]`, matched by `id`) for its title and its `acceptance[]` list — that list is the exact wording that counts, word for word.
- Read that story's entry in `.colaberry/progress.json` (`stories[]`, matched by `id`) for its current `criteria[]`, `files_touched`, `tests_added`, `notes`, and `verification` block.
- If the story id isn't in one or both files, say so and stop — don't invent an entry.

## 2. Verify for real, don't trust the existing ticks

- Run `cd backend && npm run typecheck && npm test` and `cd frontend && npm run typecheck && npm test`. Both must actually run; report the real pass/fail counts, not an assumption.
- For every criterion in the plan's `acceptance[]` list, decide from the code and the test results whether it is genuinely true **today** — a `passed: true` already sitting in `progress.json` is a prior claim, not proof. If a criterion that was true has regressed, that's a real finding — report it, don't paper over it.
- If a criterion's truth genuinely can't be determined from tests or code alone (it needs a judgment call only I can make — e.g. "is this the right interpretation of an ambiguous requirement"), ask me. Don't guess and don't tick it to make the count look better.

## 3. Reconcile `.colaberry/progress.json`

- Update only this story's entry. Flip `passed` to match what you just verified — for criteria that are still false, leave them false; that is a correct, honest state, not a failure.
- Fill `files_touched` and `tests_added` with the real files/tests from this pass (additive to what's already there, not a rewrite of history).
- Add to `notes` only if there's a deviation, a regression, or a non-obvious judgment call worth recording. Don't retype criterion text — only the boolean and the metadata fields change.
- **If nothing you found differs from what the file already claims** — same criteria true/false, tests still green, nothing new touched — say so plainly and skip straight to reporting. Do not write a no-op commit.

## 4. Log it in PROGRESS.md (hard gate, per CLAUDE.md)

- If this session hasn't minted a Session ID yet (`CC-<YYYYMMDD>-<4 random alphanumerics>`), mint one now and use it for the rest of this run.
- Re-read the tail of `PROGRESS.md` immediately before appending — another instance may have written to it since you last looked. Append after the current last line.
- Append one entry in the required format (task name, Date, Session, What changed, Verification, Notes) under this story's section. `Verification` must cite something concrete: the real test counts from step 2, or "user confirmed," never intent.

## 5. Commit and push

- Stage only the specific files this pass actually changed (`git add <path> <path>...` — never `-A` or `.`).
- Commit with the story named in the message, plus a `Story: STORY-nnn` trailer, plus the `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` line.
- Push. If push fails or is rejected, say so and stop — don't force it.
- If step 3 found nothing to change, there's nothing to commit — don't manufacture a diff just to have something to push.

## 6. Report back

Tell me plainly, in a short list:
- which criteria are true now and which are still false, and why
- what (if anything) changed in `progress.json`, `PROGRESS.md`, and git
- anything you had to ask me about instead of deciding yourself
