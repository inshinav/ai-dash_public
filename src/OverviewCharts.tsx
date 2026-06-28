import { TrendingUp } from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

// Compact axis/label numbers: 9 812 → "9,8k". Avoids the broken overlapping "0000" tick.
const compact = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(1).replace('.', ',')}k` : `${Math.round(value)}`

function ChartEmpty({ detail }: { detail: string }) {
  return (
    <div className="empty-state">
      <TrendingUp size={26} />
      <strong>Нет точек для графика</strong>
      <p>{detail}</p>
    </div>
  )
}

// Loaded lazily (React.lazy) so recharts (~350 KB) only ships when the Cockpit opens.
// recharts takes inline colours, not CSS vars, so we derive a theme-aware palette from
// the `theme` prop and re-render when it toggles. Platform comparison now lives in the
// scoreboard, so this renders just the one signal line: views over time.
export default function OverviewCharts({
  timeline,
  theme = 'dark',
}: {
  timeline: Array<{ date: string; views: number }>
  theme?: 'dark' | 'light'
}) {
  const light = theme === 'light'
  const axis = light ? '#5a6373' : '#7e8898'
  const grid = light ? 'rgba(90,99,115,.16)' : 'rgba(126,136,152,.14)'
  const accent = light ? '#b07d0a' : '#ffc24b'
  const tooltipStyle = light
    ? { background: '#ffffff', border: '1px solid #e2e7ef', borderRadius: 12, color: '#0e1420' }
    : { background: '#0d1118', border: '1px solid #28313f', borderRadius: 12, color: '#f4f7fb' }

  return (
    <section className="panel chart-panel cockpit-chart">
      <div className="panel-title">
        <div>
          <span className="eyebrow">ДИНАМИКА</span>
          <h2>Показы по датам</h2>
        </div>
      </div>
      {timeline.length ? (
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={timeline} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="viewsFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accent} stopOpacity={0.22} />
                <stop offset="100%" stopColor={accent} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={grid} vertical={false} />
            <XAxis dataKey="date" stroke={axis} fontSize={11} tickLine={false} axisLine={false} />
            <YAxis
              stroke={axis}
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={46}
              allowDecimals={false}
              tickFormatter={compact}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              cursor={{ stroke: grid }}
              formatter={(value) => [compact(Number(value) || 0), 'Показы']}
            />
            <Area
              type="monotone"
              dataKey="views"
              stroke={accent}
              strokeWidth={2}
              fill="url(#viewsFill)"
              dot={{ fill: accent, r: 3 }}
              activeDot={{ r: 5 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <ChartEmpty detail="Добавьте LIVE-публикации с датой и просмотрами." />
      )}
    </section>
  )
}
