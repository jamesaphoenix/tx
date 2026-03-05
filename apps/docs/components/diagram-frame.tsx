import type { ReactNode } from "react";

interface DiagramFrameProps {
  readonly title: string;
  readonly caption?: string;
  readonly children: ReactNode;
}

export function DiagramFrame({ title, caption, children }: DiagramFrameProps) {
  return (
    <figure className="not-prose my-6 overflow-hidden rounded-[24px] border border-fd-border/70 bg-gradient-to-br from-fd-card via-fd-card to-fd-card/80 shadow-sm">
      <div className="border-b border-fd-border/60 bg-gradient-to-r from-black/10 via-black/5 to-transparent px-4 py-3 dark:from-white/10 dark:via-white/5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-fd-muted-foreground">
          {title}
        </p>
      </div>
      <div className="p-5 sm:p-6">{children}</div>
      {caption ? (
        <figcaption className="border-t border-fd-border/60 bg-fd-background px-4 py-3 text-sm text-fd-muted-foreground">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
