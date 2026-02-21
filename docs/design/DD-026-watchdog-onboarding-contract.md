# DD-026: Watchdog Onboarding Contract and Safe Defaults

## Overview

This document defines the canonical watchdog onboarding contract for `tx init`.

Implements: [PRD-026](../prd/PRD-026-watchdog-onboarding-contract.md)

This DD is the source of truth for downstream tasks:

- `tx-cefb13798912` (scaffold + launcher assets)
- `tx-70931038f401` (integration/script/Bash 3.2 tests)
- `tx-86a15490531f` (docs + rollout/rollback runbook)

## Design

### Contract IDs (Normative)

| ID | Contract |
|----|----------|
| WOC-001 | Watchdog onboarding is opt-in only and default-off |
| WOC-002 | Runtime `auto` never launches unsupported runtimes |
| WOC-003 | Explicit runtime selections fail clearly when unavailable |
| WOC-004 | Polling/idle thresholds and detached mode are configurable through a Bash 3.2-safe env surface |
| WOC-005 | Detached mode defaults to enabled for watchdog launcher flow |
| WOC-006 | Generated onboarding scripts must be Bash 3.2 compatible |
| WOC-007 | Scaffold is non-destructive (never overwrite existing files) |
| WOC-008 | Generated watchdog onboarding assets and service templates are deterministic |

### Onboarding Decision Contract (WOC-001)

Product decision is **GO** for watchdog onboarding, with explicit opt-in and default-off behavior.

`tx init` contract:

- No watchdog flag, no interactive opt-in: watchdog is not scaffolded and not enabled.
- Non-interactive opt-in: `tx init --watchdog`.
- Interactive opt-in: prompt appears with default `No`.

Normative prompt text (or semantically equivalent):

`Enable watchdog supervision for detached RALPH loops? (default: No)`

### Runtime Selection Contract (WOC-002, WOC-003)

`tx init --watchdog` supports:

`--watchdog-runtime <auto|codex|claude|both>` (default `auto`)

Runtime resolution:

1. Detect runtime availability via `command -v codex` and `command -v claude`.
2. Apply mode behavior:
   - `auto`: choose installed runtimes only; never schedule missing runtimes.
   - `codex`: require `codex` present, otherwise fail with actionable error.
   - `claude`: require `claude` present, otherwise fail with actionable error.
   - `both`: require both present, otherwise fail with actionable error listing missing runtime(s).
3. Missing runtime in `auto`:
   - If exactly one runtime is available, onboarding enables only that runtime.
   - If none are available, onboarding scaffolds files but leaves watchdog disabled with clear next-step guidance.

Normative examples:

- `codex` missing:
  - `Watchdog runtime 'codex' unavailable: codex CLI not found in PATH. Install codex or use --watchdog-runtime auto|claude.`
- `both` with missing `claude`:
  - `Watchdog runtime 'both' requires codex and claude; missing: claude.`

### Config Surface Contract (WOC-004)

Scaffolded config file: `.tx/watchdog.env`

Format constraints:

- Plain `KEY=VALUE` lines only
- No Bash arrays, associative maps, or command substitution
- Values parse cleanly in `/bin/bash` 3.2 via `source .tx/watchdog.env`

Required keys and defaults:

| Key | Default | Validation | Maps to |
|-----|---------|------------|---------|
| `WATCHDOG_ENABLED` | `0` unless user opted in and runtime selected; otherwise `1` | `0|1` | Launcher gating |
| `WATCHDOG_RUNTIME_MODE` | `auto` | `auto|codex|claude|both` | Runtime selection |
| `WATCHDOG_CODEX_ENABLED` | runtime-dependent | `0|1` | `--no-codex` inversion |
| `WATCHDOG_CLAUDE_ENABLED` | runtime-dependent | `0|1` | `--no-claude` inversion |
| `WATCHDOG_POLL_SECONDS` | `300` | integer `>=1` | `--interval` |
| `WATCHDOG_TRANSCRIPT_IDLE_SECONDS` | `300` | integer `>=60` | `--transcript-idle-seconds` |
| `WATCHDOG_HEARTBEAT_LAG_SECONDS` | `180` | integer `>=1` | `--heartbeat-lag-seconds` |
| `WATCHDOG_RUN_STALE_SECONDS` | `5400` | integer `>=60` | `--run-stale-seconds` |
| `WATCHDOG_IDLE_ROUNDS` | `300` | integer `>=1` | `--idle-rounds` |
| `WATCHDOG_DETACHED` | `1` | `0|1` | Launcher mode |

Optional advanced knobs (if scaffold chooses to expose):

- `WATCHDOG_ERROR_BURST_WINDOW_MINUTES` (default `20`)
- `WATCHDOG_ERROR_BURST_THRESHOLD` (default `4`)
- `WATCHDOG_RESTART_COOLDOWN_SECONDS` (default `900`)

### Detached Mode Contract (WOC-005)

