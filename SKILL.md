---
allowed-tools: Bash(gh pr diff:*), Bash(gh pr view:*), Bash(gh api:*), Bash(cat <<*), Bash(wc *), Bash(python3 *), Read, Glob, Grep, Agent, AskUserQuestion
argument-hint: <pr-number>
description: Multi-perspective PR review — dispatches 8 raccoon agents in parallel, merges findings, posts one GitHub review
---

# Rampaging Raccoons

Print: *"🦝 Releasing the raccoons on PR #$ARGUMENTS..."*

Multi-perspective code review that dispatches 8 parallel agents, each with a
distinct personality and focus area. Findings are merged, deduplicated, and
posted as one GitHub review with inline comments.

**Prerequisite:** Run this skill from inside the target repo directory (e.g.,
`~/code/homebot/mikasa`), not from a parent directory. The `gh` commands need
git context to resolve the repo.

## Step 1: Gather

Run the gather operations in **two batches**. Batch A operations are all
independent — run them in parallel. Batch B depends on Batch A results.

### Batch A — run these in parallel

**1. PR metadata**

```bash
gh pr view $ARGUMENTS --json title,body,author,headRefName,baseRefName,additions,deletions,changedFiles,number --jq '.'
```

**2. Diff fetch**

```bash
gh pr diff $ARGUMENTS > /tmp/raccoons-diff-$ARGUMENTS.patch
```

**3. Existing inline comments**

```bash
gh api repos/{owner}/{repo}/pulls/$ARGUMENTS/comments --jq '.[] | "\(.path):\(.line // .original_line) — \(.body[0:120])"'
```

**4. Existing review-level comments**

```bash
gh pr view $ARGUMENTS --json reviews --jq '.reviews[] | "\(.author.login) (\(.state)): \(.body[0:200])"'
```

**5. Repo conventions** — read the repo's `CLAUDE.md` if it exists at the repo
root.

**6. Custom engineer context** — check if
`~/.claude/skills/rampaging-raccoons/my-context.md` has non-comment content. If
so, read and include it.

### Batch B — after Batch A completes

These depend on the diff fetched in Batch A.

**7. Noise reduction** — strip these patterns from the saved diff before passing
to agents:
- Lockfiles: `Gemfile.lock`, `go.sum`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`
- Schema dumps: `db/structure.sql`
- Vendor directories: `vendor/`
- Generated files: `.min.js`, `.min.css`, compiled assets

Read the cleaned diff from the temp file. For diffs over ~8000 lines, split by
file boundary (`diff --git` markers) and distribute relevant sections to each
agent based on their focus area rather than sending the entire diff to all.

**8. Diff line map** — build a **line map** from the cleaned diff: a lookup of
which line numbers in each file are actually present in the diff. This is used
in Step 6 to validate findings before posting.

The map is derived from the `@@` hunk headers. For each `+` line in the diff,
record the file path and line number. Only lines that appear in this map are
valid targets for inline review comments.

**9. Diff size check** — count lines of the cleaned diff. If over **1500
lines**, print:

> ⚠️ Heads up — this is a big diff (~N lines). Findings may be noisier than usual.

Then proceed normally.

**10. Language detection** — examine file extensions in the diff and detect
languages:

| Extensions | Language file |
|---|---|
| `.rb`, `.rake`, `Gemfile` | `languages/ruby.md` |
| `.go`, `go.mod`, `go.sum` | `languages/go.md` |
| `.tf`, `.tfvars`, `*.hcl` | `languages/terraform.md` |
| `.py`, `pyproject.toml`, `requirements*.txt` | `languages/python.md` |
| `.yml`/`.yaml` in `.circleci/` or `.github/workflows/`, `Dockerfile`, `docker-compose*`, `*.k8s.yml`, files in `k8s/` | `languages/cicd.md` |

Read all matching language hint files from
`~/.claude/skills/rampaging-raccoons/languages/`.

Multiple languages per PR are expected — read all that match.

## Step 2: Triage

Run a fast Haiku classification on the cleaned diff to determine change type and
inform agent dispatch. This should take ~3-5 seconds.

### Classify

Launch an Agent with `model: "haiku"` using the prompt from
`~/.claude/skills/rampaging-raccoons/triage-prompt.md`, passing in the PR
title, description, and cleaned diff. The agent returns a JSON object:

```json
{
  "change_type": "mechanical | additive | mutative",
  "modified_identifiers": ["ClassName#method_name"],
  "reasoning": "one sentence"
}
```

Print the result:

> 🔍 Triage: **<change_type>** — <reasoning>

### Blast radius scan (mutative only)

When triage returns `mutative` with `modified_identifiers`:

1. For each identifier, grep the repo for callers/includers (exclude the changed
   files themselves, exclude `vendor/`, `node_modules/`, generated files)
2. Collect file paths + line numbers + the calling line as context
3. Cap at **5 callers per identifier**. If more exist, add:
   `... and N more callers`
4. Format as a "Downstream Dependencies" section to inject into agent prompts:

```
## Downstream Dependencies

