import { useRef, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { fetchers, type DocGraphNode, type DocGraphEdge } from "../../api/client"

interface DocGraphProps {
  selectedDocName?: string | null
  onSelectDoc?: (name: string) => void
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
function layoutNodes(nodes: DocGraphNode[], _edges: DocGraphEdge[]): PositionedNode[] {
  if (nodes.length === 0) return []

  // Group by kind for vertical layering
  const layers: Record<string, DocGraphNode[]> = { overview: [], prd: [], design: [], task: [] }
  for (const node of nodes) {
    const kind = node.kind in layers ? node.kind : "task"
    layers[kind].push(node)
  }

  const positioned: PositionedNode[] = []
  const layerOrder = ["overview", "prd", "design", "task"]
  const layerY: Record<string, number> = { overview: 40, prd: 120, design: 200, task: 280 }

  for (const kind of layerOrder) {
    const layerNodes = layers[kind]
    if (layerNodes.length === 0) continue

    const spacing = Math.min(120, 280 / Math.max(1, layerNodes.length))
    const startX = (300 - spacing * (layerNodes.length - 1)) / 2

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

export function DocGraph({ selectedDocName, onSelectDoc }: DocGraphProps) {
  const canvasRef = useRef<SVGSVGElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ["doc-graph"],
    queryFn: fetchers.docGraph,
    refetchInterval: 30000,
  })

  const nodes = data?.nodes ?? []
  const edges = data?.edges ?? []
  const positioned = useMemo(() => layoutNodes(nodes, edges), [nodes, edges])

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

  return (
    <svg
      ref={canvasRef}
      viewBox="0 0 300 320"
      className="w-full h-full"
      style={{ maxHeight: 200 }}
    >
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
            stroke="#4B5563"
            strokeWidth="1.5"
            opacity={0.6}
          />
        )
      })}

      {/* Nodes */}
      {positioned.map((node) => {
        const isSelected = selectedDocName === node.id
        const color = KIND_COLORS[node.kind] ?? "#9CA3AF"
        return (
          <g
            key={node.id}
            onClick={() => onSelectDoc?.(node.id)}
            className="cursor-pointer"
          >
            <circle
              cx={node.x}
              cy={node.y}
              r={isSelected ? 10 : 7}
              fill={color}
              stroke={isSelected ? "#fff" : "transparent"}
              strokeWidth={isSelected ? 2 : 0}
              opacity={isSelected ? 1 : 0.8}
            />
            <title>{node.label} ({node.kind})</title>
            <text
              x={node.x}
              y={node.y + 18}
              textAnchor="middle"
              fill="#9CA3AF"
              fontSize="8"
              className="pointer-events-none"
            >
              {node.label.length > 15 ? node.label.slice(0, 14) + "..." : node.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
