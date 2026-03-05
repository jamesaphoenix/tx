"use client";

import { DiagramFrame } from "@/components/diagram-frame";
import mermaid from "mermaid";
import { useEffect, useId, useMemo, useState } from "react";

type MermaidTheme = "default" | "dark";
type ActorIconKind = "human" | "robot";

interface MermaidProps {
  readonly chart: string;
  readonly title?: string;
  readonly caption?: string;
  readonly actorIcons?: Readonly<Record<string, ActorIconKind>>;
}

interface ActorPalette {
  readonly halo: string;
  readonly fill: string;
  readonly ring: string;
  readonly icon: string;
  readonly label: string;
}

const SVG_NS = "http://www.w3.org/2000/svg";

const humanPalettes: Record<MermaidTheme, ActorPalette> = {
  default: {
    halo: "#dbeafe",
    fill: "#ffffff",
    ring: "#2563eb",
    icon: "#0f172a",
    label: "#0f172a",
  },
  dark: {
    halo: "#172554",
    fill: "#0f172a",
    ring: "#93c5fd",
    icon: "#e2e8f0",
    label: "#e2e8f0",
  },
};

const robotPalettes: Record<MermaidTheme, ActorPalette> = {
  default: {
    halo: "#fde68a",
    fill: "#fffaf0",
    ring: "#b45309",
    icon: "#3f2c1c",
    label: "#3f2c1c",
  },
  dark: {
    halo: "#78350f",
    fill: "#111827",
    ring: "#f59e0b",
    icon: "#fde68a",
    label: "#fde68a",
  },
};

const getTheme = (): MermaidTheme =>
  document.documentElement.classList.contains("dark") || document.documentElement.dataset.theme === "dark"
    ? "dark"
    : "default";

const createSvgElement = <K extends keyof SVGElementTagNameMap>(doc: Document, tagName: K): SVGElementTagNameMap[K] =>
  doc.createElementNS(SVG_NS, tagName);

const setAttributes = (element: Element, attributes: Record<string, number | string>) => {
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
};

const replaceActorGlyph = (
  group: SVGGElement,
  className: string,
  buildGlyph: (doc: Document, group: SVGGElement, centerX: number, centerY: number) => void,
) => {
  const originalLabel = group.querySelector("text");
  const originalCircle = group.querySelector("circle");
  const centerX = parseFloat(originalLabel?.getAttribute("x") ?? originalCircle?.getAttribute("cx") ?? "0");
  const centerY = parseFloat(originalCircle?.getAttribute("cy") ?? "0");
  const doc = group.ownerDocument;

  while (group.firstChild) {
    group.removeChild(group.firstChild);
  }

  group.setAttribute("class", group.getAttribute("class")?.replace("actor-man", className) ?? className);
  buildGlyph(doc, group, centerX, centerY);

  if (originalLabel) {
    group.appendChild(originalLabel.cloneNode(true));
  }
};

const applyHumanIcon = (group: SVGGElement, palette: ActorPalette) => {
  replaceActorGlyph(group, "actor-avatar", (doc, target, centerX, centerY) => {
    const halo = createSvgElement(doc, "circle");
    setAttributes(halo, {
      cx: centerX,
      cy: centerY,
      r: 22,
      fill: palette.halo,
      opacity: 0.46,
    });

    const shell = createSvgElement(doc, "circle");
    setAttributes(shell, {
      cx: centerX,
      cy: centerY,
      r: 18,
      fill: palette.fill,
      stroke: palette.ring,
      "stroke-width": 2.5,
    });

    const head = createSvgElement(doc, "circle");
    setAttributes(head, {
      cx: centerX,
      cy: centerY - 5.5,
      r: 4.5,
      fill: "none",
      stroke: palette.icon,
      "stroke-width": 2,
    });

    const shoulders = createSvgElement(doc, "path");
    setAttributes(shoulders, {
      d: [
        `M ${centerX - 8.5} ${centerY + 8.5}`,
        `C ${centerX - 8} ${centerY + 1.5}, ${centerX + 8} ${centerY + 1.5}, ${centerX + 8.5} ${centerY + 8.5}`,
      ].join(" "),
      fill: "none",
      stroke: palette.icon,
      "stroke-width": 2,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    });

    target.appendChild(halo);
    target.appendChild(shell);
    target.appendChild(head);
    target.appendChild(shoulders);
  });
};

