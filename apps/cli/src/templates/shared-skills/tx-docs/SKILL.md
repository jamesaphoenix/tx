---
name: tx-docs
description: Create design docs, optional product requirements and system overviews beside the code.
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
with the requested content. Start with a design doc. Add a PRD when a separate
product contract helps, then link it to the design:

```bash
tx doc add prd <feature>-prd --title "Feature requirements"
tx doc add design <feature>-design --title "Feature design"
tx doc link <feature>-prd <feature>-design
```

The PRD states the problem, requirements and acceptance criteria. The design states
the implementation, interfaces, invariants, failure handling and verification.
Use distinct names or kind-scoped references to avoid ambiguous document slugs.

Edit existing documents in place, then `tx doc sync <doc-ref>` and `tx spec lint`.
Do not remove and recreate documents to refresh their hashes. Sync before locking
a reviewed version. `tx doc version` preserves locked source under `.versions/`
in the docs directory and creates the working version at its normal path. Commit
both files; use `tx doc show --doc-version <n>` to read historical content. For a worktree,
keep the main state root and explicitly select the worktree content root using
`--state-root` and `--content-root`.

Use CLI help for exact options. Document creation does not launch decomposition,
verification, agents or an implementation loop. Use `verify-invariants` when
mapping and verification are part of the requested work.
