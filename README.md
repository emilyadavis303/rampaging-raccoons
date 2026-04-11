# Rampaging Raccoons

Multi-perspective PR review skill for [Claude Code](https://claude.com/claude-code). Dispatches 6 parallel agents — each with a distinct personality and focus area — merges and deduplicates their findings, and posts one unified GitHub review with inline comments.

## The Raccoons

| Character | Focus |
|-----------|-------|
| Nit Pickles | Style, naming, inconsistency, dead code |
| Chaos Carl | Edge cases, error handling, security, data integrity |
| Old Man Grizzle | Over/under-engineering, pattern violations, scope creep |
| Lil' Blinky | Clarity, naming, implicit assumptions, missing context |
| Ghost Agent | Maintainability, missing tests, fragile assumptions |
| Inspector Bandit | PR description vs diff alignment, scope, missing pieces |

## Install

```bash
# Clone into your Claude Code skills directory
git clone https://github.com/emilyadavis303/rampaging-raccoons.git ~/.claude/skills/rampaging-raccoons
```

## Usage

From inside any repo directory:

```
/rampaging-raccoons <pr-number>
```

## Custom Context

Create `~/.claude/skills/rampaging-raccoons/my-context.md` to inject your own review context (team conventions, personal focus areas, Obsidian notes, etc.). If it exists, it's automatically included in every agent's prompt.

## Adding Languages

Drop a new `.md` file in `languages/` to add language-specific review patterns. The orchestrator auto-detects languages from file extensions in the diff.

## Adding Raccoons

Drop a new `.md` file in `agents/` to add a perspective. Remove one to retire it.
