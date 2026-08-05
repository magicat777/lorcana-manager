import { useEffect, useState } from 'react'
import { get, money } from '../api'
import type { SetStats, Totals } from '../types'

export default function Stats() {
  const [totals, setTotals] = useState<Totals | null>(null)
  const [sets, setSets] = useState<SetStats[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    get<Totals>('/stats').then(setTotals).catch((e) => setError(String(e)))
    get<SetStats[]>('/stats/sets').then(setSets).catch((e) => setError(String(e)))
  }, [])

  if (error) return <p className="error">{error}</p>

  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Collection stats</h1>
      {totals && (
        <div className="statrow">
          <div className="stat"><div className="k">Unique cards</div><div className="v">{totals.unique_owned} / {totals.catalog_cards}</div></div>
          <div className="stat"><div className="k">Normal copies</div><div className="v">{totals.total_normal}</div></div>
          <div className="stat"><div className="k">Foil copies</div><div className="v">{totals.total_foil}</div></div>
          <div className="stat"><div className="k">Est. value</div><div className="v">{money(totals.value_total)}</div></div>
        </div>
      )}
      {sets.map((s) => {
        const pct = s.cards_in_set ? (100 * s.unique_owned) / s.cards_in_set : 0
        const playsetPct = s.cards_in_set ? (100 * s.playsets) / s.cards_in_set : 0
        return (
          <div className="panel" key={s.code}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{s.code} — {s.name}</strong>
              <span className="muted">
                {s.unique_owned}/{s.cards_in_set} unique ({pct.toFixed(1)}%) · {s.total_qty} copies · {money(s.value)}
              </span>
            </div>
            <div style={{ margin: '0.5rem 0 0.3rem' }} className="progress">
              <div style={{ width: `${pct}%` }} />
            </div>
            <div className="progress playset" title="Playsets (4+ copies)">
              <div style={{ width: `${playsetPct}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
