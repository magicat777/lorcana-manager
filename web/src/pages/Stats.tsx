import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { get, money } from '../api'
import Sparkline from '../components/Sparkline'
import type { SetStats, Totals } from '../types'

interface ValuePoint { day: string; value: string | number; cards_priced: number }
interface MoverRow {
  full_name: string; set_code: string; collector_number: string
  price_now: string | number; price_then: string | number; delta: string | number
}
interface Movers { days: number; gainers: MoverRow[]; losers: MoverRow[] }

function MoverTable({ rows }: { rows: MoverRow[] }) {
  return (
    <table>
      <tbody>
        {rows.map((m) => (
          <tr key={`${m.set_code}-${m.collector_number}`}>
            <td><Link to={`/cards/${m.set_code}/${m.collector_number}`}>{m.full_name}</Link></td>
            <td className={Number(m.delta) >= 0 ? 'ok' : 'error'}>
              {Number(m.delta) >= 0 ? '+' : ''}{money(m.delta)}
            </td>
            <td className="muted">{money(m.price_then)} → {money(m.price_now)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function Stats() {
  const [totals, setTotals] = useState<Totals | null>(null)
  const [sets, setSets] = useState<SetStats[]>([])
  const [history, setHistory] = useState<ValuePoint[]>([])
  const [movers, setMovers] = useState<Movers | null>(null)
  const [days, setDays] = useState(30)
  const [error, setError] = useState('')

  useEffect(() => {
    get<Totals>('/stats').then(setTotals).catch((e) => setError(String(e)))
    get<SetStats[]>('/stats/sets').then(setSets).catch((e) => setError(String(e)))
    get<ValuePoint[]>('/stats/value-history').then(setHistory).catch(() => {})
  }, [])
  useEffect(() => {
    get<Movers>('/stats/movers', { days }).then(setMovers).catch(() => {})
  }, [days])

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
      {history.length >= 2 && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>
            Collection value over time
            <span className="muted"> — today's collection at each weekly price snapshot</span>
          </h3>
          <Sparkline
            points={history.map((h) => ({ t: h.day, v: Number(h.value) }))}
            width={640} height={140} showRange
          />
          <p className="muted" style={{ margin: '0.3rem 0 0', fontSize: '0.8rem' }}>
            {history[0].day} → {history[history.length - 1].day} · {history.length} snapshots
          </p>
        </div>
      )}
      {history.length === 1 && (
        <p className="muted">
          First price snapshot captured {history[0].day} — the value-over-time chart appears
          after the next weekly refresh (Mondays).
        </p>
      )}

      {movers && (movers.gainers.length > 0 || movers.losers.length > 0) && (
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h3 style={{ marginTop: 0 }}>Price movers (owned cards)</h3>
            <span>
              {[30, 90].map((d) => (
                <button key={d} className={days === d ? '' : 'secondary'}
                  style={{ marginLeft: 6, padding: '0.15rem 0.6rem' }} onClick={() => setDays(d)}>
                  {d}d
                </button>
              ))}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
            {movers.gainers.length > 0 && (
              <div style={{ flex: '1 1 300px' }}>
                <p className="ok" style={{ margin: '0 0 0.3rem' }}>Gainers</p>
                <MoverTable rows={movers.gainers} />
              </div>
            )}
            {movers.losers.length > 0 && (
              <div style={{ flex: '1 1 300px' }}>
                <p className="error" style={{ margin: '0 0 0.3rem' }}>Losers</p>
                <MoverTable rows={movers.losers} />
              </div>
            )}
          </div>
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
