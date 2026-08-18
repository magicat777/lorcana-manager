import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { get, send } from '../api'
import type { Deck, EventDetailData, MatchRow, Venue } from '../types'

const INKS = ['Amber', 'Amethyst', 'Emerald', 'Ruby', 'Sapphire', 'Steel']
const RESULTS = ['2-0', '2-1', '1-2', '0-2', '1-0', '0-1', 'DRAW', 'BYE']
const SHAPES = ['lore_rush', 'aggro', 'midrange', 'control', 'unclear']
const TAGS = ['Items', 'Locations', 'Songs+Singer', 'Bodyguard', 'Evasive', 'Ward',
  'Rush', 'Shift', 'Boost', 'Direct removal', 'Board wipe', 'Vinelings']
const LOSS_MODES = ['race', 'board', 'flood', 'screw', 'time', 'na']

const emptyGame = (n: number) => ({ game_no: n, on_play: null as boolean | null, won: null as boolean | null, loss_mode: 'na', cards_altered: '' })

const emptyMatch = () => ({
  round: '', opponent_handle: '', result: '2-0', inks: [] as string[],
  opp_shape: 'unclear', one_liner: '', threats: ['', '', '', ''],
  tags: [] as string[], dead: '', mvp: '',
  games: [emptyGame(1), emptyGame(2), emptyGame(3)],
})

