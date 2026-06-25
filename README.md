# Rampaging Raccoons

Multi-perspective PR review skill for [Claude Code](https://claude.com/claude-code) with three modes: **peer review** (dispatch the squad, post one unified GitHub review), **self review** (walk findings interactively, fix in place), and **rummage** (process incoming reviewer feedback through Boss, respond comment by comment).

## The raccoons

| Character | Focus |
|-----------|-------|
| 🥒 **Nit Pickles**<br>*"Not to be that raccoon, but..."* | Style, inconsistency, dead code, leftover TODOs — *and* clarity nits (self-explaining names, magic values, confusing control flow, missing *why* context) |
| 🌪️ **Chaos Carol**<br>*"Now here's where it gets fun."* | Edge cases, error handling, security, data integrity, distributed-system semantics |
| 🥃 **Cranky Hank**<br>*"Sure, fine — but at what cost?"* | Cost/benefit — over/under-engineering, pattern violations, dependency coupling, realistic-scale performance |
| 🔮 **The Oracle**<br>*"I've seen how this ends."* | Agentic-first maintainability — PR/commit context, durable repo knowledge, potentially catastrophic foot-guns |
| 🚧 **Inspector Bandit**<br>*"Something doesn't add up here."* | PR description vs diff alignment, scope, missing pieces |
| 📟 **Nosy**<br>*"Okay, it's 3am, the alert fires. What do I see?"* | Observability — the 3am test, logs, traces, error context, alerts |
| 🧪 **Squinty**<br>*"So much green, so little confidence."* | Tests-as-code — does this test prove what it claims? |
| 🦝 **Boss**<br>*"I've heard all seven of them. Here's what matters."* | Rummage mode only — channels the squad's perspectives on incoming reviewer feedback without dispatching them |

## Smart dispatch

A fast Haiku triage pass reads the diff and picks which raccoons should review it — floor of 2, ceiling of all 7. No fixed change-type table; the dispatcher matches what's actually in the diff to who will produce useful findings. A mutative auth change pulls in Carol/Oracle/Nosy; a pure rename pulls in just Carol/Bandit; a test-only PR pulls in Squinty/Oracle. Override with `--full-rampage` to deploy everyone regardless.

A blast-radius scan runs separately whenever modified signatures are detected in the diff — independent of dispatch.

## Rampage levels

Squad override (peer and self modes only). The default is for triage to pick the squad. Use `--full-rampage` to skip triage and deploy everyone. Rummage mode ignores levels entirely.

| Flag | Squad | When to use |
|------|-------|-------------|
| `--full-rampage` | All 7 | Maximum scrutiny regardless of triage |

## Rampage types

Session modifiers. Change what happens with the findings — or replace the review pipeline entirely. Types are **mutually exclusive**.

| Flag | Behavior |
|------|----------|
| `--casing-the-joint` | Dry run — findings shown in terminal, nothing posted to GitHub |
| `--mirror-check` | Self-review your own PR — walks findings interactively (fix / skip / defer each), ends with commit + post-deferred prompts. Requires PR's branch checked out locally. |
| `--rummage` | Process incoming reviewer feedback — Boss channels raccoon perspectives per comment, you decide fix / respond / explain / skip. Replies posted in your voice, not raccoon voice. Requires PR's branch checked out locally. |

Examples:

```text
/rampaging-raccoons 1234
/rampaging-raccoons 1234 --casing-the-joint
/rampaging-raccoons 1234 --full-rampage
/rampaging-raccoons 1234 --mirror-check
/rampaging-raccoons 1234 --full-rampage --mirror-check
/rampaging-raccoons 1234 --rummage
```

## Model usage

All review agents (1-8) run on **Opus** by default. Boss always runs on **Opus** regardless of override. Triage and fingerprinting use **Haiku**. To override review agents, add `agent-model: sonnet` to `my-context.md` — this forces agents 1-8 to Sonnet.

## Install

```bash
git clone https://github.com/emilyadavis303/rampaging-raccoons.git ~/.claude/skills/rampaging-raccoons
```

## Usage

From inside any repo directory:

```text
/rampaging-raccoons <pr-number>
```

For unattended mode (no preview, post directly), invoke via `/raccoons-watch` or pass `--auto`.

## Custom context

Create `~/.claude/skills/rampaging-raccoons/my-context.md` to inject your own review context (team conventions, personal focus areas, Obsidian notes, etc.). If it exists, it's automatically included in every agent's prompt.

## Adding languages

Drop a new `.md` file in `languages/` to add language-specific review patterns. The orchestrator auto-detects languages from file extensions in the diff. Built-in coverage: Ruby, Go, Python, Terraform, CI/CD configs.


## Adding raccoons

Drop a new `.md` file in `agents/` to add a perspective. Remove one to retire it. Update the dispatch table in `persona.md` if the new raccoon should join a specific squad.

## Architecture

The engine supports three branches — **peer**, **self**, and **rummage** — determined by the type flag. Peer and self share the same 6-step pipeline (gather, triage, dispatch, merge, confirm, post) and differ only in how findings are presented and applied. Rummage is a fundamentally different pipeline: Boss processes reviewer comments one at a time instead of dispatching the squad.

The skill is split into layers: `engine.md` (branch routing and orchestration pipeline), `persona.md` (raccoon roster, dispatch strategy, prompt templates, review voice), `merge-prompt.md` (merge agent instructions), and `triage-prompt.md` (Haiku classification prompt). `SKILL.md` is a thin entry point that loads them.
