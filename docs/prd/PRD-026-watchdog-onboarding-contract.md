# PRD-026: Watchdog Onboarding Contract and Safe Defaults

## Problem

`tx` already has watchdog-related scripts (`scripts/ralph-watchdog.sh`, `scripts/ralph-hourly-supervisor.sh`), but onboarding is undefined:

- No explicit `tx init` contract for enabling watchdog supervision
- No default-safe runtime selection policy for Codex/Claude availability
- No canonical config surface for polling/idle/detached behavior
- No shared contract that scaffold, docs, and test work can implement against

This creates implementation drift risk across follow-on tasks.

## Solution

Define a single onboarding contract for watchdog enablement that is:

- Explicit opt-in (default-off)
- Runtime-safe by default (`auto` detects supported runtimes and never launches unsupported ones)
- Configurable through a Bash 3.2-safe environment surface
- Explicit about detached-mode defaults and launcher semantics
- Normative for downstream scaffold/docs/test tasks

## Requirements

- [ ] Document product decision: watchdog onboarding is `GO`, but opt-in only (not default-enabled).
- [ ] Define `tx init` onboarding entrypoints:
  - Non-interactive flag: `--watchdog`
  - Interactive prompt with default = `No`
- [ ] Define runtime selection contract:
  - Runtime flag: `--watchdog-runtime <auto|codex|claude|both>`
  - `auto` selects installed runtimes only
  - Never auto-start unsupported runtimes
  - Explicit runtime selections fail clearly when unavailable
- [ ] Define canonical config surface for watchdog:
  - Polling interval
  - Transcript idle threshold
  - Heartbeat lag threshold
  - Run-stale threshold
  - Idle rounds
  - Detached mode default
- [ ] Define Bash 3.2 compatibility constraints for generated launcher/onboarding scripts.
- [ ] Define generated asset contract and non-overwrite behavior.
- [ ] Publish the final contract in docs for downstream tasks:
  - `tx-cefb13798912` (scaffold + launcher assets)
  - `tx-70931038f401` (integration/script/Bash 3.2 tests)
  - `tx-86a15490531f` (docs + rollout/rollback runbook)

## Acceptance Criteria

1. A canonical watchdog onboarding contract exists in docs and is referenced by an implementation DD.
2. Contract states watchdog onboarding is explicit opt-in and default-off for `tx init`.
3. Contract defines runtime selection behavior that avoids launching unsupported runtimes by default.
4. Contract defines concrete defaults and config keys for polling/idle thresholds and detached mode.
5. Contract defines Bash 3.2 script constraints for generated onboarding assets.
6. Contract defines generated files and non-overwrite semantics for scaffold behavior.
7. Contract includes testable assertions that downstream integration/script tests can implement directly.

## Out of Scope

- Implementing watchdog onboarding code in `tx init`
- Writing/adjusting watchdog templates and launcher scripts
- Publishing user-facing rollout docs/runbooks
- Adding CI test jobs beyond the contract definition

## References

- Implements via: [DD-026](../design/DD-026-watchdog-onboarding-contract.md)
- Parent decision task: `tx-71082c13dff3`
