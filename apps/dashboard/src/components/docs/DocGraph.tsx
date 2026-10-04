import { useId, useRef, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { fetchers, type DocGraphNode, type DocGraphEdge } from "../../api/client"
import { Button } from "../ui"

interface DocGraphProps {
  selectedNodeId?: string | null
  onSelectDoc?: (docDbId: number) => void
  onSelectTask?: (taskId: string) => void
  fullPage?: boolean
}

const KIND_COLORS = new Map<string, string>(Object.entries({
  overview: "#60A5FA",
  prd: "#34D399",
  design: "#A78BFA",
  requirement: "#F472B6",
  system_design: "#FB923C",
  runbook: "#22C55E",
  decision: "#EAB308",
  plan: "#38BDF8",
  task: "#FBBF24",
}))

const KIND_LABELS = new Map<string, string>(Object.entries({
  overview: "Overview",
  prd: "PRD",
  design: "Design",
  requirement: "Requirement",
  system_design: "System Design",
  runbook: "Runbook",
  decision: "Decision",
  plan: "Plan",
  task: "Task",
}))

interface PositionedNode extends DocGraphNode {
  x: number
  y: number
}

/**
 * Layer-based layout with force relaxation to prevent overlaps.
 */
function layoutNodes(nodes: DocGraphNode[], _edges: DocGraphEdge[], w: number, h: number): PositionedNode[] {
  if (nodes.length === 0) return []

  const builtinOrder = ["overview", "requirement", "prd", "system_design", "design", "runbook", "decision"]
  const customKinds = [...new Set(nodes.map(node => node.kind))]
    .filter(kind => !builtinOrder.includes(kind) && kind !== "plan" && kind !== "task").sort()
  const layerOrder = [...builtinOrder, ...customKinds, "plan", "task"]
  const layers = new Map<string, DocGraphNode[]>()
  for (const node of nodes) {
    const layer = layers.get(node.kind) ?? []
    layer.push(node)
    layers.set(node.kind, layer)
  }
  const positioned: PositionedNode[] = []
  const activeLayers = layerOrder.filter(kind => layers.has(kind))

  const padX = w * 0.1

  // Cap vertical gap between layers so few-node graphs stay compact and centered
  const maxLayerGap = 100
  const yStep = activeLayers.length > 1
    ? Math.min(maxLayerGap, (h * 0.6) / (activeLayers.length - 1))
    : 0
  const totalLayerH = yStep * (activeLayers.length - 1)
  const startY = (h - totalLayerH) / 2

  // Cap horizontal spacing so nodes don't fly to edges
  const maxNodeGap = 160
  const usableW = w - padX * 2

  for (let li = 0; li < activeLayers.length; li++) {
    const kind = activeLayers[li]
    const layerNodes = layers.get(kind)!
    const y = startY + li * yStep

    const rawSpacing = usableW / (layerNodes.length + 1)
    const spacing = Math.min(maxNodeGap, rawSpacing)
    const totalW = spacing * (layerNodes.length - 1)
    const layerStartX = (w - totalW) / 2

    for (let i = 0; i < layerNodes.length; i++) {
      positioned.push({
        ...layerNodes[i],
        x: layerStartX + i * spacing,
        y,
      })
    }
  }

  // Force relaxation: push apart overlapping nodes
  for (let iter = 0; iter < 40; iter++) {
    for (let i = 0; i < positioned.length; i++) {
      for (let j = i + 1; j < positioned.length; j++) {
        const dx = positioned[j].x - positioned[i].x
        const dy = positioned[j].y - positioned[i].y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const minDist = 90
        if (dist < minDist && dist > 0.1) {
          const push = ((minDist - dist) / dist) * 0.25
          positioned[j].x += dx * push
          positioned[i].x -= dx * push
          positioned[j].y += dy * push * 0.15
          positioned[i].y -= dy * push * 0.15
        }
      }
    }
    for (const n of positioned) {
      n.x = Math.max(padX + 30, Math.min(w - padX - 30, n.x))
      n.y = Math.max(40, Math.min(h - 40, n.y))
    }
  }

  return positioned
}

/** Cubic bezier curve between two points (vertical bias). */
function edgePath(x1: number, y1: number, x2: number, y2: number, nodeR: number): string {
  const dx = x2 - x1
  const dy = y2 - y1
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist < 0.1) return `M ${x1} ${y1} L ${x2} ${y2}`

  // Shorten by node radius so arrow sits at the edge, not center
  const ratio1 = nodeR / dist
  const ratio2 = (dist - nodeR - 4) / dist
  const sx = x1 + dx * ratio1
  const sy = y1 + dy * ratio1
  const ex = x1 + dx * ratio2
  const ey = y1 + dy * ratio2

  // Control point offset for a gentle curve
  const cpOff = Math.min(Math.abs(dy) * 0.4, 60)
  const cpx = (sx + ex) / 2 + (dy > 0 ? cpOff * 0.3 : -cpOff * 0.3)
  const midY = (sy + ey) / 2

  return `M ${sx} ${sy} Q ${cpx} ${midY}, ${ex} ${ey}`
}

