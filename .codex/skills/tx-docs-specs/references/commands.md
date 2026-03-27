# tx Docs And Specs Command Reference

This file is generated from `apps/cli/src/help.ts`. Regenerate it with `tx skills generate`.

## tx decision

```text
tx decision - Manage decisions as first-class artifacts

Usage: tx decision <subcommand> [options]

Subcommands:
  add <content>       Add a decision manually
  list                List decisions (default if no subcommand)
  show <id>           Show decision details
  approve <id>        Approve a pending decision
  reject <id>         Reject a pending decision (--reason required)
  edit <id> <content> Edit a pending decision's content
  pending             Shorthand for list --status pending

Options (where applicable):
  --question <q>      Question this decision answers (add)
  --task <id>         Link to a task (add)
  --doc <id>          Link to a doc (add)
  --commit <sha>      Git commit (add)
  --reviewer <name>   Reviewer name (approve/reject/edit)
  --note <text>       Approval note (approve)
  --reason <text>     Rejection reason (reject, required)
  --status <s>        Filter by status (list)
  --source <s>        Filter by source: manual, diff, transcript, agent (list)
  --limit <n>         Maximum results (list)
  --json              Output as JSON
  --help              Show this help

Examples:
  tx decision add "Use WAL mode for SQLite" --question "Which journal mode?"
  tx decision list --status pending
  tx decision approve dec-abc123 --reviewer james --note "Good call"
  tx decision reject dec-abc123 --reviewer james --reason "Too complex"
  tx decision edit dec-abc123 "Use WAL mode with 64MB cache"
  tx decision pending
```

## tx decompose

```text
tx decompose - Create a task graph from a design spec

Usage: tx decompose <design-doc-ref> [options]

Resolves a design doc, runs the selected runtime against that spec, validates
the structured result, and materializes the plan as tx tasks plus dependencies.

Options:
  --parent, -p <task-id>   Reuse an existing task as the graph root
  --runtime <runtime>      Agent runtime: auto, claude, codex (default: auto)
  --model <name>           Optional model hint for the runtime
  --max-tasks <n>          Maximum generated tasks (default: 12)
  --root-title <text>      Override the generated root task title
  --score <n>              Override root task score when creating a root
  --dry-run                Validate and print the graph without writing tasks
  --json                   Output as JSON
  --help                   Show this help

Examples:
  tx decompose auth-flow-design
  tx decompose auth-flow-design --runtime claude --max-tasks 10
  tx decompose auth-flow-design --parent tx-abc123 --runtime codex
  tx decompose auth-flow-design --dry-run --json
```

## tx doc

```text
tx doc - Manage docs-as-primitives

Usage: tx doc [subcommand] [options]

Subcommands:
  add <kind> <name>         Create a new doc (overview, prd, design)
  edit <name>               Open doc in $EDITOR
  show <name>               Show doc details
  list                      List all docs
  rm <name>                 Remove latest mutable doc version
  lock <name>               Lock a doc version (immutable)
  version <name>            Create new version from locked doc
  link <from> <to>          Link two docs
  attach <task-id> <name>   Attach a doc to a task
  patch <design> <patch>    Create a design patch doc
  validate                  Check task-doc coverage + searchable index metadata
  drift <name>              Detect file-vs-DB drift for a doc
  lint-ears <name|path>     Validate PRD EARS requirements
  sync [name]               Re-sync doc hashes from disk

Run 'tx doc <subcommand> --help' for subcommand-specific help.
Running 'tx doc' with no subcommand defaults to 'tx doc list'.

Use 'tx spec lint' for comprehensive doc/spec checking (drift, EARS, coverage).

Examples:
  tx doc add prd auth-flow --title "Authentication Flow"
  tx doc show auth-flow --json
  tx doc list --kind design --status changing
  tx doc rm auth-flow
  tx doc lock auth-flow
  tx doc version auth-flow
  tx doc attach tx-abc123 auth-flow
```

