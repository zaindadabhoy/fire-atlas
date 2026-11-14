import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { DetectionRecord, Envelope, FuelPhase, Investigation, Outcome, TestPoint } from './types'

type SortKey = 'acronym' | 'title' | 'hardware_suite' | 'fuel_phases' | 'o2_range' | 'pressure_range_psi' | 'flow_range_cm_s' | 'n_tests' | 'outcomes' | 'safety_tags' | 'years'
type RangeField = 'o2_range' | 'pressure_range_psi' | 'flow_range_cm_s'
type EnvelopeRangeField = 'o2_pct_range' | 'pressure_psi_range' | 'flow_cm_s_range'
interface DisplayRange { value: [number, number] | null; summary: boolean }
interface TableRow {
  investigation: Investigation
  tests: TestPoint[]
  outcomes: string[]
  phases: FuelPhase[]
  o2: DisplayRange
  pressure: DisplayRange
  flow: DisplayRange
  pressureAssumed: boolean
  quiescent: boolean
}

const suiteOrder = ['CIR + ACME', 'CIR + MDCA', 'MSG + SPICE flow duct', 'Saffire on Cygnus', 'Smoke / aerosol instruments', 'Analysis / modeling (ground)']
const phases: FuelPhase[] = ['gas', 'liquid', 'solid']
const outcomeLabels: Record<Outcome, string> = { burned: 'Burned', self_extinguished: 'Self-extinguished', no_ignition: 'No ignition', unknown: 'Unknown' }
const phaseLabels: Record<FuelPhase, string> = { gas: 'Gas', liquid: 'Droplet', solid: 'Solid' }

function rangeText(range: [number, number] | null, suffix = ''): string {
  if (!range) return 'Not stated'
  const [minimum, maximum] = range
  const low = Number.isInteger(minimum) ? String(minimum) : minimum.toFixed(1)
  const high = Number.isInteger(maximum) ? String(maximum) : maximum.toFixed(1)
  return Math.abs(maximum - minimum) < 0.05 ? `${low}${suffix}` : `${low}–${high}${suffix}`
}

function dateYear(value: string | null): string | null {
  if (!value) return null
  const match = value.match(/(?:19|20)\d{2}/)
  return match?.[0] ?? null
}

function mergedRange(values: Array<[number, number] | null | undefined>): [number, number] | null {
  const usable = values.filter((value): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite))
  if (!usable.length) return null
  return [Math.min(...usable.map((value) => value[0])), Math.max(...usable.map((value) => value[1]))]
}

