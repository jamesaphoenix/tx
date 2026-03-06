import { DiagramFrame } from "@/components/diagram-frame";

function LayerCard({
  title,
  items,
  tone = "slate",
}: {
  readonly title: string;
  readonly items: readonly string[];
  readonly tone?: "slate" | "blue" | "emerald" | "amber";
}) {
  const toneClasses = {
    slate: "border-slate-300/70 bg-white/90 dark:border-slate-700/70 dark:bg-slate-950/70",
    blue: "border-blue-300/80 bg-blue-50/80 dark:border-blue-500/40 dark:bg-blue-950/40",
    emerald: "border-emerald-300/80 bg-emerald-50/80 dark:border-emerald-500/40 dark:bg-emerald-950/40",
    amber: "border-amber-300/80 bg-amber-50/80 dark:border-amber-500/40 dark:bg-amber-950/40",
  } as const;

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${toneClasses[tone]}`}>
      <p className="text-sm font-semibold text-fd-foreground">{title}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.map((item) => (
          <span
            key={item}
            className="rounded-full border border-fd-border/70 bg-fd-background/85 px-2.5 py-1 text-xs font-medium text-fd-muted-foreground"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function OrchestrationBanner() {
  return (
    <div className="rounded-[24px] border border-fd-border/70 bg-fd-foreground px-5 py-5 text-fd-background shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-fd-background/70">
        Your Layer
      </p>
      <p className="mt-2 text-xl font-semibold">Your orchestration</p>
      <p className="mt-1 text-sm text-fd-background/75">Your code, your rules, your handoffs.</p>
    </div>
  );
}

function Connector() {
  return (
    <div className="flex justify-center py-2">
      <div className="flex flex-col items-center gap-1 text-fd-muted-foreground">
        <div className="h-4 w-px bg-fd-border" />
        <div className="flex h-7 w-7 items-center justify-center rounded-full border border-fd-border/70 bg-fd-background text-xs">
          ↓
        </div>
        <div className="h-4 w-px bg-fd-border" />
      </div>
    </div>
  );
}

export function HeadlessLayersFigure() {
  return (
    <DiagramFrame
      title="Headless Layers"
      caption="tx stays below your orchestration layer. You keep the loop design; tx provides reusable primitives underneath it."
    >
      <OrchestrationBanner />
      <Connector />
      <div className="grid gap-4 md:grid-cols-2">
        <LayerCard
          title="Queue and coordination"
          items={["tx ready", "tx done", "tx block", "tx claim"]}
          tone="blue"
        />
        <LayerCard
          title="Context and memory"
          items={["tx context", "tx learn", "tx learning:*", "tx handoff"]}
          tone="emerald"
        />
        <LayerCard
          title="Bounded autonomy"
          items={["tx label", "tx guard", "tx verify", "tx reflect", "tx gate"]}
          tone="amber"
        />
        <LayerCard
          title="Docs and observability"
          items={["tx doc", "tx invariant", "tx spec", "tx trace"]}
          tone="slate"
        />
      </div>
    </DiagramFrame>
  );
}
