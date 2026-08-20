import { Fragment, useEffect, useRef, useState } from 'react'
import { get, send, uploadWithProgress } from '../api'
import type { Deck, ImportDiff, ImportHistoryRow, ImportReport } from '../types'

const DIFF_DISPLAY_CAP = 60

function DiffSummaryLine({ s }: { s: ImportDiff['summary'] }) {
  return (
    <span>
      {s.copies_added > 0 && <span className="ok">+{s.copies_added} copies</span>}
      {s.copies_added > 0 && s.copies_removed > 0 && <span className="muted"> · </span>}
      {s.copies_removed > 0 && <span className="error">−{s.copies_removed} copies</span>}
      {s.copies_added === 0 && s.copies_removed === 0 && <span className="muted">no changes</span>}
      <span className="muted">
        {' '}({s.new_cards} new card{s.new_cards === 1 ? '' : 's'}
        {s.removed_cards > 0 && `, ${s.removed_cards} zeroed`})
      </span>
    </span>
  )
}

function DiffActions({ diff, importId, sealedDecks }: {
  diff: ImportDiff
  importId: number
  sealedDecks: Deck[]
}) {
  const [deckId, setDeckId] = useState<number | ''>('')
  const [status, setStatus] = useState('')
  const added = diff.cards.filter((c) => c.delta > 0)
  if (!added.length) return null

  const copyAdded = () => {
    const text = added.map((c) => `${c.delta} ${c.full_name}`).join('\n')
    navigator.clipboard.writeText(text).then(
      () => setStatus(`Copied ${added.length} added cards`),
      () => setStatus('Clipboard unavailable'),
    )
  }

  const toPool = async () => {
    if (deckId === '') return
    try {
      const r = await send<{ deck_name: string; cards: number; copies: number }>(
        'POST', `/imports/${importId}/to-pool`, { deck_id: deckId })
      setStatus(`Added ${r.copies} copies (${r.cards} cards) to "${r.deck_name}" pool`)
    } catch (e) {
      setStatus(String((e as Error).message ?? e))
    }
  }

  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap',
      margin: '0.4rem 0' }}>
      <button className="secondary" onClick={copyAdded}>
        ⧉ Copy {added.length} added card{added.length === 1 ? '' : 's'}
      </button>
      {sealedDecks.length > 0 && (
        <>
          <select value={deckId} onChange={(e) => setDeckId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">sealed deck…</option>
            {sealedDecks.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <button className="secondary" disabled={deckId === ''} onClick={toPool}>
            → Add to sealed pool
          </button>
        </>
      )}
      {status && <span className="muted">{status}</span>}
    </div>
  )
}

function DiffTable({ diff }: { diff: ImportDiff }) {
  const [showAll, setShowAll] = useState(false)
  if (!diff.cards.length) return <p className="muted">No card counts changed.</p>
  const rows = showAll ? diff.cards : diff.cards.slice(0, DIFF_DISPLAY_CAP)
  return (
    <>
      <table>
        <thead>
          <tr><th>Card</th><th>Set·#</th><th>Before</th><th>After</th><th>Δ</th></tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.card_id}>
              <td>{c.full_name}</td>
              <td className="muted">{c.set_code}·{c.collector_number}</td>
              <td className="muted">{c.before_normal}+{c.before_foil}✦</td>
              <td>{c.after_normal}+{c.after_foil}✦</td>
              <td className={c.delta >= 0 ? 'ok' : 'error'}>
                {c.delta >= 0 ? '+' : ''}{c.delta}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {diff.cards.length > DIFF_DISPLAY_CAP && !showAll && (
        <button className="secondary" style={{ marginTop: 4 }} onClick={() => setShowAll(true)}>
          Show all {diff.cards.length} changed cards
        </button>
      )}
      {diff.truncated > 0 && (
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          {diff.truncated} more small changes weren't stored (per-import cap); totals above
          cover everything.
        </p>
      )}
    </>
  )
}

