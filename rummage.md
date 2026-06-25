# Rummage Branch — Process Incoming Reviewer Feedback

The rummage branch runs when `--rummage` is set. It's a fundamentally
different pipeline from peer/self review: instead of dispatching the review
squad, it fetches incoming reviewer comments, dispatches Boss to channel
the appropriate raccoon perspectives per comment, and walks the engineer
through each one (fix / respond / explain / skip).

Engine.md's Branches table points here. When `--rummage` is detected, read
this file instead of running engine.md Steps 1-6.

Print: *"🦝 Rummage mode — Boss is reading through the feedback."*

## Step 1: Gather

Run these operations in parallel:

**1. PR metadata** — same as peer/self engine.md Batch A item 1.

**2. Diff fetch** — same as peer/self Batch A item 2. Boss needs the full diff to evaluate whether reviewer comments are valid.

**3. Full comment fetch** — fetch all three comment types with full bodies (not truncated):

Inline review comments:

```bash
gh api repos/{owner}/{repo}/pulls/$ARGUMENTS/comments --paginate
```

Review-level comments (reviews with bodies):

```bash
gh api repos/{owner}/{repo}/pulls/$ARGUMENTS/reviews --paginate
```

Discussion comments (issue-level):

```bash
gh api repos/{owner}/{repo}/issues/$ARGUMENTS/comments --paginate
```

**4. Local branch pre-flight** — verify the PR's branch is checked out locally (same check engine.md describes for the self branch).

**5. Repo conventions + custom context** — same as peer/self Batch A items 5-6.

After Batch A completes:

**6. Noise reduction + language detection** — same as engine.md Batch B items 7 and 10. Boss needs clean diff and language hints for context. Skip the diff line map (item 8) and size check (item 9) — rummage doesn't post inline review comments. Skip Batch C (blast-radius) — not relevant for feedback processing.

## Step 2: Build comment inventory

Parse the fetched comments into a structured inventory. For each comment, extract:

- `id` — GitHub comment ID
- `type` — `inline_review`, `review_body`, or `discussion`
- `author` — who left it
- `body` — full comment text
- `path` — file path (inline only, null for others)
- `line` — line number (inline only, null for others)
- `state` — resolved/unresolved (where available)
- `created_at` — timestamp
- `in_reply_to` — parent comment ID if this is a thread reply

**Filter to actionable comments:**

