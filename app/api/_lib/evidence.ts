import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FuelPhase, FindingsData, Habitat, Investigation, TestPoint } from '../../src/types.ts'
import { rankInvestigations, type SafetyPillar } from '../../src/lib/rank.ts'

export interface BriefingQuery {
  o2_pct: number
  pressure_psi: number
  flow_cm_s?: number | null
  material?: string | null
  phase?: FuelPhase
  pillar?: SafetyPillar | null
  habitat_id?: string | null
}

interface EvidenceFact {
  id: string
  value: number | string | null
  unit: string
  text: string
  support_sample: string[]
  support_total: number
  [key: string]: unknown
}

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/data')
const PHASES: FuelPhase[] = ['solid', 'liquid', 'gas']
type CoverageEvidence = Pick<ReturnType<typeof phaseCoverage>, 'n_near' | 'n_near_incl_assumed' | 'n_near_assumed_pressure' | 'n_near_with_assumed_pressure' | 'coverage' | 'coverage_tier_words' | 'max_o2_tested' | 'min_pressure_tested' | 'measured_test_count'>

async function loadData<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(resolve(DATA_DIR, name), 'utf8')) as T
}

function hasConditions(point: TestPoint): boolean {
  return point.o2_pct != null && point.pressure_psi != null
}

function measuredConditions(point: TestPoint): boolean {
  return hasConditions(point) && point.quality.o2_pct === 'measured' && point.quality.pressure_psi === 'measured'
}

function distance(point: TestPoint, query: BriefingQuery): number {
  return Math.sqrt(((point.o2_pct! - query.o2_pct) / 10) ** 2 + ((point.pressure_psi! - query.pressure_psi) / 3) ** 2)
}

function inWindow(point: TestPoint, query: BriefingQuery): boolean {
  return hasConditions(point) && Math.abs(point.o2_pct! - query.o2_pct) <= 5 && Math.abs(point.pressure_psi! - query.pressure_psi) <= 2
}

function phaseCoverage(tests: TestPoint[], query: BriefingQuery, phase: FuelPhase) {
  const rows = tests.filter((point) => point.fuel_phase === phase)
  const measured = rows.filter(measuredConditions)
  const known = rows.filter(hasConditions)
  const near = measured.filter((point) => inWindow(point, query))
  const nearAssumedPressure = rows.filter((point) => point.o2_pct != null
    && point.quality.o2_pct === 'measured'
    && point.quality.pressure_psi === 'assumed'
    && Math.abs((point.pressure_psi ?? 0) - 14.7) <= 0.05
    && inWindow(point, query))
  const nearWithAssumedPressure = near.length + nearAssumedPressure.length
  const maxRows = rows.filter((point) => point.o2_pct != null && point.quality.o2_pct === 'measured')
  const minRows = rows.filter((point) => point.pressure_psi != null && point.quality.pressure_psi === 'measured')
  const max = maxRows.sort((left, right) => right.o2_pct! - left.o2_pct!)[0]
  const min = minRows.sort((left, right) => left.pressure_psi! - right.pressure_psi!)[0]
  const tierWords = near.length >= 5 ? 'COVERED · MEASURED O₂ AND PRESSURE'
    : nearWithAssumedPressure >= 5 ? 'COVERED · ASSUMED CABIN PRESSURE'
      : nearWithAssumedPressure ? 'SPARSE · LIMITED MEASURED COVERAGE' : 'NONE · NO TESTS IN THE QUERY WINDOW'
  return {
    n_near: near.length,
    n_near_incl_assumed: known.filter((point) => inWindow(point, query)).length,
    n_near_assumed_pressure: nearAssumedPressure.length,
    n_near_with_assumed_pressure: nearWithAssumedPressure,
    coverage: near.length >= 5 ? 'covered' : nearWithAssumedPressure >= 5 ? 'covered_assumed_pressure' : nearWithAssumedPressure ? 'sparse' : 'none',
    coverage_tier_words: tierWords,
    max_o2_tested: max ? { value: max.o2_pct, test_id: max.id } : null,
    min_pressure_tested: min ? { value: min.pressure_psi, test_id: min.id } : null,
    measured_test_count: measured.length,
  }
}

function numericValues(value: unknown, key = ''): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) return [value]
  if (typeof value === 'string' && ['text', 'objective', 'context_snippet', 'reason'].includes(key)) {
    const safeText = value.replace(/\bPSI-\d+\b/g, ' ')
    return Array.from(safeText.matchAll(/(?<![A-Za-z0-9])[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g), (match) => Number(match[0]))
  }
  if (Array.isArray(value)) return value.flatMap((item) => numericValues(item, key))
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([childKey]) => !['id', 'cites', 'support', 'support_sample', 'support_total', 'citation_key', 'generated_at_utc'].includes(childKey))
      .flatMap(([childKey, child]) => numericValues(child, childKey))
  }
  return []
}

