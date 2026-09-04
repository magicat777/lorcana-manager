import Hero from '../components/Hero'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { get, money } from '../api'

interface BriefData {
  today: { weekday: string; date: string }
  tonight: { display_name: string; event_time: string | null }[]
  week_schedule: { slug: string; display_name: string; event_night: string; event_time: string | null }[]
  last_event: {
    id: number; date: string; store: string; final_record: string | null
    deck_name: string | null; one_change: string | null; biggest_problem: string | null
    days_ago: number
  } | null
  rotation: { date: string; days: number; core_sets: string } | null
  news: {
    title: string; url: string; category: string | null; summary: string | null
    published_at: string | null; is_new: boolean; signal: string | null
  }[]
  meta_last5: { ink_pair: string; times_faced: number; losses_to: number }[]
  deck_watch: { value: string; mentions: number }[]
  price_movers: { full_name: string; price_now: string; price_prev: string; delta: string }[]
  market: {
    sealed: {
      id: number; name: string; set_code: string | null; kind: string
      msrp: number; price: number; observed_at: string
      sp: number; sp_wow: number | null; set_ci: number | null
      quadrant: string; reason: string
    }[]
    singles: {
      full_name: string; set_code: string; collector_number: string
      price: number; avg30: number | null; ci: number | null
      ceiling: number | null; weeks_left: number | null
      trigger: 'buy' | 'momentum' | 'dip' | 'hot-set' | null
    }[]
    params: { weekly_budget_usd: number; rotation_horizon_years: number }
  }
  collection: { unique_owned: number; total_copies: number; value: string }
}

const TRIGGER_BADGE: Record<string, { label: string; cls: string; hint: string }> = {
  buy: { label: '🛒 BUY', cls: 'ok', hint: 'Crossed under its budget ceiling' },
  momentum: { label: '↗ momentum', cls: 'ok', hint: 'Players buying while sealed sits flat' },
  dip: { label: '▼ dip', cls: 'muted', hint: 'Softening — buy if it stays playable' },
  'hot-set': { label: '🔥 hot set', cls: 'error', hint: 'Singles and sealed both moving — priced in' },
}

