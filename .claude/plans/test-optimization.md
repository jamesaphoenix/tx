# Plan: Singleton Test Database

## Current State

Agents have refactored 17 test files from per-test DBs to per-describe DBs:
- Before: ~920 DBs
- After agents: ~83 DBs (one per describe block)

## Better Pattern: Singleton DB

Instead of each test file/describe managing its own DB, use a **singleton** managed by test-utils.

### Implementation

#### 1. Create singleton in test-utils

**File:** `packages/test-utils/src/singleton.ts`

```typescript
import { createSharedTestLayer, type SharedTestLayerResult } from "./helpers/shared-test-layer.js"

let instance: SharedTestLayerResult | null = null

/**
 * Get the singleton test database layer.
 * Creates it on first call, returns cached instance thereafter.
 */
export const getSharedTestLayer = async (): Promise<SharedTestLayerResult> => {
  if (!instance) {
    instance = await createSharedTestLayer()
  }
  return instance
}

/**
 * Reset all tables in the singleton DB.
 * Call in afterEach to ensure test isolation.
 */
export const resetTestDb = async (): Promise<void> => {
  if (instance) {
    await instance.reset()
  }
}

/**
 * Close the singleton DB connection.
 * Call in global teardown or afterAll.
 */
export const closeTestDb = async (): Promise<void> => {
  if (instance) {
    await instance.close()
    instance = null
  }
}
```

#### 2. Export from test-utils index

**File:** `packages/test-utils/src/index.ts`

```typescript
export {
  getSharedTestLayer,
  resetTestDb,
  closeTestDb
} from "./singleton.js"
```

#### 3. Create vitest setup file

**File:** `vitest.setup.ts`

```typescript
import { beforeAll, afterEach, afterAll } from "vitest"
import { getSharedTestLayer, resetTestDb, closeTestDb } from "@jamesaphoenix/tx-test-utils"

// Initialize singleton DB before any tests run
beforeAll(async () => {
  await getSharedTestLayer()
})

// Reset DB between every test for isolation
afterEach(async () => {
  await resetTestDb()
})

// Close DB after all tests complete
afterAll(async () => {
  await closeTestDb()
})
```

#### 4. Update vitest.config.ts

```typescript
export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // ... rest of config
  }
})
```

#### 5. Simplify test files

**Before (current pattern):**
```typescript
describe("MyService", () => {
  let shared: SharedTestLayerResult

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("test", async () => {
    // use shared.layer
  })
})
```

**After (singleton pattern):**
```typescript
import { getSharedTestLayer } from "@jamesaphoenix/tx-test-utils"

describe("MyService", () => {
  it("test", async () => {
    const { layer } = await getSharedTestLayer()
    // use layer - no setup/teardown needed!
  })
})
```

---

## Files to Modify

1. `packages/test-utils/src/singleton.ts` - **New file**
2. `packages/test-utils/src/index.ts` - Add exports
3. `vitest.setup.ts` - **New file** (global setup)
4. `vitest.config.ts` - Add setupFiles
5. All 18 test files - Remove per-describe lifecycle hooks

---

## Result

| Metric | Before | After Agents | After Singleton |
|--------|--------|--------------|-----------------|
| DBs | ~920 | ~83 | **1** |
| Setup code per file | ~15 lines | ~15 lines | **0 lines** |
| Memory | 54GB | ~8GB | **<1GB** |

---

## Verification

```bash
# 1. Build test-utils
bun run build --filter="@jamesaphoenix/tx-test-utils"

# 2. Run all tests
bun test

# 3. Verify memory usage
bun test &
watch -n 1 "top -l 1 | grep -E 'PhysMem|bun'"

# 4. Count DB initializations (should see only 1)
bun test 2>&1 | grep -c "createSharedTestLayer"
```
