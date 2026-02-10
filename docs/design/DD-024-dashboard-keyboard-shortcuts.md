# DD-024: Dashboard Keyboard Shortcuts & UX Polish

## Overview

Adds global CMD+C keyboard handling, ESC-to-close for the document graph, and fixes the docs empty state centering. Builds on the existing command palette infrastructure (`CommandContext`, `useCommands`) rather than introducing new patterns.

## Design

### Global CMD+C Handler

The dashboard already has a `CommandProvider` in `CommandContext.tsx` that handles global keyboard shortcuts (CMD+K for palette, CMD+A for select-all, ESC for clear). CMD+C is added to this same handler following the identical pattern.

**Key design decision**: CMD+C respects native browser copy. If `window.getSelection()` returns non-empty text, the handler returns early and lets the browser handle the copy. This ensures users can still copy text from doc content, task descriptions, etc.

**Priority resolution**: The handler finds the *first* command with `shortcut: "⌘C"`. Multi-select copy commands are registered before single-item copy commands in all pages, so multi-select naturally takes priority.

### Per-Entity Copy Behavior

Each page registers copy commands with `shortcut: "⌘C"` conditionally:

| Tab | Multi-select active | Single item focused | Neither |
|-----|--------------------|--------------------|---------|
| Tasks | Copy all selected: `id [score] title` per line | Copy focused: `id title` | No CMD+C action |
| Runs | Copy all selected: `id agent status` per line | Copy focused: `id agent status` | No CMD+C action |
| Docs | Copy all selected: `name (kind) - title` per line | Copy focused: `name - title` | No CMD+C action |
| Cycles | Copy selected issues (formatted) | Copy cycle name | No CMD+C action |

The `shortcut` field is set conditionally: single-item copy commands only get `shortcut: "⌘C"` when no multi-select is active (`selectedIds.size === 0`), preventing conflicts.

### ESC Closes Document Graph

A `useEffect` in `DocsPage` registers a `keydown` listener for ESC when `showMap` is true. This runs alongside the global ESC handler in `CommandContext` (which clears selections) — both actions are harmless together.

### Empty State Centering Fix

The docs empty state container was changed from:
```tsx
<div className="flex-1 overflow-y-auto">
  <div className="flex items-center justify-center h-full">
```
to:
```tsx
<div className="flex-1 flex items-center justify-center">
```

The `overflow-y-auto` is now only applied when showing actual doc content. This matches the pattern used by Tasks and Runs empty states in `App.tsx`.

## Implementation Plan

| Phase | Files | Changes |
|-------|-------|---------|
| 1 | `CommandContext.tsx` | Add CMD+C to global `handleKeyDown` with `getSelection()` guard |
| 2 | `App.tsx` | Add `shortcut: "⌘C"` to single task/run copy; enrich copy with title |
| 3 | `DocsPage.tsx` | Add ESC handler for graph; `shortcut: "⌘C"` for single doc copy; fix empty state |
| 4 | `CyclePage.tsx` | Add single cycle name copy command with `shortcut: "⌘C"` |

## Testing Strategy

### Manual Testing
- CMD+C on each tab with: no selection, single item focused, multi-selected items
- CMD+C with text highlighted (should do normal browser copy)
- ESC in document graph (should close)
- ESC outside graph (should clear selections, existing behavior)
- Verify empty state centering on Docs tab with no doc selected

### Edge Cases
- CMD+C when palette is open (input is focused, handler returns early for INPUT elements)
- CMD+C with both multi-select and single item active (multi-select wins)
- ESC with palette open AND graph open (palette close takes priority via existing handler)

## Open Questions

- [x] Should CMD+C show a toast notification confirming copy? — **No**, keep it silent like standard OS copy.
- [x] Should single-item copy include score/kind metadata? — **No**, keep it minimal. Multi-select copy includes more detail.

## References

- PRD: [PRD-024](../prd/PRD-024-dashboard-keyboard-shortcuts.md)
- Related: [DD-010](DD-010-dashboard-ux.md) (dashboard UX patterns)
