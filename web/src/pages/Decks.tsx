import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { get, send } from '../api'
import { InkDots } from '../components/CardGrid'
import type { AllocationConflict, Deck } from '../types'

const STRATEGIES = ['Aggro', 'Rush', 'Midrange', 'Tempo', 'Control', 'Combo',
  'Ramp', 'Damage', 'Mill', 'Toolbox', 'Other']

export default function Decks() {
  const [decks, setDecks] = useState<Deck[]>([])
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [format, setFormat] = useState<'constructed' | 'sealed'>('constructed')
  const [simOnly, setSimOnly] = useState(false)
  const [error, setError] = useState('')
  const nav = useNavigate()

  const [conflicts, setConflicts] = useState<AllocationConflict[]>([])
  const [sortKey, setSortKey] = useState('')
  const [sortDir, setSortDir] = useState(1)

  const clickSort = (key: string) => {
    if (sortKey === key) setSortDir(-sortDir)
    else {
      setSortKey(key)
      setSortDir(1)
    }
  }
  const SortTh = ({ k, label, style }: { k: string; label: string; style?: CSSProperties }) => (
    <th onClick={() => clickSort(k)}
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', ...style }}
      title="Click to sort">
      {label}{sortKey === k ? (sortDir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  )
  const sortedDecks = (() => {
    if (!sortKey) return decks
    const str = (v: string | null | undefined) => (v ?? '').toLowerCase()
    return [...decks].sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'id': cmp = a.id - b.id; break
        case 'name': cmp = str(a.name).localeCompare(str(b.name)); break
        case 'type':
          cmp = str(a.sim_only ? 'sim' : a.format).localeCompare(str(b.sim_only ? 'sim' : b.format))
          break
        case 'cards': cmp = a.card_total - b.card_total; break
        case 'colors': cmp = (a.inks ?? []).join('/').localeCompare((b.inks ?? []).join('/')); break
        case 'strategy': cmp = str(a.strategy).localeCompare(str(b.strategy)); break
        case 'notes': cmp = str(a.notes).localeCompare(str(b.notes)); break
      }
      return sortDir * (cmp || a.name.localeCompare(b.name))
    })
  })()

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

  const saveMeta = async (id: number, patch: { strategy?: string; notes?: string }) => {
    try {
      const r = await send<{ id: number; strategy: string | null; notes: string | null }>(
        'PATCH', `/decks/${id}/meta`, patch)
      setDecks((ds) => ds.map((d) =>
        d.id === id ? { ...d, strategy: r.strategy, notes: r.notes } : d))
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
    <div style={{ maxWidth: 1300 }}>
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
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <SortTh k="id" label="#" />
              <SortTh k="name" label="Deck" />
              <SortTh k="type" label="Type" />
              <SortTh k="cards" label="Cards" />
              <SortTh k="colors" label="Colors" />
              <SortTh k="strategy" label="Strategy" />
              <SortTh k="notes" label="Notes" style={{ minWidth: '50ch' }} />
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedDecks.map((d) => (
              <tr key={d.id}>
                <td className="muted">{d.id}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <Link to={`/decks/${d.id}`}><strong>{d.name}</strong></Link>
                  {d.in_use && <span className="badge foil" style={{ marginLeft: 6 }}>◈ built</span>}
                  {d.wanted && !d.in_use && <span className="badge" style={{ marginLeft: 6 }}>★ want</span>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {d.sim_only ? 'sim' : d.format}
                  {d.sim_only && d.format === 'sealed' && ' · sealed'}
                </td>
                <td>{d.card_total}</td>
                <td style={{ whiteSpace: 'nowrap' }} title={(d.inks ?? []).join(' / ')}>
                  <InkDots ink={null} inks={d.inks ?? []} />
                </td>
                <td>
                  <select
                    value={d.strategy ?? ''}
                    onChange={(e) => saveMeta(d.id, { strategy: e.target.value })}
                  >
                    <option value="">—</option>
                    {STRATEGIES.map((s) => <option key={s} value={s}>{s}</option>)}
                    {d.strategy && !STRATEGIES.includes(d.strategy) && (
                      <option value={d.strategy}>{d.strategy}</option>
                    )}
                  </select>
                </td>
                <td>
                  <input
                    type="text"
                    defaultValue={d.notes ?? ''}
                    placeholder="notes…"
                    style={{ width: '100%', minWidth: '50ch' }}
                    onBlur={(e) => {
                      if (e.target.value.trim() !== (d.notes ?? '').trim())
                        saveMeta(d.id, { notes: e.target.value })
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    }}
                  />
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {d.card_total > 0 && (
                    <a href={`/api/decks/${d.id}/export.csv`}
                      title="Download Dreamborn-compatible CSV">⬇ CSV</a>
                  )}
                </td>
              </tr>
            ))}
            {decks.length === 0 && (
              <tr><td colSpan={8} className="muted">No decks yet.</td></tr>
            )}
          </tbody>
        </table>
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
