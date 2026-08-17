// Multi-series time chart for collection history: real time on the x-axis
// (import snapshots land mid-day, between the daily points), optional vertical
// markers for uploads, legend with latest values. SVG-only like Sparkline —
// no chart library.
export interface TsPoint {
  t: string // ISO timestamp
  v: number
}
export interface TsSeries {
  name: string
  color: string
  points: TsPoint[]
}
export interface TsMarker {
  t: string
  label: string
}

export default function TimeSeries({
  series, markers = [], width = 680, height = 220,
  format = (v: number) => String(Math.round(v)),
}: {
  series: TsSeries[]
  markers?: TsMarker[]
  width?: number
  height?: number
  format?: (v: number) => string
}) {
  const drawn = series.filter((s) => s.points.length > 0)
  const all = drawn.flatMap((s) => s.points)
  if (all.length < 2) return null

  const padL = 44
  const padR = 10
  const padT = 8
  const padB = 18
  const ts = all.map((p) => Date.parse(p.t))
  const t0 = Math.min(...ts)
  const t1 = Math.max(...ts)
  const tSpan = t1 - t0 || 1
  const vs = all.map((p) => p.v)
  let vMin = Math.min(...vs)
  let vMax = Math.max(...vs)
  if (vMin === vMax) {
    vMin -= 1
    vMax += 1
  }
  const vSpan = vMax - vMin
  const x = (t: string) => padL + ((Date.parse(t) - t0) * (width - padL - padR)) / tSpan
  const y = (v: number) => padT + ((vMax - v) * (height - padT - padB)) / vSpan

  const day = (t: string) => new Date(t).toLocaleDateString()

  return (
    <div>
      <svg width={width} height={height} role="img" aria-label="collection history chart"
        style={{ maxWidth: '100%' }}>
        {[vMax, (vMax + vMin) / 2, vMin].map((v, i) => (
          <g key={i}>
            <line x1={padL} y1={y(v)} x2={width - padR} y2={y(v)}
              stroke="var(--border, #2c3352)" strokeWidth="1"
              strokeDasharray={i === 2 ? undefined : '3 4'} />
            <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontSize="10"
              fill="var(--muted, #8b93b8)">{format(v)}</text>
          </g>
        ))}
        <text x={padL} y={height - 4} fontSize="10" fill="var(--muted, #8b93b8)">
          {day(new Date(t0).toISOString())}
        </text>
        <text x={width - padR} y={height - 4} textAnchor="end" fontSize="10"
          fill="var(--muted, #8b93b8)">
          {day(new Date(t1).toISOString())}
        </text>
        {markers.map((m, i) => (
          <g key={`m${i}`}>
            <line x1={x(m.t)} y1={padT} x2={x(m.t)} y2={height - padB}
              stroke="var(--muted, #8b93b8)" strokeWidth="1" strokeDasharray="2 3" />
            <circle cx={x(m.t)} cy={padT + 4} r="7" fill="transparent">
              <title>{`${day(m.t)} — ${m.label}`}</title>
            </circle>
            <circle cx={x(m.t)} cy={padT + 4} r="2.5" fill="var(--muted, #8b93b8)" />
          </g>
        ))}
        {drawn.map((s) => (
          <g key={s.name}>
            <polyline fill="none" stroke={s.color} strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round"
              points={s.points.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')} />
            {s.points.map((p, i) => (
              <g key={i}>
                <circle cx={x(p.t)} cy={y(p.v)} r="2.5" fill={s.color} />
                <circle cx={x(p.t)} cy={y(p.v)} r="7" fill="transparent">
                  <title>{`${day(p.t)} · ${s.name}: ${format(p.v)}`}</title>
                </circle>
              </g>
            ))}
          </g>
        ))}
      </svg>
      {(drawn.length > 1 || drawn[0].name !== 'Total') && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem 1rem', marginTop: 4 }}>
          {drawn.map((s) => (
            <span key={s.name} style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
              <span style={{
                display: 'inline-block', width: 10, height: 10, borderRadius: 2,
                background: s.color, marginRight: 4, verticalAlign: 'baseline',
              }} />
              {s.name}
              <span className="muted"> {format(s.points[s.points.length - 1].v)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
