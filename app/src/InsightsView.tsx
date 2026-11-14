import { useMemo } from 'react'
import type { TestPoint } from './types'

interface DetectionRecord { id: string; investigation: string; acronym?: string | null; material?: string | null }

/* ------------------------------------------------------------------ */
/* Gravity bounds — SAFFIRE-II burned the same samples at 1 g and µg   */
/* ------------------------------------------------------------------ */

interface GravityRow {
  test: TestPoint
  material: string
  thickness: string
  ugRaw: string
  oneGRaw: string
  ug: number | null
  oneG: number | null
}

/** Burn length as a fraction of sample length; null when the source text has no usable length. */
function burnFraction(raw: unknown, sampleLength: number | null): number | null {
  if (raw == null) return null
  const text = String(raw).trim().toLowerCase()
  if (!text || text === 'n/a') return null
  if (text.startsWith('complete')) return 1
  const match = text.match(/~?\s*(\d+(?:\.\d+)?)\s*(cm)?/)
  if (!match) return null
  const value = Number(match[1])
  if (value === 0) return 0
  if (!match[2] || !sampleLength) return null
  return Math.max(0, Math.min(1, value / sampleLength))
}

function gravityRows(tests: TestPoint[]): GravityRow[] {
  return tests
    .filter((test) => test.investigation === 'PSI-99')
    .map((test) => {
      const metrics = test.metrics as Record<string, unknown>
      const length = typeof metrics.sample_length_cm === 'number' ? metrics.sample_length_cm : null
      return {
        test,
        material: test.material ?? `Sample ${test.test_label} (material not recorded)`,
        thickness: String(metrics.sample_thickness_raw ?? '—'),
        ugRaw: String(metrics.burn_length_microgravity ?? 'not recorded'),
        oneGRaw: String(metrics.burn_length_1g ?? 'not recorded'),
        ug: burnFraction(metrics.burn_length_microgravity, length),
        oneG: burnFraction(metrics.burn_length_1g, length),
      }
    })
    .sort((a, b) => a.test.test_label.localeCompare(b.test.test_label, undefined, { numeric: true }))
}

/* ------------------------------------------------------------------ */
/* Material readiness matrix                                           */
/* ------------------------------------------------------------------ */

interface Family { key: string; label: string; match: RegExp; note?: string }

const FAMILIES: Family[] = [
  { key: 'pmma', label: 'PMMA (acrylic)', match: /pmma|acrylic|plexi/i },
  { key: 'sibal', label: 'Cotton-fiberglass (SIBAL)', match: /sibal|cotton/i },
  { key: 'nomex', label: 'Nomex', match: /nomex/i },
  { key: 'silicone', label: 'Silicone', match: /silicone/i },
  { key: 'wax', label: 'Paraffin / Japan wax', match: /wax/i },
  { key: 'ultem', label: 'Ultem (PEI)', match: /ultem/i },
  { key: 'kapton', label: 'Kapton', match: /kapton/i },
  { key: 'teflon', label: 'Teflon (PTFE)', match: /teflon/i },
  { key: 'pyrell', label: 'Pyrell foam', match: /pyrell/i },
  { key: 'lampwick', label: 'Lampwick (cotton)', match: /lampwick/i },
]

interface ReadinessRow {
  family: Family
  burnTests: TestPoint[]
  investigations: string[]
  burned: number
  selfExt: number
  unknown: number
  maxO2: number | null
  pressureMeasured: boolean
  gravityCompared: boolean
  smokeRecords: number
  above30: number
}

function readinessRows(tests: TestPoint[], detections: DetectionRecord[]): ReadinessRow[] {
  return FAMILIES.map((family) => {
    const burnTests = tests.filter((test) => test.fuel_phase === 'solid' && test.material && family.match.test(test.material))
    const measuredO2 = burnTests.filter((test) => test.o2_pct != null && test.quality.o2_pct !== 'assumed').map((test) => test.o2_pct as number)
    return {
      family,
      burnTests,
      investigations: [...new Set(burnTests.map((test) => test.acronym ?? test.investigation))],
      burned: burnTests.filter((test) => test.outcome === 'burned').length,
      selfExt: burnTests.filter((test) => test.outcome === 'self_extinguished').length,
      unknown: burnTests.filter((test) => test.outcome === 'unknown' || test.outcome === 'no_ignition').length,
      maxO2: measuredO2.length ? Math.max(...measuredO2) : null,
      pressureMeasured: burnTests.some((test) => test.quality.pressure_psi === 'measured'),
      gravityCompared: burnTests.some((test) => test.investigation === 'PSI-99'),
      smokeRecords: detections.filter((record) => record.material && family.match.test(record.material)).length,
      above30: burnTests.filter((test) => (test.o2_pct ?? 0) >= 30).length,
    }
  }).filter((row) => row.burnTests.length || row.smokeRecords)
}

/* ------------------------------------------------------------------ */

