export type Outcome = 'burned' | 'self_extinguished' | 'no_ignition' | 'unknown'
export type FuelPhase = 'solid' | 'liquid' | 'gas'
export type QualityFlag = 'measured' | 'from_range' | 'assumed' | 'quiescent_chamber' | 'derived' | null

export interface TestPoint {
  id: string
  investigation: string
  acronym: string | null
  table_key: string
  test_label: string
  fuel_phase: FuelPhase | null
  configuration: string
  material: string | null
  o2_pct: number | null
  pressure_psi: number | null
  o2_partial_psi: number | null
  flow_cm_s: number | null
  diluent: 'N2' | 'He' | 'CO2' | 'mixed' | null
  outcome: Outcome
  outcome_raw: string
  metrics: Record<string, number | string | number[] | null>
  quality: {
    o2_pct: QualityFlag
    pressure_psi: QualityFlag
    flow_cm_s: QualityFlag
  }
  assumptions: string[]
  missing_reasons: Record<string, string>
  source_fields: Record<string, { column: string; raw_value: string | null }>
  source_warnings: string[]
  source: { file: string; row: number; rows?: number[] }
  doi: string | null
  psi_url: string
  extra: Record<string, unknown>
}

export interface Habitat {
  id: string
  name: string
  o2_pct: number | null
  pressure_psi: number | null
  source: string
  o2_min_pct?: number | null
  pressure_max_psi?: number | null
}

export interface Envelope {
  id: string
  investigation: string
  acronym: string | null
  fuel_phase: FuelPhase | null
  material: string | null
  o2_pct_values: number[] | null
  o2_pct_range: [number, number] | null
  pressure_psi_values: number[] | null
  pressure_psi_range: [number, number] | null
  flow_cm_s_values: number[] | null
  flow_cm_s_range: [number, number] | null
  count: number | null
  note: string | null
  missing_reasons: Record<string, string>
  source: { file: string; row: number }
  doi: string | null
  psi_url: string
  extra: Record<string, unknown>
}

export interface DetectionRecord {
  id: string
  investigation: string
  acronym: string | null
  test_label: string
  material: string | null
  flow_cm_s: number | null
  metrics: Record<string, number | string | number[] | null>
  note: string | null
  source: { file: string; row: number }
  doi: string | null
  psi_url: string
  [key: string]: unknown
}

export interface Investigation {
  id: string
  acronym: string | null
  title: string | null
  doi: string | null
  psi_url: string
  objective: string | null
  approach: string | null
  hypothesis: string | null
  research_impacts: string | null
  hardware: string | null
  hardware_suite?: string | null
  hardware_mapping_status?: 'mapped' | 'unmapped'
  experiment_geometry?: string | null
  start_date: string | null
  end_date: string | null
  related: string | null
  publications_count: number
  n_tests: number
  n_envelopes: number
  fuel_phases: FuelPhase[]
  o2_range: [number, number] | null
  pressure_range_psi: [number, number] | null
  flow_range_cm_s: [number, number] | null
  safety_tags: string[]
  missing_reasons: Record<string, string>
}

export interface CoveragePhase {
  n_near: number
  n_near_incl_assumed: number
  n_near_assumed_pressure: number
  n_near_with_assumed_pressure: number
  coverage: 'covered' | 'covered_assumed_pressure' | 'sparse' | 'none'
  nearest: Array<{ id: string; distance: number }>
  nearest_incl_assumed: Array<{ id: string; distance: number }>
  max_o2_tested: { value: number; test_id: string } | null
  min_pressure_tested: { value: number; test_id: string } | null
  measured_test_count: number
}

export interface FindingFact {
  id: string
  value: number | string | null
  unit: string
  support: string[]
  text: string
  [key: string]: unknown
}

export interface FindingsData {
  generated_at_utc: string
  summary: {
    total_tests: number
    total_investigations: number
    total_envelopes: number
    total_detection_records: number
  }
  coverage_by_habitat: Record<string, {
    name: string | null
    o2_pct: number
    pressure_psi: number
    phases: Record<FuelPhase, CoveragePhase>
  }>
  facts: FindingFact[]
  context_snippets?: Array<{
    id: string
    citation_key: string
    investigation_id: string
    text: string
    source_field: string
    support: string[]
  }>
  headline_fact_ids: string[]
  rankings: Array<{ habitat_id: string; phase: FuelPhase; pillar: string | null; items: unknown[] }>
}

export interface BriefingSentence {
  text: string
  cites: string[]
  unverified?: boolean
}

export interface Briefing {
  headline: string
  sentences: BriefingSentence[]
  gaps: string[]
  next_tests: Array<{
    material: string | null
    o2_pct: number | null
    pressure_psi: number | null
    flow_cm_s: number | null
    why: string
    cites: string[]
  }>
  confidence: { level: 'low' | 'medium' | 'high'; reason: string }
}

export interface BriefingResponse {
  query: {
    o2_pct: number
    pressure_psi: number
    flow_cm_s: number | null
    material: string | null
    phase: FuelPhase
    habitat_id: string | null
    o2_partial_psi: number
  }
  briefing: Briefing
  verification: {
    sentences_total: number
    sentences_kept: number
    citations_dropped: number
    numbers_unverified: number
  }
  provider: string
  model: string | null
  evidence_pack_hash: string
  generated_at: string
  cached?: boolean
}
