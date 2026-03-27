---
kind: spec
spec_type: design
name: DD-035-generated-cli-skills
title: "DD-035: Generated CLI Skills Design"
status: draft
version: 1
owners:
  - core
summary: Generate target-specific onboarding skill bundles from the canonical tx command/help registry and make those bundles the default install path for Claude Code and Codex.
domain: onboarding
tags:
  - cli
  - skills
  - scaffolding
depends_on:
  - PRD-035-generated-cli-skills
supersedes: []
implements: PRD-035-generated-cli-skills
last_reviewed_at: 2026-03-17
---

# Summary

This design replaces static onboarding templates with generated skill bundles.
The generator consumes the same canonical command/help registry that powers
`tx help`, groups commands into a curated set of concise skills, renders
target-specific wrappers for Claude Code and Codex, and emits installable bundle
directories plus downloadable archives.

Implements: [PRD-035](../prd/PRD-035-generated-cli-skills.md)

# Architecture

## Canonical Source

The canonical source is not shelling out to `tx help` and scraping terminal
output. That would be fragile and formatting-dependent.

Instead:

1. Replace the current string-first help implementation in
   `apps/cli/src/help.ts` with a typed command documentation registry.
2. Continue rendering `HELP_TEXT` and `commandHelp` from that registry.
3. Feed the same registry into a new skills generator.

This keeps "CLI help" and "generated skills" as two projections of the same
content source.

## Bundle Composition

The generator should not create one giant skill or one skill per subcommand.
Both extremes are poor.

Use a curated grouping manifest such as:

- `tx-core-loop`
- `tx-dependencies-hierarchy`
- `tx-docs-specs`
- `tx-memory-context`
- `tx-messaging-coordination`
- `tx-sync-diagnostics`
- `tx-autonomy-guards`
- `tx-cycle-scan`

Each group defines:

- included command keys
- target availability (`claude`, `codex`, or both)
- trigger phrases and short descriptions per target
- optional custom intro/outro guidance
- explicit exclusions when a command should not become a user-facing skill

## Render Pipeline

1. Load typed command docs.
2. Validate that every supported command group is mapped or explicitly excluded.
3. Materialize a normalized intermediate shape:
   - skill id
   - target
   - title
   - description
   - trigger hints
   - included command docs
   - examples
   - optional compatibility shim text
4. Render bundle files:
   - `SKILL.md`
   - `agents/openai.yaml` where the target expects skill-list metadata
   - `manifest.json` at bundle root
5. Optionally archive each target bundle as `zip`.

## Install Path

`tx init --claude` and `tx init --codex` should install generated skills by
default.

Default outputs:

```text
.claude/skills/<skill-id>/SKILL.md
.claude/skills/<skill-id>/agents/openai.yaml
.codex/skills/<skill-id>/SKILL.md
.codex/skills/<skill-id>/agents/openai.yaml
```

Compatibility outputs are opt-in only:

```text
CLAUDE.md
AGENTS.md
```

Those compatibility files, if generated, should be short bootstrap documents
that point users to the installed skills rather than attempting to duplicate the
full help corpus.

## Release Packaging

The release pipeline should publish:

- `tx-skills-claude.zip`
- `tx-skills-codex.zip`
- `tx-skills-manifest.json`

The manifest records:

- tx version
- target
- skill ids
- source command keys
- checksums
- generation timestamp

# Interfaces

```yaml
interfaces:
  - name: tx_skills_generate
    type: cli
    command: tx skills generate --target <claude|codex|all> [--output-dir <dir>] [--archive <none|zip>]
    semantics: generate deterministic onboarding skill bundles from the canonical command/help registry
  - name: tx_init_claude
    type: cli
    command: tx init --claude
    semantics: install the generated Claude skill bundle into the project; legacy compatibility files are only emitted with an explicit compatibility flag
  - name: tx_init_codex
    type: cli
    command: tx init --codex
    semantics: install the generated Codex skill bundle into the project; Codex sub-agent profile scaffolding is no longer the default path
  - name: release_skill_artifacts
    type: build
    command: release workflow publishes zipped skill bundles and manifest metadata
    semantics: every released tx version exposes downloadable onboarding bundles for each supported target
```

# Data Model

No database changes are required.

Add typed file-backed generation metadata:

```ts
interface SkillGroupDefinition {
  id: string
  targets: Array<"claude" | "codex">
  commands: string[]
  excludes?: string[]
  displayName: Record<"claude" | "codex", string>
  shortDescription: Record<"claude" | "codex", string>
  triggerHints: Record<"claude" | "codex", string[]>
  customIntro?: string
  customOutro?: string
}

interface GeneratedSkillManifestEntry {
  id: string
  target: "claude" | "codex"
  sourceCommands: string[]
  checksum: string
}
```

