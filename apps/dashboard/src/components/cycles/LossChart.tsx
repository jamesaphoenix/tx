import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"
import type { RoundMetric } from "../../api/client"

interface LossChartProps {
  roundMetrics: RoundMetric[]
}

export function LossChart({ roundMetrics }: LossChartProps) {
  if (roundMetrics.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg border border-gray-700/50 p-6 text-center text-gray-500">
        No round metrics available
      </div>
    )
  }

  // Transform data for recharts — include weighted severity components
  const chartData = roundMetrics.map((m) => ({
    label: `C${m.cycle}R${m.round}`,
    "Total Loss": m.loss,
    "High (x3)": m.high * 3,
    "Medium (x2)": m.medium * 2,
    "Low (x1)": m.low,
  }))

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700/50 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-white">Loss Convergence</h3>
        <div className="text-[10px] text-gray-500">
          Loss = 3H + 2M + 1L
        </div>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="label"
            tick={{ fill: "#9CA3AF", fontSize: 11 }}
            axisLine={{ stroke: "#4B5563" }}
            tickLine={{ stroke: "#4B5563" }}
          />
          <YAxis
            tick={{ fill: "#9CA3AF", fontSize: 11 }}
            axisLine={{ stroke: "#4B5563" }}
            tickLine={{ stroke: "#4B5563" }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1F2937",
              border: "1px solid #374151",
              borderRadius: "8px",
              fontSize: 12,
            }}
            labelStyle={{ color: "#F3F4F6" }}
            itemStyle={{ color: "#D1D5DB" }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, color: "#9CA3AF" }}
          />
          <Line
            type="monotone"
            dataKey="Total Loss"
            stroke="#A78BFA"
            strokeWidth={2.5}
            dot={{ fill: "#A78BFA", r: 4 }}
            activeDot={{ r: 6 }}
          />
          <Line
            type="monotone"
            dataKey="High (x3)"
            stroke="#F87171"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            dot={{ fill: "#F87171", r: 3 }}
          />
          <Line
            type="monotone"
            dataKey="Medium (x2)"
            stroke="#FBBF24"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            dot={{ fill: "#FBBF24", r: 3 }}
          />
          <Line
            type="monotone"
            dataKey="Low (x1)"
            stroke="#34D399"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            dot={{ fill: "#34D399", r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
