import Link from 'next/link'
import { CopyCommand } from './copy-command'
export default function HomePage() {
  return <main className="mx-auto max-w-4xl px-6 py-24">
    <h1 className="text-5xl font-bold">tx</h1>
    <p className="my-6 text-2xl">Tasks and spec-driven development.</p>
    <p className="mb-8 text-fd-muted-foreground">Write specs, save your coding agent's plan, create tasks and inspect verification evidence.</p>
    <CopyCommand command="npm install -g @jamesaphoenix/tx-cli" />
    <div className="my-8 flex gap-6"><Link href="/docs/getting-started">Get started</Link><Link href="/docs/primitives/spec-health">Spec Health</Link><a href="https://github.com/jamesaphoenix/tx">GitHub</a></div>
    <ol className="my-8 space-y-4"><li>1. Requirements and design docs define the outcome and invariants.</li><li>2. A saved implementation plan connects the spec to the work.</li><li>3. Tasks track progress. Tests and source mappings provide evidence.</li></ol>
    <p>CLI, dashboard, REST, MCP and TypeScript SDK. Four short authoring skills.</p>
  </main>
}
