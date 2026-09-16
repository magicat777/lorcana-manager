import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Hero from '../components/Hero'
import { get, money } from '../api'

interface WatchCard {
  card_id: string
  full_name: string
  set_code: string
  collector_number: string
  rarity: string | null
  qty: number
  owned: number
  chase: boolean
  foil_side: boolean
  price: string | number | null
  avg30: string | number | null
  ci: number | null
  pct7: number | null
  mv: number
  ask: string | number | null
  ask_gap: boolean
  weeks_left: number | null
  trigger: 'momentum' | 'dip' | null
}

interface WatchData {
  as_of: string | null
  lists: { list_id: number; name: string; total_cost: number; cards: WatchCard[] }[]
}

function CiBadge({ ci }: { ci: number | null }) {
  if (ci == null) return <span className="muted">—</span>
  const cls = ci >= 1.1 ? 'error' : ci <= 0.9 ? 'ok' : ''
  return <span className={cls} title={ci >= 1.1 ? 'momentum — players/collectors buying, you may be late'
    : ci <= 0.9 ? 'dip — softening, the entry window' : 'flat vs its own 30-day average'}>
    {ci.toFixed(2)}</span>
}

export default function Watch() {
  const [data, setData] = useState<WatchData | null>(null)
  const [error, setError] = useState('')
  const [sortKey, setSortKey] = useState('')
  const [sortDir, setSortDir] = useState(1)

  const clickSort = (key: string) => {
    if (sortKey === key) setSortDir(-sortDir)
    else { setSortKey(key); setSortDir(key === 'name' || key === 'rarity' ? 1 : -1) }
  }

  const SortTh = ({ k, label, right }: { k: string; label: string; right?: boolean }) => (
    <th onClick={() => clickSort(k)}
      style={{ cursor: 'pointer', userSelect: 'none', ...(right ? { textAlign: 'right' as const } : {}) }}
      title="Click to sort">
      {label}{sortKey === k ? (sortDir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  )

  const sorted = (cards: WatchCard[]): WatchCard[] => {
    if (!sortKey) return cards
    const val = (c: WatchCard): string | number | null => {
      switch (sortKey) {
        case 'name': return c.full_name.toLowerCase()
        case 'rarity': return c.rarity?.toLowerCase() ?? null
        case 'price': return c.price != null ? Number(c.price) : null
        case 'pct7': return c.pct7
        case 'ci': return c.ci
        case 'mv': return c.mv
        case 'ask': return c.ask != null ? Number(c.ask) : null
        case 'wk': return c.weeks_left && c.price != null ? Number(c.price) / c.weeks_left : null
        case 'signal': return c.trigger ? (c.trigger === 'dip' ? 2 : 1) : 0
        default: return null
      }
    }
    return [...cards].sort((a, b) => {
      const va = val(a), vb = val(b)
      if (va == null && vb == null) return a.full_name.localeCompare(b.full_name)
      if (va == null) return 1   // nulls sink regardless of direction
      if (vb == null) return -1
      const cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb : String(va).localeCompare(String(vb))
      return sortDir * cmp || a.full_name.localeCompare(b.full_name)
    })
  }

  useEffect(() => {
    get<WatchData>('/market/watch').then(setData).catch((e) => setError(String(e)))
  }, [])

  if (error) return <p className="error">{error}</p>
  if (!data) return <p className="muted">Loading…</p>

  return (
    <div style={{ maxWidth: 1050 }}>
      <Hero img="hero-wantlist.jpg" title="Market watch" />
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Named want lists with buy-timing signals. <b>CI</b> = price ÷ its own 30-day
        average (green ≤0.90 = dip/entry, red ≥1.10 = momentum/late). <b>7d</b> = week
        move. <b>mv</b> = nights moved of 30 — <span className="error">red under 5</span>{' '}
        means the price is stale and one sale can jump it (typical for chase cards:
        trust the <b>ask</b> instead; <b>GAP</b> = ask under 0.7× market, the real buy
        window). Chase printings price on their foil ✦.
        {data.as_of && <> Prices as of {data.as_of.slice(0, 16).replace('T', ' ')} UTC.</>}
      </p>
      {data.lists.length === 0 && (
        <p className="muted">No named want lists yet — create one on the{' '}
          <Link to="/wantlist">Want List</Link> page or via Claude.</p>
      )}
      {data.lists.map((wl) => (
        <div className="panel" key={wl.list_id}>
          <h3 style={{ marginTop: 0 }}>
            {wl.name} <span className="muted">— {wl.cards.length} cards,
            ~{money(wl.total_cost)}</span>
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr><SortTh k="name" label="Card" /><SortTh k="rarity" label="Rarity" />
                  <SortTh k="price" label="Price" right /><SortTh k="pct7" label="7d" right />
                  <SortTh k="ci" label="CI" /><SortTh k="mv" label="mv" />
                  <SortTh k="ask" label="Ask" right /><SortTh k="wk" label="$/wk" />
                  <SortTh k="signal" label="Signal" /></tr>
              </thead>
              <tbody>
                {sorted(wl.cards).map((c) => (
                  <tr key={c.card_id}>
                    <td>
                      <Link to={`/cards/${c.set_code}/${c.collector_number}`}>{c.full_name}</Link>
                      <span className="muted"> {c.set_code}/{c.collector_number}</span>
                      {c.owned > 0 && <span className="muted"> (own {c.owned})</span>}
                    </td>
                    <td className="muted">{c.rarity?.replace('_', ' ')}</td>
                    <td style={{ textAlign: 'right' }}>
                      {c.price != null ? <>{money(c.price)}{c.foil_side && ' ✦'}</> : 'n/a'}
                    </td>
                    <td style={{ textAlign: 'right' }}
                      className={c.pct7 == null ? 'muted' : c.pct7 <= -5 ? 'ok' : c.pct7 >= 5 ? 'error' : ''}>
                      {c.pct7 != null ? `${c.pct7 > 0 ? '+' : ''}${c.pct7}%` : '—'}
                    </td>
                    <td><CiBadge ci={c.ci} /></td>
                    <td className={c.mv < 5 ? 'error' : c.mv >= 15 ? 'ok' : ''}
                      title="nights the price moved, of the last 30">{c.mv}</td>
                    <td style={{ textAlign: 'right' }}>
                      {c.ask != null ? money(c.ask) : <span className="muted">—</span>}
                      {c.ask_gap && <span className="ok" title="median ask under 0.7× market — the market price is stale-high; this is the real buy window"> GAP</span>}
                    </td>
                    <td className="muted">
                      {c.weeks_left && c.price != null
                        ? `${money(Number(c.price) / c.weeks_left)} (${c.weeks_left}w)` : '—'}
                    </td>
                    <td>
                      {c.trigger === 'dip' && <span className="ok">▼ dip</span>}
                      {c.trigger === 'momentum' && <span className="error">↗ late</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <p className="muted" style={{ fontSize: '0.8rem' }}>
        Shopping-list view (needs, totals, TCGplayer export) lives on the{' '}
        <Link to="/wantlist">Want List</Link> page. Chase cards here get per-card
        signals but never influence the set-CI median (play-demand instrument).
      </p>
    </div>
  )
}
