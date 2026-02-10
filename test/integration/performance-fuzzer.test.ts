/**
 * Performance Fuzzer Integration Tests
 *
 * Stress tests with varying loads to measure performance degradation.
 * Tests system behavior as load increases and identifies scalability bottlenecks.
 *
 * Per DD-007: Uses real in-memory SQLite and SHA256-based fixture IDs.
 * Per tx-f472d806: Agent swarm performance fuzzer.
 *
 * Run with: STRESS=1 bunx --bun vitest run test/integration/performance-fuzzer.test.ts
 *
 * @module test/integration/performance-fuzzer
 */

import { describe, it, expect, beforeEach } from "vitest"
import { Effect } from "effect"
import {
  createTestDatabase,
  fixtureId,
  chaos,
  type TestDatabase
} from "@jamesaphoenix/tx-test-utils"

// Skip unless STRESS=1 environment variable is set
const SKIP_STRESS = !process.env["STRESS"]

// =============================================================================
// Performance Measurement Infrastructure
// =============================================================================

interface PerformanceMetrics {
  loadLevel: number
  operationName: string
  durationMs: number
  throughput: number // operations per second
  itemsProcessed: number
}

interface DegradationAnalysis {
  metrics: PerformanceMetrics[]
  degradationFactor: number // ratio of slowest to fastest per-item time
  isLinear: boolean // true if degradation is roughly O(n)
  isQuadratic: boolean // true if degradation is roughly O(n²)
  bottleneckDetected: boolean
  maxAcceptableDegradation: number
  passed: boolean
}

/**
 * Measure operation performance at a given load level.
 */
async function measureOperation<T>(
  name: string,
  loadLevel: number,
  operation: () => Promise<T>,
  itemsProcessed?: number
): Promise<PerformanceMetrics> {
  const startTime = performance.now()
  await operation()
  const durationMs = performance.now() - startTime
  const items = itemsProcessed ?? loadLevel
  const throughput = items / (durationMs / 1000)

  return {
    loadLevel,
    operationName: name,
    durationMs,
    throughput,
    itemsProcessed: items
  }
}

/**
 * Analyze degradation across multiple load levels.
 * Returns analysis of whether performance degrades acceptably.
 */
function analyzeDegradation(
  metrics: PerformanceMetrics[],
  maxAcceptableDegradation: number = 10
): DegradationAnalysis {
  if (metrics.length < 2) {
    return {
      metrics,
      degradationFactor: 1,
      isLinear: true,
      isQuadratic: false,
      bottleneckDetected: false,
      maxAcceptableDegradation,
      passed: true
    }
  }

  // Calculate per-item time at each load level
  const perItemTimes = metrics.map(m => m.durationMs / m.itemsProcessed)

  // Degradation factor: how much slower is the per-item time at max load vs min load
  const minPerItem = Math.min(...perItemTimes)
  const maxPerItem = Math.max(...perItemTimes)
  const degradationFactor = maxPerItem / minPerItem

  // Check if degradation follows O(n) - per-item time should stay constant
  // Allow 3x variation for "linear"
  const isLinear = degradationFactor <= 3

  // Check for O(n²) behavior - per-item time increases with load
  // If per-item time at 10x load is ~10x worse, that's O(n²)
  const sortedByLoad = [...metrics].sort((a, b) => a.loadLevel - b.loadLevel)
  const smallestLoad = sortedByLoad[0]!
  const largestLoad = sortedByLoad[sortedByLoad.length - 1]!

  const loadRatio = largestLoad.loadLevel / smallestLoad.loadLevel
  const perItemRatio = (largestLoad.durationMs / largestLoad.itemsProcessed) /
                       (smallestLoad.durationMs / smallestLoad.itemsProcessed)

  // If per-item time scales with load, that's quadratic
  const isQuadratic = perItemRatio > loadRatio * 0.5

  // Bottleneck: sudden performance cliff
  let bottleneckDetected = false
  for (let i = 1; i < perItemTimes.length; i++) {
    const ratio = perItemTimes[i]! / perItemTimes[i - 1]!
    if (ratio > 5) {
      bottleneckDetected = true
      break
    }
  }

  return {
    metrics,
    degradationFactor,
    isLinear,
    isQuadratic,
    bottleneckDetected,
    maxAcceptableDegradation,
    passed: degradationFactor <= maxAcceptableDegradation && !isQuadratic
  }
}

// =============================================================================
// FUZZER: Ready Detection Performance Degradation
// =============================================================================

