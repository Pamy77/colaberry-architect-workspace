#!/usr/bin/env node
/**
 * Deterministic validator for PROGRESS.md entries (CLAUDE.md hard gate).
 * Usage:
 *   node validate-entry.js <path-to-PROGRESS.md> <SessionID>            -> validate that session's entries
 *   node validate-entry.js <path-to-PROGRESS.md> <SessionID> --audit    -> same, but prints a summary for end-of-session audit
 * Exit code 0 = all entries for that session are well-formed, no duplicates.
 * Exit code 1 = at least one problem found; details printed to stderr.
 */

const fs = require("fs");

const SESSION_ID_RE = /^CC-\d{8}-[a-zA-Z0-9]{4}$/;
const BANNED_VERIFICATION = ["done", "should work", "todo", "n/a", ""];
const REQUIRED_FIELDS = ["Date", "Session", "What changed", "Verification"];

function parseEntries(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  let current = null;

  for (const line of lines) {
    const taskMatch = line.match(/^- \[[ x]\]\s+(.*)$/);
    if (taskMatch) {
      if (current) entries.push(current);
      current = { task: taskMatch[1].trim(), fields: {}, raw: [line] };
      continue;
    }
    if (current) {
      const fieldMatch = line.match(/^\s+- ([A-Za-z ]+):\s*(.*)$/);
      if (fieldMatch) {
        current.fields[fieldMatch[1].trim()] = fieldMatch[2].trim();
        current.raw.push(line);
      }
    }
  }
  if (current) entries.push(current);
  return entries;
}

function validate(entries, sessionId) {
  const problems = [];
  const forSession = entries.filter((e) => e.fields["Session"] === sessionId);

  if (!SESSION_ID_RE.test(sessionId)) {
    problems.push(`Session ID "${sessionId}" does not match CC-YYYYMMDD-XXXX format.`);
  }

  const seenTasks = new Set();
  for (const entry of forSession) {
    for (const field of REQUIRED_FIELDS) {
      if (!entry.fields[field]) {
        problems.push(`Entry "${entry.task}" is missing required field "${field}".`);
      }
    }

    const verification = (entry.fields["Verification"] || "").toLowerCase().trim();
    if (BANNED_VERIFICATION.some((banned) => verification === banned || (banned && verification.startsWith(banned)))) {
      problems.push(`Entry "${entry.task}" has a placeholder Verification value: "${entry.fields["Verification"]}".`);
    }

    const dedupKey = `${entry.task}|${entry.fields["Date"]}`;
    if (seenTasks.has(dedupKey)) {
      problems.push(`Entry "${entry.task}" appears to be a duplicate (same task + date already logged).`);
    }
    seenTasks.add(dedupKey);
  }

  return { forSession, problems };
}

function main() {
  const [, , filePath, sessionId, mode] = process.argv;

  if (!filePath || !sessionId) {
    console.error("Usage: node validate-entry.js <path-to-PROGRESS.md> <SessionID> [--audit]");
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`PROGRESS.md not found at ${filePath}. Create it before validating.`);
    process.exit(1);
  }

  const text = fs.readFileSync(filePath, "utf8");
  const entries = parseEntries(text);
  const { forSession, problems } = validate(entries, sessionId);

  if (mode === "--audit") {
    console.log(`Session ${sessionId}: ${forSession.length} entr${forSession.length === 1 ? "y" : "ies"} found.`);
    for (const e of forSession) {
      console.log(`  - ${e.task} (${e.fields["Date"] || "no date"})`);
    }
  }

  if (problems.length > 0) {
    console.error("PROGRESS.md validation FAILED:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  console.log(`PROGRESS.md validation passed for ${sessionId} (${forSession.length} entries checked).`);
  process.exit(0);
}

main();
