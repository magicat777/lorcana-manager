import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { get, money } from '../api'
import TimeSeries from '../components/TimeSeries'
import type { TsMarker, TsSeries } from '../components/TimeSeries'
import type { SetStats, SnapshotBucket, SnapshotRow, Totals } from '../types'

interface ValuePoint { day: string; value: string | number; cards_priced: number }
interface MoverRow {
  full_name: string; set_code: string; collector_number: string
  price_now: string | number; price_then: string | number; delta: string | number
}
interface Movers { days: number; gainers: MoverRow[]; losers: MoverRow[] }

type Metric = 'value' | 'copies' | 'unique'
type Dim = 'none' | 'rarity' | 'ink' | 'set' | 'type' | 'cost'
type Range = '1w' | '1m' | '3m' | '6m' | '1y' | 'all'

const RANGE_DAYS: Record<Range, number> = {
  '1w': 7, '1m': 30, '3m': 91, '6m': 182, '1y': 365, all: Infinity,
}
const RANGE_LABEL: Record<Range, string> = {
  '1w': 'Week', '1m': 'Month', '3m': '3 months', '6m': '6 months', '1y': 'Year', all: 'All',
}
const METRIC_LABEL: Record<Metric, string> = {
  value: 'Value ($)', copies: 'Total copies', unique: 'Unique cards',
}
const DIM_LABEL: Record<Dim, string> = {
  none: 'Total only', rarity: 'By rarity', ink: 'By ink', set: 'By set',
  type: 'By card type', cost: 'By ink cost',
}

const INK_COLORS: Record<string, string> = {
  Amber: '#f4b81f', Amethyst: '#8e4f9f', Emerald: '#388c43',
  Ruby: '#d2082f', Sapphire: '#0089c3', Steel: '#9fa9b3',
}
const PALETTE = ['#c8a24a', '#3f8ed0', '#e35d8a', '#58b85c', '#8f5cc9',
  '#e8a33d', '#4fc3c7', '#b5722f', '#7986cb', '#90a4ae']
const MAX_LINES = 8

const bucketVal = (b: SnapshotBucket | undefined, m: Metric): number =>
  !b ? 0 : m === 'value' ? b.v : m === 'copies' ? b.c : b.u
const snapTotal = (s: SnapshotRow, m: Metric): number =>
  m === 'value' ? Number(s.value_usd) : m === 'copies' ? s.total_cards : s.unique_cards

function seriesColor(dim: Dim, name: string, i: number): string {
  if (name === 'Other') return '#666e8c'
  if (dim === 'ink' && INK_COLORS[name]) return INK_COLORS[name]
  return PALETTE[i % PALETTE.length]
}

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