describe.skipIf(SKIP_STRESS)("Performance Fuzzer: Ready Detection Degradation", () => {
  it("measures ready detection across increasing task counts", async () => {
    const loadLevels = [10, 50, 100, 500, 1000]
    const metrics: PerformanceMetrics[] = []

    for (const taskCount of loadLevels) {
      // Fresh database for each level to isolate measurements
      const levelDb = await Effect.runPromise(createTestDatabase())

      // Create tasks
      chaos.stressLoad({
        taskCount,
        db: levelDb,
        withDependencies: true,
        dependencyRatio: 0.2
      })

      // Measure ready detection
      const metric = await measureOperation(
        "ready_detection",
        taskCount,
        async () => {
          const ready = levelDb.query<{ id: string }>(
            `SELECT t.id FROM tasks t
             WHERE t.status IN ('backlog', 'ready', 'planning')
             AND NOT EXISTS (
               SELECT 1 FROM task_dependencies td
               JOIN tasks blocker ON td.blocker_id = blocker.id
               WHERE td.blocked_id = t.id
               AND blocker.status != 'done'
             )
             ORDER BY t.score DESC`
          )
          return ready.length
        }
      )

      metrics.push(metric)
      console.log(
        `Ready detection @ ${taskCount} tasks: ${metric.durationMs.toFixed(2)}ms, ` +
        `${metric.throughput.toFixed(0)} tasks/sec`
      )
    }

    const analysis = analyzeDegradation(metrics)

    console.log(`\nDegradation Analysis:`)
    console.log(`  Factor: ${analysis.degradationFactor.toFixed(2)}x`)
    console.log(`  Linear: ${analysis.isLinear}`)
    console.log(`  Quadratic: ${analysis.isQuadratic}`)
    console.log(`  Bottleneck: ${analysis.bottleneckDetected}`)

    // Ready detection should scale reasonably (not quadratic)
    expect(analysis.isQuadratic).toBe(false)
    expect(analysis.degradationFactor).toBeLessThan(20)
  })

  it("measures ready detection with varying dependency densities", async () => {
    const taskCount = 500
    const densityLevels = [0.1, 0.2, 0.3, 0.5, 0.7]
    const metrics: PerformanceMetrics[] = []

    for (const density of densityLevels) {
      const levelDb = await Effect.runPromise(createTestDatabase())

      chaos.stressLoad({
        taskCount,
        db: levelDb,
        withDependencies: true,
        dependencyRatio: density
      })

      const metric = await measureOperation(
        `ready_detection_density_${density}`,
        taskCount,
        async () => {
          const ready = levelDb.query<{ id: string }>(
            `SELECT t.id FROM tasks t
             WHERE t.status IN ('backlog', 'ready', 'planning')
             AND NOT EXISTS (
               SELECT 1 FROM task_dependencies td
               JOIN tasks blocker ON td.blocker_id = blocker.id
               WHERE td.blocked_id = t.id
               AND blocker.status != 'done'
             )`
          )
          return ready.length
        }
      )

      metrics.push(metric)
      console.log(
        `Ready detection @ density ${density}: ${metric.durationMs.toFixed(2)}ms`
      )
    }

    // Higher density should not cause dramatic slowdown
    const minTime = Math.min(...metrics.map(m => m.durationMs))
    const maxTime = Math.max(...metrics.map(m => m.durationMs))
    const ratio = maxTime / minTime

    console.log(`\nDensity impact: ${ratio.toFixed(2)}x slowdown at max density`)

    // Dependency density shouldn't cause more than 5x slowdown
    expect(ratio).toBeLessThan(5)
  })
})

// =============================================================================
// FUZZER: Task Creation Throughput
// =============================================================================

