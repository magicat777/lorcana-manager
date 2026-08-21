import Hero from '../components/Hero'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { get } from '../api'
import type { Deck } from '../types'

interface StatsData {
  deck_id: number | null
  overall: { matches: number; wins: number; losses: number; draws: number; byes: number; events: number }
  by_deck: { deck_id: number | null; deck_name: string | null; events: number; matches: number; wins: number; losses: number }[]
  play_draw: { on_play: boolean; games: number; wins: number }[]
  by_game_no: { game_no: number; games: number; wins: number }[]
  loss_modes: { loss_mode: string; count: number }[]
  by_shape: { opp_shape: string; matches: number; wins: number; losses: number }[]
}

interface InkPairRow { ink_pair: string; times_faced: number; losses_to: number }

const pct = (wins: number, total: number) => (total ? `${Math.round((100 * wins) / total)}%` : '—')

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="progress" style={{ width: 120, display: 'inline-block', verticalAlign: 'middle' }}>
      <div style={{ width: `${max ? (100 * value) / max : 0}%` }} />
    </div>
  )
}

export default function MatchStats() {
  const [s, setS] = useState<StatsData | null>(null)
  const [pairs, setPairs] = useState<InkPairRow[]>([])
  const [decks, setDecks] = useState<Deck[]>([])
  const [deckId, setDeckId] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    get<Deck[]>('/decks').then(setDecks).catch(() => {})
    get<InkPairRow[]>('/matchlog/ink-pairs').then(setPairs).catch(() => {})
  }, [])
  useEffect(() => {
    get<StatsData>('/matchlog/stats', deckId ? { deck_id: deckId } : {})
      .then(setS).catch((e) => setError(String(e)))
  }, [deckId])

  if (error) return <p className="error">{error}</p>
  if (!s) return <p className="muted">Loading…</p>

  const o = s.overall
  const play = s.play_draw.find((r) => r.on_play)
  const draw = s.play_draw.find((r) => !r.on_play)
  const g1 = s.by_game_no.find((g) => g.game_no === 1)
  const g23 = s.by_game_no.filter((g) => g.game_no > 1)
    .reduce((a, g) => ({ games: a.games + g.games, wins: a.wins + g.wins }), { games: 0, wins: 0 })
  const maxLoss = Math.max(...s.loss_modes.map((l) => l.count), 1)

  return (
    <div style={{ maxWidth: 900 }}>
      <p><Link to="/matches">← match log</Link></p>
      <Hero img="hero-matches.jpg" title="Match Stats" />
      <div className="filterbar">
        <select value={deckId} onChange={(e) => setDeckId(e.target.value)}>
          <option value="">All decks</option>
          {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <span className="muted">{o.events} events · {o.matches} matches logged</span>
      </div>

      {o.matches === 0 ? (
        <p className="muted">No matches logged yet{deckId ? ' with this deck' : ''}.</p>
      ) : (
        <>
          <div className="statrow">
            <div className="stat"><div className="k">Match record</div>
              <div className="v">{o.wins}-{o.losses}{o.draws ? `-${o.draws}` : ''}</div></div>
            <div className="stat"><div className="k">Match win rate</div>
              <div className="v">{pct(o.wins, o.wins + o.losses)}</div></div>
            <div className="stat"><div className="k">On the play</div>
              <div className="v">{play ? `${pct(play.wins, play.games)} (${play.wins}/${play.games})` : '—'}</div></div>
            <div className="stat"><div className="k">On the draw</div>
              <div className="v">{draw ? `${pct(draw.wins, draw.games)} (${draw.wins}/${draw.games})` : '—'}</div></div>
            <div className="stat"><div className="k">Game 1</div>
              <div className="v">{g1 ? pct(g1.wins, g1.games) : '—'}</div></div>
            <div className="stat"><div className="k">Games 2–3</div>
              <div className="v">{g23.games ? pct(g23.wins, g23.games) : '—'}</div></div>
          </div>

          {!deckId && s.by_deck.length > 0 && (
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>By deck</h3>
              <table>
                <thead><tr><th>Deck</th><th>Events</th><th>Matches</th><th>W-L</th><th>Win rate</th></tr></thead>
                <tbody>
                  {s.by_deck.map((d) => (
                    <tr key={d.deck_id ?? 'none'}>
                      <td>{d.deck_id ? <Link to={`/decks/${d.deck_id}`}>{d.deck_name}</Link> : <span className="muted">no deck recorded</span>}</td>
                      <td>{d.events}</td><td>{d.matches}</td>
                      <td>{d.wins}-{d.losses}</td>
                      <td>{pct(d.wins, d.wins + d.losses)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {s.loss_modes.length > 0 && (
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>How games are lost</h3>
              <table>
                <tbody>
                  {s.loss_modes.map((l) => (
                    <tr key={l.loss_mode}>
                      <td style={{ width: 90 }}>{l.loss_mode}</td>
                      <td><Bar value={l.count} max={maxLoss} /> <span className="muted">{l.count}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {s.by_shape.length > 0 && (
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>Vs opponent archetype</h3>
              <table>
                <thead><tr><th>Shape</th><th>Matches</th><th>W-L</th><th>Win rate</th></tr></thead>
                <tbody>
                  {s.by_shape.map((r) => (
                    <tr key={r.opp_shape}>
                      <td>{r.opp_shape.replace('_', ' ')}</td>
                      <td>{r.matches}</td><td>{r.wins}-{r.losses}</td>
                      <td>{pct(r.wins, r.wins + r.losses)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!deckId && pairs.length > 0 && (
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>Vs ink pairs (all time)</h3>
              <table>
                <thead><tr><th>Ink pair</th><th>Faced</th><th>Losses to</th></tr></thead>
                <tbody>
                  {pairs.map((p) => (
                    <tr key={p.ink_pair}>
                      <td>{p.ink_pair}</td><td>{p.times_faced}</td>
                      <td className={p.losses_to ? 'error' : ''}>{p.losses_to}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
