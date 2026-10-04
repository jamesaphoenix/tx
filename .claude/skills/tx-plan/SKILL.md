---
name: tx-plan
description: Copy an implementation plan made by a coding agent into tx docs, link its specification and keep a symlink to the original plan.
---

# Save a plan

Generate the plan using the coding agent's normal planning process. Keep its
content and format. Run tx from the main repository root; read project instructions
for any shell wrapper or worktree content-root options.

Create a plan document and obtain its file path from the result:

```bash
tx doc add plan <name> --title "Implementation plan"
tx doc link <spec-ref> <plan-ref>
```

Copy the agent plan verbatim below the tx-generated frontmatter, replacing the
scaffold body. Preserve the tx identity and metadata. If the plan already lives
elsewhere, create an adjacent `<name>.source` symlink pointing to that original
file using its absolute path. Keep the original file intact. Check an existing
link before replacing it. If the plan only exists in conversation, copy its text;
no source symlink is needed. The committed copy is readable without the symlink.
The link is provenance, not automatic synchronisation. Avoid copying secrets or
machine-specific private material into a shared repository.

Run `tx doc sync <plan-ref>` after copying or updating the plan. Create tasks from
its steps with `tx task add` and attach each with
`tx doc attach <task-id> <plan-ref>`. The graph is spec -> plan -> tasks;
requirements and invariants remain in the PRD/design specification. Use
`tx doc show <plan-ref> --md` and the dashboard doc graph to check the saved content and links.
