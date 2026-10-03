import Link from 'next/link'
import { CopyCommand } from './copy-command'
export default function HomePage() {
  return <main className="mx-auto max-w-4xl px-6 py-24">
    <h1 className="text-5xl font-bold">tx</h1>
    <p className="my-6 text-2xl">Design docs, plans and tasks.</p>
    <p className="mb-8 text-fd-muted-foreground">Keep the design, your coding agent's plan and the work together. See which rules are covered by real test evidence.</p>
    <CopyCommand command="npm install -g @jamesaphoenix/tx-cli" />
    <div className="my-8 flex gap-6"><Link href="/docs/getting-started">Get started</Link><Link href="/docs/primitives/spec-health">Spec Health</Link><a href="https://github.com/jamesaphoenix/tx">GitHub</a></div>
    <ol className="my-8 space-y-4"><li>1. A design doc defines the approach and the rules to preserve.</li><li>2. A saved implementation plan connects the spec to the work.</li><li>3. Linked tasks track progress. Executed tests provide verification evidence.</li></ol>
    <p>CLI, dashboard, REST, MCP and TypeScript SDK. Four short authoring skills.</p>
  </main>
}
