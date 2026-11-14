import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Briefing, BriefingResponse } from '../../src/types.ts'
import { buildEvidencePack, type BriefingQuery, type EvidencePack } from './evidence.ts'
import { generateJSON, SI_TOTAL_BUDGET_MS, type GeneratedJSON } from './llm.ts'
import { hasAssumedPressureDisclosure, headlineHasSupportedNumber, readBriefingShape, verifyBriefing } from './verify.ts'

const API_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function factById(pack: EvidencePack, id: string) {
  return [
    ...pack.global_facts,
    ...pack.nearest_evidence_facts,
    pack.o2_partial_comparison,
    ...pack.relevant_trend_facts,
    ...pack.material_contrasts,
  ].find((item) => item.id === id)
}

function phaseName(phase: string): string {
  return phase === 'liquid' ? 'Droplet' : phase === 'solid' ? 'Solid' : 'Gas'
}

function nextTestRows(pack: EvidencePack) {
  const phase = pack.query.phase
  const gapFact = pack.nearest_evidence_facts.find((fact) => fact.phase === phase)
  const contrast = pack.material_contrasts.find((fact) => fact.fuel_phase === phase)
  const nearestTest = gapFact?.test_id ? pack.nearest_tests.find((item) => item.id === gapFact.test_id) : undefined
  const tests = [
    {
      material: pack.query.material,
      o2_pct: pack.query.o2_pct,
      pressure_psi: pack.query.pressure_psi,
      flow_cm_s: pack.query.flow_cm_s,
      why: `Measure the selected material at the target atmosphere to establish direct ${phaseName(phase)} coverage.`,
      cites: [`coverage:${phase}`],
    },
  ]
  const materialOutcomes = contrast?.material_outcomes && typeof contrast.material_outcomes === 'object'
    ? contrast.material_outcomes as Record<string, unknown> : {}
  const selectedOutcomes = Object.entries(materialOutcomes).find(([material]) => material.toLowerCase() === (pack.query.material ?? '').toLowerCase())?.[1]
  const selectedOutcomeSet = new Set(Array.isArray(selectedOutcomes) ? selectedOutcomes.map(String) : [])
  const alternateMaterial = Object.entries(materialOutcomes).find(([material, outcomes]) =>
    material.toLowerCase() !== (pack.query.material ?? '').toLowerCase()
    && Array.isArray(outcomes)
    && outcomes.some((outcome) => ['burned', 'self_extinguished', 'no_ignition'].includes(String(outcome)) && !selectedOutcomeSet.has(String(outcome))),
  )?.[0]
  const contrastFlow = Array.isArray(contrast?.flow_cm_s_range) ? Number(contrast.flow_cm_s_range[0]) : pack.query.flow_cm_s
  if (contrast && alternateMaterial) {
    tests.push({
      material: alternateMaterial,
      o2_pct: pack.query.o2_pct,
      pressure_psi: pack.query.pressure_psi,
      flow_cm_s: Number.isFinite(contrastFlow) ? contrastFlow : pack.query.flow_cm_s,
      why: `Compare ${alternateMaterial} with ${pack.query.material ?? 'the selected material'}; the cited ${phaseName(phase)} results include a different reported outcome.`,
      cites: [...new Set([gapFact?.id ?? `coverage:${phase}`, contrast?.id ?? `coverage:${phase}`])],
    })
  }
  if (gapFact?.test_id && nearestTest) {
    tests.push({
      material: pack.query.material,
      o2_pct: nearestTest.o2_pct as number,
      pressure_psi: nearestTest.pressure_psi as number,
      flow_cm_s: nearestTest.flow_cm_s as number | null,
      why: `Use the nearest ${phaseName(phase)} source condition as a reference while testing the target atmosphere.`,
      cites: [gapFact.id],
    })
  }
  const unique = new Map<string, (typeof tests)[number]>()
  for (const test of tests) {
    const signature = JSON.stringify([test.material, test.o2_pct, test.pressure_psi, test.flow_cm_s])
    if (!unique.has(signature)) unique.set(signature, test)
  }
  for (const reference of pack.nearest_tests) {
    if (unique.size >= 2) break
    if (typeof reference.o2_pct !== 'number' || typeof reference.pressure_psi !== 'number') continue
    const flow = typeof reference.flow_cm_s === 'number' ? reference.flow_cm_s : null
    const signature = JSON.stringify([pack.query.material?.toLowerCase() ?? null, reference.o2_pct, reference.pressure_psi, flow])
    if (!unique.has(signature)) unique.set(signature, {
      material: pack.query.material,
      o2_pct: reference.o2_pct,
      pressure_psi: reference.pressure_psi,
      flow_cm_s: flow,
      why: `Use this phase-matched ${phaseName(phase)} source condition as a reference when closing the target test gap.`,
      cites: [gapFact?.id ?? `coverage:${phase}`],
    })
  }
  return Array.from(unique.values()).slice(0, 3)
}

