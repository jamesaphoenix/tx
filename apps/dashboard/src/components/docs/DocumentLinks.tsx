import { useQuery } from "@tanstack/react-query"
import { fetchers, type DocSerialized } from "../../api/client"

interface DocumentLinksProps {
  nodeId: string
  onNavigateToDoc?: (docId: string, version: number) => void
}
interface RecordedLink {
  key: string
  title: string
  kind: string
  relationship: string
  doc?: DocSerialized
  href: string
}

/** Follow recorded relationships, rather than guessing from document names. */
export function DocumentLinks({ nodeId, onNavigateToDoc }: DocumentLinksProps) {
  const docs = useQuery({ queryKey: ["docs"], queryFn: () => fetchers.docs(), refetchInterval: 10000 })
  const graph = useQuery({ queryKey: ["doc-graph"], queryFn: fetchers.docGraph, refetchInterval: 10000 })
  const error = docs.error ?? graph.error
  if (error) return <p role="status" className="text-sm text-amber-400">Could not load document links: {error.message}</p>
  if (!docs.data || !graph.data) return null

  const links = graph.data.edges.flatMap<RecordedLink>(edge => {
    if (edge.source !== nodeId && edge.target !== nodeId) return []
    const otherId = edge.source === nodeId ? edge.target : edge.source
    const doc = docs.data.docs.find(candidate => `doc:${candidate.id}` === otherId)
    if (doc) return [{ key: `${otherId}:${edge.type}`, title: doc.title, kind: doc.kind,
      relationship: edge.type.replace(/_/g, " "), doc,
      href: `/?${new URLSearchParams({ tab: "docs", docId: doc.docId, version: String(doc.version) })}` }]
    const task = graph.data.nodes.find(node => node.id === otherId && node.kind === "task")
    if (task) return [{ key: `${otherId}:${edge.type}`, title: task.label, kind: "task",
      relationship: edge.type, doc: undefined,
      href: `/?${new URLSearchParams({ view: "list", taskId: otherId.slice(5) })}` }]
    return []
  })
  if (!links.length) return null
  return <section aria-label="Linked documents and tasks" className="mb-6 rounded-lg border border-gray-700/40 bg-gray-800/30 p-4">
    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Linked documents and tasks</h3>
    <ul className="space-y-2">{links.map(link => <li key={link.key}>
      <a href={link.href} className="flex flex-wrap items-baseline gap-2 rounded text-sm text-blue-400 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
        onClick={link.doc && onNavigateToDoc ? event => { event.preventDefault(); onNavigateToDoc(link.doc!.docId, link.doc!.version) } : undefined}>
        <span className="rounded bg-gray-700/60 px-1.5 py-0.5 text-xs text-gray-400">{link.kind}</span>
        <span className="break-words">{link.title}</span>
        <span className="text-xs text-gray-500">{link.relationship}</span>
      </a>
    </li>)}</ul>
  </section>
}
