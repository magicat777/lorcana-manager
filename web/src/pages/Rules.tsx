import { useEffect, useState } from 'react'
import Hero from '../components/Hero'
import { get } from '../api'

interface CrRow {
  kind: 'section' | 'rule' | 'glossary'
  key: string
  title: string | null
  body: string
}
interface CrMeta {
  version: string
  effective_date: string | null
  loaded_at: string
  rules: number
  glossary: number
  newest_set_release: string | null
  possibly_stale: boolean
}
interface SearchResp {
  meta: CrMeta
  exact: (CrRow & { context: CrRow[]; children: CrRow[] }) | null
  results: (CrRow & { snippet: string })[]
}

function RuleKey({ k, kind, onJump }: { k: string; kind: string; onJump: (k: string) => void }) {
  if (kind === 'glossary') return <span className="badge">{k}</span>
  return (
    <button className="togglebtn small secondary" title={`Show ${k} with context`}
      onClick={() => onJump(k)}>
      {k}
    </button>
  )
}

export default function Rules() {
  const [q, setQ] = useState(() => sessionStorage.getItem('rules.q') ?? '')
  const [resp, setResp] = useState<SearchResp | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    sessionStorage.setItem('rules.q', q)
    if (q.trim().length < 2) {
      setResp(null)
      return
    }
    setLoading(true)
    const t = setTimeout(() => {
      get<SearchResp>('/rules/search', { q: q.trim() })
        .then((r) => { setResp(r); setError('') })
        .catch((e) => setError(String(e)))
        .finally(() => setLoading(false))
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  const jump = (key: string) => setQ(key)
  const meta = resp?.meta

  return (
    <div style={{ maxWidth: 900 }}>
      <Hero img="article-header.jpg" title="Comprehensive Rules" pos="center 30%" />
      <div className="panel">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          placeholder='Search the CR — "bodyguard challenge", "shift cost" — or jump to a rule: 7.4.3'
          style={{ width: '100%', fontSize: '1.05rem' }} />
        {meta && (
          <p className="muted" style={{ margin: '0.45rem 0 0', fontSize: '0.82rem' }}>
            CR {meta.version}, effective {meta.effective_date} · {meta.rules} rules ·{' '}
            {meta.glossary} glossary terms · text ©Disney/Ravensburger, indexed for personal reference
            {meta.possibly_stale && (
              <span className="error"> ⚠ a set released after this CR — the index may be
                stale, rerun the rules-seed job</span>
            )}
          </p>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Searching…</p>}

      {resp?.exact && (
        <div className="panel">
          {resp.exact.context.length > 0 && (
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              {resp.exact.context.map((c) => (
                <span key={c.key}>
                  <a onClick={() => jump(c.key)} style={{ cursor: 'pointer' }}>
                    {c.key}{c.title ? ` ${c.title}` : ''}
                  </a>{' › '}
                </span>
              ))}
            </p>
          )}
          <h3 style={{ margin: '0 0 0.3rem' }}>
            {resp.exact.key}{resp.exact.title ? ` — ${resp.exact.title}` : ''}
          </h3>
          {resp.exact.body && <p style={{ whiteSpace: 'pre-wrap' }}>{resp.exact.body}</p>}
          {resp.exact.children.map((c) => (
            <p key={c.key} style={{ whiteSpace: 'pre-wrap', margin: '0.45rem 0' }}>
              <RuleKey k={c.key} kind={c.kind} onJump={jump} /> {c.body}
            </p>
          ))}
        </div>
      )}

      {resp && !resp.exact && resp.results.length === 0 && !loading && (
        <p className="muted">No CR paragraph matches. Try different words, or a rule number.</p>
      )}
      {resp?.results.map((r) => (
        <div className="panel" key={`${r.kind}-${r.key}`}>
          <p style={{ margin: 0 }}>
            <RuleKey k={r.key} kind={r.kind} onJump={jump} />
            {r.kind === 'glossary' && <span className="muted"> glossary</span>}
          </p>
          <p style={{ whiteSpace: 'pre-wrap', margin: '0.35rem 0 0' }}>{r.body}</p>
        </div>
      ))}
    </div>
  )
}
