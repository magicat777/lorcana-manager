// Single-series price sparkline / mini line chart. One hue (the app accent),
// 2px line, 8px hover targets with native tooltips, recessive baseline — no
// legend needed for a single series (the label names it).
interface Pt {
  t: string
  v: number
}

export default function Sparkline({
  points, width = 240, height = 48, stroke = '#c8a24a', showRange = false,
  format = (v: number) => `$${v.toFixed(2)}`,
}: {
  points: Pt[]
  width?: number
  height?: number
  stroke?: string
  showRange?: boolean
  format?: (v: number) => string
}) {
  if (points.length < 2) return null
  const pad = 6
  const vs = points.map((p) => p.v)
  const min = Math.min(...vs)
  const max = Math.max(...vs)
  const span = max - min || 1
  const x = (i: number) => pad + (i * (width - 2 * pad)) / (points.length - 1)
  const y = (v: number) => height - pad - ((v - min) * (height - 2 * pad)) / span
  const path = points.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <svg width={width} height={height} role="img" aria-label={`price history, ${points.length} points`}>
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad}
          stroke="var(--border, #2c3352)" strokeWidth="1" />
        <polyline points={path} fill="none" stroke={stroke} strokeWidth="2"
          strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.v)} r="3" fill={stroke} />
            <circle cx={x(i)} cy={y(p.v)} r="8" fill="transparent">
              <title>{`${p.t}: ${format(p.v)}`}</title>
            </circle>
          </g>
        ))}
      </svg>
      {showRange && (
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          {format(min)}–{format(max)}
        </span>
      )}
    </span>
  )
}
