# PRD-024: Dashboard Keyboard Shortcuts & UX Polish

## Problem

The tx dashboard lacked critical keyboard shortcuts that power users expect:

1. **CMD+C did nothing** — Users expected CMD+C to copy the currently viewed item's ID/title to clipboard, but there was no global keyboard handler for it. The copy commands only existed in the command palette (CMD+K), requiring extra steps.
2. **CMD+A missed scrolled items** — After scrolling to load more items via infinite scroll, CMD+A's select-all only operated on items from a separate fetch query, not always matching the rendered list.
3. **No escape from document graph** — The full-page document graph view had no keyboard shortcut to close it; users had to click the "Back to Docs" button.
4. **Empty state not centered** — The "Select a doc to view details" empty state in the Docs tab was positioned near the top of the content area instead of vertically centered, inconsistent with the Tasks and Runs tabs.

## Solution

Add global keyboard shortcut handlers and fix layout inconsistencies so that:

- CMD+C copies contextually appropriate data (ID + title) for the currently active item
- ESC closes the document graph when open
- Empty states are consistently centered across all tabs

## Requirements

- [x] CMD+C globally intercepts and copies the active item's ID + title
- [x] CMD+C respects browser text selection (if text is highlighted, normal copy works)
- [x] CMD+C with multi-selected items copies all selected items (existing behavior, now triggered by keyboard)
- [x] CMD+C with a single focused item copies that item's ID + title/name
- [x] ESC closes the full-page document graph view
- [x] Docs tab empty state is vertically centered in the content area
- [x] Copy format varies by entity type:
  - Tasks: `tx-abc123 Task Title`
  - Runs: `run-id agent-name status`
  - Docs: `doc-name - Doc Title`
  - Cycles: cycle name or `Cycle N`

## Acceptance Criteria

1. On the Docs tab, viewing a doc detail, CMD+C copies `doc-name - Doc Title` to clipboard
2. On the Tasks tab, viewing a task detail, CMD+C copies `task-id Task Title` to clipboard
3. On the Runs tab, viewing a run, CMD+C copies `run-id agent status` to clipboard
4. On the Cycles tab, viewing a cycle with no issue selection, CMD+C copies the cycle name
5. Multi-select copy (checkboxes) takes priority over single-item copy
6. If the user has highlighted text on the page, CMD+C does normal browser copy (no interception)
7. Pressing ESC while the document graph is open closes the graph and returns to docs list
8. The "Select a doc to view details" empty state is vertically + horizontally centered

## Out of Scope

- Adding CMD+V (paste) or CMD+X (cut) shortcuts
- Keyboard-driven multi-select (Shift+Click, Shift+Arrow)
- Customizable keyboard shortcuts
- CMD+A improvements for infinite scroll data freshness (the existing separate queries already fetch all items)

## References

- → [DD-024](../design/DD-024-dashboard-keyboard-shortcuts.md)