## tx doc add

```text
tx doc add - Create a new doc

Usage: tx doc add <kind> <name> [--title <title>] [--json]

Creates a new doc with generated YAML template on disk and metadata in DB.
The generated frontmatter includes searchable index metadata:
  - summary   -> Description in generated specs/index.md
  - domain    -> included in Search Keywords in generated specs/index.md
  - tags      -> included in Search Keywords in generated specs/index.md

Replace generic placeholders with subsystem-specific language. 'tx spec lint'
and 'tx doc validate' will explain exactly how to fix missing search metadata.

Arguments:
  <kind>    Required. Doc kind: overview, prd, or design
  <name>    Required. Doc name (alphanumeric with dashes/dots)

Options:
  --title, -t <title>  Doc title (defaults to name)
  --json               Output as JSON
  --help               Show this help

Examples:
  tx doc add prd auth-flow --title "Authentication Flow"
  tx doc add design auth-impl -t "Auth Implementation"
  tx doc add overview system-overview
```

## tx doc attach

```text
tx doc attach - Attach a doc to a task

Usage: tx doc attach <task-id> <doc-name> [--type implements|references]

Creates a link between a task and a doc.

Arguments:
  <task-id>     Required. Task ID (e.g., tx-a1b2c3d4)
  <doc-name>    Required. Doc name

Options:
  --type <type>  Link type: implements (default) or references
  --json         Output as JSON
  --help         Show this help

Examples:
  tx doc attach tx-abc123 auth-flow
  tx doc attach tx-abc123 auth-flow --type references
```

## tx doc edit

```text
tx doc edit - Open doc YAML in editor

Usage: tx doc edit <name>

Opens the doc's YAML file in $EDITOR (defaults to vi).

Arguments:
  <name>    Required. Doc name

Examples:
  tx doc edit auth-flow
  EDITOR=code tx doc edit auth-flow
```

## tx doc link

```text
tx doc link - Link two docs

Usage: tx doc link <from-name> <to-name> [--type <link-type>]

Creates a directed link between two docs. Link type is auto-inferred
from doc kinds if not specified.

Arguments:
  <from-name>    Required. Source doc name
  <to-name>      Required. Target doc name

Options:
  --type <type>  Link type (overview_to_prd, overview_to_design, prd_to_design, design_patch)
  --json         Output as JSON
  --help         Show this help

Examples:
  tx doc link system-overview auth-prd
  tx doc link auth-prd auth-impl --type prd_to_design
```

## tx doc list

```text
tx doc list - List all docs

Usage: tx doc list [--kind <kind>] [--status <status>] [--json]

Lists all docs, optionally filtered by kind or status.

Options:
  --kind, -k <kind>      Filter by kind (overview, prd, design)
  --status, -s <status>  Filter by status (changing, locked)
  --json                 Output as JSON
  --help                 Show this help

Examples:
  tx doc list
  tx doc list --kind design
  tx doc list --status locked --json
```

## tx doc lock

```text
tx doc lock - Lock a doc version

Usage: tx doc lock <name> [--json]

Locks a doc, making it immutable. Also renders final Markdown.
Use 'tx doc version' to create a new editable version from a locked doc.

Arguments:
  <name>    Required. Doc name

Options:
  --json    Output as JSON
  --help    Show this help

Examples:
  tx doc lock auth-flow
  tx doc lock auth-flow --json
```

## tx doc patch

```text
tx doc patch - Create a design patch doc

Usage: tx doc patch <design-name> <patch-name> [--title <title>]

Creates a new design doc that patches an existing design doc.

Arguments:
  <design-name>  Required. Parent design doc name
  <patch-name>   Required. New patch doc name

Options:
  --title, -t <title>  Patch title (defaults to patch name)
  --json               Output as JSON
  --help               Show this help

Examples:
  tx doc patch auth-impl auth-impl-v2 --title "Auth v2 Migration"
```

## tx doc rm

