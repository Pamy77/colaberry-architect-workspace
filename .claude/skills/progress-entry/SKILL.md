---
name: progress-entry
description: Drafts and validates a PROGRESS.md entry per the CLAUDE.md hard-gate format (session ID, date, what-changed, verification evidence). Use after completing any code change to backend/, frontend/, scripts/, nginx/, or directives/, or when the user asks to "log this," "update PROGRESS.md," or "close out the session." Do NOT use for Basecamp tickets, Mandrill sends, or other items CLAUDE.md explicitly excludes from PROGRESS.md.
allowed-tools: Read, Edit, Write, Bash
---

# Progress Entry

## When to trigger

Trigger right before marking any code change "done," per the CLAUDE.md PROGRESS.md hard gate — not just when the user explicitly asks for it. Also trigger for explicit requests: "log this," "add a PROGRESS.md entry," "end-of-session audit."

Do **not** trigger for items CLAUDE.md excludes from PROGRESS.md: Mandrill sends, Basecamp ticket creation, ad-hoc data pulls, memory additions, dry-run output that didn't ship.

## Why tool access is restricted

This skill only needs to read the current file, append/edit it, create it if missing, and run the bundled validator. It has no need for web access, subagent delegation, or notebook editing — `allowed-tools` above is scoped to exactly `Read, Edit, Write, Bash` so the skill can't be used as a backdoor into unrelated capabilities.

## Instructions

### Step 1: Re-read the tail of PROGRESS.md first
Concurrent instances may have appended since you last read it (see CLAUDE.md "Concurrent-instance safety"). Always re-read the last ~30 lines with `Read` immediately before drafting, and never anchor an edit on stale content. If the file doesn't exist, create it with `Write` before continuing.

### Step 2: Draft the entry
Use the required format from `references/entry-format.md`:
```markdown
- [x] <task name>
  - Date: YYYY-MM-DD
  - Session: CC-<YYYYMMDD>-<4 random alphanumerics>
  - What changed: <one line>
  - Verification: <test name | deploy URL | "user confirmed" | "TypeScript passes">
  - Notes: <only if blocker, deviation, or non-obvious decision>
```
"Verification" must be a concrete artifact, never a restatement of intent (see the good/bad examples in the reference file).

### Step 3: Validate before appending
Run the bundled validator against the draft:
```
node .claude/skills/progress-entry/scripts/validate-entry.js "<path-to-PROGRESS.md>" "<SessionID>"
```
It checks: session ID format, presence of all required fields, that Verification isn't a banned placeholder (e.g. "done", "TODO", "should work"), and that the entry isn't a duplicate of one already in the file. Fix any reported issue and re-run until it exits 0 — do not append a draft that fails validation.

### Step 4: Append, never rewrite
Use `Edit` to append after the current last line. Only ever touch entries carrying your own Session ID — never edit, reformat, or "clean up" another instance's entries, even if they look wrong.

### Step 5: End-of-session audit
When asked to close out a session, re-run the validator in audit mode (no entry argument — just the session ID) to list every entry tagged with that Session ID and confirm none are missing required fields.
