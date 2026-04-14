---
allowed-tools: Bash(gh pr diff:*), Bash(gh pr view:*), Bash(gh api:*), Bash(cat <<*), Bash(wc *), Bash(python3 *), Bash(rm /tmp/raccoons-review-response-*), Read, Write, Glob, Grep, Agent, AskUserQuestion
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

## Rampage Levels

Rampage levels let the user override the default triage-based dispatch with a
named squad. Flags are passed in the invocation context (not inside
`$ARGUMENTS` — same as `--auto`).

| Flag | Squad | Use case |
|------|-------|----------|
| *(no flag)* | Triage decides (default) | Let the raccoons figure it out |
| `--full-rampage` | All 8 | Maximum scrutiny regardless of triage |
| `--bomb-sniffer` | Chaos Carol, Inspector Bandit | Does it break anything? Does it match the description? |
| `--trash-compactor` | Nit Pickles, Cranky Hank, Lil' Whiskers, Squinty | Style, architecture, clarity, tests |
| `--night-shift` | Chaos Carol, The Oracle, Nosy | Will this page someone at 3am? |
| `--casing-the-joint` | *(modifier)* | Dry run — show findings in terminal, skip GitHub posting |

### Flag parsing

Check the invocation context for flags. Flags are **not** inside `$ARGUMENTS`
(which is always just the PR number). If `$ARGUMENTS` contains anything beyond
a bare integer, trim to the leading integer and warn the user.

1. If any rampage level flag is present, **skip Step 2 (Triage)** entirely —
   the flag determines the squad directly.
2. If multiple squad flags are present (e.g., `--trash-compactor --night-shift`),
   dispatch the **union** of their squads (deduplicated). In this example:
   Nit Pickles, Cranky Hank, Lil' Whiskers, Squinty, Chaos Carol, The Oracle,
   Nosy (7 raccoons).
3. `--full-rampage` with any other squad flag = all 8 (full-rampage wins).
4. `--casing-the-joint` is a **modifier**, not a squad — it combines with any
   other flag (or no flag). When present:
   - Execute Steps 1–5 normally (findings are shown in terminal)
   - **Skip Step 6** — nothing is posted to GitHub
   - Print: *"🔍 Casing the joint — findings above, nothing posted."*
   - Still emit findings JSON to `/tmp/` (with `review_id: null`,
     `review_url: null`, `posted_inline: false` for all findings)
5. `--casing-the-joint` alone (no squad flag) = triage decides the squad, but
   don't post.

When a rampage level overrides triage, print:

> 🦝 **<flag>** — deploying **N raccoons** (<names>).

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

### Batch C — blast-radius scan

Depends on the cleaned diff from Batch B. Scan the diff for modified
method/function signatures: lines starting with `-` that contain definition
patterns (`def `, `func `, `fn `, or indented `def ` in Python/Ruby). If any
are found, extract the identifier names (class + method where inferable).

For each modified identifier:

1. Grep the repo for callers/includers (exclude the changed files themselves,
   exclude `vendor/`, `node_modules/`, generated files)
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

If no modified signatures are detected, skip the blast-radius scan — no
Downstream Dependencies section is injected.

This scan runs unconditionally whenever signatures change, regardless of
triage classification or rampage level overrides.

Store the extracted identifiers as `modified_identifiers` for the findings
JSON emission in Step 6.

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

## Step 3: Dispatch

Dispatch raccoon agents based on the triage result from Step 2 — **unless a
rampage level flag overrides it** (see Rampage Levels above). Each agent runs
as a background Agent call with `run_in_background: true`.

If a rampage level flag is present, skip triage-based selection and use the
flag's squad instead. If multiple flags are combined, dispatch the union.

### Tiered dispatch (default, when no rampage level flag is set)

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

All agents dispatch with `model: "opus"` by default. To override, add
`agent-model: sonnet` to `my-context.md` — this forces all agents to Sonnet
for teams that want to reduce token spend.

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

<blast radius output from Step 1 Batch C, or omit this section if no modified signatures were detected>

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
- **Do NOT post to GitHub.** You are one of several parallel agents. Only emit
  FINDING: and POSITIVE: blocks. The orchestrator merges, deduplicates, and
  posts a single unified review. If you post directly, your findings will
  appear as a separate rogue review alongside the merged one
