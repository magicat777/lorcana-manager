import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { get, send } from '../api'
import { InkDots } from '../components/CardGrid'
import type { Card, Deck, SearchResult } from '../types'

interface Buildable {
  buildable: boolean
  missing: { card_id: string; full_name: string; need: number; have: number; missing: number }[]
  missing_total: number
}

export default function DeckDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const [deck, setDeck] = useState<Deck | null>(null)
  const [buildable, setBuildable] = useState<Buildable | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Card[]>([])
  const [error, setError] = useState('')

  const load = () => {
    get<Deck>(`/decks/${id}`).then(setDeck).catch((e) => setError(String(e)))
    get<Buildable>(`/decks/${id}/buildable`).then(setBuildable).catch(() => {})
  }
  useEffect(load, [id])

  useEffect(() => {
    if (!query.trim()) {
      setHits([])
      return
    }
    const t = setTimeout(() => {
      get<SearchResult>('/cards', { q: query, page_size: 8 })
        .then((d) => setHits(d.results))
        .catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  const save = async (cards: { card_id: string; qty: number }[]) => {
    if (!deck) return
    try {
      await send('PUT', `/decks/${deck.id}`, { name: deck.name, notes: deck.notes ?? '', cards })
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

  if (error) return <p className="error">{error}</p>
  if (!deck) return <p className="muted">Loading…</p>

  return (
    <div style={{ maxWidth: 1000 }}>
      <p><Link to="/decks">← all decks</Link></p>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1>
          {deck.name} <span className="muted">({deck.card_total} cards)</span>
        </h1>
        <button className="danger" onClick={remove}>Delete deck</button>
      </div>
      {buildable && (
        <p className={buildable.buildable ? 'ok' : 'error'}>
          {buildable.buildable
            ? '✔ You can build this deck from your collection.'
            : `✘ Missing ${buildable.missing_total} copies across ${buildable.missing.length} cards.`}
        </p>
      )}

      <div className="panel">
        <input
          type="search"
          placeholder="Add a card — search by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ width: '60%' }}
        />
        {hits.length > 0 && (
          <table>
            <tbody>
              {hits.map((h) => (
                <tr key={h.id}>
                  <td>{h.full_name}</td>
                  <td className="muted">{h.set_code}·{h.collector_number}</td>
                  <td><button className="secondary" onClick={() => addCard(h)}>Add</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <table>
        <thead>
          <tr><th>Qty</th><th>Card</th><th>Cost</th><th>Type</th><th>Owned</th><th></th></tr>
        </thead>
        <tbody>
          {deck.cards?.map((c) => (
            <tr key={c.card_id} className={c.owned < c.qty ? 'bad' : ''}>
              <td>
                <button className="secondary" onClick={() => setQty(c.card_id, c.qty - 1)}>−</button>{' '}
                <strong>{c.qty}</strong>{' '}
                <button className="secondary" onClick={() => setQty(c.card_id, c.qty + 1)}>+</button>
                {c.qty > 4 && <span className="error" title="More than 4 copies"> ⚠</span>}
              </td>
              <td>
                <InkDots ink={c.ink} inks={c.inks} />
                <Link to={`/cards/${c.set_code}/${c.collector_number}`}>{c.full_name}</Link>
              </td>
              <td>{c.cost ?? '—'}</td>
              <td className="muted">{c.type?.join(' · ')}</td>
              <td>{c.owned}</td>
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