export default function Brief() {
  const [b, setB] = useState<BriefData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    get<BriefData>('/brief').then(setB).catch((e) => setError(String(e)))
  }, [])

  if (error) return <p className="error">{error}</p>
  if (!b) return <p className="muted">Loading…</p>

  return (
    <div style={{ maxWidth: 800 }}>
      <Hero img="hero-brief.jpg"
        title={`Daily Brief — ${b.today.weekday.charAt(0).toUpperCase() + b.today.weekday.slice(1)} ${b.today.date}`} />

      <div className="panel">
        {b.tonight.length > 0 ? (
          b.tonight.map((v) => (
            <p key={v.display_name} className="ok" style={{ margin: 0, fontSize: '1.1rem' }}>
              ◈ TONIGHT: league at {v.display_name}{v.event_time ? ` — ${v.event_time}` : ''}
            </p>
          ))
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            No league tonight.
            {b.week_schedule.length === 0 &&
              ' (No venue league nights recorded yet — set event_night on venues.)'}
          </p>
        )}
        {b.week_schedule.length > 0 && (
          <p className="muted" style={{ margin: '0.4rem 0 0' }}>
            This week: {b.week_schedule.map((v) => `${v.event_night} — ${v.display_name}`).join(' · ')}
          </p>
        )}
      </div>

      {b.rotation && b.rotation.days >= 0 && (
        <div className="panel">
          <p className={b.rotation.days <= 90 ? 'error' : 'muted'} style={{ margin: 0 }}>
            ⟳ Core rotation {b.rotation.date} — {b.rotation.days} days away.
            Core is currently sets {b.rotation.core_sets}.
          </p>
        </div>
      )}

      {b.news.length > 0 && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Official news</h3>
          {b.news.map((n) => (
            <p key={n.url} style={{ margin: '0.35rem 0' }}>
              {n.is_new && <span className="ok" style={{ fontWeight: 600 }}>NEW </span>}
              {n.signal && (
                <span className="error" style={{ fontWeight: 600 }}
                  title={n.signal === 'new-set' ? 'New set — run the seed job' : 'Rules-relevant article'}>
                  ⚠ {n.signal === 'new-set' ? 'NEW SET' : 'RULES'}{' '}
                </span>
              )}
              <a href={n.url} target="_blank" rel="noopener noreferrer">{n.title}</a>
              <span className="muted">
                {' '}— {n.category}{n.published_at ? `, ${n.published_at}` : ''}
              </span>
              {n.summary && (
                <><br /><span className="muted" style={{ fontSize: '0.85rem' }}>{n.summary}</span></>
              )}
            </p>
          ))}
        </div>
      )}

      {b.last_event && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Last event</h3>
          <p>
            <Link to={`/matches/${b.last_event.id}`}>{b.last_event.date} — {b.last_event.store}</Link>
            {' '}went <strong>{b.last_event.final_record ?? '?'}</strong>
            {b.last_event.deck_name && <> with {b.last_event.deck_name}</>}
            <span className="muted"> ({b.last_event.days_ago} days ago)</span>
          </p>
          {b.last_event.one_change && (
            <p className="ok">Your one change for next week: {b.last_event.one_change}</p>
          )}
          {b.last_event.biggest_problem && (
            <p className="muted">Biggest problem was: {b.last_event.biggest_problem}</p>
          )}
        </div>
      )}

      {b.meta_last5.length > 0 && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Local meta (last 5 events)</h3>
          <table>
            <thead><tr><th>Ink pair</th><th>Faced</th><th>Losses to</th></tr></thead>
            <tbody>
              {b.meta_last5.map((m) => (
                <tr key={m.ink_pair}>
                  <td>{m.ink_pair}</td><td>{m.times_faced}</td>
                  <td className={m.losses_to ? 'error' : ''}>{m.losses_to}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {b.deck_watch.length > 0 && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Deck watch — dead-card mentions</h3>
          <p>{b.deck_watch.map((d) => `${d.value} ×${d.mentions}`).join(' · ')}</p>
        </div>
      )}

      {(b.market?.sealed.length > 0 || b.market?.singles.length > 0) && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Market signals</h3>
          {b.market.sealed.length > 0 && (
            <table style={{ marginBottom: '0.6rem' }}>
              <thead><tr><th>Sealed</th><th>Price</th><th>SP × MSRP</th><th>Set CI</th><th>Read</th></tr></thead>
              <tbody>
                {b.market.sealed.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{money(s.price)} <span className="muted">({s.observed_at})</span></td>
                    <td className={s.sp >= 1.15 ? 'error' : ''}>{s.sp.toFixed(2)}×</td>
                    <td>{s.set_ci != null ? s.set_ci.toFixed(2) : '—'}</td>
                    <td title={s.reason}><strong>{s.quadrant}</strong>{' '}
                      <span className="muted" style={{ fontSize: '0.82rem' }}>{s.reason}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {b.market.singles.length > 0 && (
            <table>
              <thead><tr><th>Want-list single</th><th>Price</th><th>30d avg</th><th>CI</th><th>Ceiling</th><th></th></tr></thead>
              <tbody>
                {b.market.singles.map((x) => (
                  <tr key={`${x.set_code}-${x.collector_number}`}>
                    <td><Link to={`/cards/${x.set_code}/${x.collector_number}`}>{x.full_name}</Link></td>
                    <td>{money(x.price)}</td>
                    <td>{x.avg30 != null ? money(x.avg30) : '—'}</td>
                    <td className={x.ci == null ? '' : x.ci >= 1.1 ? 'ok' : x.ci <= 0.9 ? 'error' : ''}>
                      {x.ci != null ? x.ci.toFixed(2) : '—'}
                    </td>
                    <td className="muted">
                      {x.ceiling != null ? `${money(x.ceiling)} (${x.weeks_left}w)` : '—'}
                    </td>
                    <td>
                      {x.trigger && (
                        <span className={TRIGGER_BADGE[x.trigger].cls} title={TRIGGER_BADGE[x.trigger].hint}>
                          {TRIGGER_BADGE[x.trigger].label}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.8rem' }}>
            SP = sealed price ÷ MSRP (speculation). CI = single price ÷ its 30-day average (play
            demand). SP high with CI flat = scalped box: buy singles, skip sealed. Ceiling =
            ${b.market.params.weekly_budget_usd.toFixed(2)}/week × weeks of Core left. Sealed
            prices are hand-logged — ask the MCP to record one when you spot a price.
          </p>
        </div>
      )}

      {b.price_movers.length > 0 && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Price movers (owned cards)</h3>
          <table>
            <tbody>
              {b.price_movers.map((m) => (
                <tr key={m.full_name}>
                  <td>{m.full_name}</td>
                  <td className={Number(m.delta) >= 0 ? 'ok' : 'error'}>
                    {Number(m.delta) >= 0 ? '+' : ''}{money(m.delta)}
                  </td>
                  <td>{money(m.price_prev)} → {money(m.price_now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted">
        Collection: {b.collection.unique_owned} unique / {b.collection.total_copies} copies,
        ~{money(b.collection.value)}.
      </p>
    </div>
  )
}