describe.skipIf(SKIP_STRESS)("Performance Fuzzer: Task Creation Throughput", () => {
  it("measures task creation throughput at varying batch sizes", async () => {
    const taskCount = 1000
    const batchSizes = [10, 50, 100, 500, 1000]
    const metrics: PerformanceMetrics[] = []

    for (const batchSize of batchSizes) {
      const levelDb = await Effect.runPromise(createTestDatabase())

      const startTime = performance.now()
      const result = chaos.stressLoad({
        taskCount,
        db: levelDb,
        batchSize
      })
      const durationMs = performance.now() - startTime

      const metric: PerformanceMetrics = {
        loadLevel: batchSize,
        operationName: `task_creation_batch_${batchSize}`,
        durationMs,
        throughput: result.tasksPerSecond,
        itemsProcessed: taskCount
      }

      metrics.push(metric)
      console.log(
        `Task creation @ batch ${batchSize}: ${durationMs.toFixed(2)}ms, ` +
        `${result.tasksPerSecond.toFixed(0)} tasks/sec`
      )
    }

    // Larger batches should be faster or equal
    const sortedByBatch = [...metrics].sort((a, b) => a.loadLevel - b.loadLevel)
    const smallBatchTime = sortedByBatch[0]!.durationMs
    const largeBatchTime = sortedByBatch[sortedByBatch.length - 1]!.durationMs

    // Large batches should not be slower than small batches
    expect(largeBatchTime).toBeLessThanOrEqual(smallBatchTime * 1.5)

    // All should achieve reasonable throughput
    const minThroughput = Math.min(...metrics.map(m => m.throughput))
    expect(minThroughput).toBeGreaterThan(100) // At least 100 tasks/sec
  })

  it("fuzzes random task counts and measures throughput consistency", async () => {
    const randomCounts = Array.from({ length: 10 }, () =>
      Math.floor(Math.random() * 900) + 100 // Random between 100-1000
    )

    const throughputs: number[] = []

    for (const count of randomCounts) {
      const levelDb = await Effect.runPromise(createTestDatabase())
      const result = chaos.stressLoad({
        taskCount: count,
        db: levelDb
      })
      throughputs.push(result.tasksPerSecond)
    }

    // Calculate coefficient of variation
    const mean = throughputs.reduce((a, b) => a + b, 0) / throughputs.length
    const variance = throughputs.reduce((sum, t) => sum + Math.pow(t - mean, 2), 0) / throughputs.length
    const stdDev = Math.sqrt(variance)
    const coefficientOfVariation = stdDev / mean

    console.log(`\nThroughput consistency:`)
    console.log(`  Mean: ${mean.toFixed(0)} tasks/sec`)
    console.log(`  StdDev: ${stdDev.toFixed(0)}`)
    console.log(`  CV: ${(coefficientOfVariation * 100).toFixed(1)}%`)

    // Throughput should be reasonably consistent (CV < 50%)
    expect(coefficientOfVariation).toBeLessThan(0.5)
  })
})

// =============================================================================
// FUZZER: Hierarchy Traversal Performance
// =============================================================================