function computedBriefing(pack: EvidencePack): Briefing {
  const phase = pack.query.phase
  const name = phaseName(phase)
  const phaseCoverage = pack.coverage[phase]
  const nearestFact = pack.nearest_evidence_facts.find((item) => item.phase === phase)
  const maxO2 = factById(pack, `fact:${phase}_max_o2`)
  const solidRange = factById(pack, 'fact:solid_test_o2_range')
  const contrast = pack.material_contrasts.find((item) => item.fuel_phase === phase)
  const directTrend = pack.relevant_trend_facts.find((item) => item.fuel_phase === phase)
  const trend = directTrend ?? pack.relevant_trend_facts[0]
  const sentences: Briefing['sentences'] = []
  if (phaseCoverage.coverage === 'none') {
    sentences.push({
      text: `No PSI test-level data exists for the ${name} phase in this region, so this briefing is extrapolation.`,
      cites: [`coverage:${phase}`],
    })
  } else if (phaseCoverage.coverage === 'covered_assumed_pressure') {
    sentences.push({
      text: `${phaseCoverage.n_near_with_assumed_pressure} ${name} tests recorded O₂ near this query, but PSI did not record cabin pressure; 14.7 psi is a cabin-pressure assumption.`,
      cites: [`coverage:${phase}`],
    })
  } else {
    sentences.push({
      text: `${phaseCoverage.n_near} measured ${name} tests fall within the query window; use the phase-specific outcomes to set the next qualification test.`,
      cites: [`coverage:${phase}`],
    })
  }

  const pO2 = pack.o2_partial_comparison
  if (pO2.text) {
    sentences.push({
      text: fitSentence(pO2.text, 'qualify against both O₂ fraction and partial pressure.'),
      cites: [pO2.id, 'query:conditions'],
    })
  }

  if (phase === 'solid' && solidRange?.text) {
    sentences.push({
      text: fitSentence(solidRange.text, 'test at the target atmosphere before treating it as a cabin limit.'),
      cites: [solidRange.id],
    })
  } else if (maxO2?.text) {
    sentences.push({
      text: fitSentence(maxO2.text, 'do not transfer this maximum across fuel phases.'),
      cites: [maxO2.id],
    })
  }

  if (contrast) {
    sentences.push({
      text: fitSentence(contrastSentence(contrast as unknown as Record<string, unknown>), `qualify ${pack.query.material ?? 'each material'} separately.`),
      cites: [contrast.id],
    })
  }

  if (trend) {
    const indirect = trend.fuel_phase !== phase
    sentences.push({
      text: fitSentence(`${indirect ? 'Indirect: ' : ''}${String(trend.text)}`, 'a trend to prioritize tests, not a pass criterion.'),
      cites: [String(trend.id)],
    })
  }

  if (nearestFact?.text) {
    sentences.push({
      text: fitSentence(nearestFact.text, 'use it as the benchmark condition.'),
      cites: [nearestFact.id],
    })
  }
  const safeSentences = sentences.slice(0, 7)
  while (safeSentences.length < 5) {
    const fallback = pack.ranked_investigations[safeSentences.length - 1]
    if (fallback) safeSentences.push({ text: `${String(fallback.acronym ?? fallback.id)} is ranked for condition relevance; use its source rows to choose the next test configuration.`, cites: [String(fallback.id)] })
    else safeSentences.push({ text: `Run a material-specific test at the requested atmosphere before extending the evidence to this habitat.`, cites: ['query:conditions'] })
  }
  const habitatLabel = pack.habitat_reference?.name.toLowerCase().includes('iss')
    ? 'ISS air'
    : pack.habitat_reference?.name.toLowerCase().includes('earth')
      ? 'Earth sea-level air'
      : pack.habitat_reference?.name ? `${pack.habitat_reference.name} atmosphere` : 'cabin air'
  const apolloRatio = factById(pack, 'fact:apollo-1_o2_partial_pressure_ratio_vs_earth')
  const apolloGap = factById(pack, 'fact:apollo-1_o2_gap_vs_solid_max')
  const headline = pack.query.habitat_id === 'apollo-1' && phase === 'solid' && typeof apolloRatio?.value === 'number' && typeof apolloGap?.value === 'number'
    ? `Apollo 1's cabin had ${apolloRatio.value.toFixed(2)}× Earth's O₂ partial pressure; no PSI solid test came within ${apolloGap.value.toFixed(1)} points of its O₂.`
    : pack.query.habitat_id === 'moon-base' && phase === 'solid' && typeof maxO2?.value === 'number'
      ? `No solid material in PSI was tested above ${maxO2.value.toFixed(1)} % O₂ — the Moon base runs at ${pack.query.o2_pct.toFixed(0)} %.`
      : phaseCoverage.coverage === 'covered_assumed_pressure'
        ? `${phaseCoverage.n_near_with_assumed_pressure} ${name} tests near ${habitatLabel}; cabin pressure assumed`
        : phaseCoverage.coverage === 'none'
          ? `No measured ${name} evidence at ${pack.query.o2_pct.toFixed(1)} % O₂ and ${pack.query.pressure_psi.toFixed(1)} psi`
          : `${phaseCoverage.n_near} ${name} tests support targeted follow-up at this condition`
  return {
    headline,
    sentences: safeSentences,
    gaps: phaseCoverage.coverage === 'none'
      ? [`No measured ${name} tests fall within ±5 % O₂ and ±2 psi of this query.`, 'Assumed condition values do not replace measured pressure.']
      : phaseCoverage.coverage === 'covered_assumed_pressure'
        ? ['Near-condition pressure is based on assumed 14.7 psi cabin pressure.', `A targeted test is needed to measure ${name} outcomes at the specified pressure.`]
        : ['Material-specific outcomes and ventilation response remain bounded by the cited test conditions.'],
    next_tests: nextTestRows(pack),
    confidence: {
      level: phaseCoverage.coverage === 'none' ? 'low' : phaseCoverage.coverage === 'sparse' || phaseCoverage.coverage === 'covered_assumed_pressure' ? 'medium' : 'high',
      reason: phaseCoverage.coverage === 'none'
        ? 'No measured condition pair falls within the defined query window.'
        : phaseCoverage.coverage === 'covered_assumed_pressure'
          ? `${phaseCoverage.n_near_with_assumed_pressure} points meet the window only after including assumed cabin pressure.`
          : `${phaseCoverage.n_near} measured points meet the query window definition.`,
    },
  }
}

