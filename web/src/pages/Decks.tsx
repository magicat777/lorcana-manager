import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { get, send } from '../api'
import type { Deck } from '../types'

export default function Decks() {
  const [decks, setDecks] = useState<Deck[]>([])
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const nav = useNavigate()

  useEffect(() => {
    get<Deck[]>('/decks').then(setDecks).catch((e) => setError(String(e)))
  }, [])

  const createEmpty = async () => {
    if (!name.trim()) return
    try {
      const d = await send<Deck>('POST', '/decks', { name: name.trim(), notes: '', cards: [], source: 'webui' })
      nav(`/decks/${d.id}`)
    } catch (e) {
      setError(String(e))
    }
  }

  const importDeck = async () => {
    if (!name.trim() || !text.trim()) return
    try {
      const d = await send<Deck>('POST', '/decks/import', { name: name.trim(), text, source: 'webui' })
      nav(`/decks/${d.id}`)
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Decks</h1>
      {error && <p className="error">{error}</p>}
      <div className="deckgrid">
        {decks.map((d) => (
          <Link key={d.id} to={`/decks/${d.id}`} className="panel" style={{ textDecoration: 'none', color: 'inherit' }}>
            <h3 style={{ margin: 0 }}>
              {d.name}
              {d.in_use && <span className="badge foil" style={{ marginLeft: 8 }}>◈ built</span>}
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