- **Brevity — 20 words is the target, 30 is the hard ceiling.**
  - Lead with the problem, not the observation. The reader is looking at the
    line — they have the context. Don't set the scene.
  - One concern per finding. If you're numbering, it's two findings — split them.
  - Don't compare to other code in the PR unless the comparison IS the point.
  - Never explain a suggestion. Just show the code.
  - One sentence default. A second sentence is the exception, not the norm.
  - ❌ "This test only checks `options[:transactional]` is true but never calls
    `service.call` or asserts `EmailDispatcher` got `homebot_transactional`.
    Every other delivery spec in this PR goes all the way through — this one
    stops at the doorstep."
  - ✅ "Test checks `options[:transactional]` but never calls `service.call` —
    every other delivery spec goes end-to-end."
```

Launch all selected agents as background Agent calls with `model: "opus"` (or
the `agent-model` override from `my-context.md` if set). Wait for all to
complete.

## Step 4: Merge

After all agents return:

1. **Collect raw outputs** — gather the full text output from every returned
   raccoon agent. Prefix each with a header identifying the agent name and tag
   (e.g., `=== Chaos Carol (🌪️) ===`).

2. **Dispatch merge agent** — read the prompt from
   `~/.claude/skills/rampaging-raccoons/merge-prompt.md`. Launch a single Agent
   with `model: "opus"` using that prompt. Pass it three inputs:

   - All agent outputs (concatenated, with agent name headers from item 1)
   - The cleaned diff (from Step 1)
   - Existing review comments (from Step 1)

   The merge agent returns a JSON object with `findings`, `positives`,
   `verdict`, and `blocking_summary`.

3. **Parse the returned JSON** — if the merge agent returns malformed JSON
   (fails `JSON.parse` or equivalent), retry the merge agent once with the same
   inputs. If the second attempt also fails, fall back to presenting raw agent
   outputs to the user in Step 5 (skip fingerprinting).

4. **Fingerprint** — for each finding in the merge agent's JSON, generate a
   normalized issue token set used by `/raccoons-watch` to correlate findings
   across re-reviews. This step stays in the orchestrator, not in the merge
   agent.

   Launch one Agent with `model: "haiku"` and pass it all finding bodies in a
   single batched prompt. Ask it to return a JSON array, one entry per finding,
   each with 4–8 kebab-case tokens describing the *kind* of issue (not the
   specific identifier names). Examples:

   - `["nil-template-identifier", "no-validation", "silent-passthrough"]`
   - `["compact-vs-compact-blank", "behavior-change", "filter-semantics"]`
   - `["test-passes-for-wrong-reason", "hardcoded-default-value"]`

   Tokens should be stable across phrasings of the same concern. Do NOT include
   raccoon names, file paths, or line numbers in the tokens.

   Attach the token list to each finding as `fingerprint_tokens`. Also derive
   and attach `file_basename` (just the filename, no path). Assign each finding
   a stable `id` of the form `f_001`, `f_002`, ... in sort order.

   If the Haiku call fails or returns malformed JSON, fall back to an empty
   token list — findings still post normally; only re-review correlation is
   degraded.

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

Post a single GitHub review. Capture the full response (not just the URL) so
the per-comment IDs are available for the auto-mode emission step:

```bash
cat <<'PAYLOAD' | gh api repos/{owner}/{repo}/pulls/$ARGUMENTS/reviews -X POST --input - > /tmp/raccoons-review-response-$ARGUMENTS.json
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

The response includes the review `id` and `html_url`. To get per-comment IDs
for the inline comments just posted, fetch them by review id:

```bash
gh api repos/{owner}/{repo}/pulls/$ARGUMENTS/reviews/<review_id>/comments
```

**Match by body prefix, not by line.** The `/reviews/<id>/comments` endpoint
returns `path`, `position`, and `original_position` — but **no `line` field**.
Don't rely on `(path, line)` matching: it will silently fail to match and you'll
lose every `comment_id` to null.

Match each returned comment back to its source finding by:
1. `c["path"] == finding["file"]`, AND
2. `c["body"].startswith(finding["body"][:80])` (the body verbatim is the most
   reliable signal — you posted these comments yourself a moment ago).

