# tx Memory And Context Command Reference

This file is generated from `apps/cli/src/help.ts`. Regenerate it with `tx skills generate`.

## tx memory

```text
tx memory - Filesystem-backed memory with search over .md files

Usage: tx memory <subcommand> [options]

Subcommands:
  source add <dir>        Register a directory for indexing
  source rm <dir>         Unregister a directory
  source list             List registered directories
  add <title>             Create a new memory document (.md file)
  tag <id> <tags...>      Add tags to document frontmatter
  untag <id> <tags...>    Remove tags from frontmatter
  relate <id> <target>    Add to frontmatter.related
  set <id> <key> <value>  Set a key-value property
  unset <id> <key>        Remove a property
  props <id>              Show properties for a document
  index                   Index all registered sources
  search <query>          Search memory documents
  show <id>               Display a document
  links <id>              Show outgoing links
  backlinks <id>          Show incoming links
  list                    List all indexed documents
  link <src> <target>     Create explicit edge
  context <task-id>       Get task-relevant memory for prompt injection
  learn <path> <note>     Attach a learning to a file/glob pattern
  recall [path]           Query file-specific learnings by path

Run 'tx memory <subcommand> --help' for subcommand-specific help.

Examples:
  tx memory source add ./docs
  tx memory index
  tx memory search "authentication patterns"
  tx memory add "JWT Best Practices" --tags auth,security
  tx memory tag mem-a7f3bc12 production
  tx memory context tx-a1b2c3d4
  tx memory learn "src/db.ts" "Always use transactions"
  tx memory recall "src/db.ts"
```

## tx memory add

```text
tx memory add - Create a new memory document

Usage: tx memory add <title> [options]

Creates a .md file with optional frontmatter in the first registered source
directory (or --dir).

Arguments:
  <title>                  Document title (used for filename + H1 heading)

Options:
  --content, -c <text>     Initial body content
  --tags, -t <t1,t2>       Comma-separated frontmatter tags
  --prop <k=v,k2=v2>       Comma-separated key=value properties
  --dir, -d <path>         Target directory (default: first source)
  --json                   Output as JSON

Examples:
  tx memory add "Auth Patterns"
  tx memory add "JWT Guide" --content "Use RS256 for production" --tags auth,jwt
  tx memory add "Meeting Notes" --dir ~/vault/meetings
```

## tx memory backlinks

```text
tx memory backlinks - Show incoming links to a document

Usage: tx memory backlinks <id> [--json]

Lists all documents that link to this document.

Examples:
  tx memory backlinks mem-a7f3bc12
```

## tx memory context

```text
tx memory context - Get task-relevant memory for prompt injection

Usage: tx memory context <task-id> [options]

Retrieves context relevant to a specific task by searching all memory
documents (including learnings). Uses hybrid BM25 + recency scoring.

Arguments:
  <task-id>  Required. The task to get context for

Options:
  -n, --limit <n>      Maximum results (default: 10)
  --semantic            Enable vector similarity search
  --expand              Enable graph expansion via wikilinks
  --inject              Write to .tx/context.md for injection
  --json                Output as JSON

Examples:
  tx memory context tx-a1b2c3d4
  tx memory context tx-a1b2c3d4 --json
  tx memory context tx-a1b2c3d4 --inject
  tx memory context tx-a1b2c3d4 --expand --semantic
```

## tx memory index

```text
tx memory index - Index all registered source directories

Usage: tx memory index [options]

Scans all registered source directories for .md files and indexes them
into the SQLite database for search.

Options:
  --incremental, -i   Only re-index changed files (hash comparison)
  --status             Show index coverage report instead of indexing
  --json               Output as JSON

Examples:
  tx memory index                    # Full reindex
  tx memory index --incremental      # Only changed files
  tx memory index --status           # Show coverage report
```

## tx memory learn

```text
tx memory learn - Attach a learning to a file path or glob pattern

Usage: tx memory learn <path> <note> [options]

Stores a file-specific note that can be recalled when working on matching files.

Arguments:
  <path>    Required. File path or glob pattern (e.g., "src/db.ts", "*.test.ts")
  <note>    Required. The note/learning to attach

Options:
  --task <id>   Associate with a task
  --json        Output as JSON

Examples:
  tx memory learn "src/db.ts" "Always run migrations in a transaction"
  tx memory learn "src/services/*.ts" "Services must use Effect-TS patterns"
  tx memory learn "*.test.ts" "Use vitest describe/it syntax" --task tx-abc123
```

## tx memory link

```text
tx memory link - Create an explicit edge between documents

Usage: tx memory link <source-id> <target-ref>

Creates a programmatic link between two documents in the SQLite graph.
Unlike wikilinks (parsed from markdown), explicit links are stored
only in the database.

Examples:
  tx memory link mem-a7f3bc12 mem-b8e4cd56
  tx memory link mem-a7f3bc12 "JWT Auth Patterns"
```