export default function EventDetail() {
  const { id } = useParams()
  const [ev, setEv] = useState<EventDetailData | null>(null)
  const [m, setM] = useState(emptyMatch())
  const [post, setPost] = useState({ final_record: '', packs_won: '', promo: false, never_drew: '', always_dead: '', biggest_problem: '', one_change: '' })
  const [editingRound, setEditingRound] = useState<number | null>(null)
  const [editHeader, setEditHeader] = useState(false)
  const [venues, setVenues] = useState<Venue[]>([])
  const [decks, setDecks] = useState<Deck[]>([])
  const [hdr, setHdr] = useState({ date: '', venue_slug: '', store: '', format: '', deck_id: '', deck_version: '', rounds: '', player_count: '', entry_fee: '' })
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  const load = () =>
    get<EventDetailData>(`/events/${id}`).then((e) => {
      setEv(e)
      setM((cur) => ({ ...cur, round: String(e.matches.length + 1) }))
      setPost({
        final_record: e.final_record ?? '',
        packs_won: e.packs_won != null ? String(e.packs_won) : '',
        promo: !!e.promo,
        never_drew: e.observations.filter((o) => o.kind === 'never_drew').map((o) => o.value).join(', '),
        always_dead: e.observations.filter((o) => o.kind === 'always_dead').map((o) => o.value).join(', '),
        biggest_problem: e.biggest_problem ?? '',
        one_change: e.one_change ?? '',
      })
    }).catch((e) => setError(String(e)))
  useEffect(() => { load() }, [id])
  useEffect(() => {
    get<Venue[]>('/venues').then(setVenues).catch(() => {})
    get<Deck[]>('/decks').then(setDecks).catch(() => {})
  }, [])

  const startEditHeader = () => {
    if (!ev) return
    setHdr({
      date: ev.date, venue_slug: '', store: ev.store, format: ev.format,
      deck_id: ev.deck_id != null ? String(ev.deck_id) : '',
      deck_version: ev.deck_version ?? '',
      rounds: ev.rounds != null ? String(ev.rounds) : '',
      player_count: ev.player_count != null ? String(ev.player_count) : '',
      entry_fee: ev.entry_fee != null ? String(ev.entry_fee) : '',
    })
    setEditHeader(true)
  }

  const saveHeader = async () => {
    setError('')
    try {
      await send('PUT', `/events/${id}`, {
        date: hdr.date || null,
        venue_slug: hdr.venue_slug || null,
        store: hdr.venue_slug ? null : (hdr.store.trim() || null),
        format: hdr.format || null,
        deck_id: hdr.deck_id ? Number(hdr.deck_id) : null,
        deck_version: hdr.deck_version || null,
        rounds: hdr.rounds ? Number(hdr.rounds) : null,
        player_count: hdr.player_count ? Number(hdr.player_count) : null,
        entry_fee: hdr.entry_fee ? Number(hdr.entry_fee) : null,
      })
      setEditHeader(false)
      setSaved('Event details saved')
      load()
    } catch (e) {
      setError(String(e))
    }
  }

  const startEditRound = (match: MatchRow) => {
    const obs = (kind: string) => match.observations.filter((o) => o.kind === kind).map((o) => o.value)
    const threats = obs('threat_card')
    setM({
      round: String(match.round),
      opponent_handle: match.opponent_handle ?? '',
      result: match.result,
      inks: [match.opp_ink_1, match.opp_ink_2].filter(Boolean) as string[],
      opp_shape: match.opp_shape ?? 'unclear',
      one_liner: match.one_liner ?? '',
      threats: [0, 1, 2, 3].map((i) => threats[i] ?? ''),
      tags: obs('tag'),
      dead: obs('my_dead_card')[0] ?? '',
      mvp: obs('my_mvp')[0] ?? '',
      games: [1, 2, 3].map((n) => {
        const g = match.games.find((x) => x.game_no === n)
        return g
          ? { game_no: n, on_play: g.on_play, won: g.won, loss_mode: g.loss_mode ?? 'na', cards_altered: g.cards_altered != null ? String(g.cards_altered) : '' }
          : emptyGame(n)
      }),
    })
    setEditingRound(match.round)
    setSaved('')
    document.getElementById('log-round-form')?.scrollIntoView({ behavior: 'smooth' })
  }

  const toggleInk = (ink: string) =>
    setM((cur) => ({
      ...cur,
      inks: cur.inks.includes(ink) ? cur.inks.filter((i) => i !== ink)
        : cur.inks.length < 2 ? [...cur.inks, ink] : cur.inks,
    }))

  const saveMatch = async () => {
    setError('')
    const obs = [
      ...m.threats.filter((t) => t.trim()).map((t) => ({ kind: 'threat_card', value: t.trim() })),
      ...m.tags.map((t) => ({ kind: 'tag', value: t })),
      ...(m.dead.trim() ? [{ kind: 'my_dead_card', value: m.dead.trim() }] : []),
      ...(m.mvp.trim() ? [{ kind: 'my_mvp', value: m.mvp.trim() }] : []),
    ]
    const games = m.games
      .filter((g) => g.won !== null || g.on_play !== null)
      .map((g) => ({
        game_no: g.game_no, on_play: g.on_play, won: g.won,
        loss_mode: g.won === false ? g.loss_mode : 'na',
        cards_altered: g.cards_altered === '' ? null : Number(g.cards_altered),
      }))
    try {
      await send('POST', `/events/${id}/matches`, {
        round: Number(m.round), opponent_handle: m.opponent_handle.trim(), result: m.result,
        opp_ink_1: m.inks[0] ?? '', opp_ink_2: m.inks[1] ?? '', opp_shape: m.opp_shape,
        one_liner: m.one_liner.trim(), games, observations: obs,
        overwrite: editingRound != null,
      })
      setM(emptyMatch())
      setSaved(editingRound != null ? `Round ${m.round} updated` : `Round ${m.round} saved`)
      setEditingRound(null)
      load()
    } catch (e) {
      setError(String(e))
    }
  }

  const savePost = async () => {
    setError('')
    try {
      await send('PUT', `/events/${id}`, {
        final_record: post.final_record || null,
        packs_won: post.packs_won === '' ? null : Number(post.packs_won),
        promo: post.promo,
        biggest_problem: post.biggest_problem || null,
        one_change: post.one_change || null,
        observations: [
          ...post.never_drew.split(',').map((s) => s.trim()).filter(Boolean).map((v) => ({ kind: 'never_drew', value: v })),
          ...post.always_dead.split(',').map((s) => s.trim()).filter(Boolean).map((v) => ({ kind: 'always_dead', value: v })),
        ],
      })
      setSaved('Post-event saved')
      load()
    } catch (e) {
      setError(String(e))
    }
  }

  if (error && !ev) return <p className="error">{error}</p>
  if (!ev) return <p className="muted">Loading…</p>

  return (
    <div style={{ maxWidth: 1100 }}>
      <p><Link to="/matches">← all events</Link></p>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1>{ev.date} — {ev.store} <span className="muted">({ev.final_record || ev.record})</span></h1>
        <button className="secondary" onClick={() => (editHeader ? setEditHeader(false) : startEditHeader())}>
          {editHeader ? 'Cancel edit' : '✎ Edit event'}
        </button>
      </div>
      {editHeader && (
        <div className="panel">
          <div className="filterbar">
            <input type="date" value={hdr.date} onChange={(e) => setHdr({ ...hdr, date: e.target.value })} />
            <select value={hdr.venue_slug} onChange={(e) => setHdr({ ...hdr, venue_slug: e.target.value })}>
              <option value="">Venue: keep "{ev.store}"</option>
              {venues.map((v) => <option key={v.slug} value={v.slug}>{v.display_name}</option>)}
            </select>
            {!hdr.venue_slug && (
              <input placeholder="Store name" value={hdr.store} onChange={(e) => setHdr({ ...hdr, store: e.target.value })} />
            )}
            <select value={hdr.format} onChange={(e) => setHdr({ ...hdr, format: e.target.value })}>
              <option value="Core Constructed">Core Constructed</option>
              <option value="Sealed">Sealed</option>
              <option value="Draft">Draft</option>
            </select>
            <select value={hdr.deck_id} onChange={(e) => setHdr({ ...hdr, deck_id: e.target.value })}>
              <option value="">My deck…</option>
              {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <input placeholder="Version" size={6} value={hdr.deck_version} onChange={(e) => setHdr({ ...hdr, deck_version: e.target.value })} />
            <input placeholder="Rounds" size={4} value={hdr.rounds} onChange={(e) => setHdr({ ...hdr, rounds: e.target.value })} />
            <input placeholder="Players" size={4} value={hdr.player_count} onChange={(e) => setHdr({ ...hdr, player_count: e.target.value })} />
            <input placeholder="Entry $" size={5} value={hdr.entry_fee} onChange={(e) => setHdr({ ...hdr, entry_fee: e.target.value })} />
            <button onClick={saveHeader}>Save event details</button>
          </div>
        </div>
      )}
      <p className="muted">
        {ev.deck_name ?? 'no deck'}{ev.deck_version ? ` v${ev.deck_version}` : ''} · {ev.format}
        {ev.player_count ? ` · ${ev.player_count} players` : ''}{ev.rounds ? ` · ${ev.rounds} rounds` : ''}
      </p>
      {error && <p className="error">{error}</p>}
      {saved && <p className="ok">{saved}</p>}

      {ev.matches.map((match: MatchRow) => (
        <div className="panel" key={match.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong>
              R{match.round} vs {match.opponent_handle || '?'} — {match.result}
              {match.opp_ink_1 && <span className="muted"> · {match.opp_ink_1}{match.opp_ink_2 ? `/${match.opp_ink_2}` : ''} {match.opp_shape}</span>}
            </strong>
            <span>
              <button className="secondary" style={{ marginRight: 6 }} title="Load this round into the form to edit"
                onClick={() => startEditRound(match)}>✎ Edit</button>
              <button className="secondary" onClick={async () => {
                if (confirm(`Delete round ${match.round}?`)) { await send('DELETE', `/matches/${match.id}`); load() }
              }}>✕</button>
            </span>
          </div>
          <p className="muted" style={{ margin: '0.3rem 0' }}>
            {match.games.map((g) => `G${g.game_no} ${g.on_play == null ? '' : g.on_play ? 'play ' : 'draw '}${g.won == null ? '?' : g.won ? 'W' : `L(${g.loss_mode})`}`).join(' · ')}
          </p>
          {match.observations.length > 0 && (
            <p style={{ margin: '0.3rem 0' }}>
              {match.observations.filter((o) => o.kind === 'threat_card').map((o) => <span key={o.id} className="badge" style={{ marginRight: 4 }}>⚔ {o.value}</span>)}
              {match.observations.filter((o) => o.kind === 'tag').map((o) => <span key={o.id} className="badge" style={{ marginRight: 4 }}>{o.value}</span>)}
              {match.observations.filter((o) => o.kind === 'my_dead_card').map((o) => <span key={o.id} className="badge" style={{ marginRight: 4 }}>💀 {o.value}</span>)}
              {match.observations.filter((o) => o.kind === 'my_mvp').map((o) => <span key={o.id} className="badge foil" style={{ marginRight: 4 }}>★ {o.value}</span>)}
            </p>
          )}
          {match.one_liner && <p style={{ margin: '0.3rem 0', fontStyle: 'italic' }}>{match.one_liner}</p>}
        </div>
      ))}

      <div className="panel" id="log-round-form">
        <h3 style={{ marginTop: 0 }}>
          {editingRound != null ? `Editing round ${editingRound}` : 'Log round (~90 seconds)'}
          {editingRound != null && (
            <button className="secondary" style={{ marginLeft: 10 }}
              onClick={() => { setM(emptyMatch()); setEditingRound(null); load() }}>
              Cancel edit
            </button>
          )}
        </h3>
        <div className="filterbar">
          <input placeholder="Rd" size={3} value={m.round} onChange={(e) => setM({ ...m, round: e.target.value })} />
          <input placeholder="Opponent" value={m.opponent_handle} onChange={(e) => setM({ ...m, opponent_handle: e.target.value })} />
          <select value={m.result} onChange={(e) => setM({ ...m, result: e.target.value })}>
            {RESULTS.map((r) => <option key={r}>{r}</option>)}
          </select>
          <select value={m.opp_shape} onChange={(e) => setM({ ...m, opp_shape: e.target.value })}>
            {SHAPES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </div>
        <p style={{ margin: '0.4rem 0' }}>
          <span className="muted">Their inks (pick 2): </span>
          {INKS.map((ink) => (
            <button key={ink} className={m.inks.includes(ink) ? 'togglebtn' : 'togglebtn secondary'}
              onClick={() => toggleInk(ink)}>
              {ink}
            </button>
          ))}
        </p>
        <p style={{ margin: '0.4rem 0' }}>
          <span className="muted">They ran: </span>
          {TAGS.map((t) => (
            <button key={t} className={m.tags.includes(t) ? 'togglebtn small' : 'togglebtn small secondary'}
              onClick={() => setM({ ...m, tags: m.tags.includes(t) ? m.tags.filter((x) => x !== t) : [...m.tags, t] })}>
              {t}
            </button>
          ))}
        </p>
        <div className="filterbar">
          {m.threats.map((t, i) => (
            <input key={i} placeholder={`Card that mattered ${i + 1}`} value={t}
              onChange={(e) => setM({ ...m, threats: m.threats.map((x, j) => (j === i ? e.target.value : x)) })} />
          ))}
        </div>
        <table style={{ maxWidth: 620 }}>
          <tbody>
            {m.games.map((g, i) => (
              <tr key={g.game_no}>
                <td>G{g.game_no}</td>
                <td>
                  <button className={g.on_play === true ? 'togglebtn' : 'togglebtn secondary'} onClick={() => setM({ ...m, games: m.games.map((x, j) => j === i ? { ...x, on_play: true } : x) })}>play</button>
                  <button className={g.on_play === false ? 'togglebtn' : 'togglebtn secondary'} onClick={() => setM({ ...m, games: m.games.map((x, j) => j === i ? { ...x, on_play: false } : x) })}>draw</button>
                </td>
                <td>
                  <button className={g.won === true ? 'togglebtn' : 'togglebtn secondary'} onClick={() => setM({ ...m, games: m.games.map((x, j) => j === i ? { ...x, won: true } : x) })}>W</button>
                  <button className={g.won === false ? 'togglebtn' : 'togglebtn secondary'} onClick={() => setM({ ...m, games: m.games.map((x, j) => j === i ? { ...x, won: false } : x) })}>L</button>
                </td>
                <td>
                  {g.won === false && (
                    <select value={g.loss_mode} onChange={(e) => setM({ ...m, games: m.games.map((x, j) => j === i ? { ...x, loss_mode: e.target.value } : x) })}>
                      {LOSS_MODES.map((l) => <option key={l}>{l}</option>)}
                    </select>
                  )}
                </td>
                <td><input placeholder="altered" size={6} value={g.cards_altered}
                  onChange={(e) => setM({ ...m, games: m.games.map((x, j) => j === i ? { ...x, cards_altered: e.target.value } : x) })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="filterbar" style={{ marginTop: '0.6rem' }}>
          <input placeholder="Card stuck dead in hand" value={m.dead} onChange={(e) => setM({ ...m, dead: e.target.value })} />
          <input placeholder="Card that overperformed" value={m.mvp} onChange={(e) => setM({ ...m, mvp: e.target.value })} />
        </div>
        <input style={{ width: '100%', marginTop: '0.4rem' }} placeholder="One sentence…" value={m.one_liner}
          onChange={(e) => setM({ ...m, one_liner: e.target.value })} />
        <p><button onClick={saveMatch} disabled={!m.round}>{editingRound != null ? 'Update round' : 'Save round'}</button></p>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Post-event — fill in the car</h3>
        <div className="filterbar">
          <input placeholder="Final record" size={8} value={post.final_record} onChange={(e) => setPost({ ...post, final_record: e.target.value })} />
          <input placeholder="Packs won" size={6} value={post.packs_won} onChange={(e) => setPost({ ...post, packs_won: e.target.value })} />
          <label><input type="checkbox" checked={post.promo} onChange={(e) => setPost({ ...post, promo: e.target.checked })} /> Promo</label>
        </div>
        <div className="filterbar">
          <input style={{ flex: 1 }} placeholder="Cards I never drew (comma-separated)" value={post.never_drew} onChange={(e) => setPost({ ...post, never_drew: e.target.value })} />
        </div>
        <div className="filterbar">
          <input style={{ flex: 1 }} placeholder="Cards dead every time I drew them" value={post.always_dead} onChange={(e) => setPost({ ...post, always_dead: e.target.value })} />
        </div>
        <div className="filterbar">
          <input style={{ flex: 1 }} placeholder="Biggest repeated problem (one thing)" value={post.biggest_problem} onChange={(e) => setPost({ ...post, biggest_problem: e.target.value })} />
        </div>
        <div className="filterbar">
          <input style={{ flex: 1 }} placeholder="One change for next week (one — not four)" value={post.one_change} onChange={(e) => setPost({ ...post, one_change: e.target.value })} />
        </div>
        <p><button onClick={savePost}>Save post-event</button></p>
      </div>
    </div>
  )
}
