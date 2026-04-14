# Engine — Multi-Agent Review Orchestration Pipeline

Generic orchestration pipeline for dispatching parallel review agents, merging
findings, and posting a single GitHub review. Persona-agnostic — all
personality, agent rosters, and dispatch tables live in `persona.md`.

## Step 1: Gather

Run gather operations in **three batches**. Batch A operations are all
independent — run them in parallel. Batch B depends on Batch A results. Batch C
depends on Batch B.

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

**6. Custom engineer context** — check if the skill's `my-context.md` has
non-comment content. If so, read and include it.

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

Run a fast Haiku classification on the cleaned diff to determine change type and
inform agent dispatch. This should take ~3-5 seconds.

### Classify

Launch an Agent with `model: "haiku"` using the prompt from the skill's
`triage-prompt.md`, passing in the PR title, description, and cleaned diff. The
agent returns a JSON object:

```json
{
  "change_type": "mechanical | additive | mutative",
  "modified_identifiers": ["ClassName#method_name"],
  "reasoning": "one sentence"
}
```

Print the result. The engine does not interpret the triage categories — it
passes the `change_type` to Step 3, where the persona's dispatch table maps it
to the appropriate squad.

## Step 3: Dispatch

Dispatch agents based on the triage result from Step 2 — **unless a rampage
level flag overrides it** (see persona's Rampage Level Overrides). Each agent
runs as a background Agent call with `run_in_background: true`.

### Dispatch logic

1. **Read the persona's Agent Roster and Dispatch Strategy** from `persona.md`.
2. **Check for rampage level flags** in the invocation context:
   - If a rampage level flag is present, **skip Step 2 (Triage)** entirely and
     use the persona's rampage level rules to determine the squad directly.
   - If multiple squad flags are present, dispatch the **union** of their squads
     (deduplicated).
   - Print the override announcement using the persona's voice.
3. **Otherwise, use the triage result** + the persona's tiered dispatch table to
   select which agents to dispatch.
4. **Construct agent prompts** using the persona's Agent Prompt Template from
   `persona.md`. Read each dispatched agent's file from the skill's `agents/`
   directory.
5. **Launch all selected agents** as background Agent calls with the model
   specified by the persona (default `model: "opus"`, overridable via
   `agent-model` in `my-context.md`). Wait for all to complete.

### Diff content rules

**Always pass the actual cleaned diff content to agents, not a summary.** Agents
reviewing summaries hallucinate details — they fill in code they haven't seen
and generate false findings. The actual diff is the source of truth.

For diffs under ~4000 lines, pass the full cleaned diff to every agent. For
larger diffs, split by file boundary and give each agent the sections relevant
to their focus area. Only summarize as a last resort for truly massive diffs
(8000+ lines), and when you do, flag in the prompt that the agent is working
from a summary and should not assume details not explicitly stated.

## Step 4: Merge

After all agents return:

1. **Collect raw outputs** — gather the full text output from every returned
   agent. Prefix each with a header identifying the agent name and tag
   (e.g., `=== Agent Name (tag) ===`).

2. **Dispatch merge agent** — read the prompt from the skill's
   `merge-prompt.md`. Launch a single Agent with `model: "opus"` using that
   prompt. Pass it three inputs:

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
   normalized issue token set used for correlating findings across re-reviews.
   This step stays in the orchestrator, not in the merge agent.

   Launch one Agent with `model: "haiku"` and pass it all finding bodies in a
   single batched prompt. Ask it to return a JSON array, one entry per finding,
   each with 4-8 kebab-case tokens describing the *kind* of issue (not the
   specific identifier names). Examples:

   - `["nil-template-identifier", "no-validation", "silent-passthrough"]`
   - `["compact-vs-compact-blank", "behavior-change", "filter-semantics"]`
   - `["test-passes-for-wrong-reason", "hardcoded-default-value"]`

   Tokens should be stable across phrasings of the same concern. Do NOT include
   agent names, file paths, or line numbers in the tokens.

   Attach the token list to each finding as `fingerprint_tokens`. Also derive
   and attach `file_basename` (just the filename, no path). Assign each finding
   a stable `id` of the form `f_001`, `f_002`, ... in sort order.

   If the Haiku call fails or returns malformed JSON, fall back to an empty
   token list — findings still post normally; only re-review correlation is
   degraded.

## Step 5: Confirm

Present the merged findings in the terminal, numbered. Use the persona's
**Review Summary Voice** from `persona.md` for formatting — opener, positives,
and finding list style are all persona-defined.

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

## Auto Mode

When auto mode is requested, run the review without human confirmation:

- Execute Steps 1-4 normally
- **Skip Step 5 entirely** — no terminal preview, no AskUserQuestion
- Execute Step 6 — post all merged findings directly to GitHub
- Emit findings JSON for the caller (see below)
- Return the review URL to the caller

Auto mode uses tiered dispatch (same as interactive). Every finding gets posted.

### How auto mode is signaled

`$ARGUMENTS` is a single opaque string — passing flags like `--auto` inside it
will pollute the `gh` commands in Step 1 (literal substitution), so it cannot
carry mode flags. Auto mode is signaled by **the invoking context only**:

- **Caller is a watcher skill.** The watcher invokes this skill with
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

When a watcher skill invokes this skill for a re-review, it pins the dispatch
tier to whatever was used on the original review (so the same agent squad runs
both times — otherwise correlation fights agent diversity). The pin is
communicated as part of the invocation context.

When you see a pinned tier in your invocation context:

- **Skip Step 2 (Triage classification)** — do not call the triage agent for
  the change-type classification
- Use the pinned tier directly to select the agent squad in Step 3
- Blast-radius runs in Step 1 Batch C as usual (based on signature detection
  in the diff, not triage classification) — no special handling needed
- Still emit `modified_identifiers` in the findings JSON so the cache stays
  warm for next time
- Print that triage was skipped due to a pinned re-review tier

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
      "tags": ["tag1", "tag2"],
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
  findings in the review body. Watcher skills use this to delete duplicate
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
