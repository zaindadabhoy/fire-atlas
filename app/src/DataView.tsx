import { useMemo, useState } from 'react'
import type { Investigation, TestPoint } from './types'

type FlatRow = Record<string, string | number | null>
const coreColumns = ['id', 'investigation', 'acronym', 'table_key', 'test_label', 'fuel_phase', 'configuration', 'material', 'o2_pct', 'pressure_psi', 'o2_partial_psi', 'flow_cm_s', 'diluent', 'outcome', 'outcome_raw', 'quality_o2_pct', 'quality_pressure_psi', 'quality_flow_cm_s', 'source_file', 'source_row', 'source_rows', 'doi', 'psi_url']

function flatten(value: unknown, prefix = '', result: FlatRow = {}): FlatRow {
  if (value === null || value === undefined) {
    if (prefix) result[prefix] = null
    return result
  }
  if (Array.isArray(value)) {
    result[prefix] = JSON.stringify(value)
    return result
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) flatten(child, prefix ? `${prefix}.${key}` : key, result)
    return result
  }
  if (prefix) result[prefix] = typeof value === 'string' || typeof value === 'number' ? value : String(value)
  return result
}

function flattened(point: TestPoint): FlatRow {
  const row = flatten(point)
  row.quality_o2_pct = point.quality.o2_pct
  row.quality_pressure_psi = point.quality.pressure_psi
  row.quality_flow_cm_s = point.quality.flow_cm_s
  row.source_file = point.source.file
  row.source_row = point.source.row
  row.source_rows = point.source.rows ? JSON.stringify(point.source.rows) : null
  row.doi = point.doi
  return row
}

function hashText(text: string): string {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619)
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

function download(filename: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function DataView({ tests, allTests, investigations, filterSummary, filterKey }: {
  tests: TestPoint[]
  allTests: TestPoint[]
  investigations: Investigation[]
  filterSummary: string
  filterKey: string
}) {
  const [status, setStatus] = useState('')
  const rows = useMemo(() => tests.map(flattened), [tests])
  const allRows = useMemo(() => allTests.map(flattened), [allTests])
  const columns = useMemo(() => {
    const observed = Array.from(new Set([...allRows.flatMap((row) => Object.keys(row)), ...rows.flatMap((row) => Object.keys(row))]))
    return Array.from(new Set([...coreColumns, ...observed])).sort((a, b) => {
      const ai = coreColumns.indexOf(a); const bi = coreColumns.indexOf(b)
      if (ai >= 0 || bi >= 0) return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
      return a.localeCompare(b)
    })
  }, [allRows, rows])
  const fileToken = hashText(filterKey)
  const baseName = `fire-atlas-tests-${fileToken}`
  const cited = useMemo(() => {
    const ids = new Set(tests.map((item) => item.investigation))
    return investigations.filter((item) => ids.has(item.id) && item.doi).map((item) => ({ id: item.id, acronym: item.acronym ?? item.id, doi: item.doi! }))
  }, [tests, investigations])

  const exportCsv = () => {
    const csv = [columns.map(csvCell).join(','), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(','))].join('\r\n')
    download(`${baseName}.csv`, 'text/csv;charset=utf-8', `\uFEFF${csv}`)
    setStatus(`CSV downloaded: ${rows.length.toLocaleString()} rows · ${baseName}.csv`)
  }
  const exportJson = () => {
    download(`${baseName}.json`, 'application/json;charset=utf-8', `${JSON.stringify(rows, null, 2)}\n`)
    setStatus(`JSON downloaded: ${rows.length.toLocaleString()} rows · ${baseName}.json`)
  }

  return <section className="data-view panel" aria-label="Export filtered PSI data">
    <div className="view-title"><div><span className="section-kicker">05 · PREDICTIVE DATA EXTRACTION</span><h2>Export test-level data</h2></div><span className="view-count">{rows.length.toLocaleString()} rows ready</span></div>
    <p className="view-intro">Current filters: {filterSummary}. Exported rows retain source rows, measurement quality, assumptions, and normalized detail.</p>
    <div className="data-actions"><button type="button" onClick={exportCsv}>Download CSV <span>↓</span></button><button type="button" onClick={exportJson}>Download JSON <span>↓</span></button><a href="/data/data-dictionary.md" target="_blank" rel="noreferrer">Data dictionary ↗</a><small>Filename includes filter hash <b>{fileToken}</b></small></div>
    {status && <p className="export-status" role="status">{status}</p>}
    <div className="data-preview-heading"><h3>Preview · first 10 rows</h3><span>{columns.length} flattened columns · scroll horizontally</span></div>
    <div className="data-preview-wrap"><table className="data-preview"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.slice(0, 10).map((row, index) => <tr key={`${String(row.id ?? index)}-${index}`}>{columns.map((column) => <td key={column}>{row[column] == null ? '—' : String(row[column])}</td>)}</tr>)}</tbody></table>{!rows.length && <p className="empty-state">No tests match the current filters.</p>}</div>
    <div className="citation-box" id="how-to-cite"><div><h3>How to cite</h3><p>Use the investigation DOI links represented in this export and cite NASA Physical Sciences Informatics as the data source.</p></div><ul>{cited.length ? cited.map((item) => <li key={item.id}><span>{item.acronym}</span><a href={`https://doi.org/${item.doi}`} target="_blank" rel="noreferrer">{item.doi}</a></li>) : <li>No DOI is recorded for the current selection.</li>}</ul></div>
  </section>
}