### `User#eligible_for_billing?` (modified)
- app/services/billing_service.rb:88 — BillingService#process
- app/services/sponsorship_manager.rb:23 — SponsorshipManager#discard
- app/jobs/rea_downgrade_job.rb:15 — ReaDowngradeJob#perform
... and 4 more callers
```

If triage returns `mechanical` or `additive`, skip the blast radius scan.

## Step 3: Dispatch

Dispatch raccoon agents based on the triage result from Step 2. Each agent runs
as a background Agent call with `run_in_background: true`.

### Tiered dispatch

| Change type | Raccoons dispatched | Rationale |
|------------|-------------------|-----------|
| **Mutative** | All 8 (full rampage) | Changing existing behavior — maximum scrutiny |
| **Additive** | Chaos Carol, The Oracle, Inspector Bandit, Cranky Hank, Nosy, Squinty (6) | New code needs correctness, maintainability, scope, architecture, observability, and test quality — less need for nit/clarity review |
| **Mechanical** | Chaos Carol, Inspector Bandit (2) | Sanity check: does it break anything? Does it match the description? |

Print which squad is deploying:

> 🦝 Deploying **N raccoons** (<names>) for a **<change_type>** change.

### The 8 agents

| # | Agent | File | Tag |
|---|-------|------|-----|
| 1 | Nit Pickles | `agents/nit-pickles.md` | `🥒 Nit Pickles` |
| 2 | Chaos Carol | `agents/chaos-carol.md` | `🌪️ Chaos Carol` |
| 3 | Cranky Hank | `agents/cranky-hank.md` | `🥃 Cranky Hank` |
| 4 | Lil' Whiskers | `agents/lil-whiskers.md` | `🔦 Lil' Whiskers` |
| 5 | The Oracle | `agents/the-oracle.md` | `🔮 The Oracle` |
| 6 | Inspector Bandit | `agents/inspector-bandit.md` | `🚧 Inspector Bandit` |
| 7 | Nosy | `agents/nosy.md` | `📟 Nosy` |
| 8 | Squinty | `agents/squinty.md` | `🧪 Squinty` |

### Diff content for agents

**Always pass the actual cleaned diff content to agents, not a summary.** Agents
reviewing summaries hallucinate details — they fill in code they haven't seen
and generate false findings. The actual diff is the source of truth.

For diffs under ~4000 lines, pass the full cleaned diff to every agent. For
larger diffs, split by file boundary and give each agent the sections relevant
to their focus area. Only summarize as a last resort for truly massive diffs
(8000+ lines), and when you do, flag in the prompt that the agent is working
from a summary and should not assume details not explicitly stated.

### Agent prompt template

Read each dispatched agent's file from
`~/.claude/skills/rampaging-raccoons/agents/` and construct its prompt:

