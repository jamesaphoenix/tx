#!/bin/bash
# Dependency Chain Example
#
# Demonstrates task dependencies:
# 1. Create tasks with dependencies (A → B → C)
# 2. Verify only unblocked tasks are ready
# 3. Complete in order
# 4. Verify unblocking works
#
# Usage: ./dependency-chain.sh

set -e

# Change to examples directory
cd "$(dirname "$0")"

# Use a test database
export TX_DB="./test-deps.db"
rm -f "$TX_DB" "$TX_DB-wal" "$TX_DB-shm"

echo "=== Dependency Chain Example ==="
echo ""

# Initialize
echo "1. Initializing tx..."
bun run ../apps/cli/src/cli.ts init --db "$TX_DB"

# Create tasks
echo ""
echo "2. Creating tasks..."
TASK_A=$(bun run ../apps/cli/src/cli.ts add "A: Foundation" --score 1000 --db "$TX_DB" --json | jq -r '.id')
TASK_B=$(bun run ../apps/cli/src/cli.ts add "B: Build on A" --score 800 --db "$TX_DB" --json | jq -r '.id')
TASK_C=$(bun run ../apps/cli/src/cli.ts add "C: Build on B" --score 600 --db "$TX_DB" --json | jq -r '.id')

echo "   Task A: $TASK_A"
echo "   Task B: $TASK_B"
echo "   Task C: $TASK_C"

# Create dependency chain: A → B → C
echo ""
echo "3. Creating dependencies (A → B → C)..."
bun run ../apps/cli/src/cli.ts block "$TASK_B" "$TASK_A" --db "$TX_DB" > /dev/null
bun run ../apps/cli/src/cli.ts block "$TASK_C" "$TASK_B" --db "$TX_DB" > /dev/null
echo "   A blocks B"
echo "   B blocks C"

# Check ready - should only show A
echo ""
echo "4. Checking ready tasks (expect only A)..."
READY=$(bun run ../apps/cli/src/cli.ts ready --db "$TX_DB" --json | jq -r '.[].id')
if [ "$READY" = "$TASK_A" ]; then
    echo "   ✓ Only A is ready (correct!)"
else
    echo "   ✗ Expected only A, got: $READY"
    exit 1
fi

# Complete A
echo ""
echo "5. Completing A..."
RESULT=$(bun run ../apps/cli/src/cli.ts done "$TASK_A" --db "$TX_DB" --json)
UNBLOCKED=$(echo "$RESULT" | jq -r '.nowReady[]' 2>/dev/null || echo "")
echo "   Completed A"
if [ "$UNBLOCKED" = "$TASK_B" ]; then
    echo "   ✓ B is now unblocked!"
else
    echo "   B should be unblocked"
fi

# Check ready - should show B
echo ""
echo "6. Checking ready tasks (expect only B)..."
READY=$(bun run ../apps/cli/src/cli.ts ready --db "$TX_DB" --json | jq -r '.[].id')
if [ "$READY" = "$TASK_B" ]; then
    echo "   ✓ Only B is ready (correct!)"
else
    echo "   ✗ Expected only B, got: $READY"
    exit 1
fi

# Complete B
echo ""
echo "7. Completing B..."
bun run ../apps/cli/src/cli.ts done "$TASK_B" --db "$TX_DB" > /dev/null
echo "   Completed B"

# Check ready - should show C
echo ""
echo "8. Checking ready tasks (expect only C)..."
READY=$(bun run ../apps/cli/src/cli.ts ready --db "$TX_DB" --json | jq -r '.[].id')
if [ "$READY" = "$TASK_C" ]; then
    echo "   ✓ Only C is ready (correct!)"
else
    echo "   ✗ Expected only C, got: $READY"
    exit 1
fi

# Complete C
echo ""
echo "9. Completing C..."
bun run ../apps/cli/src/cli.ts done "$TASK_C" --db "$TX_DB" > /dev/null
echo "   Completed C"

# Verify all done
echo ""
echo "10. Verifying all tasks complete..."
READY_COUNT=$(bun run ../apps/cli/src/cli.ts ready --db "$TX_DB" --json | jq '. | length')
DONE_COUNT=$(bun run ../apps/cli/src/cli.ts list --status done --db "$TX_DB" --json | jq '. | length')

if [ "$READY_COUNT" -eq 0 ] && [ "$DONE_COUNT" -eq 3 ]; then
    echo "    ✓ All tasks completed in correct order!"
else
    echo "    ✗ Ready: $READY_COUNT, Done: $DONE_COUNT"
    exit 1
fi

# Cleanup
echo ""
echo "11. Cleaning up..."
rm -f "$TX_DB" "$TX_DB-wal" "$TX_DB-shm"

echo ""
echo "=== Dependency Chain Complete ==="
