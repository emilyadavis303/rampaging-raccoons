---
allowed-tools: Bash(gh pr diff:*), Bash(gh pr view:*), Bash(gh api:*), Bash(cat <<*), Bash(wc *), Read, Glob, Grep, Agent, AskUserQuestion
argument-hint: <pr-number>
description: Multi-perspective PR review — dispatches 6 raccoon agents in parallel, merges findings, posts one GitHub review
---

# Rampaging Raccoons

Print: *"🦝 Releasing the raccoons on PR #$ARGUMENTS..."*

Multi-perspective code review that dispatches 6 parallel agents, each with a
distinct personality and focus area. Findings are merged, deduplicated, and
posted as one GitHub review with inline comments.

**Prerequisite:** Run this skill from inside the target repo directory (e.g.,
`~/code/homebot/mikasa`), not from a parent directory. The `gh` commands need
git context to resolve the repo.

## Step 1: Gather

### PR metadata

!`gh pr view $ARGUMENTS --json title,body,author,headRefName,baseRefName,additions,deletions,changedFiles,number --jq '.'`

### Diff

Save the diff to a temp file for reliable handling of large PRs:

```bash
gh pr diff $ARGUMENTS > /tmp/raccoons-diff-$ARGUMENTS.patch
```

**Noise reduction** — strip these patterns from the saved diff before passing
to agents:
- Lockfiles: `Gemfile.lock`, `go.sum`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`
- Schema dumps: `db/structure.sql`
- Vendor directories: `vendor/`
- Generated files: `.min.js`, `.min.css`, compiled assets

Read the cleaned diff from the temp file. For diffs over ~8000 lines, split by
file boundary (`diff --git` markers) and distribute relevant sections to each
agent based on their focus area rather than sending the entire diff to all 6.

### Diff line map

After reading the diff, build a **line map** — a lookup of which line numbers
in each file are actually present in the diff. This is used in Step 3 to
validate findings before posting (see "Validate line numbers" in Step 5).

The map is derived from the `@@` hunk headers. For each `+` line in the diff,
record the file path and line number. Only lines that appear in this map are
valid targets for inline review comments.

### Diff size check

Count lines of the cleaned diff. If over **1500 lines**, print:

> ⚠️ Heads up — this is a big diff (~N lines). Findings may be noisier than usual.

Then proceed normally.

### Existing review comments

Fetch existing comments to avoid duplicating feedback:

```bash
gh api repos/{owner}/{repo}/pulls/$ARGUMENTS/comments --jq '.[] | "\(.path):\(.line // .original_line) — \(.body[0:120])"'
```

```bash
gh pr view $ARGUMENTS --json reviews --jq '.reviews[] | "\(.author.login) (\(.state)): \(.body[0:200])"'
```

### Repo conventions

Read the repo's `CLAUDE.md` if it exists at the repo root.

### Custom engineer context

Check if `~/.claude/skills/rampaging-raccoons/my-context.md` has non-comment
content. If so, read and include it.

### Language detection

Examine file extensions in the diff and detect languages:

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

## Step 2: Dispatch

Launch **6 parallel agents** (all as background agents using the Agent tool),
one for each perspective. Each agent receives the same context payload
constructed by the orchestrator.

### Agent prompt template

Construct each agent's prompt as follows:

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

## Existing Review Comments

These comments have already been left on this PR. Do NOT duplicate any of them:

<summary of existing comments, or "No existing comments." if none>

## The Diff

<cleaned diff content>

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
description: <what was done well>

Rules:
- Do not pad output or add preamble
- Do not repeat the diff
- Only emit FINDING: and POSITIVE: blocks
- Do not flag pre-existing issues in unchanged code
- Do not duplicate issues already covered in existing review comments
- Be concrete: reference specific files and lines
- When suggesting a fix, write actual code, not descriptions of code
- Your tag MUST include the emoji — e.g. [👻 Ghost Agent] not [Ghost Agent]
```

### The 6 agents

