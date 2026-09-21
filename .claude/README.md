# Claude Code tooling in this repo

Three pieces work together as one pipeline: a command that closes out a
story, a hook that refuses to let ungoverned work leave your machine, and a
CI reviewer that leaves a paper trail on every push. The recording below
shows all three firing in one real push.

<video src="../artifacts/week-08/kpi-copilot-finish-story-pipeline-demo.mp4" controls width="720">
  Your viewer doesn't render inline video — watch it directly:
  <a href="../artifacts/week-08/kpi-copilot-finish-story-pipeline-demo.mp4">kpi-copilot-finish-story-pipeline-demo.mp4</a>
</video>

## The command — `/finish-story`

**File:** [`commands/finish-story.md`](commands/finish-story.md)
**Triggers on:** you typing `/finish-story STORY-nnn` in a Claude Code session (asks which story if you omit it).

Runs the CLAUDE.md "when you finish a story" ritual end to end, for one story:

1. Reads that story's acceptance criteria from `.colaberry/plan.json` and its current claims from `.colaberry/progress.json`.
2. Re-runs backend + frontend `typecheck` and the real test suites — never trusts an existing `passed: true`, re-derives it.
3. Reconciles `.colaberry/progress.json` to match what's actually true today. Leaves genuinely-unmet criteria `false` rather than inflating the count.
4. Appends a `PROGRESS.md` entry in the CLAUDE.md hard-gate format.
5. Commits (naming the story, with a `Story: STORY-nnn` trailer) and pushes — **only if something actually changed.** If everything already holds, it says so and stops; it will not manufacture an empty commit.

## The hook — the PROGRESS.md pre-push gate

**Files:** [`.githooks/pre-push`](../.githooks/pre-push) → [`scripts/checkProgressGate.sh`](../scripts/checkProgressGate.sh) → [`scripts/headless_verify.sh`](../scripts/headless_verify.sh)
**Triggers on:** any `git push`, automatically — this clone has `core.hooksPath` set to `.githooks`, so git invokes it on its own, no extra step needed.

Two checks, cheapest first:

1. **`checkProgressGate.sh`** (read-only — only `git rev-list`/`diff-tree`/`merge-base`/`log`, no writes, no network): for every commit the push is about to add, if it touches `backend/`, `frontend/`, `scripts/`, `nginx/`, or `directives/`, `PROGRESS.md` must be touched in that *same* commit — the CLAUDE.md hard gate this repo had never actually enforced until now. Blocks with the exact commit sha and paths if not.
2. **`headless_verify.sh`**: backend + frontend `typecheck` and test suites must pass.

Either failure blocks the push outright (`exit 2`/non-zero); fix it or push again. `git push --no-verify` bypasses both, deliberately, for the rare time you need to.

## The CI reviewer — `push-review.yml`

**File:** [`../.github/workflows/push-review.yml`](../.github/workflows/push-review.yml)
**Triggers on:** a push landing on GitHub, on any branch.

Diffs exactly what that push changed, has Claude review it for code quality, likely bugs, security implications (secrets, injection, unsafe input), and test coverage, and **always** leaves a commit comment — including "no issues found" and "the review step itself failed" — never a silent pass or a silent failure. Claude's own tools are read-only git plumbing plus writing one file (`review.md`); a separate, non-Claude step does the actual posting via `gh api`, using the auto-issued `GITHUB_TOKEN` — Claude never runs `git commit`, `git push`, or `gh` itself.

Costs roughly 1–3 minutes of CI time and one Claude API call per push, billed against the `ANTHROPIC_API_KEY` repo secret (the same one `claude-code-review.yml` already uses).