```text
tx doc rm - Remove latest mutable doc version

Usage: tx doc rm <name> [--json]

Alias: 'tx doc remove <name>'

Removes the latest mutable doc version from the database and deletes its
markdown file from disk. Locked docs cannot be removed.

Arguments:
  <name>    Required. Doc name

Options:
  --json    Output as JSON
  --help    Show this help

Examples:
  tx doc rm auth-flow
  tx doc remove auth-flow --json
```

## tx doc rm

```text
tx doc rm - Remove latest mutable doc version

Usage: tx doc rm <name> [--json]

Removes the latest mutable doc version from the database and deletes its
markdown file from disk. Locked docs cannot be removed.

Arguments:
  <name>    Required. Doc name

Options:
  --json    Output as JSON
  --help    Show this help

Examples:
  tx doc rm auth-flow
  tx doc rm auth-flow --json
```

## tx doc show

```text
tx doc show - Show doc details

Usage: tx doc show <name> [--md] [--json]

Shows doc metadata. With --md, renders and displays Markdown content.

Arguments:
  <name>    Required. Doc name

Options:
  --md      Render and display Markdown content
  --json    Output as JSON
  --help    Show this help

Examples:
  tx doc show auth-flow
  tx doc show auth-flow --md
  tx doc show auth-flow --json
```

## tx doc sync

```text
tx doc sync - Re-read docs from disk and update DB hashes

Usage: tx doc sync [name] [--json]

Re-syncs doc hashes in the database from the current file content on disk.
Use this after editing spec files directly to clear drift warnings.

Arguments:
  [name]  Optional. Sync a single doc by name. Omit to sync all docs.

Options:
  --json               Output result as JSON
  --help               Show this help

Examples:
  tx doc sync                  # sync all docs
  tx doc sync auth-flow        # sync one doc
  tx doc sync --json
```

## tx doc validate

```text
tx doc validate - Validate doc/task coverage and index search metadata

Usage: tx doc validate [--json]

Checks:
  - Tasks linked to docs
  - Searchable index metadata used by generated specs/index.md
    - summary -> Description
    - domain + tags -> Search Keywords

Warnings explain the exact frontmatter field to edit and show an example fix.

Options:
  --json               Output result as JSON
  --help               Show this help

Examples:
  tx doc validate
  tx doc validate --json
```

## tx doc version

```text
tx doc version - Create new version from locked doc

Usage: tx doc version <name> [--json]

Creates a new editable version of a locked doc. The doc must be locked first.

Arguments:
  <name>    Required. Doc name (must be locked)

Options:
  --json    Output as JSON
  --help    Show this help

Examples:
  tx doc version auth-flow
```

## tx invariant is deprecated. Use 'tx spec' instead.

```text
tx invariant is deprecated. Use 'tx spec' instead.

Run 'tx spec --help' for full usage.
```

## tx md-export

```text
tx md-export - Export tasks to markdown file

Usage: tx md-export [options]

Materializes tasks into a markdown file for file-based agent loops.
Agents read the file directly instead of calling tx ready.

Options:
  --path, -p <path>      Output file path (default: .tx/tasks.md)
  --filter, -f <filter>  Task filter: ready (default), open (all non-done), all, or a status name
  --include-context      Include relevant learnings per task
  --include-done <n>     Include last N completed tasks (default: 5)
  --watch, -w            Re-export on changes (poll mode)
  --interval <seconds>   Poll interval for --watch (default: 5)
  --json                 Output result metadata as JSON
  --help                 Show this help

Examples:
  tx md-export                              # Export ready tasks to .tx/tasks.md
  tx md-export --path tasks.md              # Custom output path
  tx md-export --include-context            # Include learnings per task
  tx md-export --filter open                # Export all non-done tasks
  tx md-export --filter all                 # Export all tasks
  tx md-export --include-done 10            # Include last 10 completed tasks
  tx md-export --watch                      # Watch and re-export on changes
  tx md-export --watch --interval 10        # Poll every 10 seconds

File-based agent loop:
  while true; do
    tx md-export
    claude -p "Read .tx/tasks.md and complete the highest priority task. When done, run: tx done <id>"
  done
```

