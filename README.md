# Rampaging Raccoons

Multi-perspective PR review skill for [Claude Code](https://claude.com/claude-code). Triage classifies the change, dispatches a tiered squad of raccoon agents in parallel — each with a distinct personality and focus area — merges and deduplicates their findings, and posts one unified GitHub review with inline comments.

## The raccoons

| Character | Focus |
|-----------|-------|
| 🥒 **Nit Pickles**<br>*"Not to be that raccoon, but..."* | Style, inconsistency, dead code, leftover TODOs |
| 🌪️ **Chaos Carol**<br>*"Now here's where it gets fun."* | Edge cases, error handling, security, data integrity, distributed-system semantics |
| 🥃 **Cranky Hank**<br>*"Sure, fine — but at what cost?"* | Cost/benefit — over/under-engineering, pattern violations, dependency coupling, realistic-scale performance |
| 🔦 **Lil' Whiskers**<br>*"My flashlight can't find the why here."* | Clarity, self-explaining names, confusing control flow, implicit assumptions |
| 🔮 **The Oracle**<br>*"I've seen how this ends."* | Agentic-first maintainability — PR/commit context, durable repo knowledge, potentially catastrophic foot-guns |
| 🚧 **Inspector Bandit**<br>*"Something doesn't add up here."* | PR description vs diff alignment, scope, missing pieces |
| 📟 **Nosy**<br>*"Okay, it's 3am, the alert fires. What do I see?"* | Observability — the 3am test, logs, traces, error context, alerts |
| 🧪 **Squinty**<br>*"So much green, so little confidence."* | Tests-as-code — does this test prove what it claims? |

## Tiered dispatch

A fast Haiku triage pass classifies the change before the rampage begins, so the squad scales to the work:

| Change type | Raccoons dispatched |
|-------------|---------------------|
| Mutative (changes existing behavior) | All 8 — full rampage, plus a blast-radius scan for downstream callers |
| Additive (new code only) | Chaos Carol, The Oracle, Inspector Bandit, Cranky Hank, Nosy, Squinty |
| Mechanical (renames, formatting, moves) | Chaos Carol, Inspector Bandit |

## Rampage levels

Override the default triage with a named squad. Flags are combinable — the union of all selected squads is dispatched.

| Flag | Squad | When to use |
|------|-------|-------------|
| `--full-rampage` | All 8 | Maximum scrutiny regardless of triage |
| `--bomb-sniffer` | Chaos Carol, Inspector Bandit | Quick check — does it break anything? |
| `--trash-compactor` | Nit Pickles, Cranky Hank, Lil' Whiskers, Squinty | Code quality pass — style, architecture, clarity, tests |
| `--night-shift` | Chaos Carol, The Oracle, Nosy | The 3am crew — will this page someone? |
| `--casing-the-joint` | *(modifier)* | Dry run — findings shown in terminal, nothing posted to GitHub |

Combine them: `--trash-compactor --night-shift` dispatches 7 raccoons.
Add `--casing-the-joint` to any of them to preview without posting.

```text
/rampaging-raccoons 1234 --bomb-sniffer
/rampaging-raccoons 1234 --casing-the-joint
/rampaging-raccoons 1234 --trash-compactor --night-shift
```

## Cost & token guidance

All raccoon agents run on **Opus** by default. Triage and fingerprinting use Haiku. Token usage scales with squad size and diff length.

**Approximate cost per review** (varies with diff size):

| Scenario | Agents | Rough cost |
|----------|--------|------------|
| Mechanical (triage default) | 2 | ~$0.40 |
| Additive (triage default) | 6 | ~$1.20 |
| Full rampage (mutative or `--full-rampage`) | 8 | ~$2.00 |
| `--bomb-sniffer` | 2 | ~$0.40 |
| `--trash-compactor` | 4 | ~$0.80 |
| `--night-shift` | 3 | ~$0.60 |

Estimates assume a ~500-line diff. Larger diffs cost more. The Haiku triage and fingerprinting calls add ~$0.01-0.02.

**To reduce costs**, add `agent-model: sonnet` to `my-context.md` — this forces all agents to Sonnet and drops a full rampage to ~$0.25.

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

The skill is split into three layers: `engine.md` (generic orchestration pipeline — gather, dispatch, merge, post), `persona.md` (raccoon-specific roster, dispatch strategy, prompt template, review voice), and `merge-prompt.md` (dedicated merge agent instructions). `SKILL.md` is a thin entry point that loads them.
