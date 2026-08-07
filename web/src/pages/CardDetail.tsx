import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { get, money, send } from '../api'
import { InkDots } from '../components/CardGrid'
import RarityIcon from '../components/RarityIcon'
import Sparkline from '../components/Sparkline'
import type { Card } from '../types'

export default function CardDetail() {
  const { set, number } = useParams()
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
        {card.image_large && <img src={card.image_large} alt={card.full_name} />}
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
            if (hist.length < 2 && foil.length < 2) return null
            const pts = (rows: typeof hist, key: 'usd' | 'usd_foil') =>
              rows.map((h) => ({ t: h.captured_at.slice(0, 10), v: Number(h[key]) }))
            return (
              <div className="panel">
                <h3 style={{ marginTop: 0 }}>Price history <span className="muted">(weekly)</span></h3>
                {hist.length >= 2 && (
                  <p style={{ margin: '0.3rem 0' }}>
                    <span className="muted" style={{ display: 'inline-block', width: 60 }}>Price</span>
                    <Sparkline points={pts(hist, 'usd')} showRange />
                  </p>
                )}
                {foil.length >= 2 && (
                  <p style={{ margin: '0.3rem 0' }}>
                    <span className="muted" style={{ display: 'inline-block', width: 60 }}>Foil ✦</span>
                    <Sparkline points={pts(foil, 'usd_foil')} showRange />
                  </p>
                )}
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
        </div>
      </div>
    </div>
  )
}