export function InsightsView({ tests, detections, onReceipt }: { tests: TestPoint[]; detections: DetectionRecord[]; onReceipt: (test: TestPoint) => void }) {
  const gravity = useMemo(() => gravityRows(tests), [tests])
  const readiness = useMemo(() => readinessRows(tests, detections), [tests, detections])

  const silicone = gravity.filter((row) => /silicone/i.test(row.material))
  const siliconeBurned1g = silicone.filter((row) => (row.oneG ?? 0) > 0.05).length
  const siliconeBurnedUg = silicone.filter((row) => (row.ug ?? 0) > 0.05).length
  const withBurnData = readiness.filter((row) => row.burnTests.length > 0)
  const testedAbove30 = readiness.filter((row) => row.above30 > 0).length

  return (
    <section className="insights-view" aria-label="Insights">
      <div className="panel insights-panel">
        <div className="section-kicker"><span>05</span> GRAVITY BOUNDS · 0 g vs 1 g</div>
        <h2>Same material, different gravity, different answer</h2>
        <p className="insights-lede">
          SAFFIRE-II burned its samples in microgravity aboard a Cygnus vehicle and recorded the same materials in a 1 g screening test.
          {silicone.length > 0 && <> <b>Silicone: {siliconeBurned1g} of {silicone.length} samples burned at 1 g; {siliconeBurnedUg} of {silicone.length} burned in microgravity.</b></>}
          {' '}The Moon (0.17 g) and Mars (0.38 g) sit between these bounds. PSI holds no partial-gravity combustion data yet (LUCI and FM2 are planned to add it).
        </p>
        <div className="gravity-legend"><span><i className="g-swatch ug" />Microgravity burn length</span><span><i className="g-swatch oneg" />1 g burn length</span><span className="muted">bar = fraction of sample length · text = NASA's recorded value</span></div>
        <div className="gravity-table" role="table" aria-label="SAFFIRE-II burn length at 1 g and microgravity">
          <div className="gravity-row gravity-head" role="row"><span role="columnheader">Sample</span><span role="columnheader">Material · thickness</span><span role="columnheader">Microgravity</span><span role="columnheader">1 g</span><span role="columnheader">Source</span></div>
          {gravity.map((row) => (
            <div className="gravity-row" role="row" key={row.test.id}>
              <span role="cell" className="mono">{row.test.test_label}</span>
              <span role="cell">{row.material}<small>{row.thickness}</small></span>
              <span role="cell" className="g-cell"><span className="g-bar"><i className="ug" style={{ width: `${(row.ug ?? 0) * 100}%` }} /></span><small>{row.ugRaw}</small></span>
              <span role="cell" className="g-cell"><span className="g-bar"><i className="oneg" style={{ width: `${(row.oneG ?? 0) * 100}%` }} /></span><small>{row.oneGRaw}</small></span>
              <span role="cell"><button type="button" className="citation-chip" onClick={() => onReceipt(row.test)} title={row.test.id}>PSI-99 · {row.test.test_label}</button></span>
            </div>
          ))}
        </div>
        <p className="insights-caveat">9 samples from one investigation. These are bounds for test planning, not a prediction for lunar gravity. Source wording is shown as recorded (e.g. "~ 0", "Complete"); "037 mm" is a typo in the NASA table, kept unedited.</p>
      </div>

      <div className="panel insights-panel">
        <div className="section-kicker"><span>06</span> MATERIAL READINESS · LUNAR CABIN</div>
        <h2>Which cabin materials have evidence for a 34 % O₂ habitat?</h2>
        <p className="insights-lede"><b>{withBurnData.length} materials have microgravity burn tests in PSI. {testedAbove30 === 0 ? 'None' : testedAbove30} of them {testedAbove30 === 1 ? 'has' : 'have'} been tested at ≥ 30 % O₂.</b> Smoke-signature data (SAME, SAME-R) covers several more. Every row below is computed from the normalized PSI tests.</p>
        <div className="readiness-wrap">
          <table className="readiness-table">
            <thead><tr>
              <th>Material</th><th>Microgravity burn tests</th><th>Outcomes (burned / self-ext / unknown)</th><th>Max O₂ tested</th><th>Pressure</th><th>1 g vs 0 g</th><th>Smoke data</th><th>≥ 30 % O₂</th><th>Lunar evidence</th>
            </tr></thead>
            <tbody>{readiness.map((row) => (
              <tr key={row.family.key}>
                <td><b>{row.family.label}</b>{row.investigations.length > 0 && <small>{row.investigations.join(', ')}</small>}</td>
                <td className="num">{row.burnTests.length || '—'}</td>
                <td className="num">{row.burnTests.length ? <><span className="o-burned">{row.burned}</span> / <span className="o-self">{row.selfExt}</span> / <span className="o-unknown">{row.unknown}</span></> : '—'}</td>
                <td className="num">{row.maxO2 == null ? (row.burnTests.length ? 'not recorded' : '—') : `${row.maxO2.toFixed(1)} %`}</td>
                <td>{row.burnTests.length ? (row.pressureMeasured ? 'measured' : <span className="tag-assumed">cabin, assumed</span>) : '—'}</td>
                <td>{row.gravityCompared ? <span className="tag-yes">yes</span> : '—'}</td>
                <td className="num">{row.smokeRecords || '—'}</td>
                <td className="num">{row.burnTests.length ? row.above30 : '—'}</td>
                <td>{row.above30 > 0 ? <span className="tag-yes">partial</span> : <span className="tag-none">NONE</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="insights-caveat">Material names are grouped by keyword from the NASA tables (e.g. "PMMA sphere 2 cm" → PMMA). Unlabeled BASS-II samples (e.g. "1/4&quot; clear") are not assigned to a material. Outcome "unknown" means the PSI table records no outcome for that test.</p>
      </div>
    </section>
  )
}
