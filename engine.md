# Engine — Multi-Agent Review Orchestration Pipeline

Generic orchestration pipeline for dispatching parallel review agents, merging findings, and posting a single GitHub review. Persona-agnostic — all personality, agent rosters, and dispatch tables live in `persona.md`.

## Branches

The engine supports three branches. The branch is determined by the rampage type flag (or lack thereof). All three share the same 6-step skeleton but diverge at well-defined points.

| Branch | Flag | Input | Steps used | Output |
|--------|------|-------|------------|--------|
| **peer** | *(none)* or `--casing-the-joint` | PR diff | All 6 | GitHub review |
| **self** | `--mirror-check` | PR diff (local branch) | All 6 (Step 5 = walkthrough) | Local edits + optional commit |
| **rummage** | `--rummage` | PR reviewer comments | 1, 3, 5, 6 (skips 2 + 4) | GitHub replies + local edits |

**Peer** and **self** share the same pipeline through Step 4 — they differ only in how findings are presented (Step 5) and posted (Step 6). **Rummage** is a fundamentally different pipeline: it fetches reviewer comments instead of dispatching the review squad, uses Boss to channel perspectives per comment, and skips triage and merge entirely.

When `--rummage` is detected in the invocation context, **read `rummage.md` instead of running the peer/self pipeline.** The Rummage Branch pointer near the bottom of this file confirms that handoff.

## Step 1: Gather

Run gather operations in **three batches**. Batch A operations are all
independent — run them in parallel. Batch B depends on Batch A results. Batch C
depends on Batch B.

### Batch A — run these in parallel

**1. PR metadata**

Always fetch fresh — never reuse metadata from a prior gather or session
start. The PR body may have been updated between reviews.

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

**4b. Copilot comments — full bodies (mirror-check only)**

