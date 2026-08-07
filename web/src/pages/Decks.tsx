import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { get, send } from '../api'
import type { AllocationConflict, Deck } from '../types'

export default function Decks() {
  const [decks, setDecks] = useState<Deck[]>([])
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [format, setFormat] = useState<'constructed' | 'sealed'>('constructed')
  const [simOnly, setSimOnly] = useState(false)
  const [error, setError] = useState('')
  const nav = useNavigate()

  const [conflicts, setConflicts] = useState<AllocationConflict[]>([])

  useEffect(() => {
    get<Deck[]>('/decks').then(setDecks).catch((e) => setError(String(e)))
    get<AllocationConflict[]>('/allocation-conflicts').then(setConflicts).catch(() => {})
  }, [])

  const createEmpty = async () => {
    if (!name.trim()) return
    try {
      const d = await send<Deck>('POST', '/decks', { name: name.trim(), notes: '', cards: [], source: 'webui', format, sim_only: simOnly })
      nav(`/decks/${d.id}`)
    } catch (e) {
      setError(String(e))
    }
  }

  const importDeck = async () => {
    if (!name.trim() || !text.trim()) return
    try {
      const d = await send<Deck>('POST', '/decks/import', { name: name.trim(), text, source: 'webui', format, sim_only: simOnly })
      nav(`/decks/${d.id}`)
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div style={{ maxWidth: 1000 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1>Decks</h1>
        <Link to="/wantlist">Want list →</Link>
      </div>
      {error && <p className="error">{error}</p>}
      {conflicts.length > 0 && (
        <div className="panel" style={{ borderColor: 'var(--danger)' }}>
          <p className="error" style={{ margin: 0 }}>
            ⚠ Built decks claim more copies than you own — the database is out of
            sync with your sleeves:
          </p>
          {conflicts.map((c) => (
            <p key={c.card_id} style={{ margin: '0.25rem 0 0', fontSize: '0.88rem' }}>
              <Link to={`/cards/${c.set_code}/${c.collector_number}`}>{c.full_name}</Link>
              {' '}— {c.claimed} claimed / {c.owned} owned
              <span className="muted"> ({c.decks.join('; ')})</span>
            </p>
          ))}
          <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.8rem' }}>
            Fix by un-building a deck, editing its list, or correcting collection counts
            on the card page.
          </p>
        </div>
      )}
      <div className="deckgrid">
        {decks.map((d) => (
          <Link key={d.id} to={`/decks/${d.id}`} className="panel" style={{ textDecoration: 'none', color: 'inherit' }}>
            <h3 style={{ margin: 0 }}>
              {d.name}
              {d.format === 'sealed' && <span className="badge" style={{ marginLeft: 8 }}>SEALED</span>}
              {d.sim_only && <span className="badge" style={{ marginLeft: 8 }} title="Opponent deck for simulations — not owned">SIM</span>}
              {d.in_use && <span className="badge foil" style={{ marginLeft: 8 }}>◈ built</span>}
              {d.wanted && !d.in_use && <span className="badge" style={{ marginLeft: 8 }}>★ want</span>}
            </h3>
            <p className="muted" style={{ margin: '0.3rem 0 0' }}>
              {d.card_total} cards{d.notes ? ` · ${d.notes}` : ''}
            </p>
          </Link>
        ))}
        {decks.length === 0 && <p className="muted">No decks yet.</p>}
      </div>

      <div className="panel" style={{ marginTop: '1.5rem' }}>
        <h3 style={{ marginTop: 0 }}>New deck</h3>
        <p>
          <input placeholder="Deck name" value={name} onChange={(e) => setName(e.target.value)} />
          {'  '}
          <select value={format} onChange={(e) => setFormat(e.target.value as 'constructed' | 'sealed')}>
            <option value="constructed">Constructed (60 cards)</option>
            <option value="sealed">Sealed / limited (40+ from pool)</option>
          </select>
          {'  '}
          <label className="muted" style={{ cursor: 'pointer', marginRight: 8 }}>
            <input type="checkbox" checked={simOnly} onChange={(e) => setSimOnly(e.target.checked)} />
            {' '}Sim-only (opponent deck, not owned)
          </label>
          <button className="secondary" onClick={createEmpty} disabled={!name.trim()}>
            Create empty deck
          </button>
        </p>
        <p className="muted">
          …or paste a Dreamborn deck export (lines like <code>4 Elsa - Spirit of Winter</code>):
        </p>
        <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} />
        <p>
          <button onClick={importDeck} disabled={!name.trim() || !text.trim()}>
            Import deck
          </button>
        </p>
      </div>
    </div>
  )
}