```
You are a code reviewer looking at PR #<number>: "<title>" by <author>.

## Your Perspective

<contents of the agent file from ~/.claude/skills/rampaging-raccoons/agents/<name>.md>

## Language-Specific Patterns

<contents of all detected language hint files, concatenated>

## Repo Conventions

<contents of repo CLAUDE.md, or "No CLAUDE.md found." if absent>

## Custom Context

<contents of my-context.md, or omit this section if no custom context>

## Downstream Dependencies

<blast radius output from Step 2, or omit this section if not mutative>

## Existing Review Comments

These comments have already been left on this PR. Do NOT duplicate any of them:

<summary of existing comments, or "No existing comments." if none>

## The Diff

<actual cleaned diff content — not a summary>

## Output Format

For each finding, emit a structured block exactly like this:

FINDING:
file: <path relative to repo root>
line: <line number in the diff>
tag: <your EXACT perspective tag including emoji — copy it verbatim from the Tag line in your perspective section>
body: <the finding, written conversationally>
suggestion: <optional — concrete code fix or empty>

Only emit findings with real substance. If the code looks good from your
perspective, emit:

POSITIVE:
description: <what was done well, written in your voice>

Rules:
- Do not pad output or add preamble
- Do not repeat the diff
- Only emit FINDING: and POSITIVE: blocks
- Do not flag pre-existing issues in unchanged code
- Do not duplicate issues already covered in existing review comments
- Be concrete: reference specific files and lines
- When suggesting a fix, write actual code, not descriptions of code
- Your tag MUST include the emoji — e.g. [🔮 The Oracle] not [The Oracle]
- Write your POSITIVE blocks in character — your voice, not a generic compliment
- Verify before you emit: confirm the line you're citing actually says what you
  claim. If the diff was summarized, work only from what's explicitly stated —
  never fill in code details you haven't seen
- Be decisive: if you're unsure about a finding after one look, skip it. Do not
  talk yourself in circles or hedge with "wait, actually..."
- Quality over quantity: every finding should survive scrutiny. If you wouldn't
  bet on it, don't ship it
```

Launch all selected agents as background Agent calls. Wait for all to complete.

## Step 4: Merge

After all agents return:

1. **Parse findings** — scan each agent's output for `FINDING:` blocks. Extract
   `file`, `line`, `tag`, `body`, `suggestion` fields from each block.

2. **Deduplicate** — if two findings reference the same file and same line
   (within ±3 lines) and describe the same underlying issue, keep the
   better-written one. Merge their tags (e.g., `🌪️ Chaos Carol · 🔮 The Oracle`).
   If all 8 raccoons flag the same issue, use: `All eight raccoons 🥒🌪️🥃🔦🔮🚧📟🧪`

3. **Strip existing** — remove findings that substantially overlap with existing
   review comments fetched in Step 1.

4. **Verify claims** — for each remaining finding, spot-check that the claim
   matches the actual diff. Read the cited `file:line` in the diff and confirm
   the finding describes what's actually there. Drop findings where the agent
   hallucinated code that doesn't exist, described behavior opposite to what the
   code does, or referenced lines/constructs not present in the diff. This step
   is cheap and catches the most common agent failure mode.

5. **Sort by importance** — flat list, most important first. Correctness and
   security issues → design and architecture → clarity and maintainability → nits.

6. **Collect positives** — gather `POSITIVE:` blocks for the review summary.

## Step 5: Confirm

Present the merged findings in the terminal, numbered:

```
🦝 Rampaging Raccoons rummaged through PR #<number> and found N things
worth chattering about.

1. `path/to/file.rb:42` — Thoughts on renaming this...
   — 🥒 Nit Pickles
2. `path/to/handler.go:88` — What happens when ctx is nil here?
   — 🌪️ Chaos Carol
3. `path/to/service.rb:15` — This adds a service object for a single method call...
   — 🥃 Cranky Hank · 🔮 The Oracle

The good stuff 🗑️✨
- Chaos Carol threw everything at the error handling and nothing broke. She's furious.
- Lil' Whiskers understood the entire flow on the first read. That basically never happens.
```

Use AskUserQuestion with these options:

- **Post all** — post all findings to GitHub
- **Remove some** — user provides numbers to remove (e.g., "1,3,5"), re-present
  remaining findings, then ask again
- **Bail** — nothing posted, done

## Step 6: Post

### Validate line numbers

Before posting, check every finding's `file:line` against the diff line map
built in Step 1. A comment targeting a line not in the diff will cause the
GitHub API to 422 and reject the **entire** review.

For each finding:
- If the `file` + `line` exists in the diff line map → keep it as an inline
  comment
- If the `file` exists in the diff but the `line` does not → try to snap to the
  nearest valid line in that file (within ±5 lines). If no nearby line exists,
  move the finding to the review body text instead of posting inline.
- If the `file` is not in the diff at all → move to review body text

Never drop a finding — just relocate it from inline to body if the line is
invalid.

### Get the HEAD SHA

```bash
gh api repos/{owner}/{repo}/pulls/$ARGUMENTS --jq '.head.sha'
```

Post a single GitHub review:

