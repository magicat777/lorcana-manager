import { useEffect, useState } from 'react'
import { get } from '../api'
import CardGrid from '../components/CardGrid'
import type { SearchResult, SetInfo } from '../types'

const INKS = ['Amber', 'Amethyst', 'Emerald', 'Ruby', 'Sapphire', 'Steel']
const RARITIES = ['Common', 'Uncommon', 'Rare', 'Super_rare', 'Legendary', 'Enchanted']

export default function Collection() {
  const [sets, setSets] = useState<SetInfo[]>([])
  const [q, setQ] = useState('')
  const [set, setSet] = useState('')
  const [ink, setInk] = useState('')
  const [rarity, setRarity] = useState('')
  const [owned, setOwned] = useState('all')
  const [core, setCore] = useState(false)
  const [page, setPage] = useState(1)
  const [data, setData] = useState<SearchResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    get<SetInfo[]>('/sets').then(setSets).catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      get<SearchResult>('/cards', { q, set, ink, rarity, owned, page, ...(core ? { core: 'true' } : {}) })
        .then((d) => {
          setData(d)
          setError('')
        })
        .catch((e) => setError(String(e)))
    }, 250)
    return () => clearTimeout(t)
  }, [q, set, ink, rarity, owned, core, page])

  const reset = () => setPage(1)
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  return (
    <div>
      <div className="filterbar">
        <input
          type="search"
          placeholder="Search name or text…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            reset()
          }}
        />
        <select value={set} onChange={(e) => { setSet(e.target.value); reset() }}>
          <option value="">All sets</option>
          {sets.map((s) => (
            <option key={s.id} value={s.code}>
              {s.code} — {s.name}
            </option>
          ))}
        </select>
        <select value={ink} onChange={(e) => { setInk(e.target.value); reset() }}>
          <option value="">All inks</option>
          {INKS.map((i) => <option key={i}>{i}</option>)}
        </select>
        <select value={rarity} onChange={(e) => { setRarity(e.target.value); reset() }}>
          <option value="">All rarities</option>
          {RARITIES.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
        </select>
        <select value={owned} onChange={(e) => { setOwned(e.target.value); reset() }}>
          <option value="all">Owned + missing</option>
          <option value="owned">Owned only</option>
          <option value="missing">Missing only</option>
        </select>
        <label className="muted" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={core} onChange={(e) => { setCore(e.target.checked); reset() }} />
          {' '}Core-legal only
        </label>
        {data && <span className="muted">{data.total} cards</span>}
      </div>
      {error && <p className="error">{error}</p>}
      {data && <CardGrid cards={data.results} />}
      {pages > 1 && (
        <div className="pager">
          <button className="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ← Prev
          </button>
          <span className="muted">
            page {page} / {pages}
          </span>
          <button className="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
