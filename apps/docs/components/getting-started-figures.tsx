import { DiagramFrame } from "@/components/diagram-frame";

function Step({
  number,
  label,
  detail,
}: {
  readonly number: string;
  readonly label: string;
  readonly detail: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-fd-border/70 bg-fd-card/90 p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-fd-border/70 bg-fd-background text-xs font-semibold text-fd-muted-foreground">
          {number}
        </span>
        <p className="text-sm font-semibold text-fd-foreground">{label}</p>
      </div>
      <p className="mt-3 text-sm text-fd-muted-foreground">{detail}</p>
    </div>
  );
}

function Arrow() {
  return (
    <div className="flex items-center justify-center text-fd-muted-foreground">
      <div className="hidden h-px w-8 bg-fd-border md:block" />
      <div className="mx-2 flex h-7 w-7 items-center justify-center rounded-full border border-fd-border/70 bg-fd-background text-xs">
        →
      </div>
      <div className="hidden h-px w-8 bg-fd-border md:block" />
    </div>
  );
}

function Outcome({
  title,
  detail,
  tone = "slate",
}: {
  readonly title: string;
  readonly detail: string;
  readonly tone?: "slate" | "emerald" | "amber";
}) {
  const toneClasses = {
    slate: "border-slate-300/70 bg-white/90 dark:border-slate-700/70 dark:bg-slate-950/70",
    emerald: "border-emerald-300/80 bg-emerald-50/80 dark:border-emerald-500/40 dark:bg-emerald-950/40",
    amber: "border-amber-300/80 bg-amber-50/80 dark:border-amber-500/40 dark:bg-amber-950/40",
  } as const;

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${toneClasses[tone]}`}>
      <p className="text-sm font-semibold text-fd-foreground">{title}</p>
      <p className="mt-2 text-sm text-fd-muted-foreground">{detail}</p>
    </div>
  );
}

export function WorkLoopFigure() {
  return (
    <DiagramFrame
      title="Work Loop"
      caption="Pull one ready task, inspect it, implement, and verify. If nothing is ready, stop. If verification fails, fix or block before trying again."
    >
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
        <Step number="1" label="tx ready" detail="Pull the next workable task." />
        <Arrow />
        <Step number="2" label="show + context" detail="Read the task and inject the relevant context." />
        <Arrow />
        <Step number="3" label="implement + verify" detail="Make the change, then run the checks that matter." />
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Outcome title="pass → tx done" detail="Complete the task and let tx unblock any dependents." tone="emerald" />
        <Outcome title="fail → fix or block" detail="Keep iterating or explicitly block the task with the current issue." tone="amber" />
      </div>
    </DiagramFrame>
  );
}