function displayRange(
  investigation: Investigation,
  points: TestPoint[],
  envelopes: Envelope[],
  field: RangeField,
  envelopeField: EnvelopeRangeField,
  pointField: 'o2_pct' | 'pressure_psi' | 'flow_cm_s',
): DisplayRange {
  if (investigation[field]) return { value: investigation[field], summary: false }
  const values = points.map((point) => point[pointField]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (values.length) return { value: [Math.min(...values), Math.max(...values)], summary: false }
  return {
    value: mergedRange(envelopes.filter((item) => item.investigation === investigation.id).map((item) => item[envelopeField])),
    summary: true,
  }
}

function sensorsFor(investigation: Investigation): string[] {
  const text = `${investigation.approach ?? ''} ${investigation.hardware ?? ''}`.toLowerCase()
  const groups: [string, RegExp][] = [
    ['Camera', /\b(camera|video|imaging|photograph|optical)\b/],
    ['Radiometer', /radiometer/],
    ['Thermocouple', /thermocouple/],
    ['Gas analyzer', /gas analys|gas chromatograph|\banalyzer\b|\banalyser\b/],
    ['Smoke / aerosol instrument', /smoke|aerosol|particulate|soot/],
  ]
  return groups.filter(([, pattern]) => pattern.test(text)).map(([label]) => label)
}

function sampleGeometry(tests: TestPoint[]): string {
  for (const test of tests) {
    const geometry = test.metrics.sample_geometry ?? test.metrics.geometry ?? test.extra.sample_geometry
    if (typeof geometry === 'string' && geometry.trim()) return geometry.trim()
    if (Array.isArray(geometry) && geometry.length) return geometry.join(' · ')
  }
  const samples = tests.map((item) => item.configuration).filter(Boolean)
  return samples.length ? Array.from(new Set(samples)).slice(0, 2).join(' · ') : 'Not stated'
}

function relatedDataText(investigation: Investigation, investigations: Investigation[]): string | null {
  if (investigation.hardware_suite !== 'Analysis / modeling (ground)') return null
  const ids = investigation.related?.match(/PSI-\d+/g) ?? []
  const byId = new Map(investigations.map((item) => [item.id, item]))
  const names = Array.from(new Set(ids.map((id) => byId.get(id)?.acronym ?? id)))
  return names.length ? `Uses data from ${names.join(', ')}` : 'Related investigation not stated in PSI detail.'
}

function RangeBar({ range, maximum, label, display, summary }: { range: [number, number] | null; maximum: number; label: string; display: string; summary: boolean }) {
  const left = range ? Math.max(0, Math.min(100, range[0] / maximum * 100)) : 0
  const width = range ? Math.max(1, Math.min(100 - left, (range[1] - range[0]) / maximum * 100)) : 0
  return <div className="compare-range"><div className="compare-range-label"><span>{label}</span><b>{display}{summary && <small className="range-source">SUMMARY RANGE</small>}</b></div><div className="compare-range-track"><i style={{ left: `${left}%`, width: `${width}%` }} /></div><div className="compare-range-scale"><span>0</span><span>{maximum}</span></div></div>
}

function rangeCell(range: DisplayRange, suffix: string, source?: string): ReactNode {
  return <>{source ?? rangeText(range.value, suffix)}{range.summary && range.value && <small className="range-source">SUMMARY RANGE</small>}</>
}

export default function CompareView({ investigations, tests, detections, envelopes }: { investigations: Investigation[]; tests: TestPoint[]; detections: DetectionRecord[]; envelopes: Envelope[] }) {
  const [sort, setSort] = useState<{ key: SortKey; direction: 1 | -1 }>({ key: 'n_tests', direction: -1 })
  const rows = useMemo<TableRow[]>(() => investigations.map((investigation) => {
    const sourceTests = tests.filter((point) => point.investigation === investigation.id)
    const sourceEnvelopes = envelopes.filter((item) => item.investigation === investigation.id)
    const detected = detections.some((item) => item.investigation === investigation.id)
    const outcomes = Array.from(new Set(sourceTests.map((point) => outcomeLabels[point.outcome]).filter((label) => label !== 'Unknown')))
    if (detected) outcomes.push('Detection')
    const rowPhases = Array.from(new Set([
      ...sourceTests.map((point) => point.fuel_phase),
      ...sourceEnvelopes.map((item) => item.fuel_phase),
    ].filter((phase): phase is FuelPhase => !!phase)))
    const o2 = displayRange(investigation, sourceTests, sourceEnvelopes, 'o2_range', 'o2_pct_range', 'o2_pct')
    const pressure = displayRange(investigation, sourceTests, sourceEnvelopes, 'pressure_range_psi', 'pressure_psi_range', 'pressure_psi')
    const flow = displayRange(investigation, sourceTests, sourceEnvelopes, 'flow_range_cm_s', 'flow_cm_s_range', 'flow_cm_s')
    const pressureRows = sourceTests.filter((point) => point.pressure_psi != null)
    const pressureAssumed = pressureRows.length > 0 && pressureRows.every((point) => point.quality.pressure_psi === 'assumed')
    const flowRows = sourceTests.filter((point) => point.flow_cm_s != null)
    const quiescent = flowRows.length > 0 && flowRows.every((point) => point.quality.flow_cm_s === 'quiescent_chamber')
      && flow.value?.every((value) => Math.abs(value) < 0.05) === true
    return { investigation, tests: sourceTests, outcomes, phases: rowPhases, o2, pressure, flow, pressureAssumed, quiescent }
  }), [investigations, tests, detections, envelopes])
  const sorted = useMemo(() => [...rows].sort((left, right) => {
    const value = (row: TableRow): string | number => {
      switch (sort.key) {
        case 'fuel_phases': return row.phases.map((phase) => phaseLabels[phase]).join(', ')
        case 'o2_range': return row.o2.value?.[0] ?? -1
        case 'pressure_range_psi': return row.pressure.value?.[0] ?? -1
        case 'flow_range_cm_s': return row.flow.value?.[0] ?? -1
        case 'n_tests': return row.investigation.n_tests
        case 'outcomes': return row.outcomes.join(', ')
        case 'safety_tags': return row.investigation.safety_tags.join(', ')
        case 'years': return `${dateYear(row.investigation.start_date) ?? ''} ${dateYear(row.investigation.end_date) ?? ''}`
        default: return String(row.investigation[sort.key] ?? '').toLocaleLowerCase()
      }
    }
    const a = value(left)
    const b = value(right)
    const order = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true })
    return order * sort.direction || left.investigation.id.localeCompare(right.investigation.id)
  }), [rows, sort])
  const [selectedIds, setSelectedIds] = useState<string[]>(['PSI-69', 'PSI-99'])
  const selectedRows = selectedIds.map((id) => rows.find((row) => row.investigation.id === id)).filter((row): row is TableRow => !!row)
  const pair = selectedRows.slice(0, 2)
  const toggleSelected = (id: string) => setSelectedIds((current) => current.includes(id)
    ? current.filter((item) => item !== id)
    : current.length < 3 ? [...current, id] : current)

  function header(key: SortKey, label: string) {
    return <th key={key} aria-sort={sort.key === key ? sort.direction === 1 ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => setSort((current) => ({ key, direction: current.key === key ? current.direction === 1 ? -1 : 1 : 1 }))}>{label}<span>{sort.key === key ? sort.direction === 1 ? ' ↑' : ' ↓' : ' ↕'}</span></button></th>
  }

  const pairDiffs = useMemo(() => {
    if (pair.length < 2) return []
    const [left, right] = pair
    const sharedHardware = left.investigation.hardware_suite === right.investigation.hardware_suite
    const sharedPhases = left.phases.filter((phase) => right.phases.includes(phase))
    const a = left.o2.value
    const b = right.o2.value
    const overlap = a && b ? [Math.max(a[0], b[0]), Math.min(a[1], b[1])] as [number, number] : null
    return [
      `${sharedHardware ? 'Same' : 'Different'} hardware suite: ${left.investigation.hardware_suite ?? 'Not stated'} / ${right.investigation.hardware_suite ?? 'Not stated'}.`,
      `${sharedPhases.length ? 'Same' : 'Different'} fuel phase${sharedPhases.length === 1 ? '' : 's'}${sharedPhases.length ? `: ${sharedPhases.map((phase) => phaseLabels[phase]).join(', ')}` : ' across the selected investigations'}.`,
      overlap && overlap[0] <= overlap[1] ? `Same: O₂ ranges overlap at ${rangeText(overlap, ' %')}.` : 'Different: O₂ ranges do not overlap.',
    ]
  }, [pair])

  return <section className="compare-view panel" aria-label="Compare investigations">
    <div className="view-title"><div><span className="section-kicker">04 · INVESTIGATION COMPARISON</span><h2>Compare PSI investigations</h2></div><span className="view-count">{investigations.length} investigations · select up to 3</span></div>
    <p className="view-intro">Compare apparatus, measured condition ranges, outcomes, and stated instrumentation across the harvested PSI set.</p>
    <div className="compare-table-wrap"><table className="compare-table"><thead><tr><th className="select-col">Select</th>{[
      ['acronym', 'Acronym'], ['title', 'Title'], ['hardware_suite', 'Hardware suite'], ['fuel_phases', 'Fuel phase(s)'], ['o2_range', 'O₂ range'], ['pressure_range_psi', 'Pressure range'], ['flow_range_cm_s', 'Flow range'], ['n_tests', '# tests'], ['outcomes', 'Outcomes measured'], ['safety_tags', 'Safety pillars'], ['years', 'Years'],
    ].map(([key, label]) => header(key as SortKey, label))}</tr></thead><tbody>{sorted.map((row) => {
      const { investigation, phases: rowPhases, outcomes } = row
      const related = relatedDataText(investigation, investigations)
      const pressureDisplay = row.pressureAssumed && row.pressure.value && Math.abs(row.pressure.value[1] - row.pressure.value[0]) < 0.05
        ? `${rangeText(row.pressure.value, ' psi')} (assumed)`
        : rangeText(row.pressure.value, ' psi')
      const flowDisplay = row.quiescent ? 'Quiescent' : rangeText(row.flow.value, ' cm/s')
      return <tr key={investigation.id}>
        <td><input type="checkbox" aria-label={`Compare ${investigation.acronym ?? investigation.id}`} checked={selectedIds.includes(investigation.id)} disabled={!selectedIds.includes(investigation.id) && selectedIds.length >= 3} onChange={() => toggleSelected(investigation.id)} /></td>
        <td className="mono-cell"><b>{investigation.acronym ?? investigation.id}</b><small>{investigation.id}</small>{investigation.hardware_mapping_status === 'unmapped' && <i className="mapping-flag">UNMAPPED</i>}</td>
        <td>{investigation.title ?? 'Not stated'}</td><td>{investigation.hardware_suite ?? 'Not stated'}{related && <small className="related-source">{related}</small>}</td><td>{rowPhases.map((phase) => phaseLabels[phase]).join(' · ') || (detections.some((item) => item.investigation === investigation.id) ? 'Detection' : 'Not stated')}</td>
        <td className="mono-cell">{rangeCell(row.o2, ' %')}</td><td className="mono-cell">{rangeCell(row.pressure, ' psi', pressureDisplay)}</td><td className="mono-cell">{rangeCell(row.flow, ' cm/s', flowDisplay)}</td><td className="mono-cell">{investigation.n_tests}</td><td>{outcomes.join(' · ') || 'Not stated'}</td><td>{investigation.safety_tags.join(' · ') || 'Not stated'}</td><td className="mono-cell">{dateYear(investigation.start_date) ?? '—'}{dateYear(investigation.end_date) && dateYear(investigation.end_date) !== dateYear(investigation.start_date) ? `–${dateYear(investigation.end_date)}` : ''}</td>
      </tr>
    })}</tbody></table></div>
    <div className="compare-selection-heading"><h3>Side-by-side</h3><span>{selectedRows.length}/3 selected</span></div>
    {selectedRows.length ? <div className="compare-cards">{selectedRows.map((row) => {
      const { investigation, tests: sourceTests, outcomes } = row
      const sensors = sensorsFor(investigation)
      const related = relatedDataText(investigation, investigations)
      const pressureDisplay = row.pressureAssumed && row.pressure.value && Math.abs(row.pressure.value[1] - row.pressure.value[0]) < 0.05
        ? `${rangeText(row.pressure.value, ' psi')} (assumed)`
        : rangeText(row.pressure.value, ' psi')
      const flowDisplay = row.quiescent ? 'Quiescent' : rangeText(row.flow.value, ' cm/s')
      return <article className="compare-card" key={investigation.id}>
        <div className="compare-card-head"><div><span>{investigation.hardware_suite ?? 'Not stated'}</span><h4>{investigation.acronym ?? investigation.id}</h4></div>{investigation.doi && <a href={`https://doi.org/${investigation.doi}`} target="_blank" rel="noreferrer">DOI ↗</a>}</div>
        <p className="compare-objective">{(investigation.objective ?? 'Objective not stated in the harvested detail.').slice(0, 280)}</p>
        <dl className="compare-facts"><div><dt>Hardware</dt><dd>{investigation.hardware ?? 'Not stated'}</dd></div><div><dt>Sample / fuel geometry</dt><dd>{sampleGeometry(sourceTests)}</dd></div>{related && <div><dt>Related PSI work</dt><dd>{related}</dd></div>}</dl>
        <RangeBar range={row.o2.value} maximum={105} label="O₂" display={`${rangeText(row.o2.value, ' %')}${row.o2.summary ? ' · summary range' : ''}`} summary={false} />
        <RangeBar range={row.pressure.value} maximum={120} label="Pressure" display={`${pressureDisplay}${row.pressure.summary ? ' · summary range' : ''}`} summary={false} />
        <dl className="compare-facts"><div><dt>Flow</dt><dd>{flowDisplay}{row.flow.summary && row.flow.value && <small className="range-source">SUMMARY RANGE</small>}</dd></div><div><dt>Outcomes measured</dt><dd>{outcomes.join(' · ') || 'Not stated'}</dd></div><div><dt>Sensors / measurements</dt><dd>{sensors.join(' · ') || 'Not stated'}</dd></div></dl>
      </article>
    })}</div> : <p className="empty-state">Select two or three investigations in the table to compare their methods and conditions.</p>}
    {pairDiffs.length > 0 && <section className="same-different"><h3>Same / Different</h3><ul>{pairDiffs.map((item) => <li key={item}>{item}</li>)}</ul></section>}
    <section className="hardware-matrix"><div className="compare-selection-heading"><h3>Hardware × fuel phase</h3><span>Investigation acronyms in each cell</span></div><div className="compare-table-wrap"><table className="matrix-table"><thead><tr><th>Hardware suite</th><th>Gas</th><th>Droplet</th><th>Solid</th><th>Detection</th></tr></thead><tbody>{suiteOrder.map((suite) => <tr key={suite}><th>{suite}</th>{[...phases, 'detection'].map((phase) => {
      const ids = rows.filter((row) => row.investigation.hardware_suite === suite && (phase === 'detection'
        ? detections.some((item) => item.investigation === row.investigation.id)
        : row.phases.includes(phase as FuelPhase))).map((row) => row.investigation.acronym ?? row.investigation.id)
      return <td key={`${suite}-${phase}`}>{ids.length ? ids.join(' · ') : '—'}</td>
    })}</tr>)}</tbody></table></div></section>
  </section>
}