describe.skipIf(SKIP_STRESS)("Performance Fuzzer: Hierarchy Traversal", () => {
  it("measures getAncestors performance with varying depth", async () => {
    const depths = [5, 10, 25, 50, 100]
    const metrics: PerformanceMetrics[] = []

    for (const depth of depths) {
      const levelDb = await Effect.runPromise(createTestDatabase())

      // Create deep hierarchy chain: task0 <- task1 <- task2 <- ... <- taskN
      const taskIds: string[] = []
      const now = new Date().toISOString()

      for (let i = 0; i < depth; i++) {
        const id = fixtureId(`hierarchy-depth-${depth}-task-${i}`)
        const parentId = i === 0 ? null : taskIds[i - 1]
        levelDb.run(
          `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, metadata)
           VALUES (?, ?, '', 'backlog', ?, 500, ?, ?, '{}')`,
          [id, `Deep Task ${i}`, parentId, now, now]
        )
        taskIds.push(id)
      }

      const deepestId = taskIds[taskIds.length - 1]!

      // Measure ancestor traversal
      const metric = await measureOperation(
        `getAncestors_depth_${depth}`,
        depth,
        async () => {
          // Recursive CTE to get all ancestors
          const ancestors = levelDb.query<{ id: string; depth: number }>(
            `WITH RECURSIVE ancestry AS (
               SELECT id, parent_id, 0 as depth FROM tasks WHERE id = ?
               UNION ALL
               SELECT t.id, t.parent_id, a.depth + 1
               FROM tasks t
               JOIN ancestry a ON t.id = a.parent_id
             )
             SELECT id, depth FROM ancestry WHERE id != ?`,
            [deepestId, deepestId]
          )
          return ancestors.length
        },
        depth - 1 // Processing depth-1 ancestors
      )

      metrics.push(metric)
      console.log(
        `getAncestors @ depth ${depth}: ${metric.durationMs.toFixed(2)}ms`
      )
    }

    // At small depths, per-item time is inflated by fixed overhead,
    // so we use a higher threshold. What matters is not quadratic.
    const analysis = analyzeDegradation(metrics, 50)

    console.log(`\nHierarchy degradation:`)
    console.log(`  Factor: ${analysis.degradationFactor.toFixed(2)}x`)
    console.log(`  Quadratic: ${analysis.isQuadratic}`)

    // Hierarchy traversal should not be quadratic
    expect(analysis.isQuadratic).toBe(false)
    // Should not have a sudden performance cliff
    expect(analysis.bottleneckDetected).toBe(false)
  })

  it("measures getTree performance with varying breadth", async () => {
    const breadths = [2, 5, 10, 20] // Children per node
    const depth = 3 // Fixed depth
    const metrics: PerformanceMetrics[] = []

    for (const breadth of breadths) {
      const levelDb = await Effect.runPromise(createTestDatabase())
      const now = new Date().toISOString()

      // Create tree: root with 'breadth' children, each with 'breadth' grandchildren
      const rootId = fixtureId(`tree-breadth-${breadth}-root`)
      levelDb.run(
        `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
         VALUES (?, 'Root', '', 'backlog', 1000, ?, ?, '{}')`,
        [rootId, now, now]
      )

      let totalNodes = 1
      let currentLevel = [rootId]

      for (let d = 1; d < depth; d++) {
        const nextLevel: string[] = []
        for (const parentId of currentLevel) {
          for (let c = 0; c < breadth; c++) {
            const childId = fixtureId(`tree-breadth-${breadth}-d${d}-c${c}-p${parentId.slice(-6)}`)
            levelDb.run(
              `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, metadata)
               VALUES (?, ?, '', 'backlog', ?, 500, ?, ?, '{}')`,
              [childId, `Child ${d}-${c}`, parentId, now, now]
            )
            nextLevel.push(childId)
            totalNodes++
          }
        }
        currentLevel = nextLevel
      }

      // Measure tree retrieval
      const metric = await measureOperation(
        `getTree_breadth_${breadth}`,
        totalNodes,
        async () => {
          const tree = levelDb.query<{ id: string; level: number }>(
            `WITH RECURSIVE tree AS (
               SELECT id, parent_id, 0 as level FROM tasks WHERE id = ?
               UNION ALL
               SELECT t.id, t.parent_id, tree.level + 1
               FROM tasks t
               JOIN tree ON t.parent_id = tree.id
             )
             SELECT id, level FROM tree`,
            [rootId]
          )
          return tree.length
        },
        totalNodes
      )

      metrics.push(metric)
      console.log(
        `getTree @ breadth ${breadth} (${totalNodes} nodes): ${metric.durationMs.toFixed(2)}ms`
      )
    }

    // Tree traversal time should scale with node count, not exponentially
    const sortedBySize = [...metrics].sort((a, b) => a.itemsProcessed - b.itemsProcessed)
    const smallest = sortedBySize[0]!
    const largest = sortedBySize[sortedBySize.length - 1]!

    const sizeRatio = largest.itemsProcessed / smallest.itemsProcessed
    const timeRatio = largest.durationMs / smallest.durationMs

    console.log(`\nTree scaling: ${sizeRatio.toFixed(1)}x more nodes, ${timeRatio.toFixed(1)}x more time`)

    // Time should scale at most quadratically with size
    expect(timeRatio).toBeLessThan(sizeRatio * sizeRatio)
  })
})

// =============================================================================
// FUZZER: Concurrent Operation Stress
// =============================================================================

