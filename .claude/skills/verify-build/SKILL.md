---
name: verify-build
description: Build a verification script that defines "done" for a parent task or project phase. Creates a .sh script and attaches it via tx verify set.
disable-model-invocation: true
argument-hint: [task-id]
---

# Build Verification Script for Parent Tasks

Creates a `.sh` script that defines machine-checkable "done" criteria for a **parent task** or project phase. The primary use case: attach a verification gate to a parent task so agents (and humans) can machine-check whether a phase is complete before moving on.

## Step 1: Understand the scope

Ask the user:
1. **What parent task or phase is this for?** (specific task ID, or a phase like "docs", "implementation", "testing")
2. **What does "done" look like for this phase?** Examples:
   - "All child tasks are completed"
   - "All tests pass with >80% coverage"
   - "No TypeScript errors and build succeeds"
   - "10+ design docs exist in .tx/docs"
   - "API responds to health check"
   - "All children done AND tests pass AND typecheck clean"

## Step 2: Build the verification script

Based on the user's definition of done, create a `.sh` script at `.tx/verify/<name>.sh`.

### Parent task patterns (primary use case)

#### Check all children are done
The most common parent task check — verify all subtasks have been completed:
```bash
#!/usr/bin/env bash
set -euo pipefail
PARENT_ID="${1:-tx-xxxxxx}"  # pass as arg or hard-code
CHILDREN=$(tx children "$PARENT_ID" --json 2>/dev/null)
TOTAL=$(echo "$CHILDREN" | jq 'length')
INCOMPLETE=$(echo "$CHILDREN" | jq '[.[] | select(.status != "done")] | length')
if [ "$INCOMPLETE" -gt 0 ]; then
  echo "FAIL: $INCOMPLETE of $TOTAL child tasks not done" >&2
  echo "$CHILDREN" | jq -r '.[] | select(.status != "done") | "  - \(.id): \(.title) [\(.status)]"' >&2
  exit 1
fi
echo "PASS: All $TOTAL children of $PARENT_ID are done"
```

#### Children done + tests pass (composite parent check)
```bash
#!/usr/bin/env bash
set -euo pipefail
PARENT_ID="${1:-tx-xxxxxx}"
PASS=0; FAIL=0

check() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then
    PASS=$((PASS+1))
    echo "  PASS: $desc"
  else
    FAIL=$((FAIL+1))
    echo "  FAIL: $desc" >&2
  fi
}

# Check all children done
INCOMPLETE=$(tx children "$PARENT_ID" --json 2>/dev/null | jq '[.[] | select(.status != "done")] | length')
if [ "$INCOMPLETE" -eq 0 ]; then
  PASS=$((PASS+1)); echo "  PASS: All children done"
else
  FAIL=$((FAIL+1)); echo "  FAIL: $INCOMPLETE children not done" >&2
fi

# Check tests pass
check "Tests pass" bun run test:unit

# Check typecheck
check "Typecheck clean" bun run typecheck

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
```

#### Children done + structured JSON output
For richer verification data (use with `--schema` for machine validation):
```bash
#!/usr/bin/env bash
set -euo pipefail
PARENT_ID="${1:-tx-xxxxxx}"
CHILDREN=$(tx children "$PARENT_ID" --json 2>/dev/null)
TOTAL=$(echo "$CHILDREN" | jq 'length')
DONE=$(echo "$CHILDREN" | jq '[.[] | select(.status == "done")] | length')
INCOMPLETE=$((TOTAL - DONE))

# Output structured JSON for schema validation
cat <<ENDJSON
{
  "total": $TOTAL,
  "done": $DONE,
  "incomplete": $INCOMPLETE,
  "passed": $([ "$INCOMPLETE" -eq 0 ] && echo "true" || echo "false")
}
ENDJSON

[ "$INCOMPLETE" -eq 0 ]
```

### General patterns

#### File count checks
```bash
#!/usr/bin/env bash
set -euo pipefail
DOC_COUNT=$(find .tx/docs -name "*.yaml" -type f | wc -l | tr -d ' ')
echo "Found $DOC_COUNT docs"
if [ "$DOC_COUNT" -lt 10 ]; then
  echo "FAIL: Need at least 10 docs, found $DOC_COUNT" >&2
  exit 1
fi
echo "PASS: Docs phase complete ($DOC_COUNT docs)"
```

#### Test suite checks
```bash
#!/usr/bin/env bash
set -euo pipefail
bunx --bun vitest run test/integration/ --reporter=json 2>/dev/null | jq -e '.numFailedTests == 0'
```

#### Build + typecheck
```bash
#!/usr/bin/env bash
set -euo pipefail
bun run typecheck && bun run build && echo "PASS: Build clean"
```

#### API health check
```bash
#!/usr/bin/env bash
set -euo pipefail
curl -sf http://localhost:3456/health | jq -e '.status == "ok"'
```

## Step 3: Attach to parent task

After creating the script, make it executable and attach it to the parent task:

```bash
chmod +x .tx/verify/<name>.sh
tx verify set <parent-task-id> ".tx/verify/<name>.sh"
```

Optional: attach a JSON schema to validate structured output from the script:
```bash
tx verify set <parent-task-id> ".tx/verify/<name>.sh" --schema ".tx/verify/<name>.schema.json"
```

Example schema (`.tx/verify/<name>.schema.json`):
```json
{
  "required": ["total", "done", "incomplete", "passed"],
  "properties": {
    "total": { "type": "number" },
    "done": { "type": "number" },
    "incomplete": { "type": "number" },
    "passed": { "type": "boolean" }
  }
}
```

If no task ID was provided, ask which parent task to attach it to.

## Step 4: Test it

Run the verification to confirm it works:
```bash
tx verify run <parent-task-id>
tx verify run <parent-task-id> --json       # machine-readable output
tx verify run <parent-task-id> --timeout 600  # longer timeout for heavy checks
```

Show the user the output and ask if adjustments are needed.

## CLI Reference

```
tx verify set <id> <command> [--schema <path>]   # Attach verify script
tx verify show <id>                              # Inspect what's attached
tx verify run <id> [--timeout <seconds>] [--json]  # Execute and check
tx verify clear <id>                             # Remove verify script
```

## Agent Workflow Pattern

The parent task verification pattern fits into the agent loop like this:

```bash
# Agent completes all subtasks, then verifies the parent
PARENT_ID="tx-abc123"

# Work on children...
for child in $(tx children "$PARENT_ID" --json | jq -r '.[].id'); do
  # ... agent works on each child, calls tx done $child
done

# Gate: only mark parent done if verification passes
if tx verify run "$PARENT_ID"; then
  tx done "$PARENT_ID"
else
  echo "Parent verification failed — check remaining work"
fi
```

## Important

- Scripts MUST be Bash 3.2 compatible (macOS ships with Bash 3.2)
- Use `set -euo pipefail` at the top
- Exit 0 = pass, non-zero = fail
- Print human-readable output to stdout, errors to stderr
- Store scripts in `.tx/verify/` directory (create if needed)
- Default timeout is 300 seconds (configurable in `.tx/config.toml` or via `--timeout`)
- Do NOT use Bash 4+ features: `${var:1:-1}`, `&>>`, associative arrays (`declare -A`), `|&`, `coproc`, `mapfile`, `declare -n`