Default launcher behavior is detached (`WATCHDOG_DETACHED=1`).

- Detached start uses:
  - `nohup /bin/bash "$PROJECT_DIR/scripts/ralph-watchdog.sh" ... > "$OUT" 2>&1 < /dev/null &`
- Foreground mode is explicitly opt-in by setting:
  - `WATCHDOG_DETACHED=0`
  - or CLI override flag (`--watchdog-foreground`) during onboarding

Safety requirements:

- PID file ownership check before duplicate start
- SIGHUP handling is ignore-by-default in detached mode
- Clear start/stop/status messages using deterministic `.tx/*.pid` paths

### Generated Asset Contract (WOC-007, WOC-008)

On watchdog onboarding opt-in, scaffold must provision (if missing):

1. `scripts/ralph-watchdog.sh`
2. `scripts/ralph-hourly-supervisor.sh`
3. `scripts/watchdog-launcher.sh`
4. `.tx/watchdog.env`
5. `ops/watchdog/com.tx.ralph-watchdog.plist`
6. `ops/watchdog/tx-ralph-watchdog.service`

Non-overwrite rules:

- Existing files are never overwritten.
- Skipped files are reported in scaffold output (`~ <path> (exists)`).
- New `.sh` files are executable (`chmod 755`).

### Bash 3.2 Compatibility Rules (WOC-006)

All generated onboarding/launcher scripts must avoid Bash 4+ features:

- No negative substring expansion (`${var:1:-1}`)
- No associative arrays (`declare -A`)
- No `|&`, `coproc`, or `&>>`
- Prefer portable forms already used in repo scripts (`sed`, standard arrays, `nohup`, `trap`)

Validation command in test plan:

`/bin/bash -n <script>`

## Implementation Plan

| Phase | Files | Changes |
|-------|-------|---------|
| 0 | `docs/prd/PRD-026-watchdog-onboarding-contract.md`, `docs/design/DD-026-watchdog-onboarding-contract.md` | Publish canonical contract and defaults |
| 1 | `apps/cli/src/cli.ts`, `apps/cli/src/help.ts`, `apps/cli/src/commands/scaffold.ts`, `apps/cli/src/templates/**` | Add `tx init --watchdog` path, runtime selection, launcher/config scaffolding, non-overwrite behavior |
| 2 | `test/integration/init-onboarding.test.ts`, `test/integration/scaffold.test.ts`, `test/integration/ralph-watchdog-script.test.ts`, `test/integration/bash32-compat.test.ts` | Add integration and script-level contract coverage |
| 3 | `README.md`, `docs/examples/**`, `apps/docs/content/docs/**` | Publish user-facing onboarding flow, launchd/systemd setup, troubleshooting, rollback |

## Testing Strategy

### Requirement Traceability Matrix

| Requirement | Test Type | Test Name | Assertions | File Path |
|-------------|-----------|-----------|------------|-----------|
| WOC-001 | Integration | `init_default_does_not_enable_watchdog` | `tx init` with no watchdog input creates no watchdog assets and prints no enabled message | `test/integration/init-onboarding-watchdog.test.ts` |
| WOC-001 | Integration | `init_watchdog_opt_in_flag_enables_path` | `tx init --watchdog` enters watchdog scaffold path | `test/integration/init-onboarding-watchdog.test.ts` |
| WOC-002 | Integration | `auto_runtime_selects_only_installed` | auto mode enables available runtime(s) only, never missing runtime | `test/integration/init-onboarding-watchdog.test.ts` |
| WOC-003 | Integration | `explicit_runtime_missing_fails` | `--watchdog-runtime codex|claude|both` fails with actionable error when unavailable | `test/integration/init-onboarding-watchdog.test.ts` |
| WOC-004 | Integration | `watchdog_env_defaults_written` | `.tx/watchdog.env` includes exact default keys/values | `test/integration/scaffold-watchdog-assets.test.ts` |
| WOC-005 | Integration | `launcher_detached_default` | launcher starts detached by default and writes pid/out files | `test/integration/ralph-watchdog-script.test.ts` |
| WOC-006 | Script/Compatibility | `watchdog_scripts_pass_bash_32_parse` | `/bin/bash -n` succeeds for all generated watchdog scripts | `test/integration/bash32-compat.test.ts` |
| WOC-007 | Integration | `watchdog_scaffold_non_overwrite` | existing files are preserved and reported as skipped | `test/integration/scaffold-watchdog-assets.test.ts` |
| WOC-008 | Integration | `watchdog_asset_set_is_deterministic` | exact expected files are generated on clean sandbox | `test/integration/scaffold-watchdog-assets.test.ts` |

### Unit Tests

- `apps/cli/src/commands/scaffold.ts`
  - runtime mode parsing helper (`auto|codex|claude|both`)
  - runtime availability resolver from mocked `PATH`
  - `.tx/watchdog.env` serialization and default interpolation