const applyRobotIcon = (group: SVGGElement, palette: ActorPalette) => {
  replaceActorGlyph(group, "actor-robot", (doc, target, centerX, centerY) => {
    const halo = createSvgElement(doc, "rect");
    setAttributes(halo, {
      x: centerX - 24,
      y: centerY - 20,
      width: 48,
      height: 40,
      rx: 18,
      fill: palette.halo,
      opacity: 0.46,
    });

    const shell = createSvgElement(doc, "rect");
    setAttributes(shell, {
      x: centerX - 18,
      y: centerY - 14,
      width: 36,
      height: 28,
      rx: 9,
      fill: palette.fill,
      stroke: palette.ring,
      "stroke-width": 2.5,
    });

    const antenna = createSvgElement(doc, "line");
    setAttributes(antenna, {
      x1: centerX,
      y1: centerY - 14,
      x2: centerX,
      y2: centerY - 22,
      stroke: palette.icon,
      "stroke-width": 2,
      "stroke-linecap": "round",
    });

    const antennaTip = createSvgElement(doc, "circle");
    setAttributes(antennaTip, {
      cx: centerX,
      cy: centerY - 24,
      r: 2.5,
      fill: palette.icon,
    });

    const leftEye = createSvgElement(doc, "circle");
    setAttributes(leftEye, {
      cx: centerX - 6,
      cy: centerY - 4,
      r: 2,
      fill: palette.icon,
    });

    const rightEye = createSvgElement(doc, "circle");
    setAttributes(rightEye, {
      cx: centerX + 6,
      cy: centerY - 4,
      r: 2,
      fill: palette.icon,
    });

    const mouth = createSvgElement(doc, "line");
    setAttributes(mouth, {
      x1: centerX - 6,
      y1: centerY + 5,
      x2: centerX + 6,
      y2: centerY + 5,
      stroke: palette.icon,
      "stroke-width": 2,
      "stroke-linecap": "round",
    });

    const leftEar = createSvgElement(doc, "line");
    setAttributes(leftEar, {
      x1: centerX - 18,
      y1: centerY,
      x2: centerX - 22,
      y2: centerY,
      stroke: palette.icon,
      "stroke-width": 2,
      "stroke-linecap": "round",
    });

    const rightEar = createSvgElement(doc, "line");
    setAttributes(rightEar, {
      x1: centerX + 18,
      y1: centerY,
      x2: centerX + 22,
      y2: centerY,
      stroke: palette.icon,
      "stroke-width": 2,
      "stroke-linecap": "round",
    });

    target.appendChild(halo);
    target.appendChild(shell);
    target.appendChild(antenna);
    target.appendChild(antennaTip);
    target.appendChild(leftEye);
    target.appendChild(rightEye);
    target.appendChild(mouth);
    target.appendChild(leftEar);
    target.appendChild(rightEar);
  });
};

const stylizeActorIcons = (
  svgMarkup: string,
  theme: MermaidTheme,
  actorIcons: Readonly<Record<string, ActorIconKind>> | undefined,
): string => {
  if (!actorIcons || Object.keys(actorIcons).length === 0) return svgMarkup;

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgMarkup, "image/svg+xml");
  const actorGroups = Array.from(doc.querySelectorAll<SVGGElement>("g.actor-man"));

  for (const group of actorGroups) {
    const actorName = group.getAttribute("name") ?? "";
    const iconKind = actorIcons[actorName];
    if (!iconKind) continue;

    if (iconKind === "human") {
      applyHumanIcon(group, humanPalettes[theme]);
      continue;
    }

    if (iconKind === "robot") {
      applyRobotIcon(group, robotPalettes[theme]);
    }
  }

  const textGroups = Array.from(doc.querySelectorAll<SVGTextElement>("text.actor"));
  for (const text of textGroups) {
    const value = text.textContent?.trim() ?? "";
    const iconKind = actorIcons[value];
    if (!iconKind) continue;
    const palette = iconKind === "human" ? humanPalettes[theme] : robotPalettes[theme];
    const style = text.getAttribute("style") ?? "";
    text.setAttribute("style", `${style}; fill:${palette.label}; font-weight:600; letter-spacing:0.01em;`);
  }

  return new XMLSerializer().serializeToString(doc.documentElement);
};

export function Mermaid({ chart, title, caption, actorIcons }: MermaidProps) {
  const rawId = useId();
  const diagramId = useMemo(() => `mermaid-${rawId.replace(/[:]/g, "")}`, [rawId]);
  const actorIconKey = useMemo(() => JSON.stringify(actorIcons ?? {}), [actorIcons]);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const render = async () => {
      try {
        const theme = getTheme();

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme,
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          sequence: {
            useMaxWidth: false,
          },
          flowchart: {
            useMaxWidth: false,
          },
        });

        const { svg: nextSvg } = await mermaid.render(diagramId, chart);
        const styledSvg = stylizeActorIcons(nextSvg, theme, actorIcons);

        if (!cancelled) {
          setSvg(styledSvg);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setSvg("");
        }
      }
    };

    void render();

    const observer = new MutationObserver(() => {
      void render();
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [actorIconKey, actorIcons, chart, diagramId]);

  return (
    <DiagramFrame title={title ?? "Diagram"} caption={caption}>
      {error ? (
        <div className="space-y-3">
          <p className="text-sm font-medium text-fd-primary">Mermaid render failed</p>
          <pre className="overflow-x-auto rounded-xl border border-fd-border/70 bg-fd-background/80 p-3 text-xs text-fd-muted-foreground">
            {error}
          </pre>
          <pre className="overflow-x-auto rounded-xl border border-fd-border/70 bg-fd-background/80 p-3 text-xs text-fd-muted-foreground">
            {chart}
          </pre>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[20px] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.65),transparent_42%),linear-gradient(to_bottom,var(--color-fd-card),var(--color-fd-background))] dark:bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_42%),linear-gradient(to_bottom,var(--color-fd-card),var(--color-fd-background))]">
          {svg ? (
            <div
              className="mermaid-diagram min-w-[44rem] text-fd-foreground [&_svg]:h-auto [&_svg]:w-full [&_svg]:max-w-none"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <div className="flex min-h-56 items-center justify-center rounded-xl border border-dashed border-fd-border bg-fd-background text-sm text-fd-muted-foreground">
              Rendering diagram…
            </div>
          )}
        </div>
      )}
    </DiagramFrame>
  );
}
