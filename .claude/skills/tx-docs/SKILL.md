---
name: tx-docs
description: Create configured tx documents, including paired PRD and design documents for feature work.
---

# Create documents

Read project instructions and run tx from the main repository root. Discover
configured document types and their actual templates:

```bash
tx spec types --json
tx doc template <type> --name <name> --title "Title"
tx doc add <type> <name> --title "Title"
```

Use the configured headings and required frontmatter. Replace scaffold placeholders
with the requested content. For feature work create a paired PRD and design doc:

```bash
tx doc add prd <feature>-prd --title "Feature requirements"
tx doc add design <feature>-design --title "Feature design"
tx doc link <feature>-prd <feature>-design
```

The PRD states the problem, requirements and acceptance criteria. The design states
the implementation, interfaces, invariants, failure handling and verification.
Use distinct names or kind-scoped references to avoid ambiguous document slugs.

Edit existing documents in place, then `tx doc sync <doc-ref>` and `tx spec lint`.
Do not remove and recreate documents to refresh their hashes. For a worktree,
keep the main state root and explicitly select the worktree content root using
`--state-root` and `--content-root`.

Use CLI help for exact options. Document creation does not launch decomposition,
verification, agents or an implementation loop. Use `verify-invariants` when
mapping and verification are part of the requested work.
