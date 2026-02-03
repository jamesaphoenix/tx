#!/bin/bash
# Simple Loop Example
#
# Demonstrates the basic task workflow:
# 1. Initialize tx
# 2. Create tasks
# 3. Process tasks one by one
# 4. Verify all tasks are done
#
# Usage: ./simple-loop.sh

set -e

# Change to examples directory
cd "$(dirname "$0")"

# Use a test database
export TX_DB="./test-simple.db"
rm -f "$TX_DB" "$TX_DB-wal" "$TX_DB-shm"

echo "=== Simple Loop Example ==="
echo ""

# Initialize
echo "1. Initializing tx..."
bun run ../apps/cli/src/cli.ts init --db "$TX_DB"

# Create tasks
echo ""
echo "2. Creating tasks..."
TASK1=$(bun run ../apps/cli/src/cli.ts add "Task 1: Setup project" --score 800 --db "$TX_DB" --json | jq -r '.id')
TASK2=$(bun run ../apps/cli/src/cli.ts add "Task 2: Write code" --score 600 --db "$TX_DB" --json | jq -r '.id')
TASK3=$(bun run ../apps/cli/src/cli.ts add "Task 3: Run tests" --score 400 --db "$TX_DB" --json | jq -r '.id')

echo "   Created: $TASK1, $TASK2, $TASK3"

# Process loop
echo ""
echo "3. Processing tasks..."
PROCESSED=0
while true; do
    # Get next ready task
    TASK=$(bun run ../apps/cli/src/cli.ts ready --limit 1 --db "$TX_DB" --json | jq -r '.[0].id // empty')

    if [ -z "$TASK" ]; then
        echo "   No more ready tasks."
        break
    fi

    echo "   Working on: $TASK"

    # Simulate work
    sleep 0.5

    # Mark done
    bun run ../apps/cli/src/cli.ts done "$TASK" --db "$TX_DB" > /dev/null
    echo "   Completed: $TASK"

    PROCESSED=$((PROCESSED + 1))
done

# Verify
echo ""
echo "4. Verifying..."
DONE_COUNT=$(bun run ../apps/cli/src/cli.ts list --status done --db "$TX_DB" --json | jq '. | length')

if [ "$DONE_COUNT" -eq 3 ]; then
    echo "   ✓ All 3 tasks completed successfully!"
else
    echo "   ✗ Expected 3 done tasks, got $DONE_COUNT"
    exit 1
fi

# Cleanup
echo ""
echo "5. Cleaning up..."
rm -f "$TX_DB" "$TX_DB-wal" "$TX_DB-shm"

echo ""
echo "=== Simple Loop Complete ==="