function evidenceHash(pack: EvidencePack): string {
  return createHash('sha256').update(JSON.stringify(pack)).digest('hex')
}

const wordCount = (text: string) => text.trim().split(/\s+/).length
/** Append an engineering tail only when the sentence stays within the verifier's 30-word limit. */
function fitSentence(base: string, tail: string): string {
  const core = base.trim().replace(/\.$/, '')
  const full = `${core}; ${tail}`
  return wordCount(full) <= 30 ? full : `${core}.`
}
const OUTCOME_WORDS: Record<string, string> = { burned: 'burned', self_extinguished: 'self-extinguished', no_ignition: 'did not ignite', unknown: 'had no recorded outcome' }
function listJoin(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
/** Compact material-contrast sentence: groups materials by outcome so it fits in 30 words. */
function contrastSentence(contrast: Record<string, unknown>): string {
  const outcomes = contrast.material_outcomes as Record<string, string[]> | undefined
  const o2 = contrast.o2_pct_range as number[] | undefined
  const flow = contrast.flow_cm_s_range as number[] | undefined
  if (!outcomes || !o2?.length) return String(contrast.text ?? '')
  const byOutcome = new Map<string, string[]>()
  for (const [material, values] of Object.entries(outcomes)) {
    const key = values[0] ?? 'unknown'
    byOutcome.set(key, [...(byOutcome.get(key) ?? []), material])
  }
  const parts = [...byOutcome.entries()].map(([outcome, materials]) => `${listJoin(materials)} ${OUTCOME_WORDS[outcome] ?? outcome}`)
  const flowText = flow?.length ? ` and ${flow[flow.length - 1].toFixed(0)} cm/s` : ''
  return `At ${o2[o2.length - 1].toFixed(1)} % O₂${flowText} (${String(contrast.investigation_id ?? '')}), ${parts.join('; ')}.`
}

export async function runBriefing(input: BriefingQuery): Promise<BriefingResponse> {
  const pack = await buildEvidencePack(input)
  const hash = evidenceHash(pack)
  const system = await readFile(resolve(API_DIR, 'prompts/briefing.system.txt'), 'utf8')
  const userTemplate = await readFile(resolve(API_DIR, 'prompts/briefing.user.txt'), 'utf8')
  const user = userTemplate.replace('{{EVIDENCE_PACK}}', JSON.stringify(pack))
  const computed = computedBriefing(pack)
  let provider = 'computed'
  let model: string | null = null
  let result = verifyBriefing(computed, pack)
  const excludedCandidates: string[] = []
  const deadline = Date.now() + SI_TOTAL_BUDGET_MS

  while (excludedCandidates.length < 4) {
    let generated: GeneratedJSON
    try {
      generated = await generateJSON(system, user, excludedCandidates, deadline)
    } catch {
      // Keep trying the evidence-only path if no configured provider can respond.
      break
    }
    excludedCandidates.push(`${generated.provider}/${generated.model}`)
    const parsed = readBriefingShape(generated.json, computed)
    if (!parsed) continue
    if (!headlineHasSupportedNumber(parsed.headline, pack)) {
      console.warn(`[SI] discarded ${generated.provider}/${generated.model} headline without a supported finding number.`)
      continue
    }
    const coverageLead = computed.sentences[0]
    const normalized = coverageLead ? { ...parsed, sentences: [coverageLead, ...parsed.sentences.slice(1)] } : parsed
    const candidate = verifyBriefing(normalized, pack)
    const assumedPressureNeedsDisclosure = pack.coverage[pack.query.phase].coverage === 'covered_assumed_pressure'
    if (candidate.verification.sentences_kept < 4 || assumedPressureNeedsDisclosure && !hasAssumedPressureDisclosure(candidate.briefing)) {
      console.warn(`[SI] discarded ${generated.provider}/${generated.model} answer after verification (${candidate.verification.sentences_kept} valid sentences).`)
      continue
    }
    provider = generated.provider
    model = generated.model
    const accepted: Briefing = {
      ...candidate.briefing,
      gaps: candidate.briefing.gaps.length ? candidate.briefing.gaps : computed.gaps,
      next_tests: candidate.briefing.next_tests.length >= 2 ? candidate.briefing.next_tests : computed.next_tests,
    }
    result = verifyBriefing(accepted, pack)
    break
  }
  if (pack.coverage[pack.query.phase].coverage === 'covered_assumed_pressure') {
    result.briefing.headline = computed.headline
    result.briefing.confidence = { ...result.briefing.confidence, level: 'medium' }
  } else if (pack.coverage[pack.query.phase].coverage === 'none') {
    result.briefing.confidence = { ...result.briefing.confidence, level: 'low' }
  }
  if (pack.query.phase === 'solid' && ['moon-base', 'apollo-1'].includes(pack.query.habitat_id ?? '')) {
    result.briefing.headline = computed.headline
  }
  console.info(`[SI] briefing provider: ${provider}${model ? `/${model}` : ''}; citations dropped: ${result.verification.citations_dropped}; unverified numbers: ${result.verification.numbers_unverified}`)
  return {
    query: pack.query,
    briefing: result.briefing,
    verification: result.verification,
    provider,
    model,
    evidence_pack_hash: hash,
    generated_at: new Date().toISOString(),
  }
}
