// 响应时间面积图(React 岛屿,client:visible 懒注水;选型 Recharts 为用户点名,见 ADR-002)
// dataviz 约束:单序列免图例、2px 线、克制横向网格、tooltip 必配、色彩过校验器
import { fmtMs } from '../lib/format'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

interface Point {
  t: string
  ms: number
}

function ChartTip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Point & { time: string } }> }) {
  if (!active || !payload?.length) return null
  const p = payload[0]!.payload
  return (
    <div className="chart-tip">
      <p className="chart-tip-time">{p.time}</p>
      <p className="chart-tip-value">{fmtMs(p.ms)}</p>
    </div>
  )
}

export default function ResponseChart({ points }: { points: Point[] }) {
  const data = points.map((p) => ({
    ...p,
    time: new Date(p.t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
  }))
  return (
    <div style={{ width: '100%', height: 130 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="rt-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--t-ok)" stopOpacity={0.2} />
              <stop offset="100%" stopColor="var(--t-ok)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--t-line)" />
          <XAxis
            dataKey="time"
            tickLine={false}
            axisLine={false}
            minTickGap={72}
            tick={{ fill: 'var(--t-faint)', fontSize: 11 }}
            dy={6}
          />
          <YAxis
            width={56}
            tickLine={false}
            axisLine={false}
            tickCount={3}
            domain={[0, 'auto']}
            tick={{ fill: 'var(--t-faint)', fontSize: 11 }}
            tickFormatter={fmtMs}
          />
          <Tooltip content={<ChartTip />} cursor={{ stroke: 'var(--t-line-strong)' }} />
          <Area
            type="monotone"
            dataKey="ms"
            stroke="var(--t-ok)"
            strokeWidth={2}
            fill="url(#rt-fill)"
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0, fill: 'var(--t-ok)' }}
            animationDuration={400}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
