import { useRef, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { fetchers, type DocGraphNode, type DocGraphEdge } from "../../api/client"

interface DocGraphProps {
  selectedDocName?: string | null
  onSelectDoc?: (name: string) => void
  fullPage?: boolean
}

const KIND_COLORS: Record<string, string> = {
  overview: "#60A5FA", // blue-400
  prd: "#34D399",      // green-400
  design: "#A78BFA",   // purple-400
  task: "#FBBF24",     // yellow-400
}

interface PositionedNode extends DocGraphNode {
  x: number
  y: number
}

/**
 * Simple force-directed layout (static computation).
 * Positions nodes in a top-down hierarchy: overview -> prd -> design.
 */
function layoutNodes(nodes: DocGraphNode[], _edges: DocGraphEdge[], canvasWidth = 300, canvasHeight = 320): PositionedNode[] {
  if (nodes.length === 0) return []

  // Group by kind for vertical layering
  const layers: Record<string, DocGraphNode[]> = { overview: [], prd: [], design: [], task: [] }
  for (const node of nodes) {
    const kind = node.kind in layers ? node.kind : "task"
    layers[kind].push(node)
  }

  const positioned: PositionedNode[] = []
  const layerOrder = ["overview", "prd", "design", "task"]
  const yStep = canvasHeight / 5
  const layerY: Record<string, number> = {
    overview: yStep,
    prd: yStep * 2,
    design: yStep * 3,
    task: yStep * 4,
  }

  for (const kind of layerOrder) {
    const layerNodes = layers[kind]
    if (layerNodes.length === 0) continue

    const maxSpacing = canvasWidth * 0.4
    const spacing = Math.min(maxSpacing, (canvasWidth * 0.8) / Math.max(1, layerNodes.length))
    const startX = (canvasWidth - spacing * (layerNodes.length - 1)) / 2

    for (let i = 0; i < layerNodes.length; i++) {
      positioned.push({
        ...layerNodes[i],
        x: startX + i * spacing,
        y: layerY[kind],
      })
    }
  }

  return positioned
}

export function DocGraph({ selectedDocName, onSelectDoc, fullPage }: DocGraphProps) {
  const canvasRef = useRef<SVGSVGElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ["doc-graph"],
    queryFn: fetchers.docGraph,
    refetchInterval: 30000,
  })

  const nodes = data?.nodes ?? []
  const edges = data?.edges ?? []
  const canvasW = fullPage ? 500 : 300
  const canvasH = fullPage ? 400 : 320
  const positioned = useMemo(() => layoutNodes(nodes, edges, canvasW, canvasH), [nodes, edges, canvasW, canvasH])

  // Build node position lookup
  const nodePos = useMemo(() => {
    const map = new Map<string, PositionedNode>()
    for (const n of positioned) map.set(n.id, n)
    return map
  }, [positioned])

  if (isLoading) {
    return (
      <div className="animate-pulse bg-gray-800 rounded-lg h-full" />
    )
  }

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-xs">
        No doc graph data
      </div>
    )
  }

  const nodeRadius = fullPage ? 14 : 7
  const selectedRadius = fullPage ? 18 : 10
  const fontSize = fullPage ? 12 : 8
  const labelMaxLen = fullPage ? 28 : 15
  const edgeWidth = fullPage ? 2.5 : 1.5

  return (
    <div className={fullPage ? "absolute inset-0" : "relative"}>
      <svg
        ref={canvasRef}
        viewBox={`0 0 ${canvasW} ${canvasH}`}
        className={fullPage ? "absolute inset-0 w-full h-full" : "w-full h-full"}
        style={fullPage ? undefined : { maxHeight: 220 }}
        preserveAspectRatio="xMidYMid meet"
      >
        <rect x={0} y={0} width={canvasW} height={canvasH} fill="#0f172a" opacity={0.08} rx={12} />

        {/* Edges */}
        {edges.map((edge, i) => {
          const from = nodePos.get(edge.source)
          const to = nodePos.get(edge.target)
          if (!from || !to) return null
          return (
            <line
              key={`edge-${i}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="#64748b"
              strokeWidth={edgeWidth}
              opacity={0.9}
            />
          )
        })}

        {/* Nodes */}
        {positioned.map((node) => {
          const isSelected = selectedDocName === node.label
          const color = KIND_COLORS[node.kind] ?? "#9CA3AF"
          const truncated = node.label.length > labelMaxLen ? node.label.slice(0, labelMaxLen - 1) + "..." : node.label
          return (
            <g
              key={node.id}
              onClick={() => onSelectDoc?.(node.label)}
              className="cursor-pointer"
            >
              <circle
                cx={node.x}
                cy={node.y}
                r={isSelected ? selectedRadius : nodeRadius}
                fill={color}
                stroke={isSelected ? "#ffffff" : "#e2e8f0"}
                strokeWidth={isSelected ? 2.5 : 1}
                opacity={1}
              />
              <title>{node.label} ({node.kind})</title>
              <text
                x={node.x}
                y={node.y + (fullPage ? 22 : 18)}
                textAnchor="middle"
                fill={fullPage ? "#cbd5e1" : "#334155"}
                fontSize={fontSize}
                fontWeight={600}
                className="pointer-events-none"
              >
                {truncated}
              </text>
            </g>
          )
        })}
      </svg>

      {fullPage && (
        <div className="absolute right-4 top-4 rounded border border-gray-700/80 bg-gray-900/85 px-3 py-2 text-[11px] text-gray-200">
          <div className="font-semibold text-gray-100 mb-1">Legend</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: KIND_COLORS.overview }} /> Overview</div>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: KIND_COLORS.prd }} /> PRD</div>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: KIND_COLORS.design }} /> Design</div>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: KIND_COLORS.task }} /> Task</div>
          </div>
        </div>
      )}
    </div>
  )
}