function HistoryPanel({ snaps, legacy }: { snaps: SnapshotRow[]; legacy: ValuePoint[] }) {
  const [metric, setMetric] = useState<Metric>('value')
  const [dim, setDim] = useState<Dim>('none')
  const [range, setRange] = useState<Range>('3m')

  const { series, markers } = useMemo(() => {
    const cutoff = Date.now() - RANGE_DAYS[range] * 86400e3
    const inRange = snaps.filter(
      (s) => range === 'all' || Date.parse(s.captured_at) >= cutoff,
    )
    const markers: TsMarker[] = inRange
      .filter((s) => s.source === 'import')
      .map((s) => ({
        t: s.captured_at,
        label: `Import: ${s.import_note || s.import_filename || `#${s.import_id}`}`,
      }))

    if (dim === 'none') {
      const points = inRange.map((s) => ({ t: s.captured_at, v: snapTotal(s, metric) }))
      if (metric === 'value') {
        // Weekly price-snapshot values from before daily snapshots began keep
        // the chart's history from starting at day one of this feature.
        const firstSnap = inRange.length ? Date.parse(inRange[0].captured_at) : Infinity
        const prefix = legacy
          .filter((h) => Date.parse(h.day) < firstSnap
            && (range === 'all' || Date.parse(h.day) >= cutoff))
          .map((h) => ({ t: h.day, v: Number(h.value) }))
        points.unshift(...prefix)
      }
      return { series: [{ name: 'Total', color: '#c8a24a', points }] as TsSeries[], markers }
    }

    // Rank buckets by the latest snapshot, draw the top N, sum the rest.
    const latest = inRange[inRange.length - 1]
    if (!latest) return { series: [] as TsSeries[], markers }
    const allKeys = Object.keys(latest.breakdown[dim] || {})
    allKeys.sort((a, b) => {
      if (dim === 'cost') return (a === '?' ? 99 : Number(a)) - (b === '?' ? 99 : Number(b))
      return bucketVal(latest.breakdown[dim][b], metric) - bucketVal(latest.breakdown[dim][a], metric)
    })
    const top = allKeys.slice(0, MAX_LINES)
    const hasOther = allKeys.length > MAX_LINES
    const series: TsSeries[] = top.map((k, i) => ({
      name: k,
      color: seriesColor(dim, k, i),
      points: inRange.map((s) => ({
        t: s.captured_at, v: bucketVal(s.breakdown[dim]?.[k], metric),
      })),
    }))
    if (hasOther) {
      series.push({
        name: 'Other',
        color: seriesColor(dim, 'Other', 0),
        points: inRange.map((s) => ({
          t: s.captured_at,
          v: Object.entries(s.breakdown[dim] || {})
            .filter(([k]) => !top.includes(k))
            .reduce((sum, [, b]) => sum + bucketVal(b, metric), 0),
        })),
      })
    }
    return { series, markers }
  }, [snaps, legacy, metric, dim, range])

  const fmt = metric === 'value'
    ? (v: number) => `$${v >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(2)}`
    : (v: number) => String(Math.round(v))
  const havePoints = series.some((s) => s.points.length >= 2)

  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        flexWrap: 'wrap', gap: '0.5rem' }}>
        <h3 style={{ margin: 0 }}>Collection over time</h3>
        <span style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
            {(Object.keys(METRIC_LABEL) as Metric[]).map((m) => (
              <option key={m} value={m}>{METRIC_LABEL[m]}</option>
            ))}
          </select>
          <select value={dim} onChange={(e) => setDim(e.target.value as Dim)}>
            {(Object.keys(DIM_LABEL) as Dim[]).map((d) => (
              <option key={d} value={d}>{DIM_LABEL[d]}</option>
            ))}
          </select>
          <select value={range} onChange={(e) => setRange(e.target.value as Range)}>
            {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
              <option key={r} value={r}>{RANGE_LABEL[r]}</option>
            ))}
          </select>
        </span>
      </div>
      {havePoints ? (
        <>
          <div style={{ marginTop: '0.5rem', overflowX: 'auto' }}>
            <TimeSeries series={series} markers={markers} format={fmt} />
          </div>
          <p className="muted" style={{ margin: '0.3rem 0 0', fontSize: '0.8rem' }}>
            Daily snapshots + one per import (dotted lines — hover for the upload note).
            Prices refresh weekly (Mondays), so between refreshes value moves only when
            cards are added or removed.
          </p>
        </>
      ) : (
        <p className="muted" style={{ marginBottom: 0 }}>
          Not enough snapshots in this window yet — the daily snapshot job adds one point
          per day (plus one per upload). Try a longer range, or check back tomorrow.
        </p>
      )}
    </div>
  )
}

export default function Stats() {
  const [totals, setTotals] = useState<Totals | null>(null)
  const [sets, setSets] = useState<SetStats[]>([])
  const [snaps, setSnaps] = useState<SnapshotRow[]>([])
  const [legacy, setLegacy] = useState<ValuePoint[]>([])
  const [movers, setMovers] = useState<Movers | null>(null)
  const [days, setDays] = useState(30)
  const [error, setError] = useState('')

  useEffect(() => {
    get<Totals>('/stats').then(setTotals).catch((e) => setError(String(e)))
    get<SetStats[]>('/stats/sets').then(setSets).catch((e) => setError(String(e)))
    get<SnapshotRow[]>('/stats/snapshots').then(setSnaps).catch(() => {})
    get<ValuePoint[]>('/stats/value-history').then(setLegacy).catch(() => {})
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

      {(snaps.length > 0 || legacy.length >= 2) && (
        <HistoryPanel snaps={snaps} legacy={legacy} />
      )}
      {snaps.length === 0 && legacy.length < 2 && (
        <p className="muted">
          Collection history appears once snapshots start accruing (daily job + one per
          import).
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
