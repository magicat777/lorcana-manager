import Hero from '../components/Hero'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { get, money, send } from '../api'
import RarityIcon from '../components/RarityIcon'
import type { Deck } from '../types'

interface WantCard {
  card_id: string; full_name: string; set_code: string; collector_number: string
  rarity: string | null; price_usd: string | number | null
  qty_wanted: number; owned: number; allocated: number; need: number
  line_cost: number | null; decks: string[]
}
interface WantlistData {
  wanted_decks: { id: number; name: string }[]
  cards: WantCard[]
  skipped: { card_id: string; full_name: string; set_code: string; collector_number: string; need: number }[]
  total_cost: number
  unpriced: number
  text: string
  tcg_text: string
}
interface NamedListCard {
  card_id: string; qty: number; full_name: string; set_code: string
  collector_number: string; rarity: string | null
  price_usd: string | number | null; line_cost: number | null; source: 'manual' | 'deck'
}
interface NamedList {
  id: number; name: string; deck_id: number | null; deck_name: string | null
  cards: NamedListCard[]; total_cost: number; unpriced: number
  text: string; tcg_text: string
}

function CopyButtons({ text, tcg }: { text: string; tcg: string }) {
  const [copied, setCopied] = useState('')
  const copy = (label: string, content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(label)
      setTimeout(() => setCopied(''), 2000)
    })
  }
  return (
    <span style={{ display: 'inline-flex', gap: 6 }}>
      <button className="secondary" disabled={!text} onClick={() => copy('list', text)}>
        {copied === 'list' ? '✓ Copied' : 'Copy list'}
      </button>
      <button className="secondary" disabled={!tcg} onClick={() => copy('tcg', tcg)}
        title="Card-code lines for TCGplayer Mass Entry — paste into tcgplayer.com/massentry">
        {copied === 'tcg' ? '✓ Copied' : 'Copy for TCGplayer'}
      </button>
    </span>
  )
}