- Exclude comments authored by the PR author (you don't need to respond to your own comments)
- Exclude bot comments (CI bots, linters, automated checks)
- Exclude comments that are already resolved
- Exclude comments where the PR author has already replied substantively (not just "done" or "fixed")
- Group thread replies with their parent — present the full thread as one unit

**Categorize remaining comments:**

- **Blocking** — `CHANGES_REQUESTED` reviews, comments containing "must", "required", "blocking", or "needs to"
- **Actionable** — suggestions, questions, code review comments with substance
- **Informational** — approvals, FYI comments, positive feedback

**Sort order:** Blocking first, then actionable, then informational. Within each category, inline comments before review-level before discussion.

Print the inventory summary:

```
🦝 Found <N> comments to rummage through.
   Blocking: <count>
   Actionable: <count>
   Informational: <count>
   (Skipped: <count> already addressed)
```

If zero actionable comments remain after filtering, print: *"🦝 Nothing to rummage through — all feedback is addressed or informational."* and exit.

## Step 3: Interactive walkthrough

For each comment in the sorted inventory, run this loop:

### Present the comment and Boss's take

**First, output the comment and Boss's perspective as text** — the engineer must be able to read everything before being asked to act. Do not call AskUserQuestion until all of the following is fully displayed.

**Step A: Show the comment:**

```
─── Comment <i> of <N> (<category>) ──────────────────
💬 <author> on <path>:<line> (or "PR-level"):

<full comment body>

<thread context if replies exist>
```

**Step B: Dispatch Boss** — launch one Agent with `model: "opus"` using the Boss Prompt Template from `persona.md`. Pass it:

- The reviewer's comment (full body + thread)
- Code context (read the file at the commented line, 10 lines above and below)
- The cleaned diff
- Language hints
- Repo CLAUDE.md
- Custom context (my-context.md)

**Step C: Show Boss's take** — parse Boss's `PERSPECTIVE:` block and print it:

```
🦝 Boss (channeling <channeled tags>):
<take>

Recommendation: <recommendation>
<reasoning>
```

**Then, after both the comment and Boss's take are visible**, use AskUserQuestion with these options:

- **Fix** — open the file at the cited line, walk through the change conversationally (same as mirror-check's fix flow: show context, propose edit, confirm, apply Edit tool). After fixing, draft a reply comment acknowledging the fix.
- **Respond** — choose a response type, then draft the reply:
  - **Discuss** — draft a clarifying question or discussion response. Optionally pull in a specific raccoon for a deeper take: show the channeled tags from Boss's response and ask which raccoon to consult. If the engineer picks one, dispatch that raccoon as a single Agent with the comment + code context, present the deeper take, then redraft the reply.
  - **Acknowledge** — the reviewer has a point but it's out of scope or a known tradeoff. Draft a response that agrees and explains.
  - **Decline** — push back respectfully. Boss's take informs the pushback. Draft a response explaining why the current approach is preferred.
- **Explain** — dig into the comment and Boss's take before deciding. Read the file at the commented line with 15-20 lines above and below, explain what the reviewer is asking and why Boss channeled the perspectives it did, surface any additional context from the diff or repo. After explaining, re-present the same options so the engineer can decide with full understanding. The engineer may also type freeform questions via "Other" to continue the conversation.
- **Skip** — move on, handle later.

The engineer can also use **Other** to type freeform questions or comments — respond conversationally, then re-present the options.

For Fix and all Respond sub-types: show the draft reply and use AskUserQuestion:

- **Post** — post the reply to GitHub immediately
- **Edit** — engineer provides changes, re-present, ask again
- **Save for later** — save the reply, post all at the end

### Track progress

For each comment, record:

- `disposition` — `fixed`, `discussed`, `acknowledged`, `declined`, `skipped`
- `reply_draft` — the composed reply text (null if skipped)
- `reply_posted` — whether the reply was posted immediately
- `file_edited` — whether a file was changed (fix only)

## Step 4: Wrap up

After all comments are walked, print the summary:

```
🦝 Rummage complete.

  Fixed: <count>
  Discussed: <count>
  Acknowledged: <count>
  Declined: <count>
  Skipped: <count>
```

**Prompt 1: Unposted replies** (only if any replies were saved for later)

> Post <N> saved replies now?

Use AskUserQuestion:

- **Post all** — post each saved reply to the appropriate GitHub comment thread
- **Review first** — show each saved reply, let the engineer edit/post/discard one at a time
- **Discard** — don't post any

**Prompt 2: Commit disposition** (only if any files were edited)

Same as mirror-check's Prompt 2:

> You fixed <N> comments. What about the changes?

- **Leave as-is** — don't touch git
- **Stage only** — `git add` the changed files
- **Commit** — stage and commit with message: `Address reviewer feedback (N fixes)`

## Reply formatting

Replies posted by rummage mode should sound like the engineer, not like a raccoon. No emoji tags, no raccoon personality in the posted reply. The raccoons advise privately — the public response is professional.

Keep replies concise:

- **Fix:** "Good catch — fixed in <sha or 'latest push'>." or "Fixed, thanks." If the fix was non-obvious, briefly explain what changed.
- **Discuss:** The clarifying question, written directly.
- **Acknowledge:** "Agreed — tracking this separately in <ticket/issue>." or "Good point, though I think it's out of scope for this PR because <reason>."
- **Decline:** "I considered this, but <reason the current approach is preferred>. Happy to discuss further."

## Findings emission

After the walkthrough, write a rummage-specific JSON to `/tmp/raccoons-rummage-<repo>-<pr>.json`:

```json
{
  "repo": "mikasa",
  "number": 12345,
  "head_sha": "abc123",
  "branch": "rummage",
  "rummaged_at": "2026-04-17T14:30:00Z",
  "comments_total": 12,
  "comments_filtered": 8,
  "comments": [
    {
      "github_comment_id": 123456,
      "type": "inline_review",
      "author": "reviewer-name",
      "path": "app/services/foo.rb",
      "line": 42,
      "body": "...",
      "category": "blocking",
      "disposition": "fixed",
      "channeled": ["🌪️ Chaos Carol", "🥃 Cranky Hank"],
      "recommendation": "fix",
      "reply_posted": true,
      "file_edited": true
    }
  ]
}
```
