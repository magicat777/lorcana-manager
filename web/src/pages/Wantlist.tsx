import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { get, money } from '../api'

interface WantlistData {
  wanted_decks: { id: number; name: string }[]
  cards: {
    card_id: string; full_name: string; set_code: string; collector_number: string
    rarity: string | null; price_usd: string | number | null
    qty_wanted: number; owned: number; allocated: number; need: number
    line_cost: number | null; decks: string[]
  }[]
  total_cost: number
  unpriced: number
  text: string
}

export default function Wantlist() {
  const [d, setD] = useState<WantlistData | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    get<WantlistData>('/wantlist').then(setD).catch((e) => setError(String(e)))
  }, [])

  if (error) return <p className="error">{error}</p>
  if (!d) return <p className="muted">Loading…</p>

  const copyList = async () => {
    await navigator.clipboard.writeText(d.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <p><Link to="/decks">← all decks</Link></p>
      <h1>Want List</h1>
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
          {d.cards.length === 0 ? (
            <p className="ok">✔ Nothing to buy — every flagged deck is coverable from free copies.</p>
          ) : (
            <>
              <div className="statrow">
                <div className="stat"><div className="k">Cards to buy</div>
                  <div className="v">{d.cards.reduce((a, c) => a + c.need, 0)}</div></div>
                <div className="stat"><div className="k">Est. cost</div>
                  <div className="v">{money(d.total_cost)}{d.unpriced ? <span className="muted"> +{d.unpriced} unpriced</span> : null}</div></div>
                <div><button className="secondary" onClick={copyList}>{copied ? '✓ Copied' : 'Copy shopping list'}</button></div>
              </div>
              <table>
                <thead>
                  <tr><th>Need</th><th>Card</th><th>Set·#</th><th>Rarity</th><th>Each</th><th>Line</th><th>For</th></tr>
                </thead>
                <tbody>
                  {d.cards.map((c) => (
                    <tr key={c.card_id}>
                      <td><strong>{c.need}</strong></td>
                      <td><Link to={`/cards/${c.set_code}/${c.collector_number}`}>{c.full_name}</Link></td>
                      <td className="muted">{c.set_code}·{c.collector_number}</td>
                      <td className="muted">{c.rarity?.replace('_', ' ')}</td>
                      <td>{money(c.price_usd)}</td>
                      <td>{c.line_cost != null ? money(c.line_cost) : '—'}</td>
                      <td className="muted">{c.decks.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  )
}
