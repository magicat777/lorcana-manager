import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { get, money } from '../api'
import Bars from '../components/Bars'
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
// Backfilled snapshots only carry total_cards — other metrics return null
// there and the point is skipped.
const snapTotal = (s: SnapshotRow, m: Metric): number | null =>
  m === 'value' ? (s.value_usd == null ? null : Number(s.value_usd))
  : m === 'copies' ? s.total_cards
  : s.unique_cards

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

function buildSeries(
  inRange: SnapshotRow[], legacy: ValuePoint[], metric: Metric, dim: Dim,
  range: Range, cutoff: number,
): TsSeries[] {
  if (dim === 'none') {
    const points = inRange
      .map((s) => ({ t: s.captured_at, v: snapTotal(s, metric) }))
      .filter((p): p is { t: string; v: number } => p.v != null)
    if (metric === 'value') {
      // Weekly price-snapshot values from before daily snapshots began keep
      // the chart's history from starting at day one of this feature.
      const firstSnap = points.length ? Date.parse(points[0].t) : Infinity
      const prefix = legacy
        .filter((h) => Date.parse(h.day) < firstSnap
          && (range === 'all' || Date.parse(h.day) >= cutoff))
        .map((h) => ({ t: h.day, v: Number(h.value) }))
      points.unshift(...prefix)
    }
    return [{ name: 'Total', color: '#c8a24a', points }]
  }

  // Rank buckets by the latest full snapshot, draw the top N, sum the rest.
  // Backfilled snapshots have no breakdown and are skipped here.
  const withBd = inRange.filter((s) => s.breakdown)
  const latest = withBd[withBd.length - 1]
  if (!latest) return []
  const allKeys = Object.keys(latest.breakdown![dim] || {})
  allKeys.sort((a, b) => {
    if (dim === 'cost') return (a === '?' ? 99 : Number(a)) - (b === '?' ? 99 : Number(b))
    return bucketVal(latest.breakdown![dim][b], metric) - bucketVal(latest.breakdown![dim][a], metric)
  })
  const top = allKeys.slice(0, MAX_LINES)
  const series: TsSeries[] = top.map((k, i) => ({
    name: k,
    color: seriesColor(dim, k, i),
    points: withBd.map((s) => ({
      t: s.captured_at, v: bucketVal(s.breakdown![dim]?.[k], metric),
    })),
  }))
  if (allKeys.length > MAX_LINES) {
    series.push({
      name: 'Other',
      color: seriesColor(dim, 'Other', 0),
      points: withBd.map((s) => ({
        t: s.captured_at,
        v: Object.entries(s.breakdown![dim] || {})
          .filter(([k]) => !top.includes(k))
          .reduce((sum, [, b]) => sum + bucketVal(b, metric), 0),
      })),
    })
  }
  return series
}

function ToggleRow<T extends string>({ options, labels, active, onToggle }: {
  options: T[]
  labels: Record<T, string>
  active: (o: T) => boolean
  onToggle: (o: T) => void
}) {
  return (
    <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {options.map((o) => (
        <button key={o} className={active(o) ? '' : 'secondary'}
          style={{ padding: '0.15rem 0.6rem' }} onClick={() => onToggle(o)}>
          {labels[o]}
        </button>
      ))}
    </span>
  )
}

function HistoryPanel({ snaps, legacy }: { snaps: SnapshotRow[]; legacy: ValuePoint[] }) {
  const [metrics, setMetrics] = useState<Metric[]>(['value', 'copies'])
  const [dim, setDim] = useState<Dim>('none')
  const [range, setRange] = useState<Range>('1m')

  const toggleMetric = (m: Metric) =>
    setMetrics((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]))

  const { charts, markers, latestBd } = useMemo(() => {
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
    const order: Metric[] = ['value', 'copies', 'unique']
    const charts = order
      .filter((m) => metrics.includes(m))
      .map((m) => ({ metric: m, series: buildSeries(inRange, legacy, m, dim, range, cutoff) }))
    // Newest snapshot that recorded a breakdown (backfilled rows have none) —
    // falls back to any-time so bars work even on short ranges.
    const latestBd = [...snaps].reverse().find((s) => s.breakdown) ?? null
    return { charts, markers, latestBd }
  }, [snaps, legacy, metrics, dim, range])

  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>Collection over time</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1.2rem',
        alignItems: 'center', marginBottom: '0.3rem' }}>
        <ToggleRow options={['value', 'copies', 'unique'] as Metric[]} labels={METRIC_LABEL}
          active={(m) => metrics.includes(m)} onToggle={toggleMetric} />
        <ToggleRow options={Object.keys(DIM_LABEL) as Dim[]} labels={DIM_LABEL}
          active={(d) => dim === d} onToggle={setDim} />
        <ToggleRow options={Object.keys(RANGE_LABEL) as Range[]} labels={RANGE_LABEL}
          active={(r) => range === r} onToggle={setRange} />
      </div>
      {metrics.length === 0 && (
        <p className="muted" style={{ marginBottom: 0 }}>Toggle a metric to chart it.</p>
      )}
      {charts.map(({ metric, series }) => {
        const fmt = metric === 'value'
          ? (v: number) => `$${v >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(2)}`
          : (v: number) => String(Math.round(v))
        const havePoints = series.some((s) => s.points.length >= 2)
        return (
          <div key={metric} style={{ marginTop: '0.6rem' }}>
            <h4 style={{ margin: '0 0 0.2rem' }}>
              {METRIC_LABEL[metric]}
              {dim !== 'none' && <span className="muted"> — {DIM_LABEL[dim].toLowerCase()}</span>}
            </h4>
            {havePoints ? (
              <div style={{ overflowX: 'auto' }}>
                <TimeSeries series={series} markers={markers} format={fmt} height={180} />
              </div>
            ) : dim !== 'none' && latestBd?.breakdown ? (
              <>
                <Bars format={fmt} bars={
                  Object.entries(latestBd.breakdown[dim])
                    .sort(([a, av], [b, bv]) => {
                      if (dim === 'cost') return (a === '?' ? 99 : Number(a)) - (b === '?' ? 99 : Number(b))
                      return bucketVal(bv, metric) - bucketVal(av, metric)
                    })
                    .map(([k, b], i) => ({
                      name: k, color: seriesColor(dim, k, i), value: bucketVal(b, metric),
                    }))
                } />
                <p className="muted" style={{ margin: '0.3rem 0 0', fontSize: '0.8rem' }}>
                  Current composition ({new Date(latestBd.captured_at).toLocaleDateString()}) —
                  trend lines replace these bars once a second daily snapshot lands. Pre-feature
                  history only recorded total copies, not composition.
                </p>
              </>
            ) : (
              <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
                Not enough data points in this window.
              </p>
            )}
          </div>
        )
      })}
      {charts.some((c) => c.series.some((s) => s.points.length >= 2)) && (
        <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.8rem' }}>
          One point per daily snapshot + one per import (dotted markers — hover for the
          upload note). Prices refresh nightly at 05:00 PT from Lorcast, one hour before
          the daily snapshot.
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
