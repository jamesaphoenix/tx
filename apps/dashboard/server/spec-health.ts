import { Effect } from "effect"
import { getSpecHealth, makeMinimalLayer, resolveWorkspaceContext } from "@jamesaphoenix/tx"

/** @spec INV-LEAN-004 Dashboard evidence uses the same checkout scope as the CLI. */
export const dashboardSpecHealth = (dbPath: string, cwd = process.cwd()) => {
  const workspace = resolveWorkspaceContext({dbPath, cwd})
  return Effect.runPromise(getSpecHealth().pipe(Effect.provide(makeMinimalLayer(dbPath, {
    contentRoot: workspace.contentRoot,
    projection: workspace,
  }))))
}
