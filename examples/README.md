# tx Examples - Runnable Scripts

This directory contains runnable example scripts demonstrating common tx workflows.

## Prerequisites

```bash
# Build the project first
bun install
bun run build

# Initialize tx in test directory
cd examples
tx init
```

## Examples

| Script | Description |
|--------|-------------|
| `simple-loop.sh` | Single worker processing tasks |
| `parallel-workers.sh` | Multiple workers in parallel |
| `dependency-chain.sh` | Tasks with blocking dependencies |
| `sync-roundtrip.sh` | Export and import workflow |

## Running Examples

```bash
# Run any example
./simple-loop.sh

# Or with bash explicitly
bash simple-loop.sh
```

## Philosophy

**If a flow works 100 times automatically, it will work for users.**

These scripts are designed to be run repeatedly. Each run should:
1. Start fresh (clean state)
2. Execute the workflow
3. Verify expected outcomes
4. Clean up

## Creating Your Own Examples

1. Create a new shell script
2. Add `#!/bin/bash` and `set -e`
3. Initialize a fresh test database
4. Run your workflow
5. Assert expected outcomes
6. Clean up temporary files
