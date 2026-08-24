import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { get } from '../api'
import type { SimRun as Run } from '../types'
import LoreCurve from '../components/LoreCurve'
import TurnTape from '../components/TurnTape'

const pct = (v: string | number | null) => (v == null ? '—' : `${(Number(v) * 100).toFixed(1)}%`)
const num = (v: string | number | null, d = 1) => (v == null ? '—' : Number(v).toFixed(d))
const when = (s: string | null) => (s ? new Date(s).toLocaleString() : '—')

/** Turns shown per tape. The engine's replay_game already caps at 10; this
 *  is a second guard so a longer tape from an older run still renders short. */
const TURN_LIMIT = 10

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="statrow" title={hint}>
      <span className="muted">{label}</span>
      <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</strong>
    </div>
  )
}

export default function SimRun() {
  const { id } = useParams()
  const [run, setRun] = useState<Run | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    get<Run>(`/sim/runs/${id}`)
      .then(setRun)
      .catch((e) => setError(String(e)))
  }, [id])

  if (error) return <p className="error">{error}</p>
  if (!run) return <p className="muted">Loading run #{id}…</p>

  const a = run.analysis
  const g = a?.game
  const shape = a?.shape
  const agg = a?.aggregates

  // Trim to the first N turns. A tape is one game's turn-by-turn record;
  // showing the opening is the point, so an over-long one is cut rather
  // than dropped.
  const tapes = a?.tapes
  const winTape = tapes?.win ? { ...tapes.win, tape: tapes.win.tape.slice(0, TURN_LIMIT) } : undefined
  const lossTape = tapes?.loss
    ? { ...tapes.loss, tape: tapes.loss.tape.slice(0, TURN_LIMIT) }
    : undefined

  return (
    <>
      <p style={{ margin: '0 0 8px' }}>
        <Link to="/sim">← all simulation runs</Link>
      </p>
      <h1 style={{ marginTop: 0 }}>
        Run #{run.id}
        <span className="muted" style={{ fontSize: '0.6em', marginLeft: 12 }}>
          {run.policy}
          {run.opponent_policy && run.opponent_policy !== run.policy
            ? ` vs ${run.opponent_policy}`
            : ''}
        </span>
      </h1>

      <p className="muted" style={{ marginTop: 0 }}>
        <Link to={`/decks/${run.deck_id}`}>{run.deck_name ?? `deck ${run.deck_id}`}</Link> vs{' '}
        {run.opponent_label ?? run.opponent} · {run.games} games · requested{' '}
        {when(run.requested_at)}
      </p>

      {/* ---- headline performance ---------------------------------- */}
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Performance</h2>
        <Stat label="Win rate" value={pct(run.win_rate)} />
        <Stat label="Record" value={run.wins == null ? '—' : `${run.wins}–${run.losses}`} />
        <Stat
          label="Wins on the play / draw"
          value={run.wins_as_p0 == null ? '—' : `${run.wins_as_p0} / ${run.wins_as_p1}`}
          hint="Seats are split evenly, so a lopsided split here is a play/draw dependency, not variance."
        />
        <Stat label="Average turns" value={num(run.avg_turns)} />
        {shape && (
          <>
            <Stat label="Avg turns in wins" value={num(shape.avg_turns_in_wins)} />
            <Stat label="Avg turns in losses" value={num(shape.avg_turns_in_losses)} />
            <Stat
              label="Losses on the play / draw"
              value={`${shape.losses_on_the_play} / ${shape.losses_on_the_draw}`}
            />
          </>
        )}
        <Stat
          label="Engine build"
          value={run.engine_build ?? '—'}
          hint="Runs from different builds are not comparable — the rules code changed between them."
        />
        <Stat
          label="Seed base"
          value={run.seed_base == null ? '—' : String(run.seed_base)}
          hint="Two runs sharing a seed base saw identical shuffles, which is what makes a paired comparison valid."
        />
      </div>

      {/* ---- why there may be nothing below ------------------------ */}
      {!a && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Detail</h2>
          <p className="muted" style={{ margin: 0 }}>
            {run.status !== 'complete' ? (
              <>This run is {run.status} — detail appears once it finishes.</>
            ) : run.analyze_requested === false ? (
              <>
                No analysis: this run was queued with analysis off, which is faster but records
                only the score. The games are reproducible from the seed, so detail can still be
                generated after the fact via the backfill.
              </>
            ) : (
              <>No analysis was recorded for this run.</>
            )}
          </p>
        </div>
      )}

      {a?.note && <p className="muted">{a.note}</p>}
      {a?.error && <p className="error">{a.error}</p>}

      {/* ---- lore curve -------------------------------------------- */}
      {agg && (agg.lore_curve?.wins?.length || agg.lore_curve?.losses?.length) ? (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Lore curve</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Mean lore per turn across {agg.sample} replayed games — where the race is actually won
            or lost, rather than the final score.
          </p>
          <LoreCurve
            wins={agg.lore_curve.wins}
            losses={agg.lore_curve.losses}
            sample={agg.sample}
          />
        </div>
      ) : null}

      {/* ---- turning points ---------------------------------------- */}
      {g?.turning_points && g.turning_points.length > 0 && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Turning points</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Decisions where search preferred a different line by a wide margin, in one
            representative game (seed {g.seed}, {g.won ? 'a win' : 'a loss'}). Low-visit decisions
            are filtered out — a preference the search barely explored is noise, not advice.
          </p>
          <table>
            <thead>
              <tr>
                <th>Turn</th>
                <th>Played</th>
                <th>Search preferred</th>
                <th>Gap</th>
              </tr>
            </thead>
            <tbody>
              {g.turning_points.map((tp, i) => (
                <tr key={i}>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{tp.turn}</td>
                  <td>
                    {tp.played}
                    <div className="muted" style={{ fontSize: '0.85em' }}>
                      {pct(tp.played_winrate)} est. win rate
                    </div>
                  </td>
                  <td>
                    {tp.search_prefers}
                    <div className="muted" style={{ fontSize: '0.85em' }}>
                      {pct(tp.search_winrate)} est. win rate
                    </div>
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--accent)' }}>
                    +{pct(tp.winrate_gap)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- first N turns ----------------------------------------- */}
      {(winTape || lossTape) && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>First {TURN_LIMIT} turns</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            One representative win and one representative loss — the most typical of each by game
            length, not the best and worst, so the two are comparable.
          </p>
          <TurnTape win={winTape} loss={lossTape} />
        </div>
      )}
    </>
  )
}
