#!/bin/bash
# Runs backend + frontend typecheck/tests deterministically, then uses a
# headless Claude Code call (no TTY, no tool access) purely to triage the
# combined output into a short pass/fail summary. Claude never executes the
# checks themselves - only npm/tsc/jest/vitest do that.
set -uo pipefail

LOGFILE="$(mktemp)"
trap 'rm -f "$LOGFILE"' EXIT

OVERALL_STATUS=0

run_step() {
  local dir="$1" cmd="$2" label="$3"
  echo "=== $label ===" | tee -a "$LOGFILE"
  if (cd "$dir" && eval "$cmd") >>"$LOGFILE" 2>&1; then
    echo "PASS: $label"
  else
    echo "FAIL: $label"
    OVERALL_STATUS=1
  fi
}

run_step backend  "npm run typecheck" "backend typecheck"
run_step backend  "npm test -- --ci"  "backend tests"
run_step frontend "npm run typecheck" "frontend typecheck"
run_step frontend "npm test"          "frontend tests"

echo
echo "Deterministic checks complete. Requesting headless triage summary..."

SUMMARY=$(timeout 120 claude -p \
  --permission-prompts none \
  --max-turns 1 \
  --max-budget-usd 0.50 \
  --output-format text \
  "You are triaging CI verification output for the KPI Copilot repo (backend typecheck, backend tests, frontend typecheck, frontend tests). Read the log below and respond in under 150 words with exactly: 1) overall PASS or FAIL, 2) which step(s) failed if any, 3) the most likely root-cause line quoted from the log, 4) one concrete next action. Do not attempt to fix anything - report only.

$(cat "$LOGFILE")") || {
  echo "Headless triage call failed or timed out; falling back to raw log." >&2
  SUMMARY="(triage unavailable - see raw log below)"
}

echo
echo "=== Headless triage summary ==="
echo "$SUMMARY"

exit "$OVERALL_STATUS"
