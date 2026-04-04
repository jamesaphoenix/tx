---
name: surface-parity
description: "Internal closed-loop skill: drive CLI/API/MCP to 100% shape parity (same service methods) AND behaviour parity (same response shapes). Uses ESLint rules tx/require-surface-parity + tx/interface-parity. NOT shipped to tx users."
argument-hint: "[--dry-run] [--service ServiceName]"
metadata:
  short-description: "Internal: shape + behaviour parity loop"
---

Internal skill (not shipped to users). Drives two dimensions of parity across all surfaces (CLI/API/MCP):

1. **Shape parity** — every core service method present on ANY surface must be present on ALL surfaces
2. **Behaviour parity** — those methods must return identical response shapes, use shared serializers, and handle errors consistently

Checked by two ESLint rules:
- `tx/require-surface-parity` — shape (service method coverage + variable naming)
- `tx/interface-parity` — behaviour (response shapes, serializer dedup, field types)

## Loop Workflow

```
STEP 1 → Audit both rules
STEP 2 → Fix naming violations (enables accurate shape detection)
STEP 3 → Fix shape gaps (implement missing service methods on surfaces)
STEP 4 → Fix behaviour gaps (align response shapes, use shared serializers)
STEP 5 → Re-audit → if clean, done; else goto STEP 2
```

### Step 1: Audit

```bash
# Shape parity: naming + method coverage
bunx eslint --no-cache apps/cli/src/commands/task.ts 2>&1 | grep 'require-surface-parity'

# Behaviour parity: response shapes + serializers
bunx eslint --no-cache apps/cli/src/commands/task.ts 2>&1 | grep 'interface-parity'

# Combined count (loop exit condition: 0)
bunx eslint --no-cache apps/cli/src/commands/task.ts 2>&1 | grep -c 'require-surface-parity\|interface-parity'
```

### Step 2: Fix Naming Violations

Naming violations look like:
```
23:11  warning  Service binding "svc" should be "taskService' or 'taskSvc" (from TaskService).
```

Fix by renaming the variable AND all its usages within the same `Effect.gen` scope:

```typescript
// BEFORE
const svc = yield* TaskService
yield* svc.create(input)

// AFTER
const taskService = yield* TaskService
yield* taskService.create(input)
```

**Fix naming FIRST** — the shape parser relies on consistent naming for accurate method attribution.

### Step 3: Fix Shape Gaps

Shape gaps look like:
```
Surface parity gap: LearningService.count is missing from cli (implemented in: api, mcp)
```

For each gap, implement the missing operation on the missing surface. Follow the existing patterns in:
- **CLI**: `apps/cli/src/commands/<domain>.ts` — `Effect.gen` + `yield* service.method()` + `toJson()`/`console.log()`
- **API**: `apps/api-server/src/routes/<domain>.ts` — `.handle()` + `Effect.gen` + `serializeX()` + `mapCoreError`
- **MCP**: `apps/mcp-server/src/tools/<domain>.ts` — `runEffect(Effect.gen(...))` + JSON text content blocks

### Step 4: Fix Behaviour Gaps

Behaviour gaps look like:
```
Interface parity violation: done response missing required field "nowReady".
Interface parity violation: Local serializeTask() duplicates shared function.
```

Fixes:
- **Missing response fields**: add the field to the response object (e.g. `{ task, nowReady }`)
- **Duplicate serializers**: delete local `serializeTask()`, import from `@jamesaphoenix/tx-types`
- **ID arrays instead of tasks**: use `.map(serializeTask)` not `.map(t => t.id)`

### Step 5: Re-Audit

```bash
bunx eslint --no-cache apps/cli/src/commands/task.ts 2>&1 | grep -c 'require-surface-parity\|interface-parity'
```

If 0: done. If >0: go back to Step 2.

## Current Gap Summary

**Shape gaps (19):**
- LearningService: 8 gaps (CLI missing create/get/search/getRecent/updateOutcome/count; MCP missing get/getRecent)
- FileLearningService: 3 gaps (CLI missing create/getAll/recall)
- ReadyService.readyAndClaim: 2 gaps (API + MCP missing)
- TaskService.get: 2 gaps (API + MCP missing — DOCTRINE RULE 1 tension)
- MemoryService.search: 2 gaps (API + MCP missing)
- HierarchyService.getTree: 1 gap (CLI missing)
- GuardService.check: 1 gap (CLI missing)

**Behaviour gaps**: run `bunx eslint --no-cache apps/ 2>&1 | grep 'interface-parity'` to check current count.

## Configuration

Shape rule in `eslint.config.js`:
```javascript
'tx/require-surface-parity': ['warn', { ... }]
```

Behaviour rule in `eslint.config.js`:
```javascript
'tx/interface-parity': ['error', { ... }]
```
