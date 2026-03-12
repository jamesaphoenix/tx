import { DiagramFrame } from "@/components/diagram-frame";

interface StageCardProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly chips: readonly string[];
  readonly tone?: "slate" | "blue" | "emerald";
  readonly step?: string;
}

interface PhaseCardProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly detail: string;
  readonly tone?: "slate" | "blue" | "emerald";
}

const toneClasses: Record<NonNullable<StageCardProps["tone"]>, string> = {
  slate: "border-slate-300/70 bg-white/90 dark:border-slate-700/70 dark:bg-slate-950/70",
  blue: "border-blue-300/80 bg-blue-50/80 dark:border-blue-500/40 dark:bg-blue-950/40",
  emerald: "border-emerald-300/80 bg-emerald-50/80 dark:border-emerald-500/40 dark:bg-emerald-950/40",
};

const chipToneClasses: Record<NonNullable<StageCardProps["tone"]>, string> = {
  slate: "border-slate-300/70 bg-slate-100/80 text-slate-800 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-200",
  blue: "border-blue-300/70 bg-blue-100/80 text-blue-900 dark:border-blue-500/40 dark:bg-blue-900/60 dark:text-blue-100",
  emerald: "border-emerald-300/70 bg-emerald-100/80 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-900/60 dark:text-emerald-100",
};

function StageCard({ eyebrow, title, chips, tone = "slate", step }: StageCardProps) {
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${toneClasses[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-fd-muted-foreground">
          {eyebrow}
        </p>
        {step ? (
          <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-fd-border/70 bg-fd-background/80 px-2 text-xs font-semibold text-fd-muted-foreground">
            {step}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-base font-semibold text-fd-foreground">{title}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {chips.map((chip) => (
          <span
            key={chip}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${chipToneClasses[tone]}`}
          >
            {chip}
          </span>
        ))}
      </div>
    </div>
  );
}

function PhaseCard({ eyebrow, title, detail, tone = "slate" }: PhaseCardProps) {
  return (
    <div className={`min-w-0 rounded-[24px] border px-5 py-5 shadow-sm ${toneClasses[tone]}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-fd-muted-foreground">
        {eyebrow}
      </p>
      <div className="mt-3 flex items-end justify-between gap-4">
        <p className="text-xl font-semibold text-fd-foreground">{title}</p>
        <p className="text-sm font-medium text-fd-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function DownConnector() {
  return (
    <div className="flex justify-center py-1.5">
      <div className="flex flex-col items-center gap-1 text-fd-muted-foreground">
        <div className="h-4 w-px bg-fd-border" />
        <div className="flex h-6 w-6 items-center justify-center rounded-full border border-fd-border/70 bg-fd-background/90 text-xs">
          ↓
        </div>
        <div className="h-4 w-px bg-fd-border" />
      </div>
    </div>
  );
}

function TransitionPill({ label }: { readonly label: string }) {
  return (
    <div className="flex justify-center">
      <div className="inline-flex items-center gap-2 rounded-full border border-fd-border/70 bg-fd-background/80 px-3 py-1.5 text-xs font-medium text-fd-muted-foreground shadow-sm">
        <span>{label}</span>
        <span aria-hidden="true">↓</span>
      </div>
    </div>
  );
}

function RegressionNote() {
  return (
    <div className="rounded-2xl border border-amber-300/70 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-100">
      Any failing outcome after HARDEN drops the phase back to BUILD.
    </div>
  );
}

function DividerLabel({ label }: { readonly label: string }) {
  return (
    <div className="hidden items-center gap-2 text-center md:flex">
      <div className="h-px w-8 bg-fd-border" />
      <p className="max-w-32 text-xs font-medium text-fd-muted-foreground">{label}</p>
      <div className="h-px w-8 bg-fd-border" />
    </div>
  );
}

function MobileDividerLabel({ label }: { readonly label: string }) {
  return (
    <div className="flex justify-center md:hidden">
      <div className="inline-flex items-center gap-2 rounded-full border border-fd-border/70 bg-fd-background/80 px-3 py-1.5 text-xs font-medium text-fd-muted-foreground shadow-sm">
        <span>{label}</span>
        <span aria-hidden="true">→</span>
      </div>
    </div>
  );
}

export function SpecPipelineFigure() {
  return (
    <DiagramFrame
      title="Spec Pipeline"
      caption="Specs become invariants, discovery builds mappings from tags or manifest entries, and recorded outcomes drive FCI and phase."
    >
      <div className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <StageCard
            eyebrow="Source"
            title="Docs"
            chips={["tx docs", "tx spec discover"]}
            tone="blue"
            step="A"
          />
          <StageCard
            eyebrow="Discovery"
            title="Test sources"
            chips={["tags", ".tx/spec-tests.yml"]}
            tone="blue"
            step="B"
          />
        </div>
        <DownConnector />
        <StageCard
          eyebrow="Mapping"
          title="Traceability mappings"
          chips={["discover", "link", "canonical IDs"]}
          step="1"
        />
        <DownConnector />
        <StageCard
          eyebrow="Execution"
          title="Recorded outcomes"
          chips={["tx spec run", "tx spec batch"]}
          step="2"
        />
        <DownConnector />
        <StageCard
          eyebrow="Scoring"
          title="FCI and phase"
          chips={["BUILD", "HARDEN", "COMPLETE"]}
          tone="emerald"
          step="3"
        />
      </div>
    </DiagramFrame>
  );
}

export function SpecPhaseFigure() {
  return (
    <DiagramFrame
      title="FCI Gate"
      caption="BUILD is automatic while any active invariant is failing. HARDEN starts at 100% FCI. COMPLETE still requires a human sign-off."
    >
      <div className="grid gap-3">
        <PhaseCard eyebrow="Automatic" title="BUILD" detail="FCI < 100" tone="slate" />
        <TransitionPill label="FCI reaches 100" />
        <PhaseCard eyebrow="Automatic" title="HARDEN" detail="FCI = 100" tone="blue" />
        <TransitionPill label="tx spec complete --by human" />
        <PhaseCard eyebrow="Manual" title="COMPLETE" detail="human sign-off" tone="emerald" />
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center">
        <RegressionNote />
        <DividerLabel label="regression path" />
        <MobileDividerLabel label="regression path" />
        <div className="rounded-2xl border border-fd-border/60 bg-fd-background/70 px-4 py-3 text-sm text-fd-muted-foreground">
          Use this as a release gate: automation can move from BUILD to HARDEN, but only a human can mark COMPLETE.
        </div>
      </div>
    </DiagramFrame>
  );
}
