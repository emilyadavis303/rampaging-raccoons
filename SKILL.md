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

Read `engine.md` for the orchestration pipeline. Read `persona.md` for the
raccoon-specific configuration (agent roster, dispatch strategy, prompt
template, review voice). Follow the engine steps, using the persona for agent
selection, prompt construction, and review formatting.

Supporting files read by the engine:
- `triage-prompt.md` — Haiku triage classification prompt
- `merge-prompt.md` — merge agent instructions
- `agents/*.md` — individual raccoon agent perspectives
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
