# Cycle-Based Issue Discovery

**Kind**: prd
**Status**: changing

## Problem

No systematic, repeatable mechanism to validate codebase quality after heavy
development. Issues accumulate silently. Teams can't measure whether codebase
health is improving or degrading. Need a convergence loop: scan -> fix ->
rescan -> fewer issues -> repeat until clean.

After agents do heavy work on an area, there's no quality gate. Issues found
manually are ad-hoc and not tracked systematically. There's no way to measure
if the new issue rate is decreasing over time.

## Solution

A cycle-based issue discovery system that:

1. Runs sub-agent swarms via Claude Agent SDK (@anthropic-ai/claude-agent-sdk)
   with two tunable prompts: a task prompt (what area) and a scan prompt (what to find)
2. Each cycle contains multiple rounds of scan -> dedup -> fix until convergence
3. Deduplication is performed by an Agent SDK agent (LLM-as-judge), comparing
   new findings against an in-memory map of known issues
4. Tracks a synthetic loss function (3*HIGH + 2*MEDIUM + 1*LOW) that decreases
   over time as issues are fixed and fewer new ones are found
5. Emits metrics to the events table for dashboard visualization
6. Dashboard Cycles tab shows the loss curve converging toward zero

## Requirements

- TypeScript script at scripts/cycle-scan.ts using @anthropic-ai/claude-agent-sdk
- Two-prompt system for task context and scan instructions
- N parallel sub-agents per round dispatched via Claude Agent SDK
- In-memory issue map with LLM-based deduplication via Agent SDK
- Cycles contain multiple rounds (scan -> dedup -> fix) until convergence
- Synthetic loss computation with hardcoded weights (HIGH=3, MEDIUM=2, LOW=1)
- Metrics emitted to events table (cycle.round.loss, cycle.complete)
- Dashboard Cycles tab with SVG loss chart (nav order Docs, Tasks, Runs, Cycles)
- Tasks created with metadata.foundByScan and metadata.cycleId for scoping
- Fix mode dumps all new issues into a single fix agent per round

## Acceptance Criteria

- Running cycle-scan with --cycles 3 --agents 2 produces cycle runs with tracked rounds
- Duplicate issues across rounds are not recreated as tasks (dedup agent works)
- Fix agent receives all new issues as batch context
- Dashboard Cycles tab renders loss chart showing convergence
- Metrics in events table enable time-series plotting
- Works with any pair of task-prompt and scan-prompt files
- --dry-run reports findings without creating tasks
- --scan-only skips fix phase

## Out of Scope

- Automatic scheduling/cron of cycle scans
- Real-time streaming of scan progress to dashboard
- Custom severity scoring models
- Multi-repo scanning
- Built-in prompt templates (users document their own)