describe.skipIf(SKIP_STRESS)("Performance Fuzzer: Concurrent Operations", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
  })

  it("measures performance under concurrent read load", async () => {
    // Create base dataset
    chaos.stressLoad({
      taskCount: 1000,
      db,
      withDependencies: true,
      dependencyRatio: 0.2
    })

    const concurrencyLevels = [1, 5, 10, 20]
    const metrics: PerformanceMetrics[] = []

    for (const concurrency of concurrencyLevels) {
      const operations = Array.from({ length: concurrency }, (_, i) => async () => {
        // Mix of different read operations
        switch (i % 3) {
          case 0:
            // Ready detection
            return db.query<{ id: string }>(
              `SELECT t.id FROM tasks t
               WHERE t.status IN ('backlog', 'ready', 'planning')
               AND NOT EXISTS (
                 SELECT 1 FROM task_dependencies td
                 JOIN tasks blocker ON td.blocker_id = blocker.id
                 WHERE td.blocked_id = t.id
                 AND blocker.status != 'done'
               )
               LIMIT 100`
            )
          case 1:
            // Task listing
            return db.query<{ id: string }>(
              "SELECT id FROM tasks ORDER BY score DESC LIMIT 100"
            )
          case 2:
            // Dependency check
            return db.query<{ blocker_id: string }>(
              "SELECT blocker_id FROM task_dependencies LIMIT 100"
            )
          default:
            return []
        }
      })

      const metric = await measureOperation(
        `concurrent_reads_${concurrency}`,
        concurrency,
        async () => {
          await Promise.all(operations.map(op => op()))
        },
        concurrency
      )

      metrics.push(metric)
      console.log(
        `Concurrent reads @ ${concurrency} parallel: ${metric.durationMs.toFixed(2)}ms`
      )
    }

    // Concurrent reads should not cause excessive slowdown
    const singleTime = metrics.find(m => m.loadLevel === 1)!.durationMs
    const maxTime = Math.max(...metrics.map(m => m.durationMs))

    console.log(`\nConcurrency impact: ${(maxTime / singleTime).toFixed(2)}x slowdown at max concurrency`)

    // Should not be more than 5x slower with 20 concurrent operations
    expect(maxTime / singleTime).toBeLessThan(5)
  })

  it("fuzzes random operation mixes and measures stability", async () => {
    chaos.stressLoad({
      taskCount: 500,
      db,
      withDependencies: true,
      dependencyRatio: 0.3,
      mixedStatuses: true
    })

    const runs = 10
    const durations: number[] = []

    for (let run = 0; run < runs; run++) {
      // Random mix of operations
      const opCount = Math.floor(Math.random() * 10) + 5 // 5-15 operations
      const operations: Array<() => unknown[]> = []

      for (let i = 0; i < opCount; i++) {
        const opType = Math.floor(Math.random() * 4)
        switch (opType) {
          case 0:
            operations.push(() => db.query<{ id: string }>("SELECT id FROM tasks LIMIT 50"))
            break
          case 1:
            operations.push(() => db.query<{ id: string }>(
              "SELECT id FROM tasks WHERE status = 'backlog' LIMIT 50"
            ))
            break
          case 2:
            operations.push(() => db.query<{ count: number }>(
              "SELECT COUNT(*) as count FROM task_dependencies"
            ))
            break
          case 3:
            operations.push(() => db.query<{ id: string; status: string }>(
              "SELECT id, status FROM tasks ORDER BY RANDOM() LIMIT 20"
            ))
            break
        }
      }

      const startTime = performance.now()
      await Promise.all(operations.map(op => Promise.resolve(op())))
      durations.push(performance.now() - startTime)
    }

    // Analyze stability
    const mean = durations.reduce((a, b) => a + b, 0) / durations.length
    const maxDuration = Math.max(...durations)
    const minDuration = Math.min(...durations)

    console.log(`\nRandom operation mix stability:`)
    console.log(`  Mean: ${mean.toFixed(2)}ms`)
    console.log(`  Range: ${minDuration.toFixed(2)}ms - ${maxDuration.toFixed(2)}ms`)
    console.log(`  Ratio: ${(maxDuration / minDuration).toFixed(2)}x`)

    // Performance should be relatively stable
    expect(maxDuration / minDuration).toBeLessThan(10)
  })
})

// =============================================================================
// FUZZER: Memory Pressure Tests
// =============================================================================

describe.skipIf(SKIP_STRESS)("Performance Fuzzer: Memory Pressure", () => {
  it("measures memory growth with increasing task counts", async () => {
    const loadLevels = [100, 500, 1000, 2000, 5000]
    const memoryGrowth: Array<{ load: number; heapMb: number }> = []

    // Force GC if available
    if (globalThis.gc) {
      globalThis.gc()
    }
    const baselineHeap = process.memoryUsage().heapUsed / 1024 / 1024

    for (const taskCount of loadLevels) {
      const db = await Effect.runPromise(createTestDatabase())

      chaos.stressLoad({
        taskCount,
        db,
        withDependencies: true,
        dependencyRatio: 0.3
      })

      // Perform some operations to ensure data is in memory
      db.query<{ id: string }>("SELECT * FROM tasks")
      db.query<{ blocker_id: string }>("SELECT * FROM task_dependencies")

      const currentHeap = process.memoryUsage().heapUsed / 1024 / 1024
      memoryGrowth.push({ load: taskCount, heapMb: currentHeap - baselineHeap })

      console.log(`Memory @ ${taskCount} tasks: +${(currentHeap - baselineHeap).toFixed(2)}MB`)
    }

    // Memory should grow roughly linearly with task count
    const smallest = memoryGrowth[0]!
    const largest = memoryGrowth[memoryGrowth.length - 1]!

    const loadRatio = largest.load / smallest.load
    const memoryRatio = largest.heapMb / (smallest.heapMb || 0.1) // Avoid division by zero

    console.log(`\nMemory scaling: ${loadRatio}x more tasks, ${memoryRatio.toFixed(2)}x more memory`)

    // Memory growth should be at most 2x the load growth (allowing for overhead)
    expect(memoryRatio).toBeLessThan(loadRatio * 2)
  })
})