| # | Agent | File | Tag |
|---|-------|------|-----|
| 1 | Nit Pickles | `agents/nit-pickles.md` | `🧹 Nit Pickles` |
| 2 | Chaos Carl | `agents/chaos-carl.md` | `💥 Chaos Carl` |
| 3 | Old Man Grizzle | `agents/old-man-grizzle.md` | `🪨 Old Man Grizzle` |
| 4 | Lil' Blinky | `agents/lil-blinky.md` | `👀 Lil' Blinky` |
| 5 | Ghost Agent | `agents/ghost-agent.md` | `👻 Ghost Agent` |
| 6 | Inspector Bandit | `agents/inspector-bandit.md` | `🚧 Inspector Bandit` |

Read each agent file from `~/.claude/skills/rampaging-raccoons/agents/` and
inject its contents into the prompt template above. Launch all 6 as background
Agent calls with `run_in_background: true`. Wait for all to complete.

## Step 3: Merge

After all agents return:

1. **Parse findings** — scan each agent's output for `FINDING:` blocks. Extract
   `file`, `line`, `tag`, `body`, `suggestion` fields from each block.

2. **Deduplicate** — if two findings reference the same file and same line
   (within ±3 lines) and describe the same underlying issue, keep the
   better-written one. Merge their tags (e.g., `💥 Chaos Carl · 👻 Ghost Agent`).
   If all 6 raccoons flag the same issue, use: `All six raccoons 🧹💥🪨👀👻🚧`

3. **Strip existing** — remove findings that substantially overlap with existing
   review comments fetched in Step 1.

4. **Sort by importance** — flat list, most important first. Correctness and
   security issues → design and architecture → clarity and maintainability → nits.

5. **Collect positives** — gather `POSITIVE:` blocks for the review summary.

## Step 4: Confirm

Present the merged findings in the terminal, numbered:

```
🦝 Rampaging Raccoons rummaged through PR #<number> and found N things
worth chattering about.

1. `path/to/file.rb:42` — Thoughts on renaming this...
   — 🧹 Nit Pickles
2. `path/to/handler.go:88` — What happens when ctx is nil here?
   — 💥 Chaos Carl
3. `path/to/service.rb:15` — This adds a service object for a single method call...
   — 🪨 Old Man Grizzle · 👻 Ghost Agent

The good stuff 🗑️✨
- Clean error handling in the new service object
- Good test coverage on edge cases
```

Use AskUserQuestion with these options:

- **Post all** — post all findings to GitHub
- **Remove some** — user provides numbers to remove (e.g., "1,3,5"), re-present
  remaining findings, then ask again
- **Bail** — nothing posted, done

## Step 5: Post

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
  on", "dug through the trash of", "raided". Keep it one sentence.
- **Positives:** These are genuine compliments, not filler. Write them with
  enthusiasm — raccoons get excited when they find good stuff in the trash.
  Skip generic praise ("good code"). Call out *specific* things done well.
- **Closer:** Optional. One short raccoon-flavored line. Examples:
  - "Now if you'll excuse us, there's a dumpster behind the CI server that
    needs investigating."
  - "The lid was on tight but we got in anyway."
  - "We'll be back. We always come back."
  - Don't reuse these — write a fresh one each time.
- **Don't overdo it.** The personality is seasoning, not the meal. The positives
  and finding count are the substance.

### Comment formatting

Each posted inline comment includes:
- A byline with the perspective tag(s) (e.g., `— 🧹 Nit Pickles` or
  `— 💥 Chaos Carl · 👻 Ghost Agent`) so the PR author knows which raccoon(s)
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

- Execute Steps 1, 2, and 3 normally
- **Skip Step 4 entirely** — no terminal preview, no AskUserQuestion
- Execute Step 5 — post all merged findings directly to GitHub
- Return the review URL to the caller

Auto mode runs all 6 raccoons with no filtering. Every finding gets posted.

## Global Rules

- **Don't duplicate.** Skip anything already covered by existing review comments.
- **Be concrete.** Reference specific files and lines. Provide actual code, not
  descriptions of code.
- **Sound like a person.** Questions and brief observations, not formal findings.
- **Diff only.** Don't flag pre-existing issues in unchanged code.
- **Respect conventions.** Don't flag something just because you'd do it
  differently — only if it breaks an established pattern.
