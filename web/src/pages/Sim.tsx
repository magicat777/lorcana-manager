import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { get, send } from '../api'
import type { Deck, SimRun } from '../types'

const POLICIES = ['heuristic', 'random', 'mcts16', 'mcts32', 'mcts64', 'mcts128']
const PENDING = new Set(['queued', 'running'])

const pct = (v: string | number | null) => (v == null ? '—' : `${(Number(v) * 100).toFixed(1)}%`)
const num = (v: string | number | null, d = 1) => (v == null ? '—' : Number(v).toFixed(d))
const when = (s: string | null) => (s ? new Date(s).toLocaleString() : '—')

export default function Sim() {
  const [params, setParams] = useSearchParams()
  const deckParam = params.get('deck')
  const [decks, setDecks] = useState<Deck[]>([])
  const [runs, setRuns] = useState<SimRun[]>([])
  const [deckId, setDeckId] = useState(deckParam ?? '')
  const [opponent, setOpponent] = useState('deck3')
  const [games, setGames] = useState(200)
  const [policy, setPolicy] = useState('heuristic')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  const load = useCallback(() => {
    const q = deckParam ? { deck_id: Number(deckParam) } : undefined
    get<SimRun[]>('/sim/runs', q)
      .then(setRuns)
      .catch((e) => setError(String(e)))
  }, [deckParam])

  useEffect(() => {
    get<Deck[]>('/decks').then(setDecks).catch(() => {})
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Poll only while something is actually pending — results are the
  // interesting part, not the waiting.
  useEffect(() => {
    window.clearInterval(timer.current)
    if (runs.some((r) => PENDING.has(r.status))) {
      timer.current = window.setInterval(load, 4000)
    }
    return () => window.clearInterval(timer.current)
  }, [runs, load])

  const queue = async () => {
    if (!deckId) return
    setBusy(true)
    setError('')
    try {
      await send<SimRun>('POST', `/decks/${deckId}/sim`, {
        opponent,
        games,
        policy,
        requested_by: 'webui',
      })
      load()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1>Simulations</h1>
        {deckParam && <Link to="/sim">all decks →</Link>}
      </div>
      <p className="muted">
        Games are played by the rules engine, not sampled — the deck is run from both seats
        (half on the play, half on the draw) so the win rate isn&apos;t confounded by turn order.
      </p>

      <div className="panel" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label>
          Deck<br />
          <select value={deckId} onChange={(e) => setDeckId(e.target.value)}>
            <option value="">Choose…</option>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Opponent<br />
          <select value={opponent} onChange={(e) => setOpponent(e.target.value)}>
            <option value="deck3">Precon: Supers &amp; Deities (Ruby/Steel)</option>
            <option value="deck2">Precon: Hunny (Amethyst/Sapphire)</option>
            {decks
              .filter((d) => String(d.id) !== deckId)
              .map((d) => (
                <option key={d.id} value={String(d.id)}>
                  My deck: {d.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Games<br />
          <input
            type="number"
            min={10}
            max={5000}
            step={50}
            value={games}
            onChange={(e) => setGames(Number(e.target.value))}
            style={{ width: 90 }}
          />
        </label>
        <label>
          Play strength<br />
          <select value={policy} onChange={(e) => setPolicy(e.target.value)}>
            {POLICIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <button onClick={queue} disabled={!deckId || busy}>
          {busy ? 'Queueing…' : 'Run simulation'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      <table className="grid" style={{ marginTop: '1rem' }}>
        <thead>
          <tr>
            <th>Deck</th>
            <th>Opponent</th>
            <th>Status</th>
            <th>Win rate</th>
            <th>W–L</th>
            <th>On play / draw</th>
            <th>Avg turns</th>
            <th>Games</th>
            <th>Requested</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td>
                <Link to={`/decks/${r.deck_id}`}>{r.deck_name ?? r.deck_id}</Link>
              </td>
              <td>{r.opponent_label ?? r.opponent}</td>
              <td>
                <StatusCell run={r} />
              </td>
              <td style={{ fontWeight: r.status === 'complete' ? 600 : 400 }}>{pct(r.win_rate)}</td>
              <td>{r.wins == null ? '—' : `${r.wins}–${r.losses}`}</td>
              <td className="muted">
                {r.wins_as_p0 == null ? '—' : `${r.wins_as_p0} / ${r.wins_as_p1}`}
              </td>
              <td>{num(r.avg_turns)}</td>
              <td className="muted">
                {r.games} · {r.policy}
              </td>
              <td className="muted">{when(r.requested_at)}</td>
            </tr>
          ))}
          {runs.length === 0 && (
            <tr>
              <td colSpan={9} className="muted">
                No simulations yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {runs
        .filter((r) => r.status === 'unsupported' && r.unsupported_cards?.length)
        .slice(0, 3)
        .map((r) => (
          <div className="panel" key={r.id} style={{ marginTop: '1rem' }}>
            <h4 style={{ marginTop: 0 }}>
              Run #{r.id} — {r.deck_name ?? `deck ${r.deck_id}`}: engine can&apos;t play this deck yet
            </h4>
            <p className="muted">
              The simulator refuses rather than guessing: a card whose ability isn&apos;t implemented
              would silently play as a vanilla and make every number here wrong.
            </p>
            <table className="grid">
              <thead>
                <tr>
                  <th>Card</th>
                  <th>Qty</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {r.unsupported_cards!.map((c, i) => (
                  <tr key={i}>
                    <td>{c.full_name}</td>
                    <td>{c.qty ?? '—'}</td>
                    <td className="muted">{c.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  )
}

function StatusCell({ run }: { run: SimRun }) {
  if (run.status === 'complete') return <span className="badge foil">complete</span>
  if (run.status === 'queued') return <span className="badge">queued</span>
  if (run.status === 'running') return <span className="badge">running…</span>
  return (
    <span className="error" title={run.error ?? ''}>
      {run.status}
    </span>
  )
}