// =============================================================================
// FUZZER: Query Performance with Random Filters
// =============================================================================

describe.skipIf(SKIP_STRESS)("Performance Fuzzer: Query Performance", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    // Create diverse dataset
    chaos.stressLoad({
      taskCount: 1000,
      db,
      withDependencies: true,
      dependencyRatio: 0.25,
      mixedStatuses: true
    })
  })

  it("measures query performance with varying filter complexity", async () => {
    const queries = [
      {
        name: "simple_status",
        sql: "SELECT id FROM tasks WHERE status = 'backlog'"
      },
      {
        name: "score_range",
        sql: "SELECT id FROM tasks WHERE score BETWEEN 200 AND 800"
      },
      {
        name: "status_and_score",
        sql: "SELECT id FROM tasks WHERE status IN ('backlog', 'ready') AND score > 500"
      },
      {
        name: "with_subquery",
        sql: `SELECT t.id FROM tasks t
              WHERE EXISTS (
                SELECT 1 FROM task_dependencies td WHERE td.blocker_id = t.id
              )`
      },
      {
        name: "complex_join",
        sql: `SELECT DISTINCT t.id FROM tasks t
              LEFT JOIN task_dependencies td ON t.id = td.blocked_id
              WHERE t.status != 'done' AND td.blocker_id IS NULL`
      }
    ]

    const metrics: Array<{ name: string; durationMs: number; resultCount: number }> = []

    for (const query of queries) {
      const startTime = performance.now()
      const results = db.query<{ id: string }>(query.sql)
      const durationMs = performance.now() - startTime

      metrics.push({ name: query.name, durationMs, resultCount: results.length })
      console.log(`${query.name}: ${durationMs.toFixed(2)}ms (${results.length} results)`)
    }

    // All queries should complete in reasonable time
    const maxTime = Math.max(...metrics.map(m => m.durationMs))
    expect(maxTime).toBeLessThan(1000) // 1 second max

    // Complex queries shouldn't be dramatically slower
    const simpleTime = metrics.find(m => m.name === "simple_status")!.durationMs
    const complexTime = metrics.find(m => m.name === "complex_join")!.durationMs

    console.log(`\nComplexity impact: ${(complexTime / simpleTime).toFixed(2)}x slower for complex query`)

    expect(complexTime).toBeLessThan(simpleTime * 20)
  })

  it("fuzzes random WHERE clauses and measures consistency", async () => {
    const statuses = ["backlog", "ready", "planning", "active", "blocked", "review", "done"]
    const runs = 20
    const durations: number[] = []

    for (let run = 0; run < runs; run++) {
      // Random filter combination
      const randomStatus = statuses[Math.floor(Math.random() * statuses.length)]
      const randomScore = Math.floor(Math.random() * 1000)
      const useScoreFilter = Math.random() > 0.5
      const useStatusFilter = Math.random() > 0.5

      let whereClause = "1=1"
      if (useStatusFilter) {
        whereClause += ` AND status = '${randomStatus}'`
      }
      if (useScoreFilter) {
        whereClause += ` AND score > ${randomScore}`
      }

      const startTime = performance.now()
      db.query<{ id: string }>(`SELECT id FROM tasks WHERE ${whereClause}`)
      durations.push(performance.now() - startTime)
    }

    const mean = durations.reduce((a, b) => a + b, 0) / durations.length
    const maxDuration = Math.max(...durations)

    console.log(`\nRandom filter performance:`)
    console.log(`  Mean: ${mean.toFixed(2)}ms`)
    console.log(`  Max: ${maxDuration.toFixed(2)}ms`)

    // Should be consistently fast
    expect(maxDuration).toBeLessThan(100)
    expect(mean).toBeLessThan(20)
  })
})
