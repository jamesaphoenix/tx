#!/bin/bash
# .claude/hooks/post-lint-check.sh
# Lint enforcement with few-shot examples for TypeScript files
# Hook: PostToolUse (Write|Edit)

set -e

# Get project directory from environment or use current directory
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# Read input from stdin
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Debug logging (disabled by default)
# echo "DEBUG: TOOL_NAME=$TOOL_NAME, FILE_PATH=$FILE_PATH" >&2

# Exit early if no file path
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only process TypeScript files in src/
if ! echo "$FILE_PATH" | grep -qE '^.*src/.*\.ts$'; then
  exit 0
fi

# Make path relative to project directory if absolute
if [[ "$FILE_PATH" = /* ]]; then
  REL_PATH=$(realpath --relative-to="$PROJECT_DIR" "$FILE_PATH" 2>/dev/null || echo "$FILE_PATH")
else
  REL_PATH="$FILE_PATH"
fi

# Skip if file doesn't exist
if [ ! -f "$PROJECT_DIR/$REL_PATH" ] && [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

# Determine which path to lint
if [ -f "$PROJECT_DIR/$REL_PATH" ]; then
  LINT_PATH="$REL_PATH"
else
  LINT_PATH="$FILE_PATH"
fi

# Run ESLint and capture output
cd "$PROJECT_DIR"
LINT_OUTPUT=$(npx eslint --format=json "$LINT_PATH" 2>/dev/null || true)

# Parse ESLint results
if [ -z "$LINT_OUTPUT" ]; then
  exit 0
fi

# Check for errors
ERROR_COUNT=$(echo "$LINT_OUTPUT" | jq '.[0].errorCount // 0')
WARNING_COUNT=$(echo "$LINT_OUTPUT" | jq '.[0].warningCount // 0')

if [ "$ERROR_COUNT" -eq 0 ] && [ "$WARNING_COUNT" -eq 0 ]; then
  exit 0
fi

# Extract messages
MESSAGES=$(echo "$LINT_OUTPUT" | jq -r '
  .[0].messages[] |
  "[\(.severity | if . == 2 then "ERROR" else "WARNING" end)] Line \(.line): \(.message) (\(.ruleId // "unknown"))"
' 2>/dev/null || true)

if [ -z "$MESSAGES" ]; then
  exit 0
fi

# Detect if it's a missing tests issue
MISSING_TESTS=$(echo "$LINT_OUTPUT" | jq -r '
  .[0].messages[] |
  select(.ruleId == "tx/require-integration-tests") |
  .message
' 2>/dev/null || true)

# Build the context with few-shot examples
CONTEXT=""

if [ -n "$MISSING_TESTS" ]; then
  # Extract component name from the message
  COMPONENT=$(echo "$MISSING_TESTS" | grep -oE 'for [^.]+' | head -1 | sed 's/for //')

  # Determine if it's a service, repo, CLI, or MCP file
  if echo "$REL_PATH" | grep -qE 'services/'; then
    # Service file - provide service test example
    SERVICE_NAME=$(basename "$REL_PATH" .ts | sed 's/-service//' | sed 's/-/_/g')
    # Convert kebab-case to PascalCase (e.g., task-service -> TaskService)
    SERVICE_CLASS=$(basename "$REL_PATH" .ts | awk -F'-' '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)} 1' OFS='')
    CONTEXT="## Lint Issue: Missing Integration Tests

$MISSING_TESTS

### Fix: Create test/integration/${SERVICE_NAME}.test.ts

\`\`\`typescript
import { describe, it, expect, beforeEach } from \"vitest\"
import { Effect, Layer } from \"effect\"
import { createTestDb, seedFixtures, FIXTURES } from \"../fixtures.js\"
import { SqliteClient } from \"../../src/db.js\"
import { ${SERVICE_CLASS}Live, ${SERVICE_CLASS} } from \"../../src/services/${SERVICE_NAME}-service.js\"
import type Database from \"better-sqlite3\"

function makeTestLayer(db: InstanceType<typeof Database>) {
  const infra = Layer.succeed(SqliteClient, db as any)
  // Add necessary repo layers here
  return ${SERVICE_CLASS}Live.pipe(Layer.provide(infra))
}

describe(\"${SERVICE_CLASS}\", () => {
  let db: InstanceType<typeof Database>
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it(\"performs expected operation\", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ${SERVICE_CLASS}
        // Call service method here
        return yield* svc.someMethod()
      }).pipe(Effect.provide(layer))
    )

    expect(result).toBeDefined()
  })
})
\`\`\`"

  elif echo "$REL_PATH" | grep -qE 'repo/'; then
    # Repository file - provide repo test example
    REPO_NAME=$(basename "$REL_PATH" .ts | sed 's/-repo//')
    # Convert kebab-case to PascalCase (e.g., task-repo -> TaskRepo)
    REPO_CLASS=$(basename "$REL_PATH" .ts | awk -F'-' '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)} 1' OFS='')
    CONTEXT="## Lint Issue: Missing Integration Tests

$MISSING_TESTS

### Fix: Add tests to test/integration/core.test.ts or create new file

\`\`\`typescript
import { describe, it, expect, beforeEach } from \"vitest\"
import { Effect, Layer } from \"effect\"
import { createTestDb, seedFixtures, FIXTURES } from \"../fixtures.js\"
import { SqliteClient } from \"../../src/db.js\"
import { ${REPO_CLASS}Live, ${REPO_CLASS} } from \"../../src/repo/${REPO_NAME}-repo.js\"
import type Database from \"better-sqlite3\"

describe(\"${REPO_CLASS}\", () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
  })

  it(\"queries data correctly\", async () => {
    const infra = Layer.succeed(SqliteClient, db as any)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* ${REPO_CLASS}
        return yield* repo.findById(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(${REPO_CLASS}Live.pipe(Layer.provide(infra))))
    )

    expect(result).toBeDefined()
    expect(result.id).toBe(FIXTURES.TASK_JWT)
  })
})
\`\`\`"

  elif echo "$REL_PATH" | grep -qE 'cli'; then
    # CLI file - provide CLI test example
    CONTEXT="## Lint Issue: Missing CLI Integration Tests

$MISSING_TESTS

### Fix: Add tests to test/integration/cli-*.test.ts

\`\`\`typescript
import { describe, it, expect, beforeEach, afterEach } from \"vitest\"
import { execSync } from \"child_process\"
import fs from \"fs\"
import path from \"path\"

describe(\"CLI: tx <command>\", () => {
  const testDir = path.join(process.cwd(), \".test-cli-temp\")

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true })
    process.chdir(testDir)
    execSync(\"npx tsx ../src/cli.ts init\", { encoding: \"utf-8\" })
  })

  afterEach(() => {
    process.chdir(path.dirname(testDir))
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  it(\"tx <command> produces expected output\", () => {
    const result = execSync(\"npx tsx ../src/cli.ts <command> --json\", {
      encoding: \"utf-8\",
      env: { ...process.env, NO_COLOR: \"1\" }
    })

    const output = JSON.parse(result)
    expect(output).toHaveProperty(\"success\", true)
  })
})
\`\`\`"

  elif echo "$REL_PATH" | grep -qE 'mcp/'; then
    # MCP file - provide MCP test example
    CONTEXT="## Lint Issue: Missing MCP Integration Tests

$MISSING_TESTS

### Fix: Add tests to test/integration/mcp.test.ts

\`\`\`typescript
import { describe, it, expect, beforeEach } from \"vitest\"
import { Effect, Layer } from \"effect\"
import { createTestDb, seedFixtures, FIXTURES } from \"../fixtures.js\"
import { handleToolCall } from \"../../src/mcp/handlers.js\"
// ... import necessary layers

describe(\"MCP Tool: <tool_name>\", () => {
  let db: InstanceType<typeof Database>
  let layer: AppLayer

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    layer = makeAppLayer(db)
  })

  it(\"<tool_name> returns expected response\", async () => {
    const result = await Effect.runPromise(
      handleToolCall({
        name: \"<tool_name>\",
        arguments: { /* tool arguments */ }
      }).pipe(Effect.provide(layer))
    )

    expect(result.content[0].type).toBe(\"text\")
    expect(result.isError).toBeFalsy()
  })
})
\`\`\`"
  fi

else
  # Regular lint errors - provide general context
  CONTEXT="## Lint Errors Found

File: \`$REL_PATH\`

$MESSAGES

### Common Fixes

**@typescript-eslint/no-unused-vars**: Remove unused variables or prefix with underscore (_)
\`\`\`typescript
// Before
const unused = getValue()

// After (if intentionally unused)
const _unused = getValue()
// Or remove it entirely
\`\`\`

**@typescript-eslint/no-explicit-any**: Add proper type annotation
\`\`\`typescript
// Before
function process(data: any) { ... }

// After
function process(data: unknown) { ... }
// Or use specific type
function process(data: MyType) { ... }
\`\`\`"
fi

# Escape for JSON output
ESCAPED_CONTEXT=$(echo "$CONTEXT" | jq -Rs '.')

# Output hook response
cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": ${ESCAPED_CONTEXT}
  }
}
EOF
