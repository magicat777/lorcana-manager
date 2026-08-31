import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { get, money, send } from '../api'
import { InkDots } from '../components/CardGrid'
import FoilCard from '../components/FoilCard'
import RarityIcon from '../components/RarityIcon'
import Sparkline from '../components/Sparkline'
import type { Card } from '../types'

interface WantListRow {
  id: number
  name: string
  cards: { card_id: string; qty: number; source: string }[]
}

function AddToWantList({ cardId }: { cardId: string }) {
  const [lists, setLists] = useState<WantListRow[]>([])
  const [sel, setSel] = useState<number | 'new' | ''>('')
  const [newName, setNewName] = useState('')
  const [status, setStatus] = useState('')

  const reload = () => get<WantListRow[]>('/wantlists').then(setLists).catch(() => {})
  useEffect(() => {
    reload()
  }, [])

  const add = async () => {
    try {
      let listId: number
      let listName: string
      if (sel === 'new') {
        if (!newName.trim()) return
        const wl = await send<{ id: number; name: string }>('POST', '/wantlists', { name: newName.trim() })
        listId = wl.id
        listName = wl.name
        setNewName('')
      } else if (sel === '') {
        return
      } else {
        listId = sel
        listName = lists.find((l) => l.id === sel)?.name ?? ''
      }
      const existing = lists.find((l) => l.id === listId)?.cards
        .find((c) => c.card_id === cardId && c.source === 'manual')?.qty ?? 0
      const r = await send<{ qty: number }>('PUT', `/wantlists/${listId}/cards`,
        { card_id: cardId, qty: existing + 1 })
      setStatus(`✓ ${r.qty}x on "${listName}"`)
      setSel(listId)
      reload()
      setTimeout(() => setStatus(''), 2500)
    } catch (e) {
      setStatus(String((e as Error).message ?? e))
    }
  }

  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>Want it</h3>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={sel} onChange={(e) => {
          const v = e.target.value
          setSel(v === 'new' ? 'new' : v === '' ? '' : Number(v))
        }}>
          <option value="">pick a want list…</option>
          {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          <option value="new">➕ New list…</option>
        </select>
        {sel === 'new' && (
          <input placeholder='List name — e.g. "Foils"' value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add() }}
            style={{ minWidth: '22ch' }} />
        )}
        <button className="secondary" disabled={sel === '' || (sel === 'new' && !newName.trim())}
          onClick={add}>
          Add
        </button>
        {status && <span className={status.startsWith('✓') ? 'ok' : 'error'}>{status}</span>}
      </div>
      <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.8rem' }}>
        Each click adds a copy. Manage lists on the <Link to="/wantlist">Want List</Link> page.
      </p>
    </div>
  )
}