When `--mirror-check` is set, fetch Copilot's inline review comments in full
(the truncated item-3 fetch can't drive a fix walkthrough):

```bash
gh api repos/{owner}/{repo}/pulls/$ARGUMENTS/comments --paginate
```

Keep only comments whose author login contains `copilot` (e.g.
`copilot-pull-request-reviewer[bot]`). For each, capture `id`, `path`,
`line` (fall back to `original_line`), `body`, and any ` ```suggestion ` block.
Drop ones already resolved. Route these to the merge agent's **input 5** (Step
4) — and **exclude them from input 3** (existing review comments). If left in
input 3 they'd strip the overlapping raccoon finding instead of merging with
it, which is the opposite of the fold-in.

In peer/default and `--casing-the-joint` modes, skip this fetch — Copilot stays
in the existing-comments strip path, unchanged.

**Verify "addressed" claims:** Don't trust reply comments that say "Addressed
in \<sha\>" — the fix may be incomplete or reverted. For any comment marked as
addressed, fetch the actual file from the PR branch to confirm:

```bash
gh api "repos/{owner}/{repo}/contents/<path>?ref=<branch>" --jq '.content' | base64 -d
```

Only skip a comment if the fix is verified in the current code. A missing reply
does NOT mean the comment is unaddressed — the author may have pushed a fix
without commenting.

**5. Repo conventions** — read the repo's `CLAUDE.md` if it exists at the repo
root.

**6. Custom engineer context** — check if the skill's `my-context.md` has
non-comment content. If so, read and include it.

### Local branch pre-flight (self and rummage branches)

When `--mirror-check` or `--rummage` is set, verify the PR's branch is currently checked out locally. Both modes make edits to the working tree, so they only work on your own PR's branch.

```bash
git branch --show-current
```

Compare the output against `headRefName` from the PR metadata fetched in Batch A.

- **If they match:** continue normally.
- **If they don't match:** error and exit:

  > ❌ This mode needs PR #<number>'s branch (`<headRefName>`) checked out locally. You're on `<current_branch>`. Check out the PR's branch first, or use `--casing-the-joint` for read-only scouting.

  Do not proceed. Return immediately.

If neither `--mirror-check` nor `--rummage` is set, skip this check entirely.

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
lines**, print a warning that this is a big diff and findings may be noisier
than usual. Then proceed normally.

**10. Language detection** — examine file extensions in the diff and detect
languages:

| Extensions | Language file |
|---|---|
| `.rb`, `.rake`, `Gemfile` | `languages/ruby.md` |
| `.go`, `go.mod`, `go.sum` | `languages/go.md` |
| `.tf`, `.tfvars`, `*.hcl` | `languages/terraform.md` |
| `.py`, `pyproject.toml`, `requirements*.txt` | `languages/python.md` |
| `.yml`/`.yaml` in `.circleci/` or `.github/workflows/`, `Dockerfile`, `docker-compose*`, `*.k8s.yml`, files in `k8s/` | `languages/cicd.md` |

Read all matching language hint files from the skill's `languages/` directory.

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

### Infra-dominant pre-check

Before running triage classification, check whether the diff is infra-dominant:
count the changed lines (`+` and `-`) in `.tf`, `.tfvars`, and `.hcl` files vs.
total changed lines. If infra files represent **≥80% of changed lines**:

- **Skip triage classification entirely**
- Set squad to: **The Oracle, Chaos Carol, Inspector Bandit**
- Print:
  > 🏗️ Infra-dominant diff — deploying The Oracle, Chaos Carol, and Inspector
  > Bandit. Triage skipped.
- Proceed directly to Step 3 Dispatch with this squad

This squad is picked because: The Oracle catches destructive/blast-radius
issues (its entire "catastrophic blast radius" section applies directly to
Terraform), Chaos Carol hunts for failure modes and invalid assumptions, and
Inspector Bandit checks that the change matches the description. The Rails-
focused raccoons (Nit Pickles, Cranky Hank, Squinty, Nosy)
add noise without signal on infra PRs.

If infra files represent <80% of changed lines (mixed PR), run triage normally.

### Classify

Launch an Agent with `model: "haiku"` using the prompt from the skill's
`triage-prompt.md`, passing in the PR title, description, and cleaned diff. The
triage prompt contains the roster + each raccoon's focus, so the Haiku agent
picks the squad directly. The agent returns a JSON object:

```json
{
  "squad": ["chaos-carol", "the-oracle", "inspector-bandit"],
  "modified_identifiers": ["ClassName#method_name"],
  "reasoning": "one sentence"
}
```

Validate the returned slugs against the roster in `persona.md`. If any slug is
unknown, drop it and continue with the rest. If `squad` is empty after
validation, fall back to dispatching all 7 reviewers (better noisy than blind).

Print the result:

> 🦝 Deploying **N raccoons** (<names>). <reasoning>

## Step 3: Dispatch

Dispatch agents based on the triage result from Step 2 — unless `--full-rampage`
is set. Each agent runs as a background Agent call with `run_in_background: true`.

Read the Agent Roster and Dispatch Strategy from `persona.md`.

### Dispatch logic

1. **Read the persona's roster and dispatch strategy** from `persona.md`.
2. **If `--full-rampage` is in the invocation context**, **skip Step 2
   (Triage)** entirely and dispatch all 7 reviewers. Print:
   > 🦝 **Full rampage** — deploying all 7 raccoons.
3. **Otherwise, use the `squad` list from triage** to select which agents to
   dispatch.
4. **Construct each agent's prompt** using the persona's Agent Prompt Template
   from `persona.md`. Read each dispatched agent's file from the skill's
   `agents/` directory.
5. **Launch all selected agents** as background Agent calls with the model
   specified by the persona (default `model: "sonnet"`, overridable to
   `opus` via `agent-model: opus` in `my-context.md`). Wait for all to
   complete.

### Diff content rules

**Always pass the actual cleaned diff content to agents, not a summary.** Agents
reviewing summaries hallucinate details — they fill in code they haven't seen
and generate false findings. The actual diff is the source of truth.

For diffs under ~4000 lines, pass the full cleaned diff to every agent. For
larger diffs, split by file boundary and give each agent the sections relevant
to their focus area. Only summarize as a last resort for truly massive diffs
(8000+ lines), and when you do, flag in the prompt that the agent is working
from a summary and should not assume details not explicitly stated.

## Step 3.5: Confidence Filter

Run a lightweight Haiku confidence check on **all findings** before merge. This
catches hallucinations and false positives across all languages — agents
occasionally describe code that isn't there, cite the wrong line, or flag
patterns that are valid in context. The filter is cheap (one batched Haiku call)
and runs every time, not just on infra PRs.

Collect all raw `FINDING:` blocks from every agent output. For each finding,
extract: `tag`, `file`, `line`, `body`.

Launch one Agent with `model: "haiku"`. Pass it:

- All findings (as a numbered list: `1. [tag] file:line — body`)
- The relevant diff hunks for each finding's cited file (not the full diff —
  just the `@@` hunk(s) that include the cited line, ±10 lines)
- The language hints loaded in Step 1 (including false-positive patterns)

Prompt the Haiku agent:

> For each finding, check whether the claim accurately describes what is in
> the diff hunk. Apply the false-positive patterns from the language hints.
> Score each finding on a 0-100 confidence scale and return a JSON array — one
> entry per finding, in the same order:
>
> ```json
> [{ "n": 1, "confidence": 85, "reason": "one short phrase" }]
> ```
>
> Scoring rubric (use this verbatim):
>
> - **0** — Not confident at all. This is a false positive that doesn't stand
>   up to light scrutiny, or it describes a pre-existing issue not in the diff.
> - **25** — Somewhat confident. This might be a real issue, but might also be
>   a false positive. You couldn't verify it's real. If stylistic, not called
>   out in language hints or repo conventions.
> - **50** — Moderately confident. You verified this is a real issue, but it
>   might be a nitpick or rare in practice. Relative to the rest of the PR,
>   not very important.
> - **75** — Highly confident. You double-checked the issue and verified it
>   will likely be hit in practice. The current approach is insufficient. The
>   issue is important and will directly impact functionality, or it matches a
>   language-hint or CLAUDE.md rule directly.
> - **100** — Absolutely certain. Double-checked, confirmed real, will happen
>   frequently. Evidence directly confirms.
>
> Pick the integer (0/25/50/75/100) closest to your honest assessment.
>
> Return only the JSON array. No preamble.

After the Haiku agent returns:

- **Drop findings scored `<80` entirely.** Below 80 means the model itself
  wasn't highly confident this is real. False positives add noise without
  signal. Remove these before Step 4 — do not pass them to the merge agent.
- Attach `confidence: <score>` to each surviving finding's raw block.
- Print a one-line summary:
  > 🔍 Confidence filter: N kept (≥80), N dropped (<80)

If the Haiku call fails or returns malformed JSON, skip silently and proceed
to Step 4 with no confidence annotations — the merge agent's own verify step
still runs.

## Step 4: Merge

After all agents return:

1. **Collect raw outputs** — gather the full text output from every returned
   agent. Prefix each with a header identifying the agent name and tag
   (e.g., `=== Agent Name (tag) ===`). Include any confidence annotations
   attached in Step 3.5.

2. **Dispatch merge agent** — read the prompt from the skill's
   `merge-prompt.md`. Launch a single Agent with `model: "opus"` using that
   prompt. Pass it these inputs:

   - All agent outputs (concatenated, with agent name headers from item 1,
     including confidence annotations from Step 3.5 where present)
   - The cleaned diff (from Step 1)
   - Existing review comments (from Step 1) — **in `--mirror-check`, with
     Copilot comments removed** (they go to input 5 instead, per Batch A 4b)
   - Language hints (all language hint files loaded in Step 1, concatenated)
   - **(mirror-check only) Copilot comments to fold in** (input 5) — the full
     Copilot comments from Batch A 4b. Omit this input in all other modes.

   The merge agent returns a JSON object with `findings`, `positives`,
   `verdict`, and `blocking_summary`. Findings folded from or matched to a
   Copilot comment carry a `🤖 Copilot` tag and a non-empty `source_comment_ids`.

3. **Parse the returned JSON** — if the merge agent returns malformed JSON
   (fails `JSON.parse` or equivalent), retry the merge agent once with the same
   inputs. If the second attempt also fails, fall back to presenting raw agent
   outputs to the user in Step 5.

Re-review dedup happens via the existing-comment fetch in Step 1 Batch A
(injected into each agent's prompt as "Do NOT duplicate any of these"). No
fingerprinting needed — the agents see the prior comments by body and skip
them.

## Step 5: Confirm

Step 5 branches based on the rampage type set in the invocation context.

### Default mode (no type flag, or `--casing-the-joint`)

Present the merged findings in the terminal, numbered. Use the persona's
Review Summary Voice from `persona.md` for formatting.

> Example terminal output uses the Rampaging Raccoons persona for
> illustration. Actual voice and personality come from `persona.md`.

```
🦝 Rampaging Raccoons rummaged through PR #<number> and found N things
worth chattering about.

1. `path/to/file.rb:42` — Thoughts on renaming this...
   — 🥒 Nit Pickles
2. `path/to/handler.go:88` — What happens when ctx is nil here?
   — 🌪️ Chaos Carol

The good stuff 🗑️✨
- <positive 1>
- <positive 2>
```

Low-confidence findings have already been dropped by the Step 3.5 filter
(scored `<80`). The findings you see survived both the confidence filter
and the merge agent's verify pass.

Use AskUserQuestion with these options:

- **Post all** — post all findings to GitHub (skip if `--casing-the-joint`)
- **Remove some** — user provides numbers to remove (e.g., "1,3,5"),
  re-present remaining findings, then ask again
- **Bail** — nothing posted, done

If `--casing-the-joint` is set, omit the "Post all" option (replace with
"Done" — show findings, exit). Print:

> 🔍 Casing the joint — findings above, nothing posted.

Then emit findings JSON to `/tmp/raccoons-findings-<repo>-<pr>.json` per
the Auto Mode Findings emission schema, with `review_id: null`,
`review_url: null`, and `posted_inline: false` for all findings.

### Mirror check mode (`--mirror-check`)

Replace the standard preview with the self-review walkthrough.

#### Phase 1: Show everything

Print the full findings list — all findings visible at once, in importance
order. Use the same format as default mode peer review:

```
🪞 Mirror check — PR #<number> (<headRefName>)

The raccoons found N things. By tier:
- Correctness: <count>
- Design: <count>
- Clarity: <count>
- Nits: <count>
(<count> folded in from Copilot)   ← omit this line if no Copilot comments

The good stuff 🗑️✨
- <2-3 positives>

<verdict line>

─── 1 ──────────────────────────────────────────────────
📍 <file>:<line>  <tags joined with " · ">

<finding body>

Suggested fix:
<suggestion code, indented two spaces; omit if no suggestion>

─── 2 ──────────────────────────────────────────────────
📍 <file>:<line>  <tags joined with " · ">

<finding body>
...
```

Print ALL findings before asking anything. The engineer reads the full list
first.

#### Phase 2: Pick what to act on

After printing all findings, use AskUserQuestion:

> Want to act on any of these?

- **All** — walk through every finding
- **Pick individually** — quick triage pass: show each finding as a one-liner
  (`N. file:line — <body truncated to 10 words>`) and ask `Include / Skip`
  for each. After the pass, confirm which are selected, then start the
  walkthrough.
- **None** — skip walkthrough, jump straight to Phase 4 end prompts

#### Phase 3: Walk through selected findings

For each selected finding:

**Print the finding again** (same format as Phase 1) so the engineer doesn't
have to scroll. Then use AskUserQuestion with these options:

- **Fix** — open the file at the cited line, present the relevant code in the
  terminal, and walk through the change conversationally:
  - Show the cited code with 5 lines of context above and below
  - Restate the suggestion (or describe the change if no suggestion)
  - Ask the engineer to confirm, propose an alternative, or skip
  - Apply the agreed-upon edit using the Edit tool
  - Confirm the edit and move to the next finding
- **Explain** — read the file at the cited line with 15-20 lines above and
  below, explain what the raccoon(s) flagged and why it matters, surface any
  additional context from the diff or repo. After explaining, re-present the
  same options so the engineer can decide. The engineer may also type freeform
  questions via "Other" — keep discussing until they pick an action.
- **Skip** — record `mirror_disposition: "skipped"` for this finding, move on
- **Defer** — record `mirror_disposition: "deferred"` for this finding, move on

The engineer can also use **Other** to type freeform questions — respond
conversationally, then re-present the options.

**Copilot-backed findings** (`source_comment_ids` non-empty) are backed by a
real comment thread on the PR, so the actions behave a little differently:

- **Fix** — after applying the edit, offer to reply `"Fixed."` and resolve each
  thread in `source_comment_ids` (same reply/resolve mechanic as rummage). For a
  merged finding (raccoon + Copilot), the raccoon's fix resolves the Copilot
  thread too.
- **Defer** — do **not** post a new inline comment in Phase 4; the comment
  already lives on the PR. Leave the thread as-is.
- **Skip** — leave the thread untouched.

Track session state (fixed, skipped, deferred counts and which findings are in
each bucket).

#### Phase 4: End-of-walkthrough prompts

After walking all findings, print the summary:

```
🪞 Mirror check complete.

  Fixed: <count>
  Skipped: <count>
  Deferred: <count>

Deferred findings:
  <i>. <file>:<line> — <body>
     — <tags>
  <i>. <file>:<line> — <body>
     — <tags>
```

Omit the "Deferred findings:" list if deferred count is 0.

**Prompt 1: Defer disposition** (only if deferred > 0)

Use AskUserQuestion:

> Post deferred findings to PR as inline comments?

- **Skip** — keep them session-only (default — listed first)
- **Post** — all deferred findings get posted (so they live with the PR for later)

If "Post": run Step 6's posting logic on the deferred findings only, with the
review body summarizing only the deferred items (e.g., "🪞 Mirror check found
N things worth deferring."). Other findings (fixed, skipped) are not posted.
**Exclude Copilot-backed deferred findings** (`source_comment_ids` non-empty)
from the post set — their comment already exists on the PR; re-posting would
duplicate it. Leave those threads as-is.

If "Skip": don't post anything. Continue to Prompt 2.

**Prompt 2: Commit disposition** (only if fixed > 0)

Use AskUserQuestion:

> You fixed N findings. What about the changes?

- **Leave as-is** — don't touch git (default — listed first)
- **Stage only** — `git add` the changed files, don't commit
- **Commit** — stage and commit with message: `Address mirror-check findings (N fixes)`

If "Stage only" or "Commit", run the corresponding git commands. Print
confirmation.

If fixed = 0, skip Prompt 2 entirely.

#### Phase 5: Emit findings JSON

Always emit the findings JSON (per the existing Auto Mode emission rules)
with the mirror-check fields populated. See Auto Mode section for schema
additions.

## Step 6: Post

### Validate line numbers

Before posting, check every finding's `file:line` against the diff line map
built in Step 1. A comment targeting a line not in the diff will cause the
GitHub API to 422 and reject the **entire** review.

For each finding:
- If the `file` + `line` exists in the diff line map -> keep it as an inline
  comment
- If the `file` exists in the diff but the `line` does not -> try to snap to the
  nearest valid line in that file (within +/-5 lines). If no nearby line exists,
  move the finding to the review body text instead of posting inline.
- If the `file` is not in the diff at all -> move to review body text

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
  "body": "<review summary — formatted using persona's Review Summary Voice>",
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

### Comment formatting

Format inline comments using the persona's **Comment Formatting** rules from
`persona.md`. This includes byline format, suggestion block format, and tag
style.

### Review summary formatting

Format the review body using the persona's **Review Summary Voice** from
`persona.md`. This includes the opener, positives style, cross-reactions, zero
findings behavior, closer, tone rules, and verdict lines.

### Posting rules

- **One review, one API call.** All comments in a single review.
- **COMMENT event only.** Never APPROVE or REQUEST_CHANGES.
- **Use quoted heredoc** (`'PAYLOAD'`) to prevent shell interpolation.
- **Escape JSON properly** — newlines as `\n`, double-quotes as `\"`.
- If the review API returns 422, identify the invalid comment(s), remove them,
  and retry with the remaining valid ones. If posting fails entirely, print
  findings to the terminal so the work is not lost.

## Rummage Branch

When `--rummage` is detected, **do not run Steps 1-6 above.** Read `rummage.md` instead — it has the full rummage pipeline (gather, comment inventory, interactive walkthrough, wrap-up, reply formatting, findings emission).

Rummage is fundamentally different from peer/self: it fetches reviewer comments instead of dispatching the squad, uses Boss to channel perspectives per comment, and skips triage, the confidence filter, and merge entirely.

## Auto Mode

When auto mode is requested, run the review without human confirmation:

- Execute Steps 1-4 normally
- **Skip Step 5 entirely** — no terminal preview, no AskUserQuestion
- Execute Step 6 — post all merged findings directly to GitHub
- Emit findings JSON for the caller (see below)
- Return the review URL to the caller

Auto mode uses smart dispatch (same as interactive). Every finding gets posted.

### How auto mode is signaled

`$ARGUMENTS` is a single opaque string — passing flags like `--auto` inside it
will pollute the `gh` commands in Step 1 (literal substitution), so it cannot
carry mode flags. Auto mode is signaled by **the invoking context only**:

- **Caller is a watcher skill.** The watcher invokes this skill with
  `args: "<pr-number>"` and includes "run in auto mode" (and optionally a
  pinned squad) in the invocation message it sends after the Skill call. If
  you see "auto mode" in the invocation context, run auto mode regardless of
  `$ARGUMENTS`.
- **User passes `--auto` themselves on the command line.** Claude Code may
  surface this as a separate hint in the invocation context (not inside
  `$ARGUMENTS`). Treat it the same way.

If `$ARGUMENTS` looks like it contains anything beyond a bare PR number
(e.g., `"6928 --auto"`), trim it to the leading integer and warn the user
that flags-in-args don't work — then proceed.

### Pinned squad

When a watcher skill invokes this skill for a re-review, it pins the squad
to whatever ran on the original review (so the same agents run both times —
otherwise correlation fights agent diversity). The pin is a list of raccoon
slugs communicated as part of the invocation context.

When you see a pinned squad in your invocation context:

- **Skip Step 2 (Triage classification)** — do not call the triage agent
- Use the pinned squad list directly in Step 3
- Blast-radius runs in Step 1 Batch C as usual (based on signature detection
  in the diff) — no special handling needed
- Still emit `modified_identifiers` in the findings JSON so the cache stays
  warm for next time
- Print that triage was skipped due to a pinned re-review squad

### Findings emission

After the review posts, write the parsed structured findings to
`/tmp/raccoons-findings-<repo>-<pr>.json` (overwrite if present). Shape:

```json
{
  "repo": "mikasa",
  "number": 12345,
  "head_sha": "abc123",
  "squad": ["chaos-carol", "the-oracle", "inspector-bandit"],
  "rampage_level": "<flag from persona's rampage levels, or null>",
  "mirror_check": {
    "fixed_count": 3,
    "skipped_count": 2,
    "deferred_count": 2,
    "deferred_posted": true,
    "fixes_committed": "committed | staged | none"
  },
  "modified_identifiers": ["User#eligible_for_billing?", "BillingService#process"],
  "verdict": "clean",
  "blocking_summary": null,
  "review_id": 1234567890,
  "review_url": "https://github.com/...",
  "posted_at": "2026-04-15T18:39:21Z",
  "findings": [
    {
      "file": "app/services/foo.rb",
      "line": 42,
      "tags": ["tag1", "tag2"],
      "body": "...",
      "suggestion": "next unless client",
      "mirror_disposition": "fixed",
      "posted_inline": false,
      "comment_id": null,
      "source_comment_ids": []
    }
  ]
}
```

- `posted_inline` is `true` for findings posted as inline comments, `false`
  for findings relocated to the review body.
- `comment_id` is the GitHub inline-comment ID for `posted_inline: true`
  findings (captured via the review-comments fetch in Step 6), or `null` for
  findings in the review body. Watcher skills use this to delete duplicate
  inline comments on re-review.
- `review_id` is the GitHub review object ID (numeric), used by callers that
  want to fetch the review's comments later.
- `squad` is the list of raccoon slugs that actually ran for this review
  (from triage's output, from `--full-rampage`, or from a pinned squad on
  re-review). Callers cache this to pin the same squad on subsequent
  re-reviews.
- `modified_identifiers` is populated from the Step 1 Batch C signature scan
  when blast-radius ran, from triage when it didn't skip, or `[]` when neither
  applied. Callers may cache this for use in subsequent re-reviews.
- `mirror_check` is `null` for non-mirror-check sessions. When present, it
  summarizes the walkthrough outcomes. `deferred_posted` is true if Prompt 1
  was answered "Post". `fixes_committed` reflects Prompt 2's answer
  (`"committed"`, `"staged"`, or `"none"`); `"none"` if fixed_count was 0.
- `source_comment_ids` is the list of GitHub Copilot comment IDs folded into a
  finding (mirror-check only), or `[]` for pure raccoon findings. On a fixed
  Copilot-backed finding, the thread reply/resolve happened in Phase 3.
- `mirror_disposition` is `null` for non-mirror-check sessions or for
  findings not yet processed. In a mirror-check session, every finding gets
  exactly one of `"fixed"`, `"skipped"`, or `"deferred"`. For deferred
  findings that were posted (Prompt 1 = "Post"), `posted_inline` and
  `comment_id` are populated normally. For fixed and skipped findings,
  `posted_inline: false, comment_id: null`.

Always emit the file even if `findings` is empty (so the caller can
distinguish "no findings" from "review failed").

The caller is responsible for reading and deleting this file. If the file
already exists from a prior run, overwrite it.
