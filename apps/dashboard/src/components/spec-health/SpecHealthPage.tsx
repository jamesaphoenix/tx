import { useQuery } from "@tanstack/react-query"
import { fetchers } from "../../api/client"
import { Button } from "../ui"

export function SpecHealthPage() {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["spec-health"], queryFn: fetchers.specHealth, refetchInterval: 10000,
  })
  if (isPending) return <p role="status" className="p-6">Loading spec health...</p>
  if (error) return <div className="p-6">
    <p role="alert" className="text-red-300">Could not load spec health: {error.message}</p>
    <Button className="mt-3" onClick={() => {void refetch()}}>Retry spec health</Button>
  </div>
  if (!data) return null
  const metrics = [
    ["Mapped invariants", `${data.specTest.covered} of ${data.specTest.total} (${data.specTest.coveragePercent}%)`],
    ["Passing evidence", data.specTest.passing],
    ["Unmapped invariants", data.specTest.uncovered],
    ["Missing test results", data.specTest.untested],
    ["Failing evidence", data.specTest.failing],
    ["Drifting documents", data.docDrift.driftedDocs],
  ] as const
  return <section className="overflow-y-auto p-4 md:p-6">
    <h1 className="text-xl font-semibold">Spec Health</h1>
    <p className="mt-2 text-gray-400">Current designs, invariant mappings and executed test evidence.</p>
    {data.docDrift.totalDocs > 0 && <p className="mt-4">Status: <strong>{data.status}</strong></p>}
    {data.docDrift.totalDocs === 0 && <p className="mt-4">No specifications yet. Create a design document to get started.</p>}
    <dl className="my-6 grid grid-cols-2 gap-3 md:grid-cols-3">
      {metrics.map(([label, value]) => <div key={label} className="rounded-lg bg-gray-800 p-4">
        <dt className="text-xs text-gray-400">{label}</dt>
        <dd className="mt-2 break-words text-lg font-semibold">{value}</dd>
      </div>)}
    </dl>
    <p className="mb-2 text-sm text-gray-400">A mapping identifies coverage. Passing test evidence and human sign-off establish completion.</p>
    <p className="mb-6 text-sm text-gray-400">Complete specs: {data.specTest.docsComplete}. Documents without invariants do not claim verified completion.</p>
    {data.docs.length > 0 && <div className="overflow-x-auto rounded-lg border border-gray-700">
      <table className="w-full min-w-[640px] text-left text-sm">
        <caption className="sr-only">Current document versions and the evidence still needed</caption>
        <thead className="bg-gray-800 text-xs text-gray-400"><tr>
          <th scope="col" className="p-3">Document</th><th scope="col" className="p-3">Phase</th>
          <th scope="col" className="p-3">Evidence</th><th scope="col" className="p-3">Next check</th>
        </tr></thead>
        <tbody>{data.docs.map(doc => <tr key={doc.docId ?? doc.name} className="border-t border-gray-700 align-top">
          <td className="p-3">
            {doc.docId ? <a className="text-blue-300 hover:underline focus-visible:outline focus-visible:outline-2" href={`/?${new URLSearchParams({tab:"docs",docId:doc.docId,version:String(doc.version)})}`}>{doc.title || doc.name}</a> : doc.name}
            {doc.docId && <p className="mt-1 text-xs text-gray-500">{doc.name} · v{doc.version}</p>}
          </td>
          <td className="p-3">{doc.invariants === 0 ? "No invariants" : doc.phase}</td>
          <td className="p-3 text-xs">
            {doc.invariants === 0 ? "Not required" : doc.invariants !== undefined ? <>
              <p>{doc.passing} of {doc.invariants} passing</p>
              {doc.failing > 0 && <p className="mt-1 text-red-300">{doc.failing} failing</p>}
              {doc.untested > 0 && <p className="mt-1 text-amber-300">{doc.untested} missing results</p>}
            </> : `${doc.gaps} unmapped`}
          </td>
          <td className="max-w-md p-3 text-xs text-gray-400">
            {(doc.blockers?.length || doc.drift.length) ? <ul className="space-y-1">
              {[...(doc.blockers ?? []),...doc.drift].map((message,index) => <li key={index}>{message}</li>)}
            </ul> : "None"}
          </td>
        </tr>)}</tbody>
      </table>
    </div>}
  </section>
}
