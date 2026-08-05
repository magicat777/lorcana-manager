import { useEffect, useRef, useState } from 'react'
import { get, upload } from '../api'
import type { ImportHistoryRow, ImportReport } from '../types'

export default function Upload() {
  const [file, setFile] = useState<File | null>(null)
  const [mode, setMode] = useState<'replace' | 'merge'>('replace')
  const [report, setReport] = useState<ImportReport | null>(null)
  const [history, setHistory] = useState<ImportHistoryRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const loadHistory = () => get<ImportHistoryRow[]>('/imports').then(setHistory).catch(() => {})
  useEffect(() => {
    loadHistory()
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
    try {
      setReport(await upload<ImportReport>('/imports', form))
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
    }
  }

  const pick = (f: File | undefined | null) => {
    if (f) {
      setFile(f)
      setReport(null)
      setError('')
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
      <table>
        <thead>
          <tr><th>#</th><th>When</th><th>File</th><th>Mode</th><th>Rows</th><th>Unmatched</th><th>Total after</th></tr>
        </thead>
        <tbody>
          {history.map((h) => (
            <tr key={h.id}>
              <td>{h.id}</td>
              <td>{new Date(h.uploaded_at).toLocaleString()}</td>
              <td>{h.filename}{h.dry_run ? ' (dry run)' : ''}</td>
              <td>{h.mode}</td>
              <td>{h.matched_rows}/{h.row_count}</td>
              <td className={h.unmatched_count ? 'error' : ''}>{h.unmatched_count}</td>
              <td>{h.dry_run ? '—' : h.summary?.qty_after ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