```bash
cat <<'PAYLOAD' | gh api repos/{owner}/{repo}/pulls/$ARGUMENTS/reviews -X POST --input - --jq '.html_url'
{
  "commit_id": "<HEAD_SHA>",
  "event": "COMMENT",
  "body": "<review summary — see formatting below>",
  "comments": [
    {
      "path": "<file>",
      "line": <line>,
      "body": "<body>\n— <tag>\n\n```suggestion\n<suggestion>\n```"
    }
  ]
}
PAYLOAD
```

### Review summary formatting

The review body (the top-level comment) should have raccoon personality — not
a dry report. Format:

```
🦝 **Rampaging Raccoons** rummaged through PR #<number> and found <N> things
worth chattering about.

**The good stuff** 🗑️✨
- <positive — written with raccoon energy, not corporate bullet points>
- <positive>
- <positive>

<optional one-liner closer — a raccoon quip, not a sign-off>
```

Guidelines for the summary:
- **Opener:** Vary the verb — "rummaged through", "tore into", "got their paws
  on", "dug through the trash of", "raided", "descended upon", "went through
  every pocket of", "shook down". Keep it one sentence.
- **Positives:** Write through the lens of whichever raccoon(s) identified them.
  These are genuine compliments, not filler — but filtered through personality.
  Examples:
  - "Chaos Carol threw everything at the error handling and nothing broke. She's furious."
  - "Cranky Hank looked at this service object and just nodded slowly. That's the highest praise he gives."
  - "Lil' Whiskers understood the entire flow on the first read. That basically never happens."
  - "The Oracle checked the future timeline and this code is still standing. Grudging respect."
  - "Nit Pickles went through this twice looking for something to rearrange and came up empty."
  Skip generic praise ("good code"). Call out *specific* things done well.
- **Cross-reactions:** When multiple raccoons flag the same line, add a brief
  reaction in the summary: "Chaos Carol and The Oracle both had concerns about
  line 42 — when those two agree, pay attention."
- **Zero findings:** When raccoons return zero findings, be suspicious:
  "We couldn't find anything. We don't trust it. We'll be back."
- **Closer:** Optional. One short raccoon-flavored line. Write a fresh one each
  time — vary based on context:
  - Friday PRs: "Submitted on a Friday. Bold. We respect it."
  - Late-night PRs: "Timestamped after midnight. We see you."
  - Tiny PRs: "Small PR, clean diff. Our favorite kind of trash."
  - Huge PRs: "We're going to need a bigger dumpster."
  - General: "Now if you'll excuse us, there's a dumpster behind the CI server
    that needs investigating." / "The lid was on tight but we got in anyway." /
    "We'll be back. We always come back."
- **Don't overdo it.** The personality is seasoning, not the meal. The positives
  and finding count are the substance.

### Comment formatting

Each posted inline comment includes:
- A byline with the perspective tag(s) (e.g., `— 🥒 Nit Pickles` or
  `— 🌪️ Chaos Carol · 🔮 The Oracle`) so the PR author knows which raccoon(s)
  flagged it
- Conversational finding text
- GitHub ```suggestion block when the finding includes a concrete code fix

### Posting rules

- **One review, one API call.** All comments in a single review.
- **COMMENT event only.** Never APPROVE or REQUEST_CHANGES.
- **Use quoted heredoc** (`'PAYLOAD'`) to prevent shell interpolation.
- **Escape JSON properly** — newlines as `\n`, double-quotes as `\"`.
- If the review API returns 422, identify the invalid comment(s), remove them,
  and retry with the remaining valid ones. If posting fails entirely, print
  findings to the terminal so the work is not lost.

## Auto Mode

When invoked from `/raccoons-watch` or with `--auto`, run the review without
human confirmation:

- Execute Steps 1–4 normally
- **Skip Step 5 entirely** — no terminal preview, no AskUserQuestion
- Execute Step 6 — post all merged findings directly to GitHub
- Return the review URL to the caller

Auto mode uses tiered dispatch (same as interactive). Every finding gets posted.

## Global Rules

- **Don't duplicate.** Skip anything already covered by existing review comments.
- **Be concrete.** Reference specific files and lines. Provide actual code, not
  descriptions of code.
- **Sound like a person.** Questions and brief observations, not formal findings.
- **Diff only.** Don't flag pre-existing issues in unchanged code.
- **Respect conventions.** Don't flag something just because you'd do it
  differently — only if it breaks an established pattern.
