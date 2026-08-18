# Skill Template — How to Build a Reusable Skill

This document is a fill-in-the-blank template for creating a "Skill" — a reusable
instruction sheet that an AI assistant can pick up automatically when it recognizes
a matching task. You do **not** need to know how to code to use this template.
Everywhere you see `[LIKE THIS]`, replace the whole bracketed phrase with your own
words and delete the brackets.

Think of a Skill like a laminated card behind a restaurant counter: it only gets
pulled out for the one specific situation it was written for, it tells the person
exactly what steps to follow, and everyone who follows it gets the same
result. Your job in filling out this template is to write that card.

A finished Skill has exactly three parts, and this template has one section for
each:

1. **Frontmatter** — a short label so the assistant can find the right card in the pile
2. **Detailed description** — the fine print on that label, so the *right* card gets picked every time
3. **Instruction body** — the actual steps written on the card

Fill them out in order. Each section below explains what it's for, why it
matters, and gives you a worked example before you write your own.

---

## Part 1: Frontmatter

**What it is:** Two short pieces of information at the very top of the file,
between a pair of `---` lines. This is the only part the assistant looks at
*before* deciding whether your Skill applies to the task in front of it — so it
has to do a lot of work in very few words.

**Why it matters:** Imagine an office with hundreds of procedure binders on a
shelf. Nobody has time to open and read every binder before starting a task —
they glance at the label on the spine and pick the one that matches. The
frontmatter is that spine label. If it's vague, the wrong binder gets pulled,
or the right one gets left on the shelf. If it's specific, the right binder
gets grabbed instantly, every time.

### 1a. Name

Fill in a short, memorable name for your Skill, using lowercase words separated
by hyphens (this style is called "kebab-case").

```
name: [your-skill-name-here]
```

**Guidance:**
- Use 2-4 words that describe the task, not the tool ("weekly-report-writer", not "helper-1")
- No spaces, no capital letters, no punctuation other than hyphens
- It should match the name of the folder this file lives in

**Example:** `name: meeting-notes-summarizer`

### 1b. Description

Fill in one to three sentences that do **three jobs at once**:

```
description: [What does this Skill do?] Use when [the specific situations that should trigger it]. Do NOT use for [situations that sound similar but should NOT trigger it].
```

**Guidance — this is the single most important field in the whole document.**
The assistant is shown *only* this sentence, alongside the one-line description
of every other Skill available, and has to decide which one (if any) fits the
current request — without reading anything else first. If your description is
generic, it will either get missed when it should apply, or get triggered by
mistake on unrelated requests.

A strong description always answers:
| Question | Why it's needed |
|---|---|
| **What does it do?** | So it's recognizable at a glance |
| **When exactly should it fire?** | The actual trigger — specific phrases or situations, not vague topics |
| **When should it NOT fire?** | Rules out lookalike requests so a similar Skill (or no Skill) gets picked instead |

**Weak example:** `Helps with meeting stuff.`
*(Too vague — "meeting stuff" could mean scheduling, note-taking, or agenda-writing. The assistant has no way to know which.)*

**Strong example:**
`Turns raw meeting notes or a transcript into a short summary with decisions and action items. Use when the user pastes meeting notes/a transcript and asks for a summary, recap, or action-item list. Do NOT use for scheduling a meeting or writing a meeting agenda before it happens.`

---

## Part 2: Detailed Description (the "when to trigger" explanation)

**What it is:** A short section, right after the frontmatter, that expands on
the one-line description above with a bit more breathing room. The frontmatter
description has to be terse; this section is where you can give one or two
extra real-world example phrases a person might actually type.

**Why it matters:** The frontmatter is the elevator pitch; this section is the
one paragraph of context that follows it. It's still meant to be short — this
is not the place for the full instructions — but it removes any remaining doubt
about when the Skill should and shouldn't be used, especially if you have
several similar Skills that could be confused with each other.

**Template:**

```markdown
## When to trigger

Trigger when [describe the situation in plain terms, and list 2-3 example
phrases a person might say, in quotes].

Do not trigger when [describe the nearby situation(s) this Skill should NOT
handle, and say which other Skill — if any — should handle it instead].
```

**Example:**

```markdown
## When to trigger

Trigger when someone shares meeting notes or a transcript and asks for a
summary — e.g. "summarize this meeting," "what were the action items from
this call," "recap this for me."

Do not trigger for scheduling a new meeting or drafting an agenda before a
meeting happens — that's a calendaring task, not a summarization task.
```

---

## Part 3: Instruction Body

**What it is:** The actual step-by-step directions — what to do once the Skill
has been correctly picked. This is the part of the "binder" that only gets
opened after someone has already decided (using Parts 1 and 2) that it's the
right one.

**Why it matters:** This is where consistency actually comes from. Without
written steps, the same request could be handled a slightly different way
every time. With clear steps, anyone (human or AI) following this document
produces the same quality of result, in the same order, every time.

**Guidance for writing good steps:**
- Number them, and give each one a short title
- Write each step as an instruction ("Do X"), not a description ("X happens")
- Keep each step to a few sentences — if a step needs a long explanation, that
  explanation belongs in a separate supporting document, with just a pointer
  left in this step
- End with what "done" looks like, so it's obvious when to stop

**Template:**

```markdown
## Instructions

### Step 1: [First thing to do]
[One or two sentences on exactly what to do.]

### Step 2: [Next thing to do]
[One or two sentences.]

### Step 3: [Next thing to do]
[One or two sentences.]

### Done when
[One sentence describing what the finished result looks like.]
```

**Example:**

```markdown
## Instructions

### Step 1: Read the full notes or transcript
Read everything provided before summarizing anything — do not summarize from
a partial read.

### Step 2: Pull out three things
Identify: (1) key decisions made, (2) action items with an owner if one was
named, (3) open questions nobody answered.

### Step 3: Write the summary
Use short bullet points under three headings: "Decisions," "Action Items,"
"Open Questions." Skip any heading that has nothing under it — don't write
"None."

### Done when
The summary fits on one screen and someone who missed the meeting could read
it in under a minute and know what to do next.
```

---

## Putting it all together — the blank template

Copy everything below this line into a new file named `SKILL.md` and fill in
every `[bracketed]` placeholder.

```markdown
---
name: [your-skill-name-here]
description: [What does this Skill do?] Use when [specific trigger situations]. Do NOT use for [similar-sounding situations that should NOT trigger it].
---

# [Your Skill Name, in Title Case]

## When to trigger

Trigger when [plain-language situation, plus 2-3 example phrases in quotes].

Do not trigger when [the nearby situation(s) this Skill should NOT cover].

## Instructions

### Step 1: [First thing to do]
[One or two sentences.]

### Step 2: [Next thing to do]
[One or two sentences.]

### Step 3: [Next thing to do]
[One or two sentences.]

### Done when
[One sentence describing the finished result.]
```

---

## Final checklist before you save it

Read through your filled-in template and check every box:

- [ ] The `name` is lowercase words separated by hyphens, and matches the folder name
- [ ] The `description` says **what** it does, **when** to use it, and **when not to**
- [ ] A stranger could read the description and know instantly if their task matches
- [ ] Each instruction step is an action ("do this"), not just a fact ("this happens")
- [ ] There's a clear sense of what "finished" looks like
- [ ] You removed every `[bracketed placeholder]` — nothing bracketed is left in the final file
- [ ] You saved the file as exactly `SKILL.md` inside a folder named the same as your `name` field

If every box is checked, your Skill is ready to use.
