---
name: test-quiet
description: Run tests with context-efficient output. Hides passing test output, shows ONLY failures. Use when running tests, checking if tests pass, or verifying changes. Also detects flaky tests.
allowed-tools: Bash(*)
---

# Context-Efficient Test Runner

Runs vitest with minimal context consumption. Passing tests show as a single `✓` line. Failing tests show the test name + first line of error. This saves 90%+ of context tokens vs raw vitest output.

Based on [HumanLayer's backpressure pattern](https://humanlayer.dev/blog/context-efficient-backpressure): swallow passing output, dump failures.

## Usage

**ALWAYS use this skill instead of running vitest directly.** Raw vitest output wastes context.

### Run all integration tests

```bash
.claude/skills/test-quiet/scripts/run.sh
```

### Run specific tests

```bash
.claude/skills/test-quiet/scripts/run.sh test/integration/core.test.ts
.claude/skills/test-quiet/scripts/run.sh test/integration/
```

### Detect flaky tests

Re-runs failing tests multiple times to distinguish flaky from consistent failures:

```bash
.claude/skills/test-quiet/scripts/run.sh --flaky
.claude/skills/test-quiet/scripts/run.sh --flaky --runs 5
```

### Options

| Flag | Description |
|------|-------------|
| `--flaky` | Re-run failing tests to detect flakiness |
| `--runs N` | Number of re-runs for flaky detection (default: 3) |
| `[path]` | Test file or directory (default: `test/integration/`) |

## Output Format

```
tx test-quiet — hide passing, show failures
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✓ test/integration/core.test.ts (82 tests)
  ✓ test/integration/cycle-scan.test.ts (15 tests)
  ✗ test/integration/cli-graph.test.ts (0 passed, 51 failed)
    FAIL: CLI graph:link creates an anchor...
      SyntaxError: JSON Parse error: Unexpected EOF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1/3 files failed — 51/148 tests failed, 0 skipped (5s)
```

## After Running

1. If all pass: you're done, move on
2. If failures exist: read the failing test file and the error message to understand what's broken
3. If `--flaky` shows flaky tests: investigate timer/async issues (see test-diagnostics skill)
4. Do NOT re-run the full suite to "double check" — trust the results