export default function Upload() {
  const [file, setFile] = useState<File | null>(null)
  const [mode, setMode] = useState<'replace' | 'merge'>('replace')
  const [note, setNote] = useState('')
  const [report, setReport] = useState<ImportReport | null>(null)
  const [history, setHistory] = useState<ImportHistoryRow[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ phase: 'uploading' | 'processing'; pct: number } | null>(null)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [expandedDiff, setExpandedDiff] = useState<ImportDiff | null>(null)
  const [noteEdit, setNoteEdit] = useState<{ id: number; text: string } | null>(null)
  const [sealedDecks, setSealedDecks] = useState<Deck[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const loadHistory = () => get<ImportHistoryRow[]>('/imports').then(setHistory).catch(() => {})
  useEffect(() => {
    loadHistory()
    get<Deck[]>('/decks')
      .then((ds) => setSealedDecks(ds.filter((d) => d.format === 'sealed')))
      .catch(() => {})
  }, [])

  const run = async (dryRun: boolean, force = false) => {
    if (!file) return
    setBusy(true)
    setError('')
    const form = new FormData()
    form.append('file', file)
    form.append('mode', mode)
    form.append('dry_run', String(dryRun))
    form.append('force', String(force))
    form.append('note', note)
    setProgress({ phase: 'uploading', pct: 0 })
    try {
      setReport(await uploadWithProgress<ImportReport>('/imports', form,
        (phase, pct) => setProgress({ phase, pct })))
      loadHistory()
    } catch (e) {
      const err = e as Error & { status?: number }
      if (err.status === 409) {
        setError(
          'This exact file was already merged. Use "Merge anyway" if you really want to add the counts again.',
        )
      } else {
        setError(String(err.message ?? err))
      }
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const pick = (f: File | undefined | null) => {
    if (f) {
      setFile(f)
      setReport(null)
      setError('')
    }
  }

  const toggleExpand = (id: number) => {
    if (expanded === id) {
      setExpanded(null)
      setExpandedDiff(null)
      return
    }
    setExpanded(id)
    setExpandedDiff(null)
    get<{ diff: ImportDiff | null }>(`/imports/${id}`)
      .then((d) => setExpandedDiff(d.diff ?? { summary: { cards_changed: 0, new_cards: 0, removed_cards: 0, copies_added: 0, copies_removed: 0 }, cards: [], truncated: 0 }))
      .catch(() => setExpanded(null))
  }

  const saveNote = async () => {
    if (!noteEdit) return
    const { id, text } = noteEdit
    setNoteEdit(null)
    try {
      await send('PATCH', `/imports/${id}`, { note: text })
      setHistory((h) => h.map((r) => (r.id === id ? { ...r, note: text.trim() || null } : r)))
    } catch {
      loadHistory()
    }
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <h1>Import collection</h1>
      <p className="muted">
        Export from the Dreamborn.ink scanner app as CSV (or .xlsx). Both export shapes work:
        variant rows (Set Number, Card Number, Variant, Count, Name) and two-column counts
        (Name, Normal, Foil, Set, Card Number). Always preview first — the dry run shows exactly
        what will change without writing anything.
      </p>
      <div
        className={`dropzone ${dragging ? 'active' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          pick(e.dataTransfer.files?.[0])
        }}
      >
        {file ? (
          <strong>{file.name}</strong>
        ) : (
          <>Drop your export.csv / .xlsx here, or click to choose a file</>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx"
          hidden
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>

      <div className="radio-row">
        <label>
          <input
            type="radio"
            checked={mode === 'replace'}
            onChange={() => setMode('replace')}
          />{' '}
          Replace collection (full snapshot — safest, re-uploads are harmless)
        </label>
        <label>
          <input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} /> Merge
          (add these counts on top)
        </label>
      </div>

      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder='Note for this upload (optional) — e.g. "additional cards from sealed competition"'
        style={{ width: '100%', margin: '0.5rem 0' }}
      />

      <div style={{ display: 'flex', gap: '0.7rem' }}>
        <button className="secondary" disabled={!file || busy} onClick={() => run(true)}>
          Preview (dry run)
        </button>
        <button disabled={!file || busy} onClick={() => run(false)}>
          {mode === 'replace' ? 'Replace collection' : 'Merge into collection'}
        </button>
        {error.includes('already merged') && (
          <button className="danger" disabled={busy} onClick={() => run(false, true)}>
            Merge anyway
          </button>
        )}
      </div>

      {progress && (
        <div style={{ margin: '0.6rem 0', maxWidth: 480 }}>
          <div className="progress">
            <div style={{
              width: progress.phase === 'uploading' ? `${Math.round(progress.pct * 100)}%` : '100%',
              transition: 'width 0.2s',
              ...(progress.phase === 'processing' ? { opacity: 0.7 } : {}),
            }} />
          </div>
          <p className="muted" style={{ margin: '0.2rem 0 0', fontSize: '0.8rem' }}>
            {progress.phase === 'uploading'
              ? `Uploading… ${Math.round(progress.pct * 100)}%`
              : 'Server processing (matching cards, computing diff)…'}
          </p>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {report && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>
            {report.dry_run ? 'Preview' : 'Imported'} — {report.filename}{' '}
            <span className={report.unmatched.length ? 'error' : 'ok'}>
              {report.matched}/{report.rows} rows matched
            </span>
          </h3>
          <div className="statrow">
            <div className="stat"><div className="k">Unique cards</div><div className="v">{report.unique_cards}</div></div>
            <div className="stat"><div className="k">Copies in file</div><div className="v">{report.summary.qty_in_file}</div></div>
            <div className="stat"><div className="k">Total before</div><div className="v">{report.summary.qty_before}</div></div>
            <div className="stat">
              <div className="k">Total after</div>
              <div className="v">
                {report.dry_run
                  ? mode === 'replace'
                    ? report.summary.qty_in_file
                    : report.summary.qty_before + report.summary.qty_in_file
                  : report.summary.qty_after}
                {report.dry_run && <span className="muted"> (projected)</span>}
              </div>
            </div>
          </div>
          {report.diff && (
            <>
              <h4 style={{ marginBottom: '0.3rem' }}>
                {report.dry_run ? 'Changes this file would make' : 'Changes made'}:{' '}
                <DiffSummaryLine s={report.diff.summary} />
              </h4>
              {!report.dry_run && (
                <DiffActions diff={report.diff} importId={report.import_id}
                  sealedDecks={sealedDecks} />
              )}
              <DiffTable diff={report.diff} />
            </>
          )}
          {report.replace_losses?.length > 0 && (
            <>
              <h4 className="error">
                ⚠ {report.replace_losses.length} owned card
                {report.replace_losses.length > 1 ? 's are' : ' is'} missing or reduced in this
                file — {report.dry_run ? 'Replace would lower them' : 'Replace lowered them'}.
                {report.dry_run &&
                  ' If these should stay in your collection, this export may not be your full binder (consider Merge, or rescan).'}
              </h4>
              <table>
                <thead>
                  <tr><th>Card</th><th>Set·#</th><th>Owned (normal+foil)</th><th>In file</th></tr>
                </thead>
                <tbody>
                  {report.replace_losses.map((l) => (
                    <tr className="bad" key={l.card_id}>
                      <td>{l.full_name}</td>
                      <td>{l.set_code}·{l.collector_number}</td>
                      <td>{l.have_normal}+{l.have_foil}✦</td>
                      <td>{l.file_normal}+{l.file_foil}✦</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {report.unmatched.length > 0 && (
            <>
              <h4>Unmatched rows (not imported)</h4>
              <table>
                <thead>
                  <tr><th>CSV row</th><th>Name</th><th>Set</th><th>#</th><th>Reason</th></tr>
                </thead>
                <tbody>
                  {report.unmatched.map((u) => (
                    <tr className="bad" key={u.row}>
                      <td>{u.row}</td><td>{u.name}</td><td>{u.set}</td><td>{u.number}</td><td>{u.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      <h2>Import history</h2>
      <p className="muted" style={{ marginTop: '-0.4rem', fontSize: '0.85rem' }}>
        Click a row's changes to see the per-card diff; click a note to edit it.
      </p>
      <table>
        <thead>
          <tr><th>#</th><th>When</th><th>File</th><th>Mode</th><th>Rows</th><th>Changes</th><th>Total after</th><th>Note</th></tr>
        </thead>
        <tbody>
          {history.map((h) => (
            <Fragment key={h.id}>
              <tr>
                <td>{h.id}</td>
                <td>{new Date(h.uploaded_at).toLocaleString()}</td>
                <td>{h.filename}{h.dry_run ? ' (dry run)' : ''}</td>
                <td>{h.mode}</td>
                <td className={h.unmatched_count ? 'error' : ''}>{h.matched_rows}/{h.row_count}</td>
                <td>
                  {h.diff_summary ? (
                    <a style={{ cursor: 'pointer' }} onClick={() => toggleExpand(h.id)}>
                      {h.diff_summary.copies_added > 0 && `+${h.diff_summary.copies_added}`}
                      {h.diff_summary.copies_added > 0 && h.diff_summary.copies_removed > 0 && ' / '}
                      {h.diff_summary.copies_removed > 0 && `−${h.diff_summary.copies_removed}`}
                      {h.diff_summary.copies_added === 0 && h.diff_summary.copies_removed === 0 && '±0'}
                      {expanded === h.id ? ' ▾' : ' ▸'}
                    </a>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>{h.dry_run ? '—' : h.summary?.qty_after ?? '—'}</td>
                <td onClick={() => !noteEdit && setNoteEdit({ id: h.id, text: h.note ?? '' })}
                  style={{ cursor: 'pointer', minWidth: 120 }}>
                  {noteEdit?.id === h.id ? (
                    <input
                      autoFocus
                      value={noteEdit.text}
                      onChange={(e) => setNoteEdit({ id: h.id, text: e.target.value })}
                      onBlur={saveNote}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveNote()
                        if (e.key === 'Escape') setNoteEdit(null)
                      }}
                      style={{ width: '100%' }}
                    />
                  ) : (
                    h.note ?? <span className="muted">＋ add</span>
                  )}
                </td>
              </tr>
              {expanded === h.id && (
                <tr>
                  <td colSpan={8} style={{ background: 'var(--panel, #171b2e)' }}>
                    {expandedDiff ? (
                      <>
                        <p style={{ margin: '0.3rem 0' }}>
                          <DiffSummaryLine s={expandedDiff.summary} />
                        </p>
                        {!h.dry_run && (
                          <DiffActions diff={expandedDiff} importId={h.id}
                            sealedDecks={sealedDecks} />
                        )}
                        <DiffTable diff={expandedDiff} />
                      </>
                    ) : (
                      <span className="muted">loading…</span>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