## tx memory links

```text
tx memory links - Show outgoing links from a document

Usage: tx memory links <id> [--json]

Lists wikilinks, frontmatter.related, and explicit edges from the document.

Examples:
  tx memory links mem-a7f3bc12
```

## tx memory list

```text
tx memory list - List indexed memory documents

Usage: tx memory list [options]

Options:
  --source <dir>       Filter by source directory
  --tags, -t <t1,t2>   Filter by tags
  --json               Output as JSON

Examples:
  tx memory list
  tx memory list --source ./docs
  tx memory list --tags auth,security --json
```

## tx memory props

```text
tx memory props - Show properties for a document

Usage: tx memory props <id> [--json]

Lists all key-value properties on a memory document.

Examples:
  tx memory props mem-a7f3bc12
  tx memory props mem-a7f3bc12 --json
```

## tx memory recall

```text
tx memory recall - Query file learnings by path

Usage: tx memory recall [path] [options]

Retrieves file-specific learnings. If a path is provided, returns learnings
matching that path (using glob patterns). Without a path, returns all learnings.

Arguments:
  [path]    Optional. File path to match against stored patterns

Options:
  --json    Output as JSON

Examples:
  tx memory recall                           # List all file learnings
  tx memory recall "src/db.ts"               # Learnings for specific file
  tx memory recall "src/services/task.ts"    # Matches patterns like src/services/*.ts
  tx memory recall --json
```

## tx memory relate

```text
tx memory relate - Add a related reference to a document

Usage: tx memory relate <id> <target-ref>

Adds a reference to frontmatter.related and re-indexes.
Links are tracked in the graph for --expand search.

Examples:
  tx memory relate mem-a7f3bc12 "JWT Auth Patterns"
  tx memory relate mem-a7f3bc12 mem-b8e4cd56
```

## tx memory search

```text
tx memory search - Search memory documents

Usage: tx memory search <query> [options]

Searches indexed memory documents using BM25 text search by default.
Add --semantic for vector similarity and --expand for graph expansion.

Arguments:
  <query>                  Search query

Options:
  --semantic, -s           Enable vector similarity search
  --expand, -e             Enable graph expansion via wikilinks
  --tags, -t <t1,t2>       Filter by tags (comma-separated)
  --prop <key=value>       Filter by property (key=value or key for existence)
  --limit, -n <N>          Max results (default: 10)
  --min-score <N>          Minimum relevance score (default: 0)
  --json                   Output as JSON

Examples:
  tx memory search "authentication"
  tx memory search "auth" --semantic --expand
  tx memory search "auth" --tags security,jwt
  tx memory search "deploy" --prop status=reviewed --limit 5
```

## tx memory set

```text
tx memory set - Set a key-value property on a document

Usage: tx memory set <id> <key> <value>

Sets a structured property on the document. Properties are written to
both frontmatter (filesystem) and the database index.

Reserved keys (tags, related, created) cannot be set via this command;
use 'tx memory tag' or 'tx memory relate' instead.

Examples:
  tx memory set mem-a7f3bc12 status reviewed
  tx memory set mem-a7f3bc12 confidence high
```

## tx memory show

```text
tx memory show - Display a memory document

Usage: tx memory show <id> [--json]

Shows full document content, metadata, and indexing status.

Examples:
  tx memory show mem-a7f3bc12
  tx memory show mem-a7f3bc12 --json
```

## tx memory source

```text
tx memory source - Manage indexed directories

Usage: tx memory source <add|rm|list> [options]

Subcommands:
  add <dir> [--label name]  Register a directory for indexing
  rm <dir>                  Unregister and remove indexed docs
  list                      Show registered directories

Examples:
  tx memory source add ./docs --label "Project docs"
  tx memory source add ~/vault --label "Obsidian vault"
  tx memory source list
  tx memory source rm ./docs
```

## tx memory tag

```text
tx memory tag - Add tags to a memory document

Usage: tx memory tag <id> <tag1> [tag2...] [--json]

Adds tags to the document's frontmatter and re-indexes.

Examples:
  tx memory tag mem-a7f3bc12 security production
  tx memory tag mem-a7f3bc12 reviewed --json
```

## tx memory unset

```text
tx memory unset - Remove a property from a document

Usage: tx memory unset <id> <key>

Removes a property from both frontmatter and the database.

Examples:
  tx memory unset mem-a7f3bc12 status
```

## tx memory untag

```text
tx memory untag - Remove tags from a memory document

Usage: tx memory untag <id> <tag1> [tag2...] [--json]

Removes tags from the document's frontmatter and re-indexes.

Examples:
  tx memory untag mem-a7f3bc12 draft
```
