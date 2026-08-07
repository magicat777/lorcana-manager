import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { get, send } from '../api'
import type { Deck, SimRun, SimAnalysis } from '../types'

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
  const [analyze, setAnalyze] = useState(true)
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

  // Re-run a previous run's exact seeds against the (edited) deck —
  // identical shuffles, so the delta is the decklist change, not luck.
  const rerunPaired = async (r: SimRun) => {
    setBusy(true)
    setError('')
    try {
      await send<SimRun>('POST', `/decks/${r.deck_id}/sim`, {
        opponent: r.opponent,
        games: r.games,
        policy: r.policy,
        analyze: r.analyze_requested,
        seed_base: r.seed_base,
        requested_by: 'webui-paired',
      })
      load()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const queue = async () => {
    if (!deckId) return
    setBusy(true)
    setError('')
    try {
      await send<SimRun>('POST', `/decks/${deckId}/sim`, {
        opponent,
        games,
        policy,
        analyze,
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
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={analyze} onChange={(e) => setAnalyze(e.target.checked)} />
          Explain a loss
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
            <th></th>
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
              <td>
                {r.status === 'complete' && (
                  <button
                    className="secondary"
                    title="Re-run these exact seeds against the deck as it is now — identical shuffles, so the difference is your edit, not variance"
                    onClick={() => rerunPaired(r)}
                    disabled={busy}
                  >
                    Re-run paired
                  </button>
                )}
              </td>
            </tr>
          ))}
          {runs.length === 0 && (
            <tr>
              <td colSpan={10} className="muted">
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

      <PairedDeltas runs={runs} />

      {runs
        .filter((r) => r.status === 'complete' && r.analysis)
        .slice(0, 2)
        .map((r) => (
          <Analysis key={r.id} run={r} analysis={r.analysis!} />
        ))}
    </div>
  )
}

function PairedDeltas({ runs }: { runs: SimRun[] }) {
  // Group completed runs by (deck, opponent, seed_base): same seeds =
  // same shuffles, so comparing them isolates the decklist change.
  const groups = new Map<string, SimRun[]>()
  for (const r of runs) {
    if (r.status !== 'complete' || r.seed_base == null) continue
    const k = `${r.deck_id}|${r.opponent}|${r.seed_base}|${r.games}|${r.policy}`
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  const pairs = [...groups.values()].filter((g) => g.length > 1).slice(0, 3)
  if (!pairs.length) return null
  return (
    <div className="panel" style={{ marginTop: '1rem' }}>
      <h4 style={{ marginTop: 0 }}>Paired comparisons</h4>
      <p className="muted">
        Same seeds, same opponent, same pilot — identical shuffles and opening hands on both
        sides, so the difference is your decklist change rather than variance.
      </p>
      {pairs.map((g) => {
        const ordered = [...g].sort((x, y) => x.id - y.id)
        const first = ordered[0]
        const last = ordered[ordered.length - 1]
        const delta = Number(last.win_rate) - Number(first.win_rate)
        return (
          <p key={first.id} style={{ margin: '0.35rem 0' }}>
            <strong>{first.deck_name}</strong> vs {first.opponent_label ?? first.opponent}:{' '}
            run #{first.id} {pct(first.win_rate)} → #{last.id} {pct(last.win_rate)}{' '}
            <strong style={{ color: delta >= 0 ? 'var(--good, #2e7d32)' : 'var(--bad, #c62828)' }}>
              {delta >= 0 ? '+' : ''}
              {(delta * 100).toFixed(1)} pts
            </strong>{' '}
            <span className="muted">over {first.games} paired games</span>
          </p>
        )
      })}
    </div>
  )
}

function Analysis({ run, analysis }: { run: SimRun; analysis: SimAnalysis }) {
  const g = analysis.game
  const s = analysis.shape
  return (
    <div className="panel" style={{ marginTop: '1rem' }}>
      <h4 style={{ marginTop: 0 }}>
        Why run #{run.id} lost games — {run.deck_name ?? `deck ${run.deck_id}`} vs{' '}
        {run.opponent_label ?? run.opponent}
      </h4>
      <p className="muted">
        Losses ran {num(s.avg_turns_in_losses)} turns on average vs {num(s.avg_turns_in_wins)} in
        wins · {s.losses_on_the_play} lost on the play, {s.losses_on_the_draw} on the draw.
      </p>
      {analysis.note && <p className="muted">{analysis.note}</p>}
      {analysis.error && <p className="error">analysis failed: {analysis.error}</p>}
      {g && (
        <>
          <p style={{ marginBottom: '0.4rem' }}>
            Typical loss (seed {g.seed}, {g.seat === 0 ? 'on the play' : 'on the draw'}): ended turn{' '}
            {g.turns} at {g.final_lore.you}–{g.final_lore.opponent} lore.{' '}
            <span className="muted">{g.decisions_scanned} decisions examined.</span>
          </p>
          {g.turning_points.length === 0 ? (
            <p className="muted">
              No clear misplays — the search agreed with every decision. This loss was about the
              matchup or the draw, not the pilot.
            </p>
          ) : (
            <table className="grid">
              <thead>
                <tr>
                  <th>Turn</th>
                  <th>Played</th>
                  <th>Search preferred</th>
                  <th title="win probability given up, per the search">Cost</th>
                </tr>
              </thead>
              <tbody>
                {g.turning_points.map((tp, i) => (
                  <tr key={i}>
                    <td>{tp.turn}</td>
                    <td>{tp.played}</td>
                    <td>{tp.search_prefers}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      −{(tp.winrate_gap * 100).toFixed(0)}%
                      <span className="muted">
                        {' '}
                        ({(tp.played_winrate * 100).toFixed(0)}→{(tp.search_winrate * 100).toFixed(0)})
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted" style={{ marginTop: '0.5rem' }}>
            Cost = win probability the played move gave up according to the search. The line shown is
            the one the simulated pilot actually took; replay it with{' '}
            <code>python -m lorcana_engine.teacher --seed {g.seed} --coach</code>.
          </p>
        </>
      )}
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