Suggested code layout:

- `apps/cli/src/help-registry.ts`
- `apps/cli/src/skills/manifest.ts`
- `apps/cli/src/skills/generate.ts`
- `apps/cli/src/skills/render.ts`
- `apps/cli/src/skills/package.ts`
- `apps/cli/src/commands/skills.ts`

# Invariants

```yaml
invariants:
  - id: INV-SKILL-001
    statement: generated skill bundles are a pure function of the command/help registry, skill grouping manifest, and target renderers
    severity: high
    verified_by:
      - test/integration/skills-generate.test.ts
  - id: INV-SKILL-002
    statement: each supported help entry is mapped to exactly one generated skill or an explicit exclusion record
    severity: high
    verified_by:
      - test/unit/skill-manifest.test.ts
  - id: INV-SKILL-003
    statement: default Claude and Codex onboarding installs skills without requiring generated top-level `CLAUDE.md` or `AGENTS.md` files
    severity: high
    verified_by:
      - test/integration/init-skills-onboarding.test.ts
  - id: INV-SKILL-004
    statement: default Codex onboarding does not scaffold `.codex/agents` sub-agent profiles
    severity: high
    verified_by:
      - test/integration/init-skills-onboarding.test.ts
  - id: INV-SKILL-005
    statement: release packaging emits one archive per target and a manifest whose checksums match the installed content
    severity: medium
    verified_by:
      - test/integration/release-skill-artifacts.test.ts
```

# Failure Modes

```yaml
failure_modes:
  - condition: a command help entry is added or renamed without updating the grouping manifest
    impact: the generated bundle silently drops coverage for a command
    handling: fail generation and CI validation with the missing command keys
  - condition: a generated skill exceeds the configured size or section-count limits
    impact: the resulting skill becomes monolithic and expensive to load
    handling: fail generation and require the manifest to split the command group into smaller skills
  - condition: target-specific metadata such as `agents/openai.yaml` is invalid
    impact: the target CLI cannot surface or trigger the skill correctly
    handling: validate generated metadata during generation and fail before packaging
  - condition: legacy files or directories already exist at install targets
    impact: onboarding may overwrite user-edited files
    handling: preserve existing files, report them as skipped, and install only missing generated assets
  - condition: release packaging publishes a zip that does not match the installed bundle contents
    impact: downloadable artifacts drift from scaffolded output
    handling: compare manifest checksums against packaged files in release verification tests
```

# Verification

```yaml
verification:
  - requirement_id: EARS-SKILL-001
    test_type: unit+integration
    target: test/unit/skill-render.test.ts; test/integration/skills-generate.test.ts
  - requirement_id: EARS-SKILL-002
    test_type: integration
    target: test/integration/skills-generate.test.ts
  - requirement_id: EARS-SKILL-003
    test_type: integration
    target: test/integration/init-skills-onboarding.test.ts
  - requirement_id: EARS-SKILL-004
    test_type: integration
    target: test/integration/init-skills-onboarding.test.ts
  - requirement_id: EARS-SKILL-005
    test_type: integration
    target: test/integration/release-skill-artifacts.test.ts
  - requirement_id: EARS-SKILL-006
    test_type: unit+integration
    target: test/unit/skill-manifest.test.ts; test/integration/skills-generate.test.ts
  - requirement_id: EARS-SKILL-007
    test_type: unit+integration
    target: test/unit/skill-render.test.ts; test/integration/skills-generate.test.ts
  - requirement_id: EARS-SKILL-008
    test_type: integration
    target: test/integration/skills-generate.test.ts
```

# Testing Strategy

## Requirement Traceability

| Requirement | Test Type | Test Name | Assertions | File Path |
|-------------|-----------|-----------|------------|-----------|
| EARS-SKILL-001 | unit+integration | registry_drives_help_and_skills | help output and generated skill sections derive from the same command registry entries | test/unit/skill-render.test.ts, test/integration/skills-generate.test.ts |
| EARS-SKILL-002 | integration | generation_is_deterministic_per_target | repeated generation produces byte-identical skill files and manifest checksums | test/integration/skills-generate.test.ts |
| EARS-SKILL-003 | integration | init_claude_installs_skills_only | `tx init --claude` creates `.claude/skills/**` and omits `CLAUDE.md` by default | test/integration/init-skills-onboarding.test.ts |
| EARS-SKILL-003 | integration | init_codex_installs_skills_only | `tx init --codex` creates `.codex/skills/**` and omits `AGENTS.md` by default | test/integration/init-skills-onboarding.test.ts |
| EARS-SKILL-004 | integration | compatibility_mode_emits_shims | explicit compatibility flag emits short bootstrap `CLAUDE.md` / `AGENTS.md` files that reference installed skills | test/integration/init-skills-onboarding.test.ts |
| EARS-SKILL-005 | integration | release_artifacts_match_manifest | both zip artifacts exist and checksums match manifest entries | test/integration/release-skill-artifacts.test.ts |
| EARS-SKILL-006 | unit+integration | unmapped_command_fails_generation | missing command group coverage fails with actionable diagnostics | test/unit/skill-manifest.test.ts, test/integration/skills-generate.test.ts |
| EARS-SKILL-007 | unit+integration | target_wrappers_differ_without_content_drift | target-specific metadata differs while shared command sections remain aligned | test/unit/skill-render.test.ts, test/integration/skills-generate.test.ts |
| EARS-SKILL-008 | integration | oversized_skill_group_is_rejected | generator rejects a manifest group that would exceed size constraints | test/integration/skills-generate.test.ts |

