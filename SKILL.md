---
name: rampaging-raccoons
allowed-tools: Bash(gh pr diff:*), Bash(gh pr view:*), Bash(gh api:*), Bash(cat <<*), Bash(wc *), Bash(python3 *), Bash(rm /tmp/raccoons-review-response-*), Read, Write, Glob, Grep, Agent, AskUserQuestion
argument-hint: <pr-number>
description: Multi-perspective PR review — dispatches 8 raccoon agents in parallel, merges findings, posts one GitHub review. With --rummage, processes incoming reviewer feedback through Boss.
---

# Rampaging Raccoons

Print: *"🦝 Releasing the raccoons on PR #$ARGUMENTS..."*

Multi-perspective code review with three modes:

- **Peer review** (default) — dispatches 8 parallel agents, merges findings, posts one GitHub review
- **Self review** (`--mirror-check`) — same agents, interactive fix/skip/defer walkthrough
- **Rummage** (`--rummage`) — Boss channels raccoon perspectives on incoming reviewer feedback, one comment at a time

**Prerequisite:** Run this skill from inside the target repo directory (e.g., `~/code/homebot/mikasa`), not from a parent directory. The `gh` commands need git context to resolve the repo.

Read `engine.md` for the orchestration pipeline. Check the **Branches** section at the top to determine which pipeline to run based on the flags. Read `persona.md` for the raccoon-specific configuration (agent roster, dispatch strategy, prompt templates, review voice).

Supporting files read by the engine:

- `triage-prompt.md` — Haiku triage classification prompt (peer/self only)
- `merge-prompt.md` — merge agent instructions (peer/self only)
- `agents/*.md` — individual raccoon agent perspectives (1-8 for peer/self, Boss for rummage)
- `languages/*.md` — language-specific review patterns
- `my-context.md` — optional custom engineer context

## Global Rules

- **Don't duplicate.** Skip anything already covered by existing review comments.
- **Be concrete.** Reference specific files and lines. Provide actual code, not
  descriptions of code.
- **Sound like a person.** Questions and brief observations, not formal findings.
- **Diff only.** Don't flag pre-existing issues in unchanged code.
- **Respect conventions.** Don't flag something just because you'd do it
  differently — only if it breaks an established pattern.
