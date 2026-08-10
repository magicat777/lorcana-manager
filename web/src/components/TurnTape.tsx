// Turn-by-turn play-by-play of one representative game. The point is
// the INTERACTION: your turn, then what the opponent did about it — so
// banishes are called out per turn, since a challenge's description
// never shows its result.
//
// Regenerated from the game's seed after the run, not recorded during
// it (replay is deterministic), so the tape narrates the exact game the
// win/loss record counted.
import { useState } from 'react'
import type { SimTape } from '../types'

function Side({ label, cards }: { label: string; cards: string[] }) {
  if (!cards.length) return null
  return (
    <div style={{ fontSize: '0.8rem' }}>
      <span className="muted">{label}: </span>
      {cards.join(', ')}
    </div>
  )
}

function Tape({ t }: { t: SimTape }) {
  if (t.error) return <p className="error">tape failed: {t.error}</p>
  return (
    <>
      <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
        seed {t.seed} · {t.seat === 0 ? 'on the play' : 'on the draw'} · ended turn {t.turns} at{' '}
        {t.final_lore.you}–{t.final_lore.opponent} lore
      </p>
      <table className="grid">
        <thead>
          <tr>
            <th style={{ width: '3rem' }}>Turn</th>
            <th style={{ width: '5rem' }}>Who</th>
            <th>Played</th>
            <th style={{ width: '5rem' }}>Lore</th>
          </tr>
        </thead>
        <tbody>
          {t.tape.map((e, i) => (
            <tr key={i}>
              <td>{e.turn}</td>
              <td>
                {e.player === 'you' ? (
                  <strong>you</strong>
                ) : (
                  <span className="muted">opponent</span>
                )}
              </td>
              <td>
                {e.actions.length === 0 ? (
                  <span className="muted">— passed —</span>
                ) : (
                  <ol style={{ margin: 0, paddingLeft: '1.1rem' }}>
                    {e.actions.map((a, j) => (
                      <li key={j}>{a}</li>
                    ))}
                  </ol>
                )}
                {e.banished.length > 0 && (
                  <div className="error" style={{ fontSize: '0.8rem', marginTop: 2 }}>
                    banished: {e.banished.join(', ')}
                  </div>
                )}
                <div style={{ marginTop: 3 }}>
                  <Side label="your board" cards={e.board.you} />
                  <Side label="their board" cards={e.board.opponent} />
                </div>
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {e.lore.you}–{e.lore.opponent}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

export default function TurnTape({ loss, win }: { loss?: SimTape; win?: SimTape }) {
  const available = [
    win ? (['win', 'A typical win'] as const) : null,
    loss ? (['loss', 'A typical loss'] as const) : null,
  ].filter(Boolean) as ReadonlyArray<readonly ['win' | 'loss', string]>
  const [tab, setTab] = useState<'win' | 'loss'>(available[0]?.[0] ?? 'loss')
  if (!available.length) return null
  const shown = tab === 'win' ? win : loss

  return (
    <div style={{ marginTop: '1rem' }}>
      <div className="radio-row" style={{ marginBottom: '0.5rem' }}>
        {available.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'togglebtn on' : 'togglebtn'}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {shown ? <Tape t={shown} /> : null}
    </div>
  )
}
