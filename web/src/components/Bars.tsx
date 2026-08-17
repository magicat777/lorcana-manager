// Horizontal bar chart for a single snapshot's breakdown — used when a
// breakdown has fewer than two time points (lines need history, bars don't).
export interface Bar {
  name: string
  color: string
  value: number
}

export default function Bars({ bars, format = (v: number) => String(Math.round(v)) }: {
  bars: Bar[]
  format?: (v: number) => string
}) {
  const max = Math.max(...bars.map((b) => b.value), 1)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '0.25rem 0.6rem',
      alignItems: 'center', maxWidth: 560 }}>
      {bars.map((b) => (
        <div key={b.name} style={{ display: 'contents' }}>
          <span style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{b.name}</span>
          <div style={{ background: 'var(--border, #2c3352)', borderRadius: 3, height: 14 }}>
            <div style={{ width: `${(100 * b.value) / max}%`, background: b.color,
              height: '100%', borderRadius: 3, minWidth: b.value > 0 ? 2 : 0 }} />
          </div>
          <span className="muted" style={{ fontSize: '0.85rem' }}>{format(b.value)}</span>
        </div>
      ))}
    </div>
  )
}
