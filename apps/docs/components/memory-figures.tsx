import { DiagramFrame } from "@/components/diagram-frame";

function MemoryCard({
  title,
  subtitle,
  bullets,
  tone = "slate",
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly bullets: readonly string[];
  readonly tone?: "slate" | "blue" | "emerald";
}) {
  const toneClasses = {
    slate: "border-slate-300/70 bg-white/90 dark:border-slate-700/70 dark:bg-slate-950/70",
    blue: "border-blue-300/80 bg-blue-50/80 dark:border-blue-500/40 dark:bg-blue-950/40",
    emerald: "border-emerald-300/80 bg-emerald-50/80 dark:border-emerald-500/40 dark:bg-emerald-950/40",
  } as const;

  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${toneClasses[tone]}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-fd-muted-foreground">
        {subtitle}
      </p>
      <p className="mt-2 text-lg font-semibold text-fd-foreground">{title}</p>
      <ul className="mt-3 space-y-2 text-sm text-fd-muted-foreground">
        {bullets.map((bullet) => (
          <li key={bullet} className="flex gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-fd-primary/70" />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BridgeCard() {
  return (
    <div className="rounded-2xl border border-fd-border/70 bg-fd-background/80 px-4 py-3 text-sm text-fd-muted-foreground shadow-sm">
      Distill a durable doc into a short learning when that knowledge also needs to surface in
      <span className="mx-1 rounded-full border border-fd-border/70 bg-fd-card px-2 py-0.5 text-xs font-medium text-fd-foreground">
        tx context
      </span>
      and learning search.
    </div>
  );
}

export function MemoryVsLearningsFigure() {
  return (
    <DiagramFrame
      title="Memory vs Learnings"
      caption="Use memory for durable markdown docs. Use learnings for short reusable insights. Distill across both when task context and long-form retrieval both matter."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <MemoryCard
          subtitle="Durable knowledge"
          title="tx memory"
          tone="blue"
          bullets={[
            "Long-form notes, runbooks, design docs, and linked markdown.",
            "Searchable by BM25, semantic recall, and graph expansion.",
            "Best when backlinks, wikilinks, and document structure matter.",
          ]}
        />
        <MemoryCard
          subtitle="Reusable insight"
          title="tx learning"
          tone="emerald"
          bullets={[
            "Short patterns, pitfalls, reminders, and operator heuristics.",
            "Surfaces directly in learning search and task context.",
            "Best when the agent needs a concise hint, not a full document.",
          ]}
        />
      </div>
      <div className="mt-4">
        <BridgeCard />
      </div>
    </DiagramFrame>
  );
}
