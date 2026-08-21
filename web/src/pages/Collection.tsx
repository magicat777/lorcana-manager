import { useEffect, useState } from 'react'
import { get } from '../api'
import { useRef } from 'react'
import CardGrid from '../components/CardGrid'
import Hero from '../components/Hero'
import RarityIcon from '../components/RarityIcon'
import type { SearchResult, SetInfo } from '../types'

const INKS = ['Amber', 'Amethyst', 'Emerald', 'Ruby', 'Sapphire', 'Steel']
const RARITIES = ['Common', 'Uncommon', 'Rare', 'Super_rare', 'Epic', 'Legendary', 'Iconic', 'Enchanted', 'Promo']

function RarityFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="secondary" onClick={() => setOpen(!open)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
        {value ? <><RarityIcon rarity={value} /> {value.replace('_', ' ')}</> : 'All rarities'}
        <span className="muted">▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 30,
          background: 'var(--panel)', border: '1px solid var(--border)',
          borderRadius: 8, padding: 4, minWidth: 170, boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
        }}>
          {['', ...RARITIES].map((r) => (
            <div key={r} className="dropdown-opt" onClick={() => { onChange(r); setOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '0.35rem 0.6rem',
                cursor: 'pointer', borderRadius: 6,
                background: r === value ? 'var(--bg2)' : undefined,
              }}>
              {r ? <RarityIcon rarity={r} /> : <span style={{ width: 14, flexShrink: 0 }} />}
              <span>{r ? r.replace('_', ' ') : 'All rarities'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const FILTER_KEY = 'cards.filters'

const loadFilters = () => {
  try {
    return { q: '', set: '', ink: '', rarity: '', lore: '', owned: 'all', core: false, page: 1,
             ...JSON.parse(sessionStorage.getItem(FILTER_KEY) ?? '{}') }
  } catch {
    return { q: '', set: '', ink: '', rarity: '', lore: '', owned: 'all', core: false, page: 1 }
  }
}

export default function Collection() {
  const saved = loadFilters()
  const [sets, setSets] = useState<SetInfo[]>([])
  const [q, setQ] = useState<string>(saved.q)
  const [set, setSet] = useState<string>(saved.set)
  const [ink, setInk] = useState<string>(saved.ink)
  const [rarity, setRarity] = useState<string>(saved.rarity)
  const [lore, setLore] = useState<string>(saved.lore)
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
    sessionStorage.setItem(FILTER_KEY, JSON.stringify({ q, set, ink, rarity, lore, owned, core, page }))
  }, [q, set, ink, rarity, lore, owned, core, page])

  const hasFilters = q !== '' || set !== '' || ink !== '' || rarity !== '' || lore !== '' || owned !== 'all' || core
  const resetFilters = () => {
    sessionStorage.removeItem(FILTER_KEY)
    setQ(''); setSet(''); setInk(''); setRarity(''); setLore(''); setOwned('all'); setCore(false); setPage(1)
  }

  useEffect(() => {
    const t = setTimeout(() => {
      get<SearchResult>('/cards', { q, set, ink, rarity, lore, owned, page, ...(core ? { core: 'true' } : {}) })
        .then((d) => {
          setData(d)
          setError('')
        })
        .catch((e) => setError(String(e)))
    }, 250)
    return () => clearTimeout(t)
  }, [q, set, ink, rarity, lore, owned, core, page])

  const reset = () => setPage(1)
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  return (
    <div>
      <Hero img="hero-cards.jpg" title="Cards" pos="center 10%" />
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
        <RarityFilter value={rarity} onChange={(r) => { setRarity(r); reset() }} />
        <select value={lore} onChange={(e) => { setLore(e.target.value); reset() }}
          title="Printed lore value (not effect-granted)">
          <option value="">Any lore</option>
          {['0', '1', '2', '3', '4', '5'].map((l) => (
            <option key={l} value={l}>{l} lore</option>
          ))}
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