## tx spec

```text
tx spec - Docs-first spec-to-test traceability primitives

Usage: tx spec <subcommand> [options]

Subcommands:
  lint                         All-in-one check (drift, EARS, coverage, spec-test status)
  discover                     Refresh doc-derived invariants and discover test mappings
  health                       Repo rollup for closure, decisions, and drift
  fci                          Compute Feature Completion Index
  status                       Quick phase + blocker summary
  complete                     Record human sign-off (HARDEN -> COMPLETE)
  run <test-id>                Record pass/fail run result for mapped test id
  batch                        Import batch run results from stdin JSON
  link <inv-id> <file> [name]  Manually link invariant to test
  unlink <inv-id> <test-id>    Remove invariant/test link
  tests <inv-id>               List tests linked to an invariant
  gaps                         List uncovered invariants
  matrix                       Show full traceability matrix

Run 'tx spec <subcommand> --help' for subcommand-specific help.

Examples:
  tx spec lint
  tx spec lint --json
  tx spec discover
  tx spec health
  tx spec fci --doc auth-flow
  tx spec run test/core.test.ts::"ready returns unblocked" --passed
  vitest run --reporter=json | tx spec batch --from vitest
  tx spec complete --doc auth-flow --by james
```

## tx spec batch

```text
tx spec batch - Import test run results from stdin

Usage: tx spec batch [--from generic|vitest|pytest|go] [--json]

Input must be piped via stdin. Generic format:
  [{"testId":"file::name", "passed":true, "durationMs":12, "details":"..."}]

Examples:
  echo '[{"testId":"test/a.test.ts::works","passed":true}]' | tx spec batch
  vitest run --reporter=json | tx spec batch --from vitest
  pytest --json-report | tx spec batch --from pytest
  go test -json ./... | tx spec batch --from go
```

## tx spec complete

```text
tx spec complete - Record human completion sign-off

Usage: tx spec complete [--doc <name> | --sub <name>] --by <human> [--notes <text>] [--json]

Records sign-off only when phase is HARDEN (FCI must be 100).
Rejects requests while phase is BUILD.

Options:
  --doc <name>                 Scope by doc
  --sub, --subsystem <name>    Scope by subsystem
  --by <human>                 Required human identifier
  --notes <text>               Optional sign-off notes
  --json                       Output as JSON
```

## tx spec discover

```text
tx spec discover - Refresh doc-derived invariants and upsert test mappings

Usage: tx spec discover [--doc <name>] [--patterns <glob1,glob2,...>] [--json]

Refreshes derived invariants from docs first, then scans configured test
patterns for [INV-*], _INV_*, and @spec annotations. Also imports
.tx/spec-tests.yml manifest mappings.

Without `--doc`, refreshes all docs before scanning. With `--doc`,
refreshes and discovers for that doc scope.

Options:
  --doc <name>                 Sync/discover with doc focus
  --patterns, -p <csv>         Override pattern list for this run
  --json                       Output as JSON

Examples:
  tx spec discover
  tx spec discover --doc auth-flow
  tx spec discover --patterns "test/**/*.test.ts,spec/**/*.py" --json
```

## tx spec fci

```text
tx spec fci - Compute Feature Completion Index

Usage: tx spec fci [--doc <name>] [--sub <name>] [--json]

Returns:
  total, covered, uncovered, passing, failing, untested, fci, phase

Phase logic:
  BUILD    fci < 100
  HARDEN   fci = 100 and no sign-off
  COMPLETE fci = 100 and signed off

Options:
  --doc <name>                 Scope by doc
  --sub, --subsystem <name>    Scope by subsystem
  --json                       Output as JSON
```

## tx spec gaps

