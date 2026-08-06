import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { get } from '../api'
import { InkDots } from '../components/CardGrid'

interface ExportData {
  deck_id: number
  name: string
  notes: string | null
  card_total: number
  text: string
  cards: {
    qty: number; full_name: string; set_code: string; collector_number: string
    ink: string | null; inks: string[] | null; cost: number | null
    inkwell: boolean | null; rarity: string | null; type: string[] | null
  }[]
  composition: {
    type_counts: Record<string, number>
    cost_curve: Record<string, number>
    ink_counts: Record<string, number>
    inkable: number
    uninkable: number
    avg_cost: number
    total_lore: number
  }
  validation: string[]
  not_core_legal: { full_name: string; qty: number; set_code: string; status: string }[]
  core_legal: boolean
  format: 'constructed' | 'sealed'
}

export default function DeckExport() {
  const { id } = useParams()
  const [d, setD] = useState<ExportData | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    get<ExportData>(`/decks/${id}/export`).then(setD).catch((e) => setError(String(e)))
  }, [id])

  if (error) return <p className="error">{error}</p>
  if (!d) return <p className="muted">Loading…</p>

  const copyList = async () => {
    await navigator.clipboard.writeText(d.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const downloadTxt = () => {
    const blob = new Blob([d.text + '\n'], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${d.name.replace(/[^a-z0-9]+/gi, '-')}-decklist.txt`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const c = d.composition
  const maxCurve = Math.max(...Object.values(c.cost_curve), 1)

  return (
    <div className="printsheet" style={{ maxWidth: 900 }}>
      <p className="no-print">
        <Link to={`/decks/${d.deck_id}`}>← back to deck</Link>
      </p>
      <div className="no-print" style={{ display: 'flex', gap: '0.6rem', marginBottom: '1rem' }}>
        <button onClick={() => window.print()}>🖨 Print sheet</button>
        <button className="secondary" onClick={copyList}>{copied ? '✓ Copied' : 'Copy text list'}</button>
        <button className="secondary" onClick={downloadTxt}>Download .txt</button>
      </div>

      <h1 style={{ marginBottom: 0 }}>Deck List — {d.name}</h1>
      <p className="muted">
        {d.card_total} cards · {Object.keys(c.ink_counts).join(' / ')} ·
        {' '}{c.inkable} inkable / {c.uninkable} uninkable · avg cost {c.avg_cost}
      </p>

      <div className="sheet-header panel">
        <div className="sheet-fields">
          <span>Player: ______________________________</span>
          <span>Event: ______________________________</span>
          <span>Date: ______________</span>
        </div>
      </div>

      {d.format === 'sealed' ? (
        d.validation.length > 0 ? (
          <div className="panel">
            {d.validation.map((w, i) => <p className="error" key={i} style={{ margin: '0.2rem 0' }}>⚠ {w}</p>)}
          </div>
        ) : (
          <p className="ok">✔ Sealed deck — {d.card_total} cards (minimum 40; pool-limited, no copy/ink restrictions).</p>
        )
      ) : (
        <>
          {!d.core_legal && (
            <div className="panel">
              {d.validation.map((w, i) => <p className="error" key={i} style={{ margin: '0.2rem 0' }}>⚠ {w}</p>)}
              {d.not_core_legal.length > 0 && (
                <p className="error" style={{ margin: '0.2rem 0' }}>
                  ⚠ Not Core Constructed legal: {d.not_core_legal.map((x) => `${x.qty}x ${x.full_name} (${x.status})`).join(', ')}
                </p>
              )}
            </div>
          )}
          {d.core_legal && <p className="ok">✔ Legal for Core Constructed (60 cards, ≤4 per name, ≤2 inks, all cards Core-legal).</p>}
        </>
      )}

      <table>
        <thead>
          <tr><th>Qty</th><th>Card</th><th>Set·#</th><th>Cost</th><th>Ink</th><th>Inkable</th><th>Type</th></tr>
        </thead>
        <tbody>
          {d.cards.map((card) => (
            <tr key={`${card.set_code}-${card.collector_number}`}>
              <td>{card.qty}</td>
              <td>{card.full_name}</td>
              <td>{card.set_code}·{card.collector_number}</td>
              <td>{card.cost ?? '—'}</td>
              <td><InkDots ink={card.ink} inks={card.inks} />{(card.inks ?? [card.ink]).filter(Boolean).join('/')}</td>
              <td>{card.inkwell ? '●' : '—'}</td>
              <td>{card.type?.join(' · ')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', marginTop: '1rem' }}>
        <div className="panel" style={{ flex: 1, minWidth: 240 }}>
          <h3 style={{ marginTop: 0 }}>Composition</h3>
          {Object.entries(c.type_counts).map(([t, n]) => (
            <p key={t} style={{ margin: '0.15rem 0' }}>{t}: {n}</p>
          ))}
          <p style={{ margin: '0.15rem 0' }}>Total lore on characters: {c.total_lore}</p>
          {Object.entries(c.ink_counts).map(([ink, n]) => (
            <p key={ink} style={{ margin: '0.15rem 0' }}>{ink}: {n} cards</p>
          ))}
        </div>
        <div className="panel" style={{ flex: 1, minWidth: 240 }}>
          <h3 style={{ marginTop: 0 }}>Cost curve</h3>
          {Object.entries(c.cost_curve).map(([cost, n]) => (
            <div key={cost} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0.2rem 0' }}>
              <span style={{ width: 24 }}>{cost}</span>
              <div className="progress" style={{ flex: 1 }}>
                <div style={{ width: `${(100 * n) / maxCurve}%` }} />
              </div>
              <span style={{ width: 24 }}>{n}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
