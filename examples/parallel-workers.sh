#!/bin/bash
# Parallel Workers Example
#
# Demonstrates multiple workers processing tasks in parallel:
# 1. Create multiple tasks
# 2. Spawn 3 worker processes
# 3. Each worker claims, processes, and releases tasks
# 4. Verify all tasks completed
#
# Usage: ./parallel-workers.sh

set -e

# Change to examples directory
cd "$(dirname "$0")"

# Use a test database
export TX_DB="./test-parallel.db"
rm -f "$TX_DB" "$TX_DB-wal" "$TX_DB-shm"

# Temp files for worker output
WORKER_LOG="./worker-output.log"
rm -f "$WORKER_LOG"

echo "=== Parallel Workers Example ==="
echo ""

# Initialize
echo "1. Initializing tx..."
bun run ../apps/cli/src/cli.ts init --db "$TX_DB"

# Create tasks
echo ""
echo "2. Creating 6 tasks..."
for i in {1..6}; do
    SCORE=$((1000 - i * 100))
    bun run ../apps/cli/src/cli.ts add "Task $i" --score "$SCORE" --db "$TX_DB" > /dev/null
done
echo "   Created 6 tasks with scores 900-400"

# Worker function
worker() {
    local WORKER_ID="$1"
    local LOG_FILE="$2"

    while true; do
        # Get next ready task
        TASK=$(bun run ../apps/cli/src/cli.ts ready --limit 1 --db "$TX_DB" --json 2>/dev/null | jq -r '.[0].id // empty')

        if [ -z "$TASK" ]; then
            echo "[$WORKER_ID] No more tasks" >> "$LOG_FILE"
            break
        fi

        # Try to claim (may fail if another worker got it)
        if bun run ../apps/cli/src/cli.ts claim "$TASK" "$WORKER_ID" --db "$TX_DB" 2>/dev/null; then
            echo "[$WORKER_ID] Claimed $TASK" >> "$LOG_FILE"

            # Simulate work
            sleep 0.3

            # Release and complete
            bun run ../apps/cli/src/cli.ts claim:release "$TASK" "$WORKER_ID" --db "$TX_DB" 2>/dev/null || true
            bun run ../apps/cli/src/cli.ts done "$TASK" --db "$TX_DB" > /dev/null
            echo "[$WORKER_ID] Completed $TASK" >> "$LOG_FILE"
        fi

        # Small delay to reduce contention
        sleep 0.1
    done
}

# Start workers
echo ""
echo "3. Starting 3 parallel workers..."

# Export functions and variables for subshells
export TX_DB
export -f worker

# Run workers in background
worker "worker-alpha" "$WORKER_LOG" &
PID1=$!
worker "worker-beta" "$WORKER_LOG" &
PID2=$!
worker "worker-gamma" "$WORKER_LOG" &
PID3=$!

echo "   Started worker-alpha (PID: $PID1)"
echo "   Started worker-beta (PID: $PID2)"
echo "   Started worker-gamma (PID: $PID3)"

# Wait for all workers
echo ""
echo "4. Waiting for workers to complete..."
wait $PID1 $PID2 $PID3

# Show worker activity
echo ""
echo "5. Worker activity log:"
if [ -f "$WORKER_LOG" ]; then
    cat "$WORKER_LOG" | while read line; do
        echo "   $line"
    done
fi

# Verify results
echo ""
echo "6. Verifying results..."
READY_COUNT=$(bun run ../apps/cli/src/cli.ts ready --db "$TX_DB" --json | jq '. | length')
DONE_COUNT=$(bun run ../apps/cli/src/cli.ts list --status done --db "$TX_DB" --json | jq '. | length')

if [ "$READY_COUNT" -eq 0 ] && [ "$DONE_COUNT" -eq 6 ]; then
    echo "   ✓ All 6 tasks completed by parallel workers!"
else
    echo "   ✗ Ready: $READY_COUNT, Done: $DONE_COUNT (expected 0 and 6)"
    exit 1
fi

# Count completions per worker
echo ""
echo "7. Work distribution:"
if [ -f "$WORKER_LOG" ]; then
    for worker in "worker-alpha" "worker-beta" "worker-gamma"; do
        COUNT=$(grep -c "\[$worker\] Completed" "$WORKER_LOG" 2>/dev/null || echo "0")
        echo "   $worker completed: $COUNT tasks"
    done
fi

# Cleanup
echo ""
echo "8. Cleaning up..."
rm -f "$TX_DB" "$TX_DB-wal" "$TX_DB-shm"
rm -f "$WORKER_LOG"

echo ""
echo "=== Parallel Workers Complete ==="
echo ""
echo "Summary:"
echo "  - 3 workers processed 6 tasks in parallel"
echo "  - Claim system prevented duplicate work"
echo "  - All tasks completed exactly once"
