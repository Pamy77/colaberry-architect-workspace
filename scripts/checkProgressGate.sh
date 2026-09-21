#!/usr/bin/env bash
# Pre-push gate: refuses to push any commit that touches backend/, frontend/,
# scripts/, nginx/, or directives/ without also touching PROGRESS.md in that
# SAME commit (CLAUDE.md, Logging section, hard-gate rule 3).
#
# Read-only by design: only git plumbing (rev-list/diff-tree/merge-base/log).
# Never writes a file, never runs git add/commit/push, never fetches the network -
# it only compares against what git already knows locally about the remote.
#
# Invoked by .githooks/pre-push, which git feeds one line per updated ref on
# stdin: "<local ref> <local sha1> <remote ref> <remote sha1>".
set -uo pipefail

GATED_PATHS_RE='^(backend|frontend|scripts|nginx|directives)/'
ZERO_SHA='0000000000000000000000000000000000000000'
violations=0

while read -r local_ref local_sha remote_ref remote_sha; do
  [[ -z "${local_sha:-}" ]] && continue
  [[ "$local_sha" == "$ZERO_SHA" ]] && continue   # deleting a remote ref: nothing to check

  if [[ -z "${remote_sha:-}" || "$remote_sha" == "$ZERO_SHA" ]]; then
    # Brand-new branch on the remote: there is no remote tip to diff against.
    # Fall back to the merge-base with the default branch, so a fresh branch
    # is checked only on what it actually adds, not its whole ancestry.
    default_branch="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')"
    base="$(git merge-base "$local_sha" "origin/${default_branch:-master}" 2>/dev/null)"
    if [[ -z "$base" ]]; then
      echo "checkProgressGate: WARNING - '$local_ref' is a new ref with no merge-base to diff against; skipping the PROGRESS.md gate for it this once." >&2
      continue
    fi
    range="$base..$local_sha"
  else
    range="$remote_sha..$local_sha"
  fi

  for sha in $(git rev-list "$range"); do
    files="$(git diff-tree --no-commit-id --name-only -r "$sha")"
    if grep -Eq "$GATED_PATHS_RE" <<<"$files" && ! grep -qx 'PROGRESS\.md' <<<"$files"; then
      subject="$(git log -1 --format=%s "$sha")"
      touched="$(grep -E "$GATED_PATHS_RE" <<<"$files" | tr '\n' ' ')"
      echo "checkProgressGate: BLOCKED - commit $sha \"$subject\" touches [ $touched] but not PROGRESS.md (CLAUDE.md hard gate: every commit touching backend/frontend/scripts/nginx/directives must also touch PROGRESS.md)." >&2
      violations=1
    fi
  done
done

exit "$violations"