export interface EvidencePack {
  query: {
    o2_pct: number
    pressure_psi: number
    flow_cm_s: number | null
    material: string | null
    phase: FuelPhase
    pillar: SafetyPillar | null
    habitat_id: string | null
    o2_partial_psi: number
  }
  habitat_reference: { id: string; name: string; source: string } | null
  coverage: Record<FuelPhase, CoverageEvidence>
  nearest_tests: Array<Record<string, unknown>>
  nearest_evidence_facts: EvidenceFact[]
  o2_partial_comparison: EvidenceFact
  relevant_trend_facts: EvidenceFact[]
  material_contrasts: EvidenceFact[]
  ranked_investigations: Array<Record<string, unknown>>
  global_facts: EvidenceFact[]
  allowed_citation_keys: string[]
  numeric_values: number[]
}

function toEvidenceFact(fact: FindingsData['facts'][number], supportLimit = 6): EvidenceFact {
  const support = fact.support ?? []
  const detailKeys = [
    'test_id', 'phase', 'fuel_phase', 'investigation_id', 'trend_type', 'series_key', 'series_name',
    'bin', 'burned_count', 'known_outcome_count', 'tested_count', 'percent', 'share',
    'o2_pct_range', 'flow_cm_s_range', 'pressure_psi_range', 'pressure_assumed', 'material_outcomes',
    'min_o2_pct', 'max_o2_pct', 'p_o2_psi', 'earth_p_o2_psi', 'percent_vs_earth',
    'oxygen_fraction_percent_vs_earth', 'distance', 'o2_pct', 'pressure_psi', 'quality', 'measured_coordinates',
  ]
  const details = Object.fromEntries(detailKeys.filter((key) => key in fact).map((key) => [key, fact[key]]))
  return {
    id: fact.id,
    value: fact.value,
    unit: fact.unit,
    text: fact.text,
    ...details,
    support_sample: support.slice(0, supportLimit),
    support_total: support.length,
  } as EvidenceFact
}

const O2_BINS = ['<18', '18-25', '25-35', '35-50', '>50']
const PRESSURE_BINS = ['<9', '9-12', '12-16', '>16']

function o2Bin(value: number): string {
  if (value < 18) return '<18'
  if (value < 25) return '18-25'
  if (value < 35) return '25-35'
  if (value <= 50) return '35-50'
  return '>50'
}

function pressureBin(value: number): string {
  if (value < 9) return '<9'
  if (value < 12) return '9-12'
  if (value <= 16) return '12-16'
  return '>16'
}

function phaseName(phase: FuelPhase): string {
  return phase === 'liquid' ? 'Droplet' : phase === 'solid' ? 'Solid' : 'Gas'
}