export default function Wantlist() {
  const [d, setD] = useState<WantlistData | null>(null)
  const [lists, setLists] = useState<NamedList[]>([])
  const [decks, setDecks] = useState<Deck[]>([])
  const [error, setError] = useState('')
  const [newName, setNewName] = useState('')
  const [newDeck, setNewDeck] = useState<number | ''>('')
  const [addCard, setAddCard] = useState<Record<number, string>>({})

  const reload = () => {
    get<WantlistData>('/wantlist').then(setD).catch((e) => setError(String(e)))
    get<NamedList[]>('/wantlists').then(setLists).catch(() => {})
  }
  useEffect(() => {
    reload()
    get<Deck[]>('/decks').then(setDecks).catch(() => {})
  }, [])

  if (error) return <p className="error">{error}</p>
  if (!d) return <p className="muted">Loading…</p>

  const skip = (card_id: string) =>
    send('POST', '/wantlist/skips', { card_id }).then(reload).catch((e) => setError(String(e)))
  const restore = (card_id: string) =>
    send('DELETE', `/wantlist/skips/${card_id}`).then(reload).catch((e) => setError(String(e)))
  const clearAll = () => {
    if (!window.confirm(`Unflag all ${d.wanted_decks.length} wanted deck(s) and empty the list?`)) return
    send('POST', '/wantlist/clear').then(reload).catch((e) => setError(String(e)))
  }
  const createList = () => {
    if (!newName.trim()) return
    send('POST', '/wantlists', { name: newName.trim(), deck_id: newDeck === '' ? null : newDeck })
      .then(() => { setNewName(''); setNewDeck(''); reload() })
      .catch((e) => setError(String(e)))
  }
  const deleteList = (wl: NamedList) => {
    if (!window.confirm(`Delete want list "${wl.name}"?`)) return
    send('DELETE', `/wantlists/${wl.id}`).then(reload).catch((e) => setError(String(e)))
  }
  const setQty = (listId: number, card_id: string, qty: number) =>
    send('PUT', `/wantlists/${listId}/cards`, { card_id, qty })
      .then(reload).catch((e) => setError(String(e)))
  const addByName = (wl: NamedList) => {
    const name = (addCard[wl.id] || '').trim()
    if (!name) return
    send('PUT', `/wantlists/${wl.id}/cards`, { card: name, qty: 1 })
      .then(() => { setAddCard((m) => ({ ...m, [wl.id]: '' })); reload() })
      .catch((e) => setError(String((e as Error).message ?? e)))
  }

  return (
    <div style={{ maxWidth: 980 }}>
      <p><Link to="/decks">← all decks</Link></p>
      <Hero img="hero-wantlist.jpg" title="Want List" />
      {d.wanted_decks.length === 0 ? (
        <p className="muted">
          No decks flagged yet — open a deck and hit <strong>☆ Add to want list</strong>.
          The shopping list aggregates every missing copy across flagged decks.
        </p>
      ) : (
        <>
          <p className="muted">
            Building: {d.wanted_decks.map((w, i) => (
              <span key={w.id}>{i > 0 && ' · '}<Link to={`/decks/${w.id}`}>{w.name}</Link></span>
            ))}
          </p>
          {d.cards.length === 0 && d.skipped.length === 0 ? (
            <p className="ok">✔ Nothing to buy — every flagged deck is coverable from free copies.</p>
          ) : (
            <>
              <div className="statrow">
                <div className="stat"><div className="k">Cards to buy</div>
                  <div className="v">{d.cards.reduce((a, c) => a + c.need, 0)}</div></div>
                <div className="stat"><div className="k">Est. cost</div>
                  <div className="v">{money(d.total_cost)}{d.unpriced ? <span className="muted"> +{d.unpriced} unpriced</span> : null}</div></div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <CopyButtons text={d.text} tcg={d.tcg_text} />
                  <button className="danger" onClick={clearAll}>Clear want list</button>
                </div>
              </div>
              <table>
                <thead>
                  <tr><th>Need</th><th>Card</th><th>Set·#</th><th>Rarity</th><th>Each</th><th>Line</th><th>For</th><th></th></tr>
                </thead>
                <tbody>
                  {d.cards.map((c) => (
                    <tr key={c.card_id}>
                      <td><strong>{c.need}</strong></td>
                      <td><Link to={`/cards/${c.set_code}/${c.collector_number}`}>{c.full_name}</Link></td>
                      <td className="muted">{c.set_code}·{c.collector_number}</td>
                      <td className="muted">
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {c.rarity && <RarityIcon rarity={c.rarity} size={12} />}{c.rarity?.replace('_', ' ')}
                        </span>
                      </td>
                      <td>{money(c.price_usd)}</td>
                      <td>{c.line_cost != null ? money(c.line_cost) : '—'}</td>
                      <td className="muted">{c.decks.join(', ')}</td>
                      <td><button className="secondary" title="Remove from want list (bought it / skip)"
                        onClick={() => skip(c.card_id)}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {d.skipped.length > 0 && (
                <p className="muted" style={{ fontSize: '0.85rem' }}>
                  Removed:{' '}
                  {d.skipped.map((s, i) => (
                    <span key={s.card_id}>
                      {i > 0 && ' · '}{s.full_name}{' '}
                      <a style={{ cursor: 'pointer' }} onClick={() => restore(s.card_id)}>↩ restore</a>
                    </span>
                  ))}
                </p>
              )}
            </>
          )}
        </>
      )}

      <h2 style={{ marginTop: '2rem' }}>Named want lists</h2>
      <p className="muted" style={{ marginTop: '-0.4rem' }}>
        Organize wants by purpose. A list linked to a deck auto-includes that deck's
        current shortfall; add any card to any list by name.
      </p>
      {lists.map((wl) => (
        <div className="panel" key={wl.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
            <h3 style={{ margin: 0 }}>
              {wl.name}
              {wl.deck_name && <span className="muted" style={{ fontWeight: 400 }}> — tracks {wl.deck_name}</span>}
            </h3>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span className="muted">{money(wl.total_cost)}{wl.unpriced ? ` +${wl.unpriced} unpriced` : ''}</span>
              <CopyButtons text={wl.text} tcg={wl.tcg_text} />
              <button className="danger" onClick={() => deleteList(wl)}>✕</button>
            </span>
          </div>
          {wl.cards.length > 0 && (
            <table>
              <tbody>
                {wl.cards.map((c) => (
                  <tr key={c.card_id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {c.source === 'manual' ? (
                        <>
                          <button className="secondary" style={{ padding: '0 0.5rem' }}
                            onClick={() => setQty(wl.id, c.card_id, c.qty - 1)}>−</button>
                          {' '}{c.qty}{' '}
                          <button className="secondary" style={{ padding: '0 0.5rem' }}
                            onClick={() => setQty(wl.id, c.card_id, c.qty + 1)}>+</button>
                        </>
                      ) : (
                        <strong title="From the linked deck's current shortfall">{c.qty}</strong>
                      )}
                    </td>
                    <td><Link to={`/cards/${c.set_code}/${c.collector_number}`}>{c.full_name}</Link></td>
                    <td className="muted">{c.set_code}·{c.collector_number}</td>
                    <td>{c.line_cost != null ? money(c.line_cost) : '—'}</td>
                    <td className="muted">{c.source === 'deck' ? 'deck' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p style={{ margin: '0.4rem 0 0' }}>
            <input placeholder="Add card by name…" value={addCard[wl.id] || ''}
              onChange={(e) => setAddCard((m) => ({ ...m, [wl.id]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') addByName(wl) }}
              style={{ minWidth: '28ch' }} />
            {' '}
            <button className="secondary" onClick={() => addByName(wl)}>Add</button>
          </p>
        </div>
      ))}
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>New want list</h3>
        <p style={{ margin: 0 }}>
          <input placeholder='Name — e.g. "Want for Rainbow Hunny"' value={newName}
            onChange={(e) => setNewName(e.target.value)} style={{ minWidth: '30ch' }} />
          {' '}
          <select value={newDeck} onChange={(e) => setNewDeck(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">no linked deck</option>
            {decks.filter((dk) => !dk.sim_only).map((dk) => (
              <option key={dk.id} value={dk.id}>track deck: {dk.name}</option>
            ))}
          </select>
          {' '}
          <button onClick={createList} disabled={!newName.trim()}>Create</button>
        </p>
      </div>
    </div>
  )
}
