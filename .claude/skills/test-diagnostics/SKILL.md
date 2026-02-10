---
name: test-diagnostics
description: Profile all test files to find slow, hanging, or failing tests. Use when tests seem slow or when vitest hangs.
disable-model-invocation: true
allowed-tools: Bash, Glob, Read
---

# Test Diagnostics

Profile every test file in the monorepo individually to find slow, hanging, or failing tests.

## Quick run

Run the diagnostics script:

```bash
.claude/skills/test-diagnostics/run-diagnostics.sh
```

Options:
- `--timeout 30` — Kill tests after N seconds (default: 30)
- `--slow-threshold 5` — Report tests taking > N seconds as SLOW (default: 5)
- `--dir ./test/integration` — Only test files under a specific directory

## After running

1. Review the summary output
2. For any **HANG** tests, read the test file and look for:
   - Missing `afterAll` cleanup or open connections
   - Servers or background processes that aren't shut down
   - Infinite loops or unresolved promises
   - File watchers that aren't cleaned up
3. For any **FAIL** tests, run them individually with verbose output:
   ```bash
   bunx --bun vitest run <path> 2>&1
   ```
4. For **SLOW** tests (>5s), check if they can be optimized:
   - Are they spawning CLI subprocesses unnecessarily?
   - Can expensive setup be shared across tests?
   - Are there unnecessary sleeps or timeouts?
5. Suggest concrete fixes for each issue found.
