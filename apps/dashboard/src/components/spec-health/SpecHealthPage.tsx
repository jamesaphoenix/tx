import { useQuery } from "@tanstack/react-query"
import { fetchers } from "../../api/client"

export function SpecHealthPage() {
  const { data, isPending, error } = useQuery({ queryKey: ["spec-health"], queryFn: fetchers.specHealth, refetchInterval: 10000 })
  if (isPending) return <p role="status" className="p-6">Loading spec health...</p>
  if (error) return <p role="alert" className="p-6">Could not load spec health: {error.message}</p>
  if (!data) return null
  const metrics = [
    ["Unmapped invariants", data.specTest.uncovered],
    ["Missing test results", data.specTest.untested],
    ["Failing evidence", data.specTest.failing],
    ["Drifting documents", data.docDrift.driftedDocs],
    ["Pending decisions", data.decisions.pending],
    ["Complete specs", data.specTest.docsComplete],
  ] as const
  return <section className="overflow-y-auto p-6">
    <h1 className="text-xl font-semibold">Spec Health</h1>
    <p className="mt-2 text-gray-400">Tasks, specifications, code mappings and executed test evidence.</p>
    {data.docDrift.totalDocs > 0 && <p className="mt-4">Status: <strong>{data.status}</strong></p>}
    {data.docDrift.totalDocs === 0 && <p className="mt-4">No specifications yet. Create a PRD and design document to get started.</p>}
    <dl className="my-6 grid grid-cols-2 gap-4 md:grid-cols-3">{metrics.map(([label, value]) => <div key={label} className="rounded-lg bg-gray-800 p-4"><dt>{label}</dt><dd className="mt-2 text-2xl font-semibold">{value}</dd></div>)}</dl>
    <p className="mb-4 text-sm text-gray-400">A source or test mapping identifies coverage. Passing test evidence and human sign-off establish completion.</p>
    <table className="w-full text-left"><thead><tr><th>Specification</th><th>Phase</th><th>Gaps</th><th>Drift</th></tr></thead><tbody>{data.docs.map(doc => <tr key={doc.name} className="border-t border-gray-800"><td className="py-3">{doc.name}</td><td>{doc.phase}</td><td>{doc.gaps}</td><td>{doc.drift.length ? doc.drift.join(", ") : "None"}</td></tr>)}</tbody></table>
  </section>
}
