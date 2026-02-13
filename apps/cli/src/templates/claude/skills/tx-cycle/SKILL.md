---
name: tx-cycle
description: Run a tx cycle scan — sub-agent swarm for automated codebase issue discovery. Use when the user mentions "cycle", "scan", or "find issues".
disable-model-invocation: true
---

# tx cycle — Sub-Agent Swarm Issue Discovery

Before running `tx cycle`, ask the user these questions to build the right command:

## Required

1. **Task prompt** (`--task-prompt`): What area of the codebase should agents review?
   - Examples: "Review core services", "Audit API endpoints", "Check error handling"

## Optional (with defaults)

2. **Scan prompt** (`--scan-prompt`): What should agents look for?
   - Default: "Find bugs, anti-patterns, missing error handling, security vulnerabilities, and untested code paths."

3. **Number of agents** (`--agents N`): How many parallel scan agents per round?
   - Default: 3

4. **Fix mode** (`--fix`): Should a fix agent run between scan rounds?
   - Default: off (scan-only)

5. **Dry run** (`--dry-run`): Report findings without writing to the database?

## Building the Command

Once you have the user's answers, construct and run:

```bash
tx cycle \
  --task-prompt "User's task prompt" \
  --scan-prompt "User's scan prompt" \
  --agents 3
```

Add `--fix` for auto-fixing. Add `--dry-run` for a dry run.

## How It Works

1. **Scan**: N parallel agents scan the codebase based on the prompts
2. **Dedup**: Findings are deduplicated against existing tx tasks
3. **Convergence**: When no new significant findings appear, the cycle stops
4. **Fix** (optional): A fix agent addresses issues between rounds
5. New issues are created as tx tasks in the normal `tx ready` workflow

## Important

- This is a **sub-agent swarm**, NOT a Claude Code team
- Do NOT use TeamCreate, SendMessage, or any built-in team tools
- The cycle command spawns its own agents internally
- Results feed back into the normal `tx ready` workflow
