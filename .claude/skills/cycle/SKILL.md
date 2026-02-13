---
name: cycle
description: Run a tx cycle scan — sub-agent swarm for codebase issue discovery. Use when the user explicitly mentions "cycle". Do NOT use Claude Code teams (TeamCreate/SendMessage) for this — use tx cycle CLI instead.
disable-model-invocation: true
---

# tx cycle — Sub-Agent Swarm Issue Discovery

Before running `tx cycle`, ask the user these questions to build the right command:

## Required

1. **Task prompt** (`--task-prompt`): What area of the codebase should agents review?
   - Examples: "Review core services", "Audit API endpoints", "Check error handling in packages/core"

## Optional (with defaults)

2. **Scan prompt** (`--scan-prompt`): What should agents look for?
   - Default: "Find bugs, anti-patterns, missing error handling, security vulnerabilities, and untested code paths."
   - User might want something specific like "Find Effect-TS anti-patterns" or "Check for SQL injection"

3. **Number of agents** (`--agents N`): How many parallel scan agents per round?
   - Default: 3
   - More agents = broader coverage per round but higher API cost

4. **Number of cycles** (`--cycles N`): How many full cycles to run?
   - Default: 1
   - Each cycle runs multiple rounds until convergence

5. **Max rounds** (`--max-rounds N`): Maximum rounds per cycle before stopping?
   - Default: 10 (capped to 1 if no --fix flag)
   - Each round scans, deduplicates, and optionally fixes

6. **Fix mode** (`--fix`): Should a fix agent run between scan rounds?
   - Default: off (scan-only)
   - When enabled, issues are fixed between rounds, and scanning continues until convergence

7. **Model** (`--model`): Which LLM model for the sub-agents?
   - Default: claude-opus-4-6

8. **Score** (`--score N`): Base priority score for new tasks created?
   - Default: 500

9. **Dry run** (`--dry-run`): Report findings without writing to the database?

10. **JSON output** (`--json`): Output results as JSON instead of human-readable?

## Building the Command

Once you have the user's answers, construct and run the command:

```bash
bun apps/cli/src/cli.ts cycle \
  --task-prompt "User's task prompt" \
  --scan-prompt "User's scan prompt" \
  --agents 3 \
  --cycles 1 \
  --max-rounds 10 \
  --model claude-opus-4-6 \
  --score 500
```

Add `--fix` if the user wants auto-fixing. Add `--dry-run` for a dry run. Add `--json` for JSON output.

## How It Works

1. **Scan**: N parallel agents scan the codebase based on the prompts
2. **Dedup**: Findings are deduplicated against existing tx tasks (LLM-as-judge)
3. **Loss**: Each round computes a loss score (high x3 + medium x2 + low x1)
4. **Convergence**: When no new significant findings appear, the cycle converges
5. **Fix** (optional): A fix agent addresses issues between rounds
6. New issues are created as tx tasks with the specified priority score

## Important

- This is a **sub-agent swarm**, NOT a Claude Code team. Do NOT use TeamCreate, SendMessage, or any built-in team tools.
- The cycle command spawns its own agents internally via `AgentService`.
- Results feed back into the normal `tx ready` workflow.
