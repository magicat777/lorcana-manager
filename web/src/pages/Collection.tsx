import { useEffect, useState } from 'react'
import { get } from '../api'
import CardGrid from '../components/CardGrid'
import type { SearchResult, SetInfo } from '../types'

const INKS = ['Amber', 'Amethyst', 'Emerald', 'Ruby', 'Sapphire', 'Steel']
const RARITIES = ['Common', 'Uncommon', 'Rare', 'Super_rare', 'Legendary', 'Enchanted']

const FILTER_KEY = 'cards.filters'

const loadFilters = () => {
  try {
    return { q: '', set: '', ink: '', rarity: '', owned: 'all', core: false, page: 1,
             ...JSON.parse(sessionStorage.getItem(FILTER_KEY) ?? '{}') }
  } catch {
    return { q: '', set: '', ink: '', rarity: '', owned: 'all', core: false, page: 1 }
  }
}

export default function Collection() {
  const saved = loadFilters()
  const [sets, setSets] = useState<SetInfo[]>([])
  const [q, setQ] = useState<string>(saved.q)
  const [set, setSet] = useState<string>(saved.set)
  const [ink, setInk] = useState<string>(saved.ink)
  const [rarity, setRarity] = useState<string>(saved.rarity)
  const [owned, setOwned] = useState<string>(saved.owned)
  const [core, setCore] = useState<boolean>(saved.core)
  const [page, setPage] = useState<number>(saved.page)
  const [data, setData] = useState<SearchResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    get<SetInfo[]>('/sets').then(setSets).catch((e) => setError(String(e)))
  }, [])

  // Filters survive card-detail visits / browser back until Reset (per tab).
  useEffect(() => {
    sessionStorage.setItem(FILTER_KEY, JSON.stringify({ q, set, ink, rarity, owned, core, page }))
  }, [q, set, ink, rarity, owned, core, page])

  const hasFilters = q !== '' || set !== '' || ink !== '' || rarity !== '' || owned !== 'all' || core
  const resetFilters = () => {
    sessionStorage.removeItem(FILTER_KEY)
    setQ(''); setSet(''); setInk(''); setRarity(''); setOwned('all'); setCore(false); setPage(1)
  }

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
        {hasFilters && (
          <button className="secondary" onClick={resetFilters} title="Clear all filters">
            ✕ Reset
          </button>
        )}
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