- `scripts/watchdog-launcher.sh` helper functions (if isolated in shell test harness)
  - env parsing
  - detached decision branch
  - pid/live-process checks

### Integration Tests

Use sandbox process tests for CLI/script behavior; where core services are touched directly, use `getSharedTestLayer()` and deterministic `fixtureId(name)` IDs.

Numbered scenarios (minimum contract set):

1. **Default-off path**
   - Setup: clean sandbox with `apps/`, `packages/`, `node_modules/` symlinked
   - Action: `tx init`
   - Assert: no watchdog assets; stdout indicates standard init completion only
2. **Non-interactive opt-in**
   - Setup: same sandbox
   - Action: `tx init --watchdog --watchdog-runtime auto`
   - Assert: watchdog assets created; `.tx/watchdog.env` created with defaults
3. **Auto runtime, only codex available**
   - Setup: PATH includes mock `codex`, no `claude`
   - Action: `tx init --watchdog --watchdog-runtime auto`
   - Assert: `WATCHDOG_CODEX_ENABLED=1`, `WATCHDOG_CLAUDE_ENABLED=0`
4. **Auto runtime, no runtimes available**
   - Setup: PATH excludes `codex` and `claude`
   - Action: `tx init --watchdog --watchdog-runtime auto`
   - Assert: command succeeds with warning; `WATCHDOG_ENABLED=0`
5. **Explicit missing runtime fails**
   - Setup: PATH excludes `codex`
   - Action: `tx init --watchdog --watchdog-runtime codex`
   - Assert: non-zero exit; actionable error text references missing `codex`
6. **Both runtime strictness**
   - Setup: PATH includes only `codex`
   - Action: `tx init --watchdog --watchdog-runtime both`
   - Assert: non-zero exit; error lists missing `claude`
7. **Non-overwrite scaffold**
   - Setup: pre-create `scripts/ralph-watchdog.sh` with sentinel text
   - Action: `tx init --watchdog`
   - Assert: sentinel unchanged; output contains skipped marker for existing file
8. **Detached launcher default**
   - Setup: generated assets, mock runtime entrypoint
   - Action: run `scripts/watchdog-launcher.sh start`
   - Assert: command returns immediately; watchdog pid file exists
9. **Foreground override**
   - Setup: `.tx/watchdog.env` has `WATCHDOG_DETACHED=0`
   - Action: run launcher `start`
   - Assert: process remains attached; no `nohup` out file expectation
10. **Service template determinism**
    - Setup: clean scaffold
    - Action: `tx init --watchdog`
    - Assert: launchd/systemd template files created at exact contract paths

### Edge Cases

- Invalid numeric values in onboarding flags (`0`, negative, non-numeric) reject with explicit parameter name.
- Unknown runtime mode rejects with accepted enum values.
- PATH collisions where `codex`/`claude` are files but not executable are treated as unavailable.
- Existing `.tx/watchdog.env` is not overwritten; scaffold reports skip.

### Failure Injection

- Simulate stale pid file pointing to unrelated process; launcher must replace stale lock safely.
- Simulate runtime executable missing after onboarding (deleted binary); launcher should log and exit without tight restart loops.
- Simulate malformed `.tx/watchdog.env`; launcher should fail fast with line/key hint.

### Performance

- `tx init --watchdog` additional overhead target: `< 500ms` in local sandbox (excluding filesystem cold-start variance).
- Launcher start command target: `< 2s` to return in detached mode.
- No busy-loop behavior when no runtimes are enabled (`sleep` cadence respected).

### File-Level Test Plan

- Create:
  - `test/integration/init-onboarding-watchdog.test.ts`
  - `test/integration/scaffold-watchdog-assets.test.ts`
  - `test/integration/ralph-watchdog-script.test.ts`
  - `test/integration/bash32-compat.test.ts`
- Update:
  - `test/integration/init-onboarding.test.ts`
  - `test/integration/scaffold.test.ts`

## Open Questions

- [ ] Should Windows (PowerShell + Task Scheduler) templates be part of this milestone or follow-up?
- [ ] Should `auto` runtime prefer `codex` over `claude` when both are available for single-runtime mode?
- [ ] Should watchdog launcher support `--dry-run` at onboarding time for CI validation of generated args?

## Migration

- Existing repositories remain unchanged until users explicitly run watchdog onboarding.
- Onboarding is additive and non-destructive:
  - create missing files
  - preserve user-modified existing files
- Rollback remains operationally simple:
  - disable service units
  - remove/ignore generated watchdog assets
  - continue manual `scripts/ralph.sh` loop

## References

- PRD: [PRD-026](../prd/PRD-026-watchdog-onboarding-contract.md)
- Related scripts: `scripts/ralph-watchdog.sh`, `scripts/ralph-hourly-supervisor.sh`, `scripts/ralph.sh`
- AGENTS doctrine references:
  - Rule 3 (integration testing bar)
  - Rule 9 (commit standards for downstream implementation work)
