// Lore-by-turn tempo curve: two small multiples (wins | losses), each a
// two-series line. Small multiples rather than one four-series chart —
// four lines on one axis is unreadable, and faceting keeps the compare
// (you vs opponent) inside each panel where it belongs.
//
// Both panels share ONE y-scale so the two are actually comparable;
// that is the whole point of showing them side by side.
//
// Colors are the app accents snapped into the dark-mode OKLCH lightness
// band [0.48, 0.67] — validated (lightness/chroma/CVD ΔE 22.4/normal
// 22.8/contrast all pass against the --panel surface). Identity follows
// the ENTITY, not the panel: "you" is gold in both facets, always.
const YOU = '#ae8d40'
const OPP = '#6092dd'

export interface LorePoint {
  turn: number
  you: number
  opponent: number
  n?: number
}

function Facet({
  title,
  points,
  yMax,
  width = 300,
  height = 132,
}: {
  title: string
  points: LorePoint[]
  yMax: number
  width?: number
  height?: number
}) {
  if (points.length < 2) {
    return (
      <figure style={{ margin: 0 }}>
        <figcaption className="muted" style={{ fontSize: '0.85rem', marginBottom: 4 }}>
          {title}
        </figcaption>
        <p className="muted" style={{ fontSize: '0.8rem' }}>not enough games</p>
      </figure>
    )
  }
  const padL = 22
  const padR = 30 // room for the direct labels
  const padT = 8
  const padB = 18
  const turns = points.map((p) => p.turn)
  const tMin = Math.min(...turns)
  const tMax = Math.max(...turns)
  const x = (t: number) => padL + ((t - tMin) * (width - padL - padR)) / Math.max(1, tMax - tMin)
  const y = (v: number) => height - padB - (v * (height - padT - padB)) / yMax
  const line = (key: 'you' | 'opponent') =>
    points.map((p) => `${x(p.turn).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ')
  const last = points[points.length - 1]

  return (
    <figure style={{ margin: 0 }}>
      <figcaption className="muted" style={{ fontSize: '0.85rem', marginBottom: 4 }}>
        {title}
      </figcaption>
      <svg width={width} height={height} role="img" aria-label={`${title}: lore by turn`}>
        {/* recessive frame: baseline + the 20-lore win line, nothing more */}
        <line x1={padL} y1={height - padB} x2={width - padR} y2={height - padB}
          stroke="var(--border)" strokeWidth="1" />
        {yMax >= 20 && (
          <>
            <line x1={padL} y1={y(20)} x2={width - padR} y2={y(20)}
              stroke="var(--border)" strokeWidth="1" strokeDasharray="3 3" />
            <text x={2} y={y(20) + 4} fill="var(--muted)" fontSize="10">20</text>
          </>
        )}
        <text x={2} y={height - padB + 4} fill="var(--muted)" fontSize="10">0</text>
        <text x={padL} y={height - 4} fill="var(--muted)" fontSize="10">t{tMin}</text>
        <text x={width - padR - 12} y={height - 4} fill="var(--muted)" fontSize="10">t{tMax}</text>

        <polyline points={line('opponent')} fill="none" stroke={OPP} strokeWidth="2"
          strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={line('you')} fill="none" stroke={YOU} strokeWidth="2"
          strokeLinejoin="round" strokeLinecap="round" />

        {/* hit targets larger than the mark, per-point native tooltip */}
        {points.map((p) => (
          <g key={p.turn}>
            <circle cx={x(p.turn)} cy={y(p.you)} r="8" fill="transparent">
              <title>{`turn ${p.turn}: you ${p.you} lore${p.n ? ` (${p.n} games)` : ''}`}</title>
            </circle>
            <circle cx={x(p.turn)} cy={y(p.opponent)} r="8" fill="transparent">
              <title>{`turn ${p.turn}: opponent ${p.opponent} lore${p.n ? ` (${p.n} games)` : ''}`}</title>
            </circle>
          </g>
        ))}

        {/* direct labels — identity without reading the legend */}
        <text x={width - padR + 3} y={y(last.you) + 3} fill="var(--text)" fontSize="10">you</text>
        <text x={width - padR + 3} y={y(last.opponent) + 3} fill="var(--muted)" fontSize="10">opp</text>
      </svg>
    </figure>
  )
}

export default function LoreCurve({
  wins,
  losses,
  sample,
}: {
  wins: LorePoint[]
  losses: LorePoint[]
  sample: number
}) {
  const all = [...wins, ...losses]
  if (all.length === 0) return null
  const yMax = Math.max(20, ...all.map((p) => Math.max(p.you, p.opponent)))
  return (
    <div>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <Facet title="Games you won" points={wins} yMax={yMax} />
        <Facet title="Games you lost" points={losses} yMax={yMax} />
      </div>
      {/* legend is always present for 2 series; the swatch carries identity,
          the text stays in text tokens */}
      <p className="muted" style={{ fontSize: '0.8rem', marginTop: 4 }}>
        <span style={{ display: 'inline-block', width: 10, height: 2, background: YOU, verticalAlign: 'middle' }} />{' '}
        you{'  '}
        <span style={{ display: 'inline-block', width: 10, height: 2, background: OPP, verticalAlign: 'middle', marginLeft: 10 }} />{' '}
        opponent{'  '}· mean lore per turn over {sample} replayed games, same y-scale in both panels.
      </p>
    </div>
  )
}