export async function buildEvidencePack(input: BriefingQuery): Promise<EvidencePack> {
  const [tests, investigations, findings, habitats] = await Promise.all([
    loadData<TestPoint[]>('tests.json'),
    loadData<Investigation[]>('investigations.json'),
    loadData<FindingsData>('findings.json'),
    loadData<Habitat[]>('habitats.json'),
  ])
  const phase = input.phase ?? 'solid'
  const query: BriefingQuery = { ...input, phase }
  const habitatReference = habitats.find((item) => item.id === query.habitat_id) ?? null
  const earthReference = habitats.find((item) => item.id === 'earth-sea-level') ?? null
  const o2Partial = query.o2_pct * query.pressure_psi / 100
  const outputQuery = {
    o2_pct: query.o2_pct,
    pressure_psi: query.pressure_psi,
    flow_cm_s: query.flow_cm_s ?? null,
    material: query.material ?? null,
    phase,
    pillar: query.pillar ?? null,
    habitat_id: query.habitat_id ?? null,
    o2_partial_psi: Math.round(o2Partial * 100) / 100,
  }
  const coverage = Object.fromEntries(PHASES.map((candidate) => [candidate, phaseCoverage(tests, query, candidate)])) as Record<FuelPhase, ReturnType<typeof phaseCoverage>>
  const factMap = new Map(findings.facts.map((fact) => [fact.id, fact]))
  const nearestEvidence = [phase].map((candidate) => {
    const stored = query.habitat_id ? factMap.get(`fact:${query.habitat_id}_nearest_${candidate}`) : undefined
    if (stored) return toEvidenceFact(stored, 1)
    const phaseRows = tests.filter((point) => point.fuel_phase === candidate)
    const measuredRows = phaseRows.filter(measuredConditions)
    const rows = measuredRows.length ? measuredRows : phaseRows.filter(hasConditions)
    const nearest = [...rows].sort((left, right) => distance(left, query) - distance(right, query) || left.id.localeCompare(right.id))[0]
    if (!nearest) {
      return {
        id: `fact:query_nearest_${candidate}`,
        value: null,
        unit: '% O₂',
        text: `No test-level ${phaseName(candidate)} condition pair is available near the query.`,
        support_sample: [],
        support_total: 0,
        test_id: null,
        phase: candidate,
        distance: null,
      }
    }
    const gap = query.o2_pct - nearest.o2_pct!
    const gapText = Math.abs(gap) < 0.05 ? 'at the same O₂ concentration' : gap > 0
      ? `${gap.toFixed(1)} percentage points lower in O₂` : `${Math.abs(gap).toFixed(1)} percentage points higher in O₂`
    const pressureNote = nearest.quality.pressure_psi === 'assumed' ? 'pressure assumed' : 'pressure measured'
    return {
      id: `fact:query_nearest_${candidate}`,
      value: nearest.o2_pct,
      unit: '% O₂',
      text: `Nearest ${phaseName(candidate)} evidence is ${nearest.id} at ${nearest.o2_pct!.toFixed(1)} % O₂ and ${nearest.pressure_psi!.toFixed(2)} psi; ${gapText}, with ${pressureNote}.`,
      support_sample: [nearest.id],
      support_total: 1,
      test_id: nearest.id,
      phase: candidate,
      o2_pct: nearest.o2_pct,
      pressure_psi: nearest.pressure_psi,
      distance: Math.round(distance(nearest, query) * 10000) / 10000,
      o2_gap_pct_points: Math.round(gap * 100) / 100,
      quality: nearest.quality,
      measured_coordinates: measuredRows.length > 0,
    }
  })
  const earthPo2 = earthReference && earthReference.o2_pct != null && earthReference.pressure_psi != null
    ? earthReference.o2_pct * earthReference.pressure_psi / 100 : null
  const po2Delta = earthPo2 && earthPo2 !== 0 ? (o2Partial - earthPo2) / earthPo2 * 100 : null
  const fractionDelta = earthReference?.o2_pct ? (query.o2_pct - earthReference.o2_pct) / earthReference.o2_pct * 100 : null
  const po2Text = earthPo2 == null || po2Delta == null || fractionDelta == null
    ? `Query O₂ partial pressure is ${Math.round(o2Partial * 100) / 100} psi.`
    : `Query O₂ partial pressure is ${(Math.round(o2Partial * 100) / 100).toFixed(2)} psi, ${Math.abs(po2Delta).toFixed(0)}% ${po2Delta < 0 ? 'below' : 'above'} Earth's ${earthPo2.toFixed(2)} psi, while O₂ mole fraction is ${Math.abs(fractionDelta).toFixed(0)}% ${fractionDelta < 0 ? 'lower' : 'higher'}.`
  const o2PartialComparison: EvidenceFact = {
    id: 'fact:query_o2_partial_comparison',
    value: Math.round(o2Partial * 100) / 100,
    unit: 'psi',
    text: po2Text,
    support_sample: earthReference ? ['query:conditions', 'habitat:earth-sea-level'] : ['query:conditions'],
    support_total: earthReference ? 2 : 1,
    p_o2_psi: Math.round(o2Partial * 100) / 100,
    earth_p_o2_psi: earthPo2 == null ? null : Math.round(earthPo2 * 100) / 100,
    percent_vs_earth: po2Delta == null ? null : Math.round(po2Delta * 100) / 100,
    oxygen_fraction_percent_vs_earth: fractionDelta == null ? null : Math.round(fractionDelta * 100) / 100,
  }
  const ranked = rankInvestigations(
    { o2_pct: query.o2_pct, pressure_psi: query.pressure_psi, phase, pillar: query.pillar ?? null },
    tests,
    investigations,
  ).slice(0, 3)
  const investigationMap = new Map(investigations.map((item) => [item.id, item]))
  const rankedInvestigations = ranked.map((rank) => {
    const source = investigationMap.get(rank.id)
    const context = findings.context_snippets?.find((item) => item.investigation_id === rank.id)
    return {
      id: rank.id,
      citation_key: rank.id,
      acronym: rank.acronym,
      title: rank.title,
      score: rank.score,
      phase_factor: rank.phase_factor,
      breakdown: rank.breakdown,
      reason_facts: rank.reason_facts,
      safety_tags: source?.safety_tags ?? [],
      objective: source?.objective?.slice(0, 300) ?? null,
      context_snippet: context?.text ?? null,
      context_source_field: context?.source_field ?? null,
      context_support: context?.support ?? [rank.id],
    }
  })
  const phaseOrder: FuelPhase[] = [phase, ...PHASES.filter((candidate) => candidate !== phase)]
  const phasePriority = new Map(phaseOrder.map((item, index) => [item, index]))
  const trendFacts = findings.facts.filter((fact) => typeof fact.trend_type === 'string')
    .sort((left, right) => {
      const phaseRank = (phasePriority.get(left.fuel_phase as FuelPhase) ?? 5) - (phasePriority.get(right.fuel_phase as FuelPhase) ?? 5)
      if (phaseRank) return phaseRank
      const leftBins = String(left.trend_type).startsWith('o2') ? O2_BINS : PRESSURE_BINS
      const rightBins = String(right.trend_type).startsWith('o2') ? O2_BINS : PRESSURE_BINS
      const leftTarget = String(left.trend_type).startsWith('o2') ? o2Bin(query.o2_pct) : pressureBin(query.pressure_psi)
      const rightTarget = String(right.trend_type).startsWith('o2') ? o2Bin(query.o2_pct) : pressureBin(query.pressure_psi)
      const leftDistance = Math.abs(leftBins.indexOf(String(left.bin)) - leftBins.indexOf(leftTarget))
      const rightDistance = Math.abs(rightBins.indexOf(String(right.bin)) - rightBins.indexOf(rightTarget))
      return leftDistance - rightDistance || String(left.id).localeCompare(String(right.id))
    })
  const selectedTrends = trendFacts.filter((fact) => fact.fuel_phase === phase).slice(0, 3).map((fact) => toEvidenceFact(fact, 2))
  const contrastFacts = findings.facts.filter((fact) => String(fact.id).startsWith('fact:material_contrast_') && fact.fuel_phase === phase)
    .sort((left, right) => {
      const phaseRank = (phasePriority.get(left.fuel_phase as FuelPhase) ?? 5) - (phasePriority.get(right.fuel_phase as FuelPhase) ?? 5)
      if (phaseRank) return phaseRank
      const leftRange = left.o2_pct_range as number[] | undefined
      const rightRange = right.o2_pct_range as number[] | undefined
      const delta = (range: number[] | undefined) => range?.length === 2 ? Math.max(0, range[0] - query.o2_pct, query.o2_pct - range[1]) : Number.POSITIVE_INFINITY
      return delta(leftRange) - delta(rightRange) || String(left.id).localeCompare(String(right.id))
    })
  const selectedContrasts = contrastFacts.slice(0, 1).map((fact) => toEvidenceFact(fact, 3))
  const prioritizedFactIds = query.habitat_id === 'apollo-1'
    ? ['fact:apollo-1_o2_partial_pressure_ratio_vs_earth', 'fact:apollo-1_o2_gap_vs_solid_max', 'fact:solid_max_o2', 'fact:apollo-1_near_solid', 'fact:solid_test_o2_range', 'fact:solid_tests_above_25']
    : query.habitat_id === 'moon-base'
      ? ['fact:solid_test_o2_range', 'fact:moon-base_o2_min', `fact:${phase}_max_o2`, `fact:${query.habitat_id}_near_${phase}`, 'fact:solid_tests_above_25', 'fact:total_tests']
      : [
        'fact:solid_test_o2_range',
        `fact:${phase}_max_o2`,
        ...(query.habitat_id ? [`fact:${query.habitat_id}_near_${phase}`] : []),
        'fact:solid_tests_above_25',
        `fact:${phase}_test_count`,
        'fact:total_tests',
      ]
  const factByIdMap = new Map(findings.facts.map((fact) => [fact.id, fact]))
  const globalFacts = prioritizedFactIds.flatMap((id) => {
    const fact = factByIdMap.get(id)
    return fact ? [toEvidenceFact(fact, 2)] : []
  }).slice(0, 6)
  const presetPo2Fact = query.habitat_id ? factMap.get(`fact:${query.habitat_id}_o2_partial_pressure_vs_earth`) : undefined
  const selectedPo2Fact = presetPo2Fact ? toEvidenceFact(presetPo2Fact, 2) : o2PartialComparison
  const testById = new Map(tests.map((point) => [point.id, point]))
  const nearestTestIds = nearestEvidence.flatMap((fact) => typeof fact.test_id === 'string' ? [fact.test_id] : [])
  const selectedTestIds = new Set(nearestTestIds)
  const rankedIds = new Set(rankedInvestigations.map((item) => String(item.id)))
  const candidateTests = tests.filter((point) => measuredConditions(point) && point.fuel_phase === phase && rankedIds.has(point.investigation))
    .sort((left, right) => distance(left, query) - distance(right, query) || left.id.localeCompare(right.id))
  for (const point of candidateTests) {
    if (selectedTestIds.size >= 6) break
    selectedTestIds.add(point.id)
  }
  if (selectedTestIds.size < 6) {
    const fallbackTests = tests.filter((point) => hasConditions(point) && point.fuel_phase === phase)
      .sort((left, right) => distance(left, query) - distance(right, query) || left.id.localeCompare(right.id))
    for (const point of fallbackTests) {
      if (selectedTestIds.size >= 6) break
      selectedTestIds.add(point.id)
    }
  }
  const selectedTests = Array.from(selectedTestIds).slice(0, 6).flatMap((id) => {
    const test = testById.get(id)
    return test ? [test] : []
  })
  const makePackBase = () => ({
    query: outputQuery,
    habitat_reference: habitatReference ? { id: habitatReference.id, name: habitatReference.name, source: habitatReference.source } : null,
    methodology: { o2_window_pct: 5, pressure_window_psi: 2, distance_scale_o2_pct: 10, distance_scale_pressure_psi: 3 },
    coverage: Object.fromEntries(PHASES.map((candidate) => {
      const { n_near, n_near_incl_assumed, n_near_assumed_pressure, n_near_with_assumed_pressure, coverage: tier, coverage_tier_words, max_o2_tested, min_pressure_tested, measured_test_count } = coverage[candidate]
      return [candidate, { n_near, n_near_incl_assumed, n_near_assumed_pressure, n_near_with_assumed_pressure, coverage: tier, coverage_tier_words, max_o2_tested, min_pressure_tested, measured_test_count }]
    })) as Record<FuelPhase, CoverageEvidence>,
    nearest_tests: selectedTests.map((test) => ({ id: test.id, citation_key: test.id, investigation: test.investigation, acronym: test.acronym, material: test.material, phase: test.fuel_phase, configuration: test.configuration, o2_semantics: test.extra.o2_semantics === 'ambient' || test.extra.o2_semantics === 'burner_stream' ? test.extra.o2_semantics : null, o2_pct: test.o2_pct, pressure_psi: test.pressure_psi, o2_partial_psi: test.o2_partial_psi, flow_cm_s: test.flow_cm_s, outcome: test.outcome, quality: test.quality, source: { file: test.source.file, row: test.source.row }, distance: Math.round(distance(test, query) * 10000) / 10000 })),
    nearest_evidence_facts: nearestEvidence,
    o2_partial_comparison: selectedPo2Fact,
    relevant_trend_facts: selectedTrends,
    material_contrasts: selectedContrasts,
    ranked_investigations: rankedInvestigations.map((item) => ({ id: item.id, citation_key: item.citation_key, acronym: item.acronym, title: item.title, score: item.score, phase_factor: item.phase_factor, breakdown: item.breakdown, reason_facts: item.reason_facts })),
    global_facts: globalFacts,
  })
  const packBase = makePackBase()
  const allowedCitationKeys = Array.from(new Set([
    'query:conditions',
    ...PHASES.map((candidate) => `coverage:${candidate}`),
    ...selectedTests.map((test) => test.id),
    ...rankedInvestigations.map((item) => String(item.id)),
    ...globalFacts.map((fact) => String(fact.id)),
    ...nearestEvidence.map((fact) => String(fact.id)),
    selectedPo2Fact.id,
    ...selectedTrends.map((fact) => String(fact.id)),
    ...selectedContrasts.map((fact) => String(fact.id)),
  ]))
  const outputBase = { ...packBase, allowed_citation_keys: allowedCitationKeys }
  const numbers = Array.from(new Set(numericValues(outputBase).map((value) => Math.round(value * 100) / 100)))
  const output = { ...outputBase, numeric_values: numbers } as EvidencePack
  const estimatedTokens = Math.ceil(JSON.stringify(output).length / 3.5)
  if (estimatedTokens > 3500) throw new Error(`Evidence pack exceeds the 3,500-token compact limit (estimated ${estimatedTokens}).`)
  return output
}
