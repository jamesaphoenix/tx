---
name: spec-doc
description: Author any spec type configured in this project, including custom types defined in .tx/config.toml (for example `rfc`, `postmortem`, `charter`). Use when the requested doc kind is not one of the built-in prd/design/overview skills, when you need to see which spec types this project defines, or when the project has customized the required sections of a built-in type. Scaffolds via `tx doc add`, fills each configured section, and verifies with `tx spec lint`.
argument-hint: <spec-type> <name>
---

# Author a Configured Spec Type

tx spec structure is **project-configurable**. Required sections, their
descriptions, the lint prompt shown when one is missing, the subdirectory, and
even the set of spec types themselves all come from `[spec.types.*]` in
`.tx/config.toml`. This skill authors any of them.

Use the dedicated `/prd`, `/design-doc`, and `/overview-spec` skills when writing
those specific types; they carry extra domain guidance. Use this skill for
custom types, or when you need to discover what a project defines.

## Step 0 - Discover the configured types

```bash
tx spec types            # human-readable
tx spec types --json     # machine-readable; authoritative
```

`tx spec types --json` is the live contract. It reports, per type: `name`,
`builtin`, `customized`, `severity`, `subdir`, `template`, and for each section
its `heading`, `description`, and the exact `message` lint emits when missing.

If the type you were asked for is not listed, it is not defined. Either pick a
listed type or tell the user to add a `[spec.types.<name>]` section to
`.tx/config.toml`. Do not invent one.

## This Project's Spec Types

<!-- tx:spec-structure:start -->
<!-- tx:spec-structure:end -->

## Step 1 - Preview the template

```bash
tx doc template <spec-type> --name <name> --title "<Title>"
```

Prints the exact scaffold without writing anything. Use it to confirm the
structure before creating the doc.

## Step 2 - Scaffold

```bash
tx doc add <spec-type> <name> --title "<Human-Readable Title>"
```

The scaffold already contains every configured section, each with its
description as placeholder text. If the doc already exists, edit it in place;
never `tx doc rm` + `tx doc add`, which overwrites content.

## Step 3 - Fill every section

Replace each placeholder with real content, guided by that section's
description. Keep the headings exactly as configured: matching is
case-insensitive and heading-level agnostic (`#` through `######`), but the text
must match.

### Fixed rules that config cannot change

These are enforced by tx itself and apply to every spec type:

- **Frontmatter contract**: `kind: spec`, `spec_type`, `name` (kebab-case),
  `title`, `status`, `version`, `owners` (non-empty), `summary`, `domain`,
  `tags`, `depends_on`, `supersedes`, `implements`, `last_reviewed_at`
  (`YYYY-MM-DD`). `doc_id` is managed by tx; never edit it.
- **Embedded yaml blocks** keep fixed schemas wherever you put them:
  - `ears_requirements:` requires `id` matching `REQ-*`, `kind`
    (`ubiquitous|event-driven|state-driven|unwanted|optional|complex`),
    `statement`, `priority` (`must|should|may`). Clause required per kind:
    `event-driven` -> `when`, `state-driven` -> `while`, `unwanted` -> `if`,
    `optional` -> `where`, `complex` ->  at least one of those.
  - `invariants:` requires `id` matching `INV-*`, `statement`, `severity`
    (`low|medium|high|critical`), `verified_by` (at least one test path).
  - `acceptance_criteria:` requires `id` matching `AC-*`, `statement`.
  - `verification:` requires `requirement_id` (a `REQ-*` id), `test_type`
    (`unit|integration|e2e|property|manual`), `target`.
  - `interfaces:` requires `name`, `type` (`http|queue|event|rpc|cron`), `semantics`.
  - `failure_modes:` requires `condition`, `impact`, `handling`.

Blocks are located by fenced ` ```yaml ` + top-level key **anywhere in the
body**, not by which heading they sit under. That is why renaming or removing a
heading never breaks `tx spec discover` or FCI scoring. But a spec type whose
sections no longer prompt for invariants tends to stop getting them written, so
keep a section for any block the project relies on.

## Step 4 - Sync and verify

```bash
tx doc sync <name>
tx spec lint
```

`tx spec lint` reports missing sections under **Required Sections** using each
section's configured prompt, at the severity configured for that type
(`error` fails the lint, `warn` reports without failing, `off` is silent).
A missing section never blocks `tx doc add`, `tx doc sync`, or drift detection:
it is lint-only.

If the doc declares invariants, also run:

```bash
tx spec discover --doc <name>
```

## Notes

- Spec structure is rendered into this skill at `tx skills sync` time. After
  editing `[spec.types.*]` in `.tx/config.toml`, re-run `tx skills sync` to
  refresh it, or just call `tx spec types --json` for the current definition.
- A type may set `template = "<path>"` to use a project-owned markdown template;
  `{name}`, `{title}`, `{date}`, and `{spec_type}` are substituted.
