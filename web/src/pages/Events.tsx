import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { get, send } from '../api'
import type { Deck, EventRow } from '../types'

export default function Events() {
  const [events, setEvents] = useState<EventRow[]>([])
  const [decks, setDecks] = useState<Deck[]>([])
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    store: '',
    deck_id: '',
    deck_version: '',
    rounds: '',
    player_count: '',
    entry_fee: '',
  })
  const nav = useNavigate()

  useEffect(() => {
    get<EventRow[]>('/events').then(setEvents).catch((e) => setError(String(e)))
    get<Deck[]>('/decks').then(setDecks).catch(() => {})
  }, [])

  const create = async () => {
    try {
      const ev = await send<EventRow>('POST', '/events', {
        date: form.date,
        store: form.store.trim(),
        deck_id: form.deck_id ? Number(form.deck_id) : null,
        deck_version: form.deck_version,
        rounds: form.rounds ? Number(form.rounds) : null,
        player_count: form.player_count ? Number(form.player_count) : null,
        entry_fee: form.entry_fee ? Number(form.entry_fee) : null,
      })
      nav(`/matches/${ev.id}`)
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Match Log</h1>
      <p className="muted">
        Rule 5.2: no notes during a match. Fill this in <strong>between rounds</strong>,
        review it <strong>before pairings</strong> — never at the table.
      </p>
      {error && <p className="error">{error}</p>}

      <table>
        <thead>
          <tr><th>Date</th><th>Store</th><th>Deck</th><th>Record</th><th>Rounds</th><th>Packs</th><th></th></tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>{e.date}</td>
              <td>{e.store}</td>
              <td>{e.deck_name ?? '—'}{e.deck_version ? ` (${e.deck_version})` : ''}</td>
              <td><strong>{e.final_record || e.record}</strong></td>
              <td>{e.match_count}/{e.rounds ?? '?'}</td>
              <td>{e.packs_won ?? '—'}{e.promo ? ' +promo' : ''}</td>
              <td><Link to={`/matches/${e.id}`}>open</Link></td>
            </tr>
          ))}
          {events.length === 0 && <tr><td colSpan={7} className="muted">No events logged yet.</td></tr>}
        </tbody>
      </table>

      <div className="panel" style={{ marginTop: '1.4rem' }}>
        <h3 style={{ marginTop: 0 }}>New event</h3>
        <div className="filterbar">
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <input placeholder="Store" value={form.store} onChange={(e) => setForm({ ...form, store: e.target.value })} />
          <select value={form.deck_id} onChange={(e) => setForm({ ...form, deck_id: e.target.value })}>
            <option value="">My deck…</option>
            {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <input placeholder="Version" size={6} value={form.deck_version} onChange={(e) => setForm({ ...form, deck_version: e.target.value })} />
          <input placeholder="Rounds" size={4} value={form.rounds} onChange={(e) => setForm({ ...form, rounds: e.target.value })} />
          <input placeholder="Players" size={4} value={form.player_count} onChange={(e) => setForm({ ...form, player_count: e.target.value })} />
          <input placeholder="Entry $" size={5} value={form.entry_fee} onChange={(e) => setForm({ ...form, entry_fee: e.target.value })} />
          <button onClick={create} disabled={!form.store.trim()}>Start event</button>
        </div>
      </div>
    </div>
  )
}