```text
tx spec gaps - List uncovered invariants (no linked tests)

Usage: tx spec gaps [--doc <name>] [--sub <name>] [--json]

Examples:
  tx spec gaps
  tx spec gaps --doc PRD-033-spec-test-traceability
  tx spec gaps --sub core
```

## tx spec health

```text
tx spec health - Repo-level spec-driven development rollup

Usage: tx spec health [--json]

Aggregates spec trace closure, decision status, and doc drift into a
single health view. Shows overall status: SYNCED, DRIFTING, or BROKEN.
This is an operations view for the repo, not part of the minimum day-1 loop.

Dimensions:
  Spec -> Test    Linked coverage across active invariants
  Spec State      Passing, failing, untested, uncovered invariants
  Doc Closure     COMPLETE vs HARDEN vs BUILD across docs with invariants
  Decisions       Pending and approved-but-unsynced decisions
  Doc Drift       Docs with YAML hash mismatches
  Doc hierarchy   Count of docs by tier (REQ, PRD, DD, SD)

Options:
  --json    Output as JSON
  --help    Show this help

Examples:
  tx spec health
  tx spec health --json
```

## tx spec link

```text
tx spec link - Manually link an invariant to a test

Usage: tx spec link <inv-id> <file> [name] [--framework <name>] [--json]

Creates or updates a manual mapping in spec_tests.

Examples:
  tx spec link INV-EARS-FL-001 test/integration/core.test.ts "ready detection returns unblocked tasks"
  tx spec link INV-EARS-FL-001 tests/test_ready.py test_ready_inv --framework pytest
```

## tx spec lint

```text
tx spec lint - All-in-one spec and doc checker

Usage: tx spec lint [--json]

Runs all doc and spec checks in a single pass:
  - Doc drift: hash mismatch between disk and DB
  - Task-doc coverage: tasks not linked to any doc
  - Index searchability: validates frontmatter used to build Description and
    Search Keywords in generated specs/index.md
  - EARS lint: validates PRD requirements syntax
  - Spec-test status: uncovered or failing invariants

Options:
  --json    Output as JSON
  --help    Show this help

Examples:
  tx spec lint
  tx spec lint --json
```

## tx spec matrix

```text
tx spec matrix - Full invariant-to-test traceability matrix

Usage: tx spec matrix [--doc <name>] [--sub <name>] [--json]

Examples:
  tx spec matrix
  tx spec matrix --doc PRD-033-spec-test-traceability --json
```

## tx spec run

```text
tx spec run - Record a pass/fail run result for a canonical test ID

Usage: tx spec run <test-id> --passed|--failed [--duration <ms>] [--details <text>] [--json]

Exactly one of --passed or --failed must be provided.

Examples:
  tx spec run test/integration/core.test.ts::ready detection returns unblocked tasks --passed
  tx spec run tests/test_ready.py::test_ready_inv --failed --details "assertion failed"
```

## tx spec status

```text
tx spec status - Explain scope closure state

Usage: tx spec status [--doc <name>] [--sub <name>] [--json]

Returns:
  phase, fci, total, covered, uncovered, passing, failing, untested,
  signedOff, blockers

Examples:
  tx spec status
  tx spec status --doc auth-flow
  tx spec status --json
```

## tx spec tests

```text
tx spec tests - List tests linked to an invariant

Usage: tx spec tests <inv-id> [--json]

Examples:
  tx spec tests INV-EARS-FL-001
  tx spec tests INV-EARS-FL-001 --json
```

## tx spec unlink

```text
tx spec unlink - Remove an invariant/test mapping

Usage: tx spec unlink <inv-id> <test-id> [--json]

Examples:
  tx spec unlink INV-EARS-FL-001 test/integration/core.test.ts::ready detection returns unblocked tasks
```

## tx triangle is a deprecated alias for 'tx spec health'.

```text
tx triangle is a deprecated alias for 'tx spec health'.

Run 'tx spec health --help' for full usage.
```
