import Link from 'next/link';

const features = [
  {
    title: 'Task Management',
    description:
      'Track tasks with dependencies, priorities, and statuses. tx ready returns the next workable task automatically.',
    href: '/docs',
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
        />
      </svg>
    ),
  },
  {
    title: 'Memory & Learnings',
    description:
      'Persist knowledge across sessions. Learnings surface automatically when contextually relevant.',
    href: '/docs',
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
        />
      </svg>
    ),
  },
  {
    title: 'Agent Coordination',
    description:
      'Claim tasks to prevent collisions. Handoff between agents with context. Checkpoint progress.',
    href: '/docs',
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
        />
      </svg>
    ),
  },
];

const primitives = [
  { name: 'tx ready', desc: 'Get next workable task' },
  { name: 'tx claim', desc: 'Prevent collisions' },
  { name: 'tx done', desc: 'Complete task' },
  { name: 'tx block', desc: 'Declare dependencies' },
  { name: 'tx handoff', desc: 'Transfer with context' },
  { name: 'tx context', desc: 'Get relevant learnings' },
];

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col">
      {/* Hero Section */}
      <section className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        <div className="max-w-4xl">
          <h1 className="mb-4 text-5xl font-bold tracking-tight sm:text-6xl">
            <span className="text-fd-primary">tx</span>
          </h1>
          <p className="mb-6 text-2xl font-medium text-fd-muted-foreground sm:text-3xl">
            TanStack for AI agents
          </p>
          <p className="mb-8 text-lg text-fd-muted-foreground">
            Primitives, not frameworks. Headless infrastructure for memory, tasks, and
            orchestration.
          </p>
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/docs"
              className="inline-flex items-center rounded-lg bg-fd-primary px-6 py-3 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
            >
              Get Started
              <svg className="ml-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </Link>
            <a
              href="https://github.com/just-understanding-data/tx"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-lg border border-fd-border px-6 py-3 text-sm font-medium text-fd-foreground transition-colors hover:bg-fd-accent"
            >
              <svg className="mr-2 h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"
                />
              </svg>
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Philosophy Section */}
      <section className="border-t border-fd-border bg-fd-muted/30 px-6 py-16">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="mb-4 text-2xl font-bold">Why Primitives?</h2>
          <p className="text-fd-muted-foreground">
            The orchestration flow is where you create value. It encodes your domain knowledge.{' '}
            <span className="font-medium text-fd-foreground">
              If a tool dictates the flow, it&apos;s not a tool—it&apos;s a competitor.
            </span>{' '}
            tx gives you headless infrastructure. You own your orchestration.
          </p>
        </div>
      </section>

      {/* Features Section */}
      <section className="px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-12 text-center text-2xl font-bold">Core Capabilities</h2>
          <div className="grid gap-8 md:grid-cols-3">
            {features.map((feature) => (
              <Link
                key={feature.title}
                href={feature.href}
                className="group rounded-lg border border-fd-border p-6 transition-colors hover:border-fd-primary hover:bg-fd-accent/50"
              >
                <div className="mb-4 inline-flex rounded-lg bg-fd-primary/10 p-3 text-fd-primary">
                  {feature.icon}
                </div>
                <h3 className="mb-2 font-semibold">{feature.title}</h3>
                <p className="text-sm text-fd-muted-foreground">{feature.description}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Primitives Section */}
      <section className="border-t border-fd-border bg-fd-muted/30 px-6 py-16">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-8 text-center text-2xl font-bold">Simple Primitives</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {primitives.map((p) => (
              <div key={p.name} className="rounded-lg border border-fd-border bg-fd-background p-4">
                <code className="text-sm font-medium text-fd-primary">{p.name}</code>
                <p className="mt-1 text-xs text-fd-muted-foreground">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Quick Start Section */}
      <section className="px-6 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="mb-4 text-2xl font-bold">Ready to start?</h2>
          <p className="mb-8 text-fd-muted-foreground">
            Get up and running with tx in your project.
          </p>
          <div className="rounded-lg border border-fd-border bg-fd-muted/50 p-4">
            <code className="text-sm">npm install @tx/core</code>
          </div>
          <Link
            href="/docs"
            className="mt-6 inline-flex items-center text-sm font-medium text-fd-primary hover:underline"
          >
            Read the documentation
            <svg className="ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-fd-border px-6 py-8">
        <div className="mx-auto max-w-4xl text-center text-sm text-fd-muted-foreground">
          <p>Built with primitives, not frameworks.</p>
        </div>
      </footer>
    </main>
  );
}
