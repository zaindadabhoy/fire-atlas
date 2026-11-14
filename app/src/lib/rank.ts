import type { FuelPhase, Investigation, TestPoint } from '../types.js'

export type SafetyPillar = 'prevention' | 'detection' | 'suppression'

export interface RankReason {
  text: string
  cites: string[]
}

export interface RankedInvestigation {
  id: string
  acronym: string | null
  title: string | null
  rank: number
  score: number
  breakdown: {
    condition_proximity: number
    phase_match: number
    pillar_match: number
    data_richness: number
  }
  reason_facts: RankReason[]
  n_measured_tests: number
  proximity_share: number
  phase_factor: number
  phase_match_value: boolean
  pillar_match_value: boolean
}

export interface RankQuery {
  o2_pct: number
  pressure_psi: number
  phase?: FuelPhase | null
  pillar?: SafetyPillar | null
}

function measuredConditions(point: TestPoint): boolean {
  return point.o2_pct != null && point.pressure_psi != null
    && point.quality.o2_pct === 'measured' && point.quality.pressure_psi === 'measured'
}

function distance(point: TestPoint, query: RankQuery): number {
  return Math.sqrt(((point.o2_pct! - query.o2_pct) / 10) ** 2 + ((point.pressure_psi! - query.pressure_psi) / 3) ** 2)
}

function insideWindow(point: TestPoint, query: RankQuery): boolean {
  return point.o2_pct != null && point.pressure_psi != null
    && Math.abs(point.o2_pct - query.o2_pct) <= 5
    && Math.abs(point.pressure_psi - query.pressure_psi) <= 2
}

function phaseName(phase: FuelPhase): string {
  return phase === 'liquid' ? 'Droplet' : phase === 'solid' ? 'Solid' : 'Gas'
}

export function rankInvestigations(
  query: RankQuery,
  tests: TestPoint[],
  investigations: Investigation[],
  limit = 8,
): RankedInvestigation[] {
  const measuredByInvestigation = new Map<string, TestPoint[]>()
  const knownByInvestigation = new Map<string, TestPoint[]>()
  const countByInvestigation = new Map<string, number>()
  const phasesByInvestigation = new Map<string, Set<FuelPhase>>()
  for (const point of tests) {
    countByInvestigation.set(point.investigation, (countByInvestigation.get(point.investigation) ?? 0) + 1)
    if (measuredConditions(point)) {
      measuredByInvestigation.set(point.investigation, [...(measuredByInvestigation.get(point.investigation) ?? []), point])
    }
    if (point.o2_pct != null && point.pressure_psi != null) {
      knownByInvestigation.set(point.investigation, [...(knownByInvestigation.get(point.investigation) ?? []), point])
    }
    if (point.fuel_phase) {
      const phases = phasesByInvestigation.get(point.investigation) ?? new Set<FuelPhase>()
      phases.add(point.fuel_phase)
      phasesByInvestigation.set(point.investigation, phases)
    }
  }
  // Assumed coordinates (e.g. unrecorded cabin pressure) still say where an investigation tested,
  // but count for less than measured ones.
  const ASSUMED_WEIGHT = 0.6
  const richnessMax = Math.max(0, ...countByInvestigation.values())
  const results = investigations.map((investigation) => {
    const measured = measuredByInvestigation.get(investigation.id) ?? []
    const usingAssumed = measured.length === 0
    const pool = usingAssumed ? (knownByInvestigation.get(investigation.id) ?? []) : measured
    const weight = usingAssumed ? ASSUMED_WEIGHT : 1
    const label = usingAssumed ? 'test points (assumed coordinates)' : 'measured test points'
    const within = pool.filter((point) => insideWindow(point, query))
    const nearest = [...pool].sort((left, right) => distance(left, query) - distance(right, query) || left.id.localeCompare(right.id))
    let proximity = 0
    let conditionText = 'No test-level O₂ and pressure pair is available for condition proximity.'
    let conditionCites = [investigation.id]
    if (within.length > 0) {
      proximity = (within.length / pool.length) * weight
      conditionText = `${within.length} of ${pool.length} ${label} fall within the query window.`
      conditionCites = within.slice(0, 5).map((point) => point.id)
    } else if (nearest.length > 0) {
      const dMin = distance(nearest[0], query)
      proximity = Math.exp(-dMin) * weight
      conditionText = `No ${label.replace(' points', '')} in the query window; nearest is ${nearest[0].o2_pct?.toFixed(1)} % O₂ at ${nearest[0].pressure_psi?.toFixed(1)} psi.`
      conditionCites = [nearest[0].id]
    }

    const phases = new Set<FuelPhase>([
      ...investigation.fuel_phases,
      ...(phasesByInvestigation.get(investigation.id) ?? []),
    ])
    const phaseMatch = query.phase != null && phases.has(query.phase) ? 1 : 0
    const phaseFactor = query.phase == null || phaseMatch ? 1 : 0.4
    const tags = investigation.safety_tags
    const pillarMatch = query.pillar != null && tags.includes(query.pillar) ? 1 : 0
    const nTests = countByInvestigation.get(investigation.id) ?? 0
    const richness = richnessMax > 0 ? Math.log1p(nTests) / Math.log1p(richnessMax) : 0
    const breakdown = {
      condition_proximity: Math.round(45 * proximity * phaseFactor * 100) / 100,
      phase_match: 25 * phaseMatch,
      pillar_match: 20 * pillarMatch,
      data_richness: Math.round(10 * richness * 100) / 100,
    }
    const reasons: RankReason[] = [{ text: conditionText, cites: conditionCites }]
    if (query.phase) {
      reasons.push({
        text: phaseMatch ? `Has tests in the ${phaseName(query.phase)} phase.` : `No tests in the ${phaseName(query.phase)} phase are listed.`,
        cites: [investigation.id],
      })
    }
    if (query.pillar) {
      reasons.push({
        text: pillarMatch ? `Tagged for ${query.pillar}.` : `Not tagged for ${query.pillar}.`,
        cites: [investigation.id],
      })
    }
    reasons.push({ text: `${nTests} test points (${measured.length} with measured O₂ and pressure) contribute to data richness.`, cites: [investigation.id] })
    const score = Math.round(Object.values(breakdown).reduce((sum, value) => sum + value, 0) * 100) / 100
    return {
      id: investigation.id,
      acronym: investigation.acronym,
      title: investigation.title,
      rank: 0,
      score,
      breakdown,
      reason_facts: reasons,
      n_measured_tests: measured.length,
      proximity_share: Math.round(proximity * 10000) / 10000,
      phase_factor: phaseFactor,
      phase_match_value: Boolean(phaseMatch),
      pillar_match_value: Boolean(pillarMatch),
    }
  })
  return results
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, limit)
    .map((item, index) => ({ ...item, rank: index + 1 }))
}