If multiple findings collide on the same path with the same body prefix
(shouldn't happen — dedup merges them — but defensively), track which IDs have
already been claimed and skip them on subsequent matches.

Attach the captured `comment_id` to each finding for use by auto-mode
emission. Findings that were relocated to the review body (not posted inline)
get `comment_id: null`.

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
- **One line per positive.** Each positive is a single sentence. Two sentences
  is the absolute ceiling and should be rare. No paragraphs.
- **Verdict line.** After the positives (or after the closer), add the verdict:
  - Clean: `🟢 **Nothing here should block merge.** The findings are worth
    reading but none are correctness or safety issues.`
  - Blocking: `🔴 **Worth addressing before merge:**
    <blocking_summary — one line naming the top correctness/security finding>.`

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

When auto mode is requested, run the review without human confirmation:

- Execute Steps 1–4 normally
- **Skip Step 5 entirely** — no terminal preview, no AskUserQuestion
- Execute Step 6 — post all merged findings directly to GitHub
- Emit findings JSON for the caller (see below)
- Return the review URL to the caller

Auto mode uses tiered dispatch (same as interactive). Every finding gets posted.

### How auto mode is signaled

`$ARGUMENTS` is a single opaque string — passing flags like `--auto` inside it
will pollute the `gh` commands in Step 1 (literal substitution), so it cannot
carry mode flags. Auto mode is signaled by **the invoking context only**:

- **Caller is `/raccoons-watch`.** The watcher invokes this skill with
  `args: "<pr-number>"` and includes "run in auto mode" (and optionally a
  pinned dispatch tier) in the invocation message it sends after the Skill
  call. If you see "auto mode" in the invocation context, run auto mode
  regardless of `$ARGUMENTS`.
- **User passes `--auto` themselves on the command line.** Claude Code may
  surface this as a separate hint in the invocation context (not inside
  `$ARGUMENTS`). Treat it the same way.

If `$ARGUMENTS` looks like it contains anything beyond a bare PR number
(e.g., `"6928 --auto"`), trim it to the leading integer and warn the user
that flags-in-args don't work — then proceed.

### Pinned dispatch tier

When `/raccoons-watch` invokes this skill for a re-review, it pins the dispatch
tier to whatever was used on the original review (so the same raccoon squad
runs both times — otherwise correlation fights agent diversity). The pin is
communicated as part of the invocation context: the watcher's session reads
this skill and tells itself "pinned tier = `<value>`, skip Step 2."

When you see a pinned tier in your invocation context:

- **Skip Step 2 (Triage classification)** — do not call the triage agent for
  the change-type classification
- Use the pinned tier directly to select the raccoon squad in Step 3
- Blast-radius runs in Step 1 Batch C as usual (based on signature detection
  in the diff, not triage classification) — no special handling needed.
- Still emit `modified_identifiers` in the findings JSON so the cache stays
  warm for next time.
- Print: *"🔍 Triage skipped — re-review pinned to **<tier>** by /raccoons-watch."*

### Findings emission

After the review posts, write the parsed structured findings to
`/tmp/raccoons-findings-<repo>-<pr>.json` (overwrite if present). Shape:

```json
{
  "repo": "mikasa",
  "number": 12345,
  "head_sha": "abc123",
  "dispatch_tier": "mutative | additive | mechanical",
  "rampage_level": "--full-rampage | --bomb-sniffer | --trash-compactor | --night-shift | null",
  "modified_identifiers": ["User#eligible_for_billing?", "BillingService#process"],
  "verdict": "clean",
  "blocking_summary": null,
  "review_id": 1234567890,
  "review_url": "https://github.com/...",
  "posted_at": "2026-04-13T18:39:21Z",
  "findings": [
    {
      "id": "f_001",
      "file": "app/services/foo.rb",
      "line": 42,
      "file_basename": "foo.rb",
      "fingerprint_tokens": ["nil-template-identifier", "no-validation"],
      "tags": ["🌪️ Chaos Carol", "🔮 The Oracle"],
      "body": "...",
      "suggestion": "next unless client",
      "posted_inline": true,
      "comment_id": 9876543210
    }
  ]
}
```

- `posted_inline` is `true` for findings posted as inline comments, `false`
  for findings relocated to the review body.
- `comment_id` is the GitHub inline-comment ID for `posted_inline: true`
  findings (captured via the review-comments fetch in Step 6), or `null` for
  findings in the review body. `/raccoons-watch` uses this to delete duplicate
  inline comments on re-review.
- `review_id` is the GitHub review object ID (numeric), used by callers that
  want to fetch the review's comments later.
- `modified_identifiers` is populated from the Step 1 Batch C signature scan
  when blast-radius ran, from triage when it didn't skip, or `[]` when neither
  applied. Callers may cache this for use in subsequent re-reviews.

Always emit the file even if `findings` is empty (so the caller can
distinguish "no findings" from "review failed").

The caller is responsible for reading and deleting this file. If the file
already exists from a prior run, overwrite it.

## Global Rules

- **Don't duplicate.** Skip anything already covered by existing review comments.
- **Be concrete.** Reference specific files and lines. Provide actual code, not
  descriptions of code.
- **Sound like a person.** Questions and brief observations, not formal findings.
- **Diff only.** Don't flag pre-existing issues in unchanged code.
- **Respect conventions.** Don't flag something just because you'd do it
  differently — only if it breaks an established pattern.
