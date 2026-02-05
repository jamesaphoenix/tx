# Plan: Investigate Test Suite Memory Usage

## Goal
Create `scripts/profile-test-memory.sh` — a diagnostic script that profiles each test suite in isolation, measuring peak RSS memory and wall time, to identify which suites are consuming too much memory (likely the local embedding/reranker models).

## Key Findings from Investigation

**Suspected memory hogs:**
- `embeddinggemma-300M-GGUF` model via node-llama-cpp (~500MB-1GB when loaded)
- `Qwen3-Reranker` model via node-llama-cpp
- Stress tests seeding 5K tasks + 10K learnings
- Dashboard jsdom environment (React + MSW)
- 72 integration test files (55K lines)

**Test execution model:**
- Stage 1: `turbo test` runs 8 package test suites in parallel (vitest/bun)
- Stage 2: `bun test test/` runs 86 root test files sequentially
- Pre-push hook (`check.sh --all`) runs both stages

## What the Script Does

1. Runs each test suite **independently** via `/usr/bin/time -l` (macOS peak RSS in bytes)
2. Profiles at three levels:
   - **Per-package** (7 packages: dashboard, api-server, core, etc.)
   - **Per-domain group** (embedding-ml, sync, daemon, anchor, etc.)
   - **Individual high-interest files** (embedding-real, stress, daemon, mcp)
3. Outputs a sorted table + summary with memory alerts

## Script Design

### File: `scripts/profile-test-memory.sh`

**Usage:**
```bash
./scripts/profile-test-memory.sh              # Profile everything (except stress/real-embedding)
./scripts/profile-test-memory.sh --packages   # Package suites only (fastest, ~2 min)
./scripts/profile-test-memory.sh --stress     # Include stress tests (STRESS=1)
./scripts/profile-test-memory.sh --embedding  # Include real embedding model tests
```

### Measurement: `/usr/bin/time -l`
- macOS reports `maximum resident set size` in **bytes**
- Convert to MB for display
- Also capture wall-clock time
- Each suite runs in its own process — clean isolation

### Profiling Groups

**Stage 1 — Packages (run each package's test script directly, bypass turbo):**

| Package | Command (run from package dir) |
|---------|-------------------------------|
| apps/dashboard | `bun vitest --run` |
| apps/api-server | `bun test` |
| apps/cli | `bun vitest run --passWithNoTests` |
| apps/agent-sdk | `bun vitest run --passWithNoTests` |
| apps/mcp-server | `bun vitest run --passWithNoTests` |
| packages/core | `bun vitest run --passWithNoTests` |
| packages/test-utils | `bun vitest run --passWithNoTests` |

**Stage 2 — Root test domain groups (via `bun test <files>`):**

| Group | Key files |
|-------|-----------|
| embedding-ml | embedding.test.ts, retrieval-e2e.test.ts, retriever.test.ts, reranker.test.ts, etc. |
| sync | sync.test.ts, auto-sync.test.ts |
| daemon | daemon.test.ts, daemon-cli.test.ts, daemon-service.test.ts |
| anchor | anchor*.test.ts (6 files) |
| graph | graph-schema.test.ts, edge-repo.test.ts, etc. |
| worker | worker-*.test.ts, run.test.ts, run-worker.test.ts |
| core-task | core.test.ts, claim-*.test.ts, deduplication.test.ts, compaction.test.ts |
| learning | learning.test.ts, file-learning.test.ts, file-watcher.test.ts |
| mcp | mcp.test.ts, interface-parity.test.ts |
| chaos | test/chaos/*.test.ts |
| golden-paths | test/golden-paths/*.test.ts |
| unit | test/unit/*.test.ts |

**Stage 3 — Individual high-interest files:**

| File | Why |
|------|-----|
| embedding-real.test.ts | Loads 300M GGUF model (~1GB) — only with `--embedding` flag |
| stress.test.ts | Seeds 5K tasks + 10K learnings — only with `--stress` flag |
| daemon.test.ts | Largest test file (3262 lines) |
| mcp.test.ts | Second largest (3004 lines) |
| sync.test.ts | Third largest (2434 lines) |
| retrieval-e2e.test.ts | Full embedding pipeline |

### Output Format

```
tx Test Suite Memory Profile (2026-02-05)
=============================================================================
Rank  Suite                          Peak RSS (MB)  Time (s)  Status
----  -----------------------------  -------------  --------  ------
  1   root/embedding-real.test          1,247.3       42.1    PASS
  2   root/group:embedding-ml             654.2       28.3    PASS
  3   pkg/dashboard                       387.1        8.4    PASS
  ...

HIGH-MEMORY ALERTS (>500MB):
  ! embedding-real.test: 1,247 MB — loads embeddinggemma-300M-GGUF
```

## Implementation Steps

1. Create `scripts/profile-test-memory.sh` with option parsing and color support (follow `scripts/check.sh` patterns)
2. Implement `profile_command()` wrapper around `/usr/bin/time -l` with RSS/time parsing
3. Define package list + test commands (Stage 1)
4. Define domain groups + file lists (Stage 2)
5. Define high-interest individual files (Stage 3)
6. Implement results collection, sorting, and table output
7. Run `./scripts/profile-test-memory.sh --packages` to validate
8. Run full profile and review results

## Key Files

- `scripts/check.sh` — Pattern to follow for bash structure, colors, run_silent helper
- `vitest.config.ts` — Pool/fork config (maxForks=4)
- `vitest.setup.ts` — Singleton DB setup
- `test/integration/embedding-real.test.ts` — Skip pattern (`SKIP_REAL_EMBEDDING_TESTS`)
- `test/chaos/stress.test.ts` — Gate pattern (`STRESS=1`)
- `packages/core/src/services/embedding-service.ts` — Local model loading code
- `packages/core/src/services/reranker-service.ts` — Local reranker model

## Verification

1. Run `./scripts/profile-test-memory.sh --packages` — should complete in ~2 min, produce table
2. Run `./scripts/profile-test-memory.sh` — full profile, ~10-15 min
3. Verify output sorts by peak RSS descending
4. Confirm embedding-related suites show highest memory (validating the hypothesis)
5. Results should be actionable — clear which suites to optimize or skip in pre-push
