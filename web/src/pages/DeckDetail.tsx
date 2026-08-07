import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { get, send } from '../api'
import { InkDots, INK_COLORS } from '../components/CardGrid'
import type { Card, Deck, DeckCardRow, SearchResult } from '../types'

const INKS = ['Amber', 'Amethyst', 'Emerald', 'Ruby', 'Sapphire', 'Steel']
const TYPES = ['Character', 'Action', 'Song', 'Item', 'Location']

function Composition({ cards }: { cards: DeckCardRow[] }) {
  if (!cards.length) return null
  const total = cards.reduce((a, c) => a + c.qty, 0)
  const curve: Record<string, number> = {}
  const inkCounts: Record<string, number> = {}
  const typeCounts: Record<string, number> = {}
  let inkable = 0
  let costSum = 0
  let lore = 0
  for (const c of cards) {
    const bucket = (c.cost ?? 0) >= 9 ? '9+' : String(c.cost ?? 0)
    curve[bucket] = (curve[bucket] ?? 0) + c.qty
    for (const i of (c.inks?.length ? c.inks : c.ink ? [c.ink] : []))
      inkCounts[i] = (inkCounts[i] ?? 0) + c.qty
    const t = c.type ?? []
    const primary = t.includes('Song') ? 'Song'
      : (['Character', 'Action', 'Item', 'Location'].find((k) => t.includes(k)) ?? 'Other')
    typeCounts[primary] = (typeCounts[primary] ?? 0) + c.qty
    if (c.inkwell) inkable += c.qty
    costSum += (c.cost ?? 0) * c.qty
    if (c.lore) lore += c.lore * c.qty
  }
  const buckets = Object.keys(curve).sort((a, b) => (a === '9+' ? 99 : +a) - (b === '9+' ? 99 : +b))
  const maxBucket = Math.max(...Object.values(curve), 1)
  return (
    <div className="panel" style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
      <div style={{ flex: '0 0 260px' }}>
        <p className="muted" style={{ margin: '0 0 0.3rem' }}>Cost curve</p>
        {buckets.map((b) => (
          <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0' }}>
            <span className="muted" style={{ width: 20, textAlign: 'right', fontSize: '0.8rem' }}>{b}</span>
            <div className="progress" style={{ flex: 1 }}>
              <div style={{ width: `${(100 * curve[b]) / maxBucket}%` }} />
            </div>
            <span className="muted" style={{ width: 18, fontSize: '0.8rem' }}>{curve[b]}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: '0.88rem' }}>
        <p className="muted" style={{ margin: '0 0 0.3rem' }}>Composition</p>
        <p style={{ margin: '0.15rem 0' }}>
          {Object.entries(inkCounts).map(([i, n]) => (
            <span key={i} style={{ marginRight: 10, whiteSpace: 'nowrap' }}>
              <span className="inkdot" style={{ background: INK_COLORS[i] }} />{i} {n}
            </span>
          ))}
        </p>
        <p style={{ margin: '0.15rem 0' }}>
          {['Character', 'Action', 'Song', 'Item', 'Location', 'Other']
            .filter((t) => typeCounts[t])
            .map((t) => `${t} ${typeCounts[t]}`).join(' · ')}
        </p>
        <p className="muted" style={{ margin: '0.15rem 0' }}>
          {inkable} inkable / {total - inkable} uninkable
          {' · '}avg cost {total ? (costSum / total).toFixed(2) : '0'}
          {' · '}{lore} lore on characters
        </p>
      </div>
    </div>
  )
}

interface Buildable {
  buildable: boolean
  in_use: boolean
  format?: string
  note?: string | null
  pool_total?: number
  missing: { card_id: string; full_name: string; need: number; have: number; free: number; missing: number }[]
  missing_total: number
  missing_cost?: number
  missing_unpriced?: number
}

export default function DeckDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const [deck, setDeck] = useState<Deck | null>(null)
  const [buildable, setBuildable] = useState<Buildable | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Card[]>([])
  const [searchInk, setSearchInk] = useState('')
  const [searchType, setSearchType] = useState('')
  const [searchCore, setSearchCore] = useState(true)
  const [searchFree, setSearchFree] = useState(false)
  const [poolText, setPoolText] = useState('')
  const [poolMsg, setPoolMsg] = useState('')
  const [error, setError] = useState('')

  const load = () => {
    get<Deck>(`/decks/${id}`).then(setDeck).catch((e) => setError(String(e)))
    get<Buildable>(`/decks/${id}/buildable`).then(setBuildable).catch(() => {})
  }
  useEffect(load, [id])

  useEffect(() => {
    if (!query.trim() && !searchInk && !searchType) {
      setHits([])
      return
    }
    const t = setTimeout(() => {
      get<SearchResult>('/cards', {
        q: query, ink: searchInk, type: searchType,
        page_size: searchFree ? 30 : 8,
        ...(searchCore ? { core: 'true' } : {}),
        ...(searchFree ? { owned: 'owned' } : {}),
      })
        .then((d) => {
          let rows = d.results
          if (searchFree) rows = rows.filter((c) => c.qty_normal + c.qty_foil - c.qty_in_use > 0)
          setHits(rows.slice(0, 8))
        })
        .catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [query, searchInk, searchType, searchCore, searchFree])

  const save = async (cards: { card_id: string; qty: number }[]) => {
    if (!deck) return
    try {
      await send('PUT', `/decks/${deck.id}`, { name: deck.name, notes: deck.notes ?? '', cards, source: 'webui' })
      load()
    } catch (e) {
      setError(String(e))
    }
  }

  const setQty = (card_id: string, qty: number) => {
    if (!deck?.cards) return
    const cards = deck.cards
      .map((c) => ({ card_id: c.card_id, qty: c.card_id === card_id ? qty : c.qty }))
      .filter((c) => c.qty > 0)
    save(cards)
  }

  const addCard = (c: Card) => {
    if (!deck?.cards) return
    const cards = deck.cards.map((x) => ({ card_id: x.card_id, qty: x.qty }))
    const hit = cards.find((x) => x.card_id === c.id)
    if (hit) hit.qty += 1
    else cards.push({ card_id: c.id, qty: 1 })
    setQuery('')
    save(cards)
  }

  const remove = async () => {
    if (!deck || !confirm(`Delete deck "${deck.name}"?`)) return
    await send('DELETE', `/decks/${deck.id}`)
    nav('/decks')
  }

  const addToPool = async () => {
    if (!deck || !poolText.trim()) return
    setPoolMsg('')
    try {
      const d = await send<Deck>('POST', `/decks/${deck.id}/pool/import`, { text: poolText, mode: 'add' })
      const bad = d.unmatched ?? []
      setPoolMsg(bad.length
        ? `Added — ${bad.length} line(s) didn't match: ${bad.map((u) => u.name).join('; ')}`
        : 'Added to pool.')
      setPoolText('')
      load()
    } catch (e) {
      setPoolMsg(String((e as Error).message ?? e))
    }
  }

  const removeFromPool = async (card_id: string) => {
    if (!deck) return
    await send('DELETE', `/decks/${deck.id}/pool/${card_id}`)
    load()
  }

  const toggleInUse = async (force = false) => {
    if (!deck) return
    setError('')
    try {
      await send('PUT', `/decks/${deck.id}/in_use`, { in_use: !deck.in_use, force })
      load()
    } catch (e) {
      const err = e as Error & { status?: number; detail?: { missing?: { full_name: string; missing: number }[] } }
      if (err.status === 409 && err.detail?.missing) {
        const list = err.detail.missing.map((c) => `${c.missing}x ${c.full_name}`).join(', ')
        if (confirm(`Not enough free copies (allocated to other built decks or unowned): ${list}.\n\nMark as built anyway?`)) {
          toggleInUse(true)
        }
      } else {
        setError(String(err.message ?? err))
      }
    }
  }

  if (error) return <p className="error">{error}</p>
  if (!deck) return <p className="muted">Loading…</p>

  return (
    <div style={{ maxWidth: 1000 }}>
      <p><Link to="/decks">← all decks</Link></p>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1>
          {deck.name} <span className="muted">({deck.card_total} cards)</span>
          {deck.format === 'sealed' && <span className="badge" style={{ marginLeft: 10, verticalAlign: 'middle' }}>SEALED</span>}
          {deck.in_use && <span className="badge foil" style={{ marginLeft: 10, verticalAlign: 'middle' }}>◈ BUILT / IN USE</span>}
        </h1>
        <span>
          <Link to={`/decks/${deck.id}/export`} style={{ marginRight: 8 }}>
            <button className="secondary">Export / print</button>
          </Link>
          <button className={deck.in_use ? 'secondary' : ''} onClick={() => toggleInUse()} style={{ marginRight: 8 }}>
            {deck.in_use ? 'Mark not in use' : 'Mark built / in use'}
          </button>
          {deck.format !== 'sealed' && !deck.in_use && (
            <button className="secondary" style={{ marginRight: 8 }}
              onClick={async () => { await send('PUT', `/decks/${deck.id}/wanted`, { wanted: !deck.wanted }); load() }}>
              {deck.wanted ? '★ On want list' : '☆ Add to want list'}
            </button>
          )}
          <button className="danger" onClick={remove}>Delete deck</button>
        </span>
      </div>
      {buildable && buildable.format === 'sealed' && (
        buildable.note
          ? <p className="muted">{buildable.note}</p>
          : <p className={buildable.buildable ? 'ok' : 'error'}>
              {buildable.buildable
                ? `✔ Buildable from your sealed pool (${buildable.pool_total} cards opened).`
                : `✘ ${buildable.missing_total} card(s) in the deck aren't in your pool — fix the deck or add the missing pulls to the pool.`}
            </p>
      )}
      {buildable && buildable.format !== 'sealed' && (
        <p className={buildable.buildable ? 'ok' : 'error'}>
          {buildable.buildable
            ? '✔ Buildable from free copies (not allocated to other built decks).'
            : `✘ Short ${buildable.missing_total} free copies across ${buildable.missing.length} cards`
              + ` — ~$${(buildable.missing_cost ?? 0).toFixed(2)} to complete`
              + (buildable.missing_unpriced ? ` (+${buildable.missing_unpriced} unpriced)` : '')
              + '.'}
        </p>
      )}
      {deck.validation && deck.validation.length > 0 && (
        <p className="error">{deck.validation.map((w, i) => <span key={i}>⚠ {w}<br /></span>)}</p>
      )}
      {deck.format !== 'sealed' && deck.cards && deck.cards.some((c) => !c.core_legal) && (
        <p className="error">
          ⟳ Not Core Constructed legal: {deck.cards.filter((c) => !c.core_legal)
            .map((c) => `${c.qty}x ${c.full_name} (set ${c.set_code} rotated)`).join(', ')}
        </p>
      )}
      {deck.format !== 'sealed' && deck.cards && deck.cards.length > 0
        && deck.cards.every((c) => c.core_legal)
        && (!deck.validation || deck.validation.length === 0) && (
        <p className="ok">✔ Core Constructed legal.</p>
      )}

      {deck.format === 'sealed' && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>
            Sealed pool <span className="muted">({deck.pool_total ?? 0} cards opened)</span>
          </h3>
          <p className="muted" style={{ margin: '0 0 0.4rem' }}>
            Paste this week's pulls (lines like <code>2 Elsa - Spirit of Winter</code>) — they add on top of the pool.
          </p>
          <textarea rows={4} value={poolText} onChange={(e) => setPoolText(e.target.value)} />
          <p>
            <button onClick={addToPool} disabled={!poolText.trim()}>Add to pool</button>
            {poolMsg && <span className="muted" style={{ marginLeft: 10 }}>{poolMsg}</span>}
          </p>
          {deck.pool && deck.pool.length > 0 && (
            <p className="muted" style={{ margin: 0, lineHeight: 1.9 }}>
              {deck.pool.map((p) => (
                <span key={p.card_id} style={{ marginRight: 12, whiteSpace: 'nowrap' }}>
                  {p.qty}× {p.full_name}
                  <button className="secondary" title="Remove from pool"
                    style={{ marginLeft: 4, padding: '0 6px' }}
                    onClick={() => removeFromPool(p.card_id)}>✕</button>
                </span>
              ))}
            </p>
          )}
        </div>
      )}

      {deck.cards && deck.cards.length > 0 && <Composition cards={deck.cards} />}

      <div className="panel">
        <div className="filterbar" style={{ marginBottom: 0 }}>
          <input
            type="search"
            placeholder="Add a card — search by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ minWidth: 220 }}
          />
          <select value={searchInk} onChange={(e) => setSearchInk(e.target.value)}>
            <option value="">Any ink</option>
            {INKS.map((i) => <option key={i}>{i}</option>)}
          </select>
          <select value={searchType} onChange={(e) => setSearchType(e.target.value)}>
            <option value="">Any type</option>
            {TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <label className="muted" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={searchCore} onChange={(e) => setSearchCore(e.target.checked)} />
            {' '}Core-legal
          </label>
          <label className="muted" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={searchFree} onChange={(e) => setSearchFree(e.target.checked)} />
            {' '}Free copies only
          </label>
        </div>
        {hits.length > 0 && (
          <table>
            <tbody>
              {hits.map((h) => (
                <tr key={h.id}>
                  <td><InkDots ink={h.ink} inks={h.inks} />{h.full_name}</td>
                  <td className="muted">{h.set_code}·{h.collector_number}</td>
                  <td className="muted">cost {h.cost ?? '—'}</td>
                  <td className="muted" title="free copies in collection">
                    {Math.max(0, h.qty_normal + h.qty_foil - h.qty_in_use)} free
                  </td>
                  <td><button className="secondary" onClick={() => addCard(h)}>Add</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <table>
        <thead>
          {deck.format === 'sealed'
            ? <tr><th>Qty</th><th>Card</th><th>Cost</th><th>Type</th><th>In pool</th><th></th></tr>
            : <tr><th>Qty</th><th>Card</th><th>Cost</th><th>Type</th><th>Owned</th><th>Free</th><th></th></tr>}
        </thead>
        <tbody>
          {deck.cards?.map((c) => (
            <tr key={c.card_id} className={
              deck.format === 'sealed'
                ? ((deck.pool_total ?? 0) > 0 && (c.in_pool ?? 0) < c.qty ? 'bad' : '')
                : (c.free < c.qty ? 'bad' : '')
            }>
              <td>
                <button className="secondary" onClick={() => setQty(c.card_id, c.qty - 1)}>−</button>{' '}
                <strong>{c.qty}</strong>{' '}
                <button className="secondary" onClick={() => setQty(c.card_id, c.qty + 1)}>+</button>
                {deck.format !== 'sealed' && c.qty > 4 && <span className="error" title="More than 4 copies"> ⚠</span>}
              </td>
              <td>
                <InkDots ink={c.ink} inks={c.inks} />
                <Link to={`/cards/${c.set_code}/${c.collector_number}`}>{c.full_name}</Link>
              </td>
              <td>{c.cost ?? '—'}</td>
              <td className="muted">{c.type?.join(' · ')}</td>
              {deck.format === 'sealed' ? (
                <td>{c.in_pool ?? 0}</td>
              ) : (
                <>
                  <td>{c.owned}</td>
                  <td title={c.allocated_elsewhere ? `${c.allocated_elsewhere} allocated to other built decks` : ''}>
                    {c.free}{c.allocated_elsewhere > 0 && <span className="muted"> ({c.allocated_elsewhere} in decks)</span>}
                  </td>
                </>
              )}
              <td><button className="secondary" onClick={() => setQty(c.card_id, 0)}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {deck.unmatched && deck.unmatched.length > 0 && (
        <div className="panel">
          <h4>Unmatched import lines</h4>
          {deck.unmatched.map((u, i) => (
            <p className="error" key={i}>{u.qty ?? ''} {u.name} — {u.reason}</p>
          ))}
        </div>
      )}
    </div>
  )
}