function displayDirection(edge: DocGraphEdge): [string, string] {
  return edge.source.startsWith("task:") && edge.target.startsWith("doc:")
    ? [edge.target, edge.source] : [edge.source, edge.target]
}

export function DocGraph({ selectedNodeId, onSelectDoc, onSelectTask, fullPage }: DocGraphProps) {
  const canvasRef = useRef<SVGSVGElement>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const svgId = useId().replace(/:/g, "")
  const definitions = {arrow:`${svgId}-arrow`,highlight:`${svgId}-arrow-highlight`,glow:`${svgId}-node-glow`,grid:`${svgId}-dot-grid`}

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["doc-graph"],
    queryFn: fetchers.docGraph,
    refetchInterval: 30000,
  })

  const nodes = data?.nodes ?? []
  const edges = data?.edges ?? []
  const canvasW = fullPage ? 800 : 400
  const canvasH = fullPage ? 500 : 320
  const positioned = useMemo(() => layoutNodes(nodes, edges, canvasW, canvasH), [nodes, edges, canvasW, canvasH])

  const nodePos = useMemo(() => {
    const map = new Map<string, PositionedNode>()
    for (const n of positioned) map.set(n.id, n)
    return map
  }, [positioned])

  // Track which nodes are connected to hovered/selected for highlighting
  const connectedToFocus = useMemo(() => {
    const focusId = focusedId ?? hoveredId ?? selectedNodeId
    if (!focusId) return null
    const focusNode = positioned.find((n) => n.id === focusId)
    if (!focusNode) return null
    const ids = new Set<string>([focusNode.id])
    const descendants = new Map<string,string[]>()
    const ancestors = new Map<string,string[]>()
    for (const e of edges) {
      // Task attachments describe what a task implements. Display their path
      // in the document -> task direction used by the layout.
      const [source,target] = displayDirection(e)
      descendants.set(source,[...(descendants.get(source) ?? []),target])
      ancestors.set(target,[...(ancestors.get(target) ?? []),source])
    }
    for (const direction of [ancestors,descendants]) {
      const visited = new Set([focusNode.id])
      const queue = [focusNode.id]
      for (let index = 0; index < queue.length; index++) {
        for (const next of direction.get(queue[index]!) ?? []) {
          if (visited.has(next)) continue
          visited.add(next)
          ids.add(next)
          queue.push(next)
        }
      }
    }
    return ids
  }, [focusedId, hoveredId, selectedNodeId, positioned, edges])

  if (isLoading) {
    return <div role="status" aria-label="Loading document graph" className="animate-pulse bg-gray-800 rounded-lg h-full" />
  }

  if (error) return <div role="alert" className="p-6 text-sm text-amber-400">
    <p>Could not load document graph: {error.message}</p>
    <Button className="mt-3" onClick={() => { void refetch() }}>Retry graph</Button>
  </div>

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-xs">
        No doc graph data
      </div>
    )
  }

  const nodeR = fullPage ? 6 : 5
  const selectedR = fullPage ? 8 : 7
  const fontSize = fullPage ? 11 : 8.5
  const labelMaxLen = fullPage ? 30 : 18

  return (
    <div className={fullPage ? "absolute inset-0" : "relative"}>
      <svg
        ref={canvasRef}
        viewBox={`0 0 ${canvasW} ${canvasH}`}
        className={fullPage ? "absolute inset-0 w-full h-full" : "w-full h-full"}
        style={fullPage ? undefined : { maxHeight: 220 }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {/* Arrow marker */}
          <marker
            id={definitions.arrow}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 8 5 L 0 9 z" fill="#475569" className="graph-arrow" />
          </marker>
          <marker
            id={definitions.highlight}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 8 5 L 0 9 z" fill="#94a3b8" className="graph-arrow" />
          </marker>
          {/* Glow filter for selected node */}
          <filter id={definitions.glow} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Subtle dot pattern for background */}
          <pattern id={definitions.grid} x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
            <circle cx="10" cy="10" r="0.5" fill="#334155" opacity="0.5" className="graph-dot" />
          </pattern>
        </defs>

        {/* Background */}
        <rect x={0} y={0} width={canvasW} height={canvasH} fill={`url(#${definitions.grid})`} rx={8} />

        {/* Edges */}
        <g pointerEvents="none">
          {edges.map((edge, i) => {
            const [source, target] = displayDirection(edge)
            const from = nodePos.get(source)
            const to = nodePos.get(target)
            if (!from || !to) return null
            const isHighlighted = connectedToFocus?.has(edge.source) && connectedToFocus?.has(edge.target)
            return (
              <path
                key={`edge-${i}`}
                d={edgePath(from.x, from.y, to.x, to.y, nodeR)}
                fill="none"
                stroke={isHighlighted ? "#94a3b8" : "#334155"}
                className={connectedToFocus && !isHighlighted ? "graph-edge-dim" : "graph-edge"}
                strokeWidth={isHighlighted ? 1.5 : 1}
                opacity={connectedToFocus && !isHighlighted ? 0.2 : 1}
                markerEnd={`url(#${isHighlighted ? definitions.highlight : definitions.arrow})`}
                style={{ transition: "stroke 200ms, opacity 200ms" }}
              />
            )
          })}
        </g>

        {/* Nodes */}
        <g>
          {positioned.map((node) => {
            const isSelected = selectedNodeId === node.id
            const isHovered = hoveredId === node.id || focusedId === node.id
            const color = KIND_COLORS.get(node.kind) ?? "#9CA3AF"
            const dimmed = connectedToFocus && !connectedToFocus.has(node.id)
            const truncated = node.label.length > labelMaxLen
              ? node.label.slice(0, labelMaxLen - 1) + "\u2026"
              : node.label
            const r = isSelected || isHovered ? selectedR : nodeR
            const interactive = node.id.startsWith("task:") ? Boolean(onSelectTask) : Boolean(onSelectDoc)
            const selectNode = () => {
              if (node.id.startsWith("task:")) { onSelectTask?.(node.id.slice(5)); return }
              if (!node.id.startsWith("doc:")) return
              const parsed = Number(node.id.slice(4))
              if (Number.isInteger(parsed)) onSelectDoc?.(parsed)
            }

            return (
              <g
                key={node.id}
                role={interactive ? "button" : undefined}
                tabIndex={interactive ? 0 : undefined}
                aria-label={interactive ? `${node.kind}: ${node.label}` : undefined}
                onClick={selectNode}
                onKeyDown={event => {
                  if (interactive && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); selectNode() }
                }}
                onFocus={() => setFocusedId(node.id)}
                onBlur={() => setFocusedId(null)}
                onMouseEnter={() => setHoveredId(node.id)}
                onMouseLeave={() => setHoveredId(null)}
                className={interactive ? "cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400" : ""}
                style={{
                  opacity: dimmed ? 0.25 : 1,
                  transition: "opacity 200ms ease",
                }}
              >
                {/* Glow ring for selected */}
                {(isSelected || isHovered) && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={r + 6}
                    fill="none"
                    stroke={color}
                    strokeWidth={1}
                    opacity={0.3}
                    filter={`url(#${definitions.glow})`}
                  />
                )}
                {/* Node dot */}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={r}
                  fill={color}
                  stroke={isSelected ? "#ffffff" : "none"}
                  strokeWidth={isSelected ? 1.5 : 0}
                />
                <title>{node.label} ({node.kind})</title>
                {/* Label */}
                <text
                  x={node.x}
                  y={node.y + (fullPage ? 20 : 15)}
                  textAnchor="middle"
                  fill={isSelected || isHovered ? "#e2e8f0" : "#94a3b8"}
                  className={isSelected || isHovered ? "graph-label-focus" : "graph-label"}
                  fontSize={fontSize}
                  fontWeight={isSelected ? 600 : 500}
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  style={{ transition: "fill 200ms ease" }}
                >
                  {truncated}
                </text>
              </g>
            )
          })}
        </g>
      </svg>

      {/* Legend */}
      {fullPage && (
        <div className="absolute right-4 top-4 rounded-lg border border-gray-700/60 bg-gray-900/90 backdrop-blur-sm px-3 py-2.5 text-[11px] text-gray-300">
          <div className="font-semibold text-gray-100 mb-1.5 text-[10px] uppercase tracking-wider">Legend</div>
          <div className="space-y-1">
            {Array.from(new Set(nodes.map(node => node.kind))).map(kind => (
              <div key={kind} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: KIND_COLORS.get(kind) ?? "#9CA3AF" }} />
                <span>{KIND_LABELS.get(kind) ?? kind}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