## Unit Tests

- `test/unit/skill-manifest.test.ts`
  - Validate every supported command key is either assigned or explicitly excluded.
  - Validate duplicate command assignment across skill groups is rejected.
  - Validate target availability rules (`claude`, `codex`, `both`).
- `test/unit/skill-render.test.ts`
  - Validate shared command docs render into stable markdown sections.
  - Validate target-specific wrappers and `agents/openai.yaml` metadata.
  - Validate compatibility shim text stays short and references installed skills.

## Integration Tests

- Shared test DB usage is not central here, but CLI integration tests must still
  run through the real command surface and real filesystem writes.
- Update or extend existing scaffold coverage rather than replacing it outright.

Scenarios:

1. Setup: clean temp project. Action: run `tx skills generate --target claude`. Assert: expected Claude skill directories, manifest, and metadata files are written.
2. Setup: clean temp project. Action: run `tx skills generate --target codex`. Assert: expected Codex skill directories are written and `.codex/agents/**` is absent.
3. Setup: same inputs, two fresh temp dirs. Action: generate both targets twice. Assert: file lists, contents, and manifest checksums are identical.
4. Setup: command registry includes an unmapped command. Action: run generation. Assert: non-zero exit with missing command diagnostics.
5. Setup: manifest assigns the same command to two skills. Action: run generation. Assert: validation fails before file writes.
6. Setup: clean temp project. Action: run `tx init --claude`. Assert: generated skills install, `CLAUDE.md` is absent by default, and skipped-file behavior is reported when rerun.
7. Setup: clean temp project. Action: run `tx init --codex`. Assert: generated skills install, `.codex/skills/**` exists, `.codex/agents/**` is absent, and `AGENTS.md` is absent by default.
8. Setup: clean temp project with compatibility flag. Action: run `tx init --claude` or `--codex` in compatibility mode. Assert: short bootstrap shim is written and references installed skills rather than duplicating full help text.
9. Setup: generated bundle directory. Action: run packaging step. Assert: zip artifact contents match manifest checksums and expected file list.
10. Setup: manifest group deliberately oversized. Action: run generation. Assert: generator rejects the group with guidance to split it.

## Failure Injection

- Corrupt the generated `agents/openai.yaml` model input and assert metadata
  validation fails before output is published.
- Simulate partial pre-existing directories under `.claude/skills` and
  `.codex/skills` and assert scaffold/install preserves existing files.
- Simulate release packaging that omits one generated file and assert checksum
  verification fails.

## Performance

- Generation target: under 250ms for current command set in local runs.
- Packaging target: under 500ms per target zip in local runs.
- Avoid invoking external CLIs during generation; everything should run in
  process from typed registry data.

# Open Questions

- [ ] What exact Codex install path and metadata rules should tx target in released bundles: `.codex/skills/`, global skill install, or both?
- [ ] Should `tx init --claude` and `tx init --codex` switch to skills-only in one release, or dual-ship for one minor release first?
- [ ] Do we want downloadable archives only, or a simple hosted install command as well?

# Migration

1. Add the typed command/help registry and generated skill pipeline behind a new
   `tx skills generate` command.
2. Dual-ship generated bundles and current static templates for one migration
   window.
3. Flip `tx init --claude` and `tx init --codex` to skills-first defaults.
4. Keep compatibility shims opt-in for one further release window.
5. Remove default generation of `.codex/agents/**`, `AGENTS.md`, and
   `CLAUDE.md` once downstream docs and tests are updated.

# References

- Plan file: `~/.codex/plans/2026-03-17-generated-cli-skills.md`
- Current scaffold implementation: `apps/cli/src/commands/scaffold.ts`
- Current help source: `apps/cli/src/help.ts`
- AGENTS.md doctrine: docs-first process and Bash 3.2 compatibility guidance for generated scripts
