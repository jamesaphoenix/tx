#!/bin/bash
# Sync Round-Trip Example
#
# Demonstrates the sync workflow:
# 1. Create tasks in source database
# 2. Export to JSONL
# 3. Import into fresh target database
# 4. Verify data preservation
#
# Usage: ./sync-roundtrip.sh

set -e

# Change to examples directory
cd "$(dirname "$0")"

# Use test databases
SOURCE_DB="./test-sync-source.db"
TARGET_DB="./test-sync-target.db"
JSONL_FILE="./test-sync.jsonl"

# Cleanup any existing files
rm -f "$SOURCE_DB" "$SOURCE_DB-wal" "$SOURCE_DB-shm"
rm -f "$TARGET_DB" "$TARGET_DB-wal" "$TARGET_DB-shm"
rm -f "$JSONL_FILE"

echo "=== Sync Round-Trip Example ==="
echo ""

# Initialize source
echo "1. Creating source database..."
bun run ../apps/cli/src/cli.ts init --db "$SOURCE_DB"

# Create tasks with hierarchy and dependencies
echo ""
echo "2. Creating tasks with hierarchy..."
PARENT=$(bun run ../apps/cli/src/cli.ts add "Parent Task" --score 1000 --db "$SOURCE_DB" --json | jq -r '.id')
CHILD1=$(bun run ../apps/cli/src/cli.ts add "Child 1" --parent "$PARENT" --score 800 --db "$SOURCE_DB" --json | jq -r '.id')
CHILD2=$(bun run ../apps/cli/src/cli.ts add "Child 2" --parent "$PARENT" --score 600 --db "$SOURCE_DB" --json | jq -r '.id')

echo "   Parent: $PARENT"
echo "   Child1: $CHILD1"
echo "   Child2: $CHILD2"

# Add dependency
echo ""
echo "3. Creating dependency..."
bun run ../apps/cli/src/cli.ts block "$CHILD2" "$CHILD1" --db "$SOURCE_DB" > /dev/null
echo "   Child1 blocks Child2"

# Export
echo ""
echo "4. Exporting to JSONL..."
EXPORT_RESULT=$(bun run ../apps/cli/src/cli.ts sync export --path "$JSONL_FILE" --db "$SOURCE_DB" --json)
OP_COUNT=$(echo "$EXPORT_RESULT" | jq -r '.opCount')
echo "   Exported $OP_COUNT operations to $JSONL_FILE"

# Show JSONL content
echo ""
echo "5. JSONL content (first 3 lines):"
head -3 "$JSONL_FILE" | while read line; do
    echo "   $line" | head -c 80
    echo "..."
done

# Initialize target
echo ""
echo "6. Creating fresh target database..."
bun run ../apps/cli/src/cli.ts init --db "$TARGET_DB"

# Import
echo ""
echo "7. Importing into target..."
IMPORT_RESULT=$(bun run ../apps/cli/src/cli.ts sync import --path "$JSONL_FILE" --db "$TARGET_DB" --json)
IMPORTED=$(echo "$IMPORT_RESULT" | jq -r '.imported')
SKIPPED=$(echo "$IMPORT_RESULT" | jq -r '.skipped')
CONFLICTS=$(echo "$IMPORT_RESULT" | jq -r '.conflicts')
echo "   Imported: $IMPORTED, Skipped: $SKIPPED, Conflicts: $CONFLICTS"

# Verify preservation
echo ""
echo "8. Verifying data preservation..."

# Check task count
SOURCE_COUNT=$(bun run ../apps/cli/src/cli.ts list --db "$SOURCE_DB" --json | jq '. | length')
TARGET_COUNT=$(bun run ../apps/cli/src/cli.ts list --db "$TARGET_DB" --json | jq '. | length')
if [ "$SOURCE_COUNT" -eq "$TARGET_COUNT" ]; then
    echo "   ✓ Task count matches: $TARGET_COUNT"
else
    echo "   ✗ Task count mismatch: source=$SOURCE_COUNT, target=$TARGET_COUNT"
    exit 1
fi

# Check hierarchy preserved
TARGET_PARENT=$(bun run ../apps/cli/src/cli.ts show "$PARENT" --db "$TARGET_DB" --json | jq -r '.children | length')
if [ "$TARGET_PARENT" -eq 2 ]; then
    echo "   ✓ Hierarchy preserved: parent has 2 children"
else
    echo "   ✗ Hierarchy not preserved"
    exit 1
fi

# Check dependency preserved
TARGET_BLOCKED=$(bun run ../apps/cli/src/cli.ts show "$CHILD2" --db "$TARGET_DB" --json | jq -r '.blockedBy | length')
if [ "$TARGET_BLOCKED" -eq 1 ]; then
    echo "   ✓ Dependency preserved: Child2 blocked by 1 task"
else
    echo "   ✗ Dependency not preserved"
    exit 1
fi

# Check ready state
TARGET_READY=$(bun run ../apps/cli/src/cli.ts show "$CHILD2" --db "$TARGET_DB" --json | jq -r '.isReady')
if [ "$TARGET_READY" = "false" ]; then
    echo "   ✓ Ready state correct: Child2 is not ready (blocked)"
else
    echo "   ✗ Ready state incorrect"
    exit 1
fi

# Cleanup
echo ""
echo "9. Cleaning up..."
rm -f "$SOURCE_DB" "$SOURCE_DB-wal" "$SOURCE_DB-shm"
rm -f "$TARGET_DB" "$TARGET_DB-wal" "$TARGET_DB-shm"
rm -f "$JSONL_FILE"

echo ""
echo "=== Sync Round-Trip Complete ==="
echo ""
echo "Summary:"
echo "  - Tasks, hierarchy, and dependencies all preserved"
echo "  - TaskWithDeps info (blockedBy, isReady) correct after import"
echo "  - Round-trip safe!"
