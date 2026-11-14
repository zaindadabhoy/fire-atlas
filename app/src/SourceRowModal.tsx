import { useEffect, useMemo, useRef, useState } from 'react'
import type { TestPoint } from './types'

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF, BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const source = text.replace(/^﻿/, '')
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index += 1 }
      else if (char === '"') quoted = false
      else cell += char
      continue
    }
    if (char === '"') quoted = true
    else if (char === ',') { row.push(cell); cell = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += char
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

function decode(buffer: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buffer)
  // Some PSI tables are Windows-1252; fall back when UTF-8 decoding produced replacement characters.
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buffer) : utf8
}

type Role = 'O₂' | 'Pressure' | 'Flow' | 'Outcome' | 'Material' | 'Test'

/** Which columns feed the normalized fields — matched on the NASA header text. */
export function columnRole(header: string): Role | null {
  const h = header.toLowerCase()
  if (/mg\/s|flow rate|burnrate|sccm/.test(h)) return null // mass/volume flow of a reactant, not a plotted coordinate
  if (/co2|final|after test|initial co|^co initial/.test(h)) return null // post-test composition or other species
  if (/\bo2\b|xo2|oxygen|o initial ambient|percent o2/.test(h)) return 'O₂'
  if (/pressure|\bp \(bar\)|pmean|approx p/.test(h)) return 'Pressure'
  if (/air flow|air rate|flow \(cm|inlet velocity|flow velocity/.test(h)) return 'Flow'
  if (/hot ignition|self.?ext|test end|burn time|flames ignited|burn length|spread/.test(h)) return 'Outcome'
  if (/mfc|conc/.test(h)) return null
  if (/material|^fuel\b|fuel type|fuel sample/.test(h)) return 'Material'
  if (/^test ?#|^test$|sample number|^flex test #|^sample #|^same test #|^as run test #/.test(h.trim())) return 'Test'
  return null
}

const cache = new Map<string, string[][]>()

export function SourceRowModal({ test, onClose }: { test: TestPoint; onClose: () => void }) {
  const [rows, setRows] = useState<string[][] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const path = `raw/${test.investigation}/${test.source.file}`
  const sourceRows = useMemo(() => (test.source.rows?.length ? test.source.rows : [test.source.row]), [test])

  useEffect(() => {
    let cancelled = false
    const cached = cache.get(path)
    if (cached) { setRows(cached); return }
    fetch(`/${encodeURI(path)}`)
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.arrayBuffer() })
      .then((buffer) => { const parsed = parseCsv(decode(buffer)); cache.set(path, parsed); if (!cancelled) setRows(parsed) })
      .catch((reason: unknown) => { if (!cancelled) setError(`Could not load the NASA file (${reason instanceof Error ? reason.message : 'network error'}).`) })
    return () => { cancelled = true }
  }, [path])

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const header = rows?.[0] ?? []
  const roles = header.map(columnRole)
  const shownRows = sourceRows.slice(0, 6)
  const context = rows ? [Math.max(1, shownRows[0] - 1), ...shownRows, Math.min(rows.length - 1, shownRows[shownRows.length - 1] + 1)] : []
  const uniqueContext = [...new Set(context)].filter((index) => rows && index >= 1 && index < rows.length)
  const usedColumns = header.map((_, index) => index).filter((index) => header[index]?.trim() || shownRows.some((r) => rows?.[r]?.[index]?.trim()))

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="source-modal panel" role="dialog" aria-modal="true" aria-labelledby="source-modal-title">
        <div className="source-modal-head">
          <div>
            <div className="section-kicker"><span>RX</span> ORIGINAL NASA RECORD</div>
            <h2 id="source-modal-title">{test.acronym ?? test.investigation} · test {test.test_label}</h2>
            <p className="source-modal-meta">{test.investigation} · {test.source.file} · data row{sourceRows.length > 1 ? 's' : ''} {sourceRows.join(', ')}</p>
          </div>
          <button ref={closeRef} type="button" className="modal-close" onClick={onClose} aria-label="Close source record">×</button>
        </div>
        <p className="source-modal-lede">This is the row exactly as published in NASA's PSI table, unmodified. Highlighted columns feed the plotted O₂, pressure, flow, and outcome. Neighbouring rows are shown dimmed for context.</p>
        {error && <p className="empty-state">{error}</p>}
        {!rows && !error && <p className="empty-state">Loading NASA file…</p>}
        {rows && <div className="source-table-wrap">
          <table className="source-table">
            <thead>
              <tr><th className="row-index">row</th>{usedColumns.map((index) => <th key={index} className={roles[index] ? 'role-col' : ''}>{roles[index] && <span className="role-tag">{roles[index]}</span>}{header[index]?.trim() || `column ${index + 1}`}</th>)}</tr>
            </thead>
            <tbody>
              {uniqueContext.map((rowIndex) => {
                const isSource = shownRows.includes(rowIndex)
                return <tr key={rowIndex} className={isSource ? 'source-row' : 'context-row'}>
                  <td className="row-index">{rowIndex}{isSource && <span className="row-marker">◀</span>}</td>
                  {usedColumns.map((index) => <td key={index} className={roles[index] && isSource ? 'role-cell' : ''}>{rows[rowIndex]?.[index] ?? ''}</td>)}
                </tr>
              })}
            </tbody>
          </table>
        </div>}
        {sourceRows.length > shownRows.length && <p className="source-modal-note">{sourceRows.length - shownRows.length} more grouped rows not shown (identical conditions collapsed into this point).</p>}
        <div className="source-modal-normalized">
          <span className="eyebrow">AS NORMALIZED IN FIRE ATLAS</span>
          <div>
            <span>O₂ <b>{test.o2_pct == null ? '—' : `${test.o2_pct.toFixed(2)} %`}</b> <i>{test.quality.o2_pct ?? 'null'}</i></span>
            <span>Pressure <b>{test.pressure_psi == null ? '—' : `${test.pressure_psi.toFixed(2)} psi`}</b> <i>{test.quality.pressure_psi ?? 'null'}</i></span>
            <span>Flow <b>{test.flow_cm_s == null ? '—' : `${test.flow_cm_s.toFixed(1)} cm/s`}</b> <i>{test.quality.flow_cm_s ?? 'null'}</i></span>
            <span>Outcome <b>{test.outcome.replace('_', ' ')}</b></span>
          </div>
          {test.assumptions.length > 0 && <p>Assumptions: {test.assumptions.join(' ')}</p>}
        </div>
        <div className="source-modal-links">
          <a href={`/${encodeURI(path)}`} download>Download original CSV</a>
          {test.doi && <a href={`https://doi.org/${test.doi}`} target="_blank" rel="noreferrer">DOI {test.doi}</a>}
          {test.psi_url && <a href={test.psi_url} target="_blank" rel="noreferrer">PSI investigation page</a>}
        </div>
      </div>
    </div>
  )
}
