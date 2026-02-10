/**
 * TanStack Store for multi-select state across all dashboard pages.
 *
 * Centralizes selection state so that command palette, list components,
 * and action bars can all read/write the same state without prop drilling.
 */
import { Store } from "@tanstack/store"

export interface SelectionState {
  /** Selected task IDs on the Tasks page */
  taskIds: Set<string>
  /** Selected run IDs on the Runs page */
  runIds: Set<string>
  /** Selected doc names on the Docs page */
  docNames: Set<string>
  /** Selected issue IDs on the Cycles page */
  issueIds: Set<string>
}

export const selectionStore = new Store<SelectionState>({
  taskIds: new Set(),
  runIds: new Set(),
  docNames: new Set(),
  issueIds: new Set(),
})

// ─── Actions ────────────────────────────────────────────────────────────────

function toggleInSet(set: Set<string>, id: string): Set<string> {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export const selectionActions = {
  // Tasks
  toggleTask: (id: string) =>
    selectionStore.setState((s) => ({ ...s, taskIds: toggleInSet(s.taskIds, id) })),
  selectAllTasks: (ids: string[]) =>
    selectionStore.setState((s) => ({ ...s, taskIds: new Set(ids) })),
  clearTasks: () =>
    selectionStore.setState((s) => ({ ...s, taskIds: new Set() })),

  // Runs
  toggleRun: (id: string) =>
    selectionStore.setState((s) => ({ ...s, runIds: toggleInSet(s.runIds, id) })),
  selectAllRuns: (ids: string[]) =>
    selectionStore.setState((s) => ({ ...s, runIds: new Set(ids) })),
  clearRuns: () =>
    selectionStore.setState((s) => ({ ...s, runIds: new Set() })),

  // Docs
  toggleDoc: (name: string) =>
    selectionStore.setState((s) => ({ ...s, docNames: toggleInSet(s.docNames, name) })),
  selectAllDocs: (names: string[]) =>
    selectionStore.setState((s) => ({ ...s, docNames: new Set(names) })),
  clearDocs: () =>
    selectionStore.setState((s) => ({ ...s, docNames: new Set() })),

  // Issues (Cycles page)
  toggleIssue: (id: string) =>
    selectionStore.setState((s) => ({ ...s, issueIds: toggleInSet(s.issueIds, id) })),
  selectAllIssues: (ids: string[]) =>
    selectionStore.setState((s) => ({ ...s, issueIds: new Set(ids) })),
  clearIssues: () =>
    selectionStore.setState((s) => ({ ...s, issueIds: new Set() })),

  // Clear everything (e.g., on tab switch)
  clearAll: () =>
    selectionStore.setState(() => ({
      taskIds: new Set(),
      runIds: new Set(),
      docNames: new Set(),
      issueIds: new Set(),
    })),
}
