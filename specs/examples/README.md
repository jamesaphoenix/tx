# tx Examples

This directory contains documented examples of common tx workflows.

## Golden Path Workflows

These are the battle-tested workflows that have been validated through integration testing.
Each example shows a complete workflow from start to finish.

### Quick Reference

| Example | Description | File |
|---------|-------------|------|
| Task Lifecycle | Create → Ready → Done | [task-lifecycle.md](./task-lifecycle.md) |
| Dependency Chain | Block → Unblock → Ready | [dependency-chain.md](./dependency-chain.md) |
| Worker Claims | Claim → Work → Release | [worker-claims.md](./worker-claims.md) |
| Sync Round-Trip | Export → Import → Verify | [sync-roundtrip.md](./sync-roundtrip.md) |
| Parallel Workers | Multi-worker coordination | [parallel-workers.md](./parallel-workers.md) |

## Philosophy

**If a flow works 100 times automatically, it will work for users.**

Trust comes from battle-tested paths, not aspirational docs.
Every example here has corresponding integration tests in `test/golden-paths/`.