export default function CardDetail() {
  const { set, number } = useParams()
  const navigate = useNavigate()
  // Jump to the Cards grid pre-filtered on one classification tag.
  const browseTag = (tag: string) => {
    sessionStorage.setItem('cards.filters', JSON.stringify({ tags: [tag] }))
    navigate('/')
  }
  const [card, setCard] = useState<Card | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    get<Card>(`/cards/${set}/${number}`).then(setCard).catch((e) => setError(String(e)))
  }, [set, number])

  const bump = async (field: 'qty_normal' | 'qty_foil', delta: number) => {
    if (!card) return
    const next = {
      qty_normal: card.qty_normal,
      qty_foil: card.qty_foil,
      [field]: Math.max(0, card[field] + delta),
    }
    setSaving(true)
    try {
      await send('PUT', `/collection/${card.id}`, next)
      setCard({ ...card, ...next })
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  if (error) return <p className="error">{error}</p>
  if (!card) return <p className="muted">Loading…</p>

  return (
    <div>
      <p>
        <Link to="/">← back to cards</Link>
      </p>
      <div className="detail">
        {card.image_large && (
          <FoilCard src={card.image_large} alt={card.full_name}
            active={card.qty_foil > 0 || card.rarity === 'Enchanted'} />
        )}
        <div style={{ maxWidth: 560 }}>
          <h1 style={{ marginBottom: 0 }}>{card.full_name}</h1>
          <p className="muted">
            {card.set_name} · #{card.collector_number} ·{' '}
            {card.rarity && <RarityIcon rarity={card.rarity} size={13} />} {card.rarity?.replace('_', ' ')}
            {(card.inks?.length || card.ink) && (
              <>
                {' · '}
                <InkDots ink={card.ink} inks={card.inks} />
                {(card.inks?.length ? card.inks : [card.ink]).join(' / ')}
              </>
            )}
          </p>
          {(card.classifications?.length ?? 0) > 0 && (
            <p style={{ margin: '0.2rem 0 0.4rem' }}>
              {card.classifications!.map((t) => (
                <button key={t} className="togglebtn small secondary" onClick={() => browseTag(t)}
                  title={`Browse all ${t} cards`}>
                  {t}
                </button>
              ))}
            </p>
          )}
          <p className={card.core_legal ? 'ok' : 'error'} style={{ fontSize: '0.88rem' }}>
            {card.core_legal ? '✔ Core Constructed legal' : '⟳ Not Core Constructed legal (set rotated)'}
          </p>
          <div className="statrow">
            {card.cost != null && <div className="stat"><div className="k">Cost</div><div className="v">{card.cost}{card.inkwell ? ' ◉' : ''}</div></div>}
            {card.strength != null && <div className="stat"><div className="k">Strength</div><div className="v">{card.strength}</div></div>}
            {card.willpower != null && <div className="stat"><div className="k">Willpower</div><div className="v">{card.willpower}</div></div>}
            {card.lore != null && <div className="stat"><div className="k">Lore</div><div className="v">{card.lore}</div></div>}
            <div className="stat"><div className="k">Price</div><div className="v">{money(card.price_usd)}</div></div>
            <div className="stat"><div className="k">Foil</div><div className="v">{money(card.price_usd_foil)}</div></div>
          </div>
          {(() => {
            const hist = (card.price_history ?? []).filter((h) => h.usd != null)
            const foil = (card.price_history ?? []).filter((h) => h.usd_foil != null)
            // One row per sibling printing per price series it actually has
            // (chase prints are foil-only; a standard sibling gets both).
            const premiums = (card.sibling_printings ?? []).flatMap((p) =>
              (['usd', 'usd_foil'] as const).flatMap((key) => {
                const rows = p.price_history.filter((h) => h[key] != null)
                return rows.length >= 2 ? [{ ...p, rows, key }] : []
              }))
            if (hist.length < 2 && foil.length < 2 && premiums.length === 0) return null
            const pts = (rows: typeof hist, key: 'usd' | 'usd_foil') =>
              rows.map((h) => ({ t: h.captured_at.slice(0, 10), v: Number(h[key]) }))
            const PREMIUM_STROKE: Record<string, string> = {
              Enchanted: '#c9a7f0', Epic: '#7fd0e8',
            }
            return (
              <div className="panel">
                <h3 style={{ marginTop: 0 }}>Price history <span className="muted">(nightly)</span></h3>
                {hist.length >= 2 && (
                  <p style={{ margin: '0.3rem 0' }}>
                    <span className="muted" style={{ display: 'inline-block', width: 110 }}>Price</span>
                    <Sparkline points={pts(hist, 'usd')} showRange />
                  </p>
                )}
                {foil.length >= 2 && (
                  <p style={{ margin: '0.3rem 0' }}>
                    <span className="muted" style={{ display: 'inline-block', width: 110 }}>Foil ✦</span>
                    <Sparkline points={pts(foil, 'usd_foil')} showRange />
                  </p>
                )}
                {premiums.map((p) => (
                  <p key={`${p.card_id}-${p.key}`} style={{ margin: '0.3rem 0' }}>
                    <span style={{ display: 'inline-block', width: 110 }}>
                      <Link to={`/cards/${card.set_code}/${p.collector_number}`}
                        title={`${p.rarity} printing #${p.collector_number}`}>
                        {p.rarity}{p.key === 'usd_foil' ? ' ✦' : ''}
                      </Link>
                    </span>
                    <Sparkline points={pts(p.rows, p.key)} showRange
                      stroke={PREMIUM_STROKE[p.rarity] ?? '#90b4be'} />
                  </p>
                ))}
              </div>
            )
          })()}
          {card.body_text && <p style={{ whiteSpace: 'pre-wrap' }}>{card.body_text}</p>}
          {card.flavor_text && <p className="muted" style={{ fontStyle: 'italic' }}>{card.flavor_text}</p>}
          {card.decks && card.decks.length > 0 && (
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>In decks</h3>
              {card.decks.map((d) => (
                <p key={d.id} style={{ margin: '0.25rem 0' }}>
                  {d.qty}x in <Link to={`/decks/${d.id}`}>{d.name}</Link>
                  {d.in_use && <span className="badge foil" style={{ marginLeft: 6 }}>◈ built</span>}
                </p>
              ))}
              <p className="muted" style={{ margin: '0.4rem 0 0' }}>
                {card.qty_in_use} allocated to built decks · {card.qty_free} free in collection
              </p>
            </div>
          )}
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>In collection</h3>
            <div className="qtyedit">
              <span style={{ width: 70 }}>Normal</span>
              <button className="secondary" disabled={saving} onClick={() => bump('qty_normal', -1)}>−</button>
              <strong>{card.qty_normal}</strong>
              <button className="secondary" disabled={saving} onClick={() => bump('qty_normal', 1)}>+</button>
            </div>
            <div className="qtyedit">
              <span style={{ width: 70 }}>Foil ✦</span>
              <button className="secondary" disabled={saving} onClick={() => bump('qty_foil', -1)}>−</button>
              <strong>{card.qty_foil}</strong>
              <button className="secondary" disabled={saving} onClick={() => bump('qty_foil', 1)}>+</button>
            </div>
          </div>
          {(card.graded?.length ?? 0) > 0 && (
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>Collector grading</h3>
              {card.graded!.map((g) => (
                <p key={g.id} style={{ margin: '0.25rem 0' }}>
                  {g.foil && '✦ '}
                  <strong>{g.status.toUpperCase()}</strong>
                  {g.grader && <> · {g.grader} {g.grade ?? '?'}{g.cert_id && <span className="muted"> (cert {g.cert_id})</span>}</>}
                  {g.declared_value != null && <> · declared {money(g.declared_value)}</>}
                </p>
              ))}
              <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.8rem' }}>
                Submitted/graded copies are excluded from deck-building availability.
              </p>
            </div>
          )}
          <AddToWantList cardId={card.id} />
        </div>
      </div>
    </div>
  )
}
