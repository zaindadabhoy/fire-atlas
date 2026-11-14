import type { Briefing, BriefingSentence } from '../../src/types.ts'
import type { EvidencePack } from './evidence.ts'

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function readBriefingShape(value: unknown, fallback: Briefing): Briefing | null {
  const source = record(value)
  if (!source || !Array.isArray(source.sentences)) return null
  const confidence = record(source.confidence)
  const sentences: BriefingSentence[] = []
  for (const item of source.sentences.slice(0, 7)) {
    const sentence = record(item)
    if (!sentence || typeof sentence.text !== 'string' || !Array.isArray(sentence.cites)) continue
    const text = sentence.text.trim()
    if (!text || !sentence.cites.every((cite) => typeof cite === 'string')) continue
    sentences.push({ text, cites: sentence.cites as string[] })
  }
  const nextTests = (Array.isArray(source.next_tests) ? source.next_tests : []).flatMap((item) => {
    const next = record(item)
    if (!next) return []
    const validField = (field: string) => next[field] == null || typeof next[field] === 'number' && Number.isFinite(next[field])
    if (!validField('o2_pct') || !validField('pressure_psi') || !validField('flow_cm_s')) return []
    if (typeof next.why !== 'string' || !next.why.trim() || !Array.isArray(next.cites) || !next.cites.every((cite) => typeof cite === 'string')) return []
    return [{
      material: typeof next.material === 'string' ? next.material : null,
      o2_pct: next.o2_pct as number | null,
      pressure_psi: next.pressure_psi as number | null,
      flow_cm_s: next.flow_cm_s as number | null,
      why: next.why.trim(),
      cites: next.cites as string[],
    }]
  }).slice(0, 3)
  const sourceHeadline = typeof source.headline === 'string' ? source.headline.trim() : ''
  const genericHeadline = /^(fire safety|safety|habitat|material|briefing|analysis|assessment)(?:\s+(?:analysis|briefing|assessment|for|at)\b)/i.test(sourceHeadline)
    || /\b(?:analysis|briefing|assessment) for\b/i.test(sourceHeadline)
  const headline = sourceHeadline && sourceHeadline.split(/\s+/).length <= 20 && !genericHeadline && !hasUnsupportedRiskClaim(sourceHeadline)
    ? sourceHeadline : ''
  return {
    headline,
    sentences,
    gaps: (Array.isArray(source.gaps) ? source.gaps : []).filter((item): item is string => typeof item === 'string' && !!item.trim()).slice(0, 3),
    next_tests: nextTests,
    confidence: confidence && ['low', 'medium', 'high'].includes(String(confidence.level)) && typeof confidence.reason === 'string'
      ? { level: confidence.level as 'low' | 'medium' | 'high', reason: confidence.reason.trim() }
      : fallback.confidence,
  }
}

function extractNumbers(text: string): number[] {
  return Array.from(text.matchAll(/(?<![A-Za-z0-9])[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g), (match) => Number(match[0]))
}

function sentenceNumbers(text: string, cites: string[], identifiers: string[]): number[] {
  let clean = text
  for (const cite of cites) clean = clean.replaceAll(cite, ' ')
  for (const identifier of identifiers.filter(Boolean)) clean = clean.replaceAll(identifier, ' ')
  clean = clean.replace(/\[\s*PSI-\d+:[^\]]*\]/g, ' ').replace(/\bPSI-\d+\b/g, ' ')
  return extractNumbers(clean)
}

function numberIsPresent(number: number, values: number[]): boolean {
  return values.some((value) => Math.abs(value - number) <= 0.05)
}

export function headlineHasSupportedNumber(headline: string, evidence: EvidencePack): boolean {
  const habitatName = evidence.habitat_reference?.name ?? ''
  const identifiers = [evidence.query.material ?? '', habitatName, habitatName.replace(/\s*\([^)]*\)/g, '').trim()]
  const numbers = sentenceNumbers(headline, [], identifiers)
  return numbers.length > 0 && numbers.every((number) => numberIsPresent(number, evidence.numeric_values))
}

export function hasAssumedPressureDisclosure(briefing: Briefing): boolean {
  const firstSentence = briefing.sentences[0]?.text ?? ''
  const oxygenTested = /(?:oxygen|o₂).{0,100}(?:test|measur|record)/i.test(firstSentence)
    || /(?:test|measur|record).{0,100}(?:oxygen|o₂)/i.test(firstSentence)
  const pressureDisclosure = /pressure.{0,70}(?:did not record|not recorded|wasn't recorded|not measured|assumed|assumption)/i.test(firstSentence)
    || /(?:did not record|not recorded|wasn't recorded|not measured).{0,50}pressure/i.test(firstSentence)
  return /\bPSI\b/i.test(firstSentence) && oxygenTested && pressureDisclosure
}

function hasUnsupportedRiskClaim(text: string): boolean {
  return /\b(?:risk|probabilit\w*|likelihood|flammabilit\w*|flammable|combustib\w*|fire-resistant|flame-retardant|safety|hazard|sustained combustion)\b/i.test(text)
    || /\b(?:detection systems?|suppression strategies?).{0,50}\b(?:must|should|calibrat\w*|prioritiz\w*)/i.test(text)
    || /\bhigh sensitivity to material selection\b/i.test(text)
    || /\b(?:suggest(?:s|ing)?\s+(?:high|increased|elevated)|(?:significantly\s+)?increas(?:es|ing)\s+the\s+potential|potential\s+for\s+(?:rapid|more|increased|sustained)\s+(?:combustion|burning|ignition))\b/i.test(text)
    || /\b(?:material-specific\s+)?(?:burn|combustion|ignition)\s+(?:behavior|outcomes?).{0,80}\bsensitiv\w*\s+to\s+(?:oxygen|o₂)\s+(?:concentration|levels?|fraction)\b/i.test(text)
    || /\bsensitiv\w*.{0,80}\b(?:oxygen|o₂)\b|\b(?:oxygen|o₂)\b.{0,80}\bsensitiv\w*/i.test(text)
    || /\bsignificantly\s+(?:increas\w*|rais\w*|enhanc\w*|influenc\w*|affect\w*)\s+(?:(?:the|a)\s+)?(?:(?:oxygen|o₂)\s+)?(?:availability|potential|risk|likelihood|probability|outcomes?|burn\w*|combustion|ignition|flammabil\w*)\b/i.test(text)
    || /\b(?:increas\w*|rais\w*|enhanc\w*)\s+(?:(?:the|a)\s+)?(?:oxygen|o₂)\s+(?:availability|partial pressure)\s+(?:for|during)\s+(?:combustion|burn\w*|ignition)\b/i.test(text)
    || /\b(?:high|elevated|greater)\s+(?:oxygen|o₂)\s+(?:partial pressure|levels?|concentrations?)\b.{0,60}\b(?:fire|combustion|ignition|flammabil\w*|hazard|risk|probabilit\w*)\b/i.test(text)
    || /\b(?:suggest(?:s|ing)?|indicat(?:e|es|ing))\b.{0,80}\b(?:may|might|could|would)\s+(?:influenc\w*|affect\w*|increas\w*|rais\w*)\b/i.test(text)
    || /\b(?:influenc\w*|affect\w*)\s+(?:flame|fire|combustion|burn\w*|ignition)\s+(?:sustainability|risk|behavior|likelihood|probability)\b/i.test(text)
}

export function verifyBriefing(briefing: Briefing, evidence: EvidencePack) {
  const allowed = new Set(evidence.allowed_citation_keys)
  const habitatName = evidence.habitat_reference?.name ?? ''
  const identifiers = [
    evidence.query.material ?? '',
    habitatName,
    habitatName.replace(/\s*\([^)]*\)/g, '').trim(),
  ]
  let citationsDropped = 0
  let numbersUnverified = 0
  const sentences: BriefingSentence[] = []
  const queryCoverage = evidence.coverage[evidence.query.phase]
  const debug = (reason: string, text: string) => { if (process.env.SI_DEBUG) console.warn(`[verify] dropped (${reason}): ${text}`) }
  for (const sentence of briefing.sentences) {
    if (sentence.text.trim().split(/\s+/).length > 30) { debug('over 30 words', sentence.text); continue }
    if (queryCoverage.coverage !== 'none' && /\b(?:no\s+(?:PSI\s+)?(?:test-level\s+)?data|extrapolat\w*)\b/i.test(sentence.text)) continue
    if (hasUnsupportedRiskClaim(sentence.text)) { debug("risk claim", sentence.text); continue }
    const cites = sentence.cites.filter((cite) => {
      const valid = allowed.has(cite)
      if (!valid) citationsDropped += 1
      return valid
    })
    if (!cites.length) { debug("no valid citation", sentence.text); continue }
    const numbers = sentenceNumbers(sentence.text, cites, identifiers)
    const unsupported = numbers.filter((number) => !numberIsPresent(number, evidence.numeric_values))
    numbersUnverified += unsupported.length
    if (unsupported.length) { debug("unsupported numbers " + unsupported.join(","), sentence.text); continue }
    sentences.push({ ...sentence, cites })
  }
  const seenTests = new Set<string>()
  const gapCitationKeys = new Set([
    'coverage:solid', 'coverage:liquid', 'coverage:gas',
    ...evidence.nearest_evidence_facts.map((fact) => fact.id),
    ...evidence.material_contrasts.map((fact) => fact.id),
  ])
  const materialPhases = new Map<string, Set<string>>()
  for (const item of evidence.nearest_tests) {
    if (typeof item.material !== 'string' || typeof item.phase !== 'string') continue
    const key = item.material.trim().toLowerCase()
    const phases = materialPhases.get(key) ?? new Set<string>()
    phases.add(item.phase)
    materialPhases.set(key, phases)
  }
  for (const contrast of evidence.material_contrasts) {
    if (typeof contrast.fuel_phase !== 'string' || !contrast.material_outcomes || typeof contrast.material_outcomes !== 'object') continue
    for (const material of Object.keys(contrast.material_outcomes as Record<string, unknown>)) {
      const key = material.trim().toLowerCase()
      const phases = materialPhases.get(key) ?? new Set<string>()
      phases.add(contrast.fuel_phase)
      materialPhases.set(key, phases)
    }
  }
  const differentOutcomeClaimSupported = (testMaterial: string | null, cites: string[]) => {
    if (!testMaterial || !evidence.query.material) return false
    const contrast = evidence.material_contrasts.find((item) => item.fuel_phase === evidence.query.phase
      && cites.includes(item.id) && item.material_outcomes && typeof item.material_outcomes === 'object')
    if (!contrast) return false
    const outcomes = contrast.material_outcomes as Record<string, unknown>
    const lookup = (material: string) => Object.entries(outcomes).find(([name]) => name.toLowerCase() === material.trim().toLowerCase())?.[1]
    const selected = lookup(evidence.query.material)
    const proposed = lookup(testMaterial)
    if (!Array.isArray(selected) || !Array.isArray(proposed)) return false
    const selectedOutcomes = new Set(selected.map(String))
    return proposed.some((outcome) => ['burned', 'self_extinguished', 'no_ignition'].includes(String(outcome))
      && !selectedOutcomes.has(String(outcome)))
  }
  let nextTestCitationsDropped = 0
  const next_tests = briefing.next_tests.filter((test) => {
    const cites = test.cites.filter((cite) => {
      const valid = allowed.has(cite) && gapCitationKeys.has(cite)
      if (!valid) nextTestCitationsDropped += 1
      return valid
    })
    const signature = JSON.stringify([test.material?.toLowerCase() ?? null, test.o2_pct, test.pressure_psi, test.flow_cm_s])
    const unsupportedWhyNumbers = sentenceNumbers(test.why, cites, identifiers).filter((number) => !numberIsPresent(number, evidence.numeric_values))
    numbersUnverified += unsupportedWhyNumbers.length
    const materialPhaseSet = test.material ? materialPhases.get(test.material.trim().toLowerCase()) : undefined
    const crossPhaseMaterial = !!materialPhaseSet && materialPhaseSet.size > 0 && !materialPhaseSet.has(evidence.query.phase)
    const ungroundedAlternateMaterial = !!test.material
      && test.material.trim().toLowerCase() !== evidence.query.material?.trim().toLowerCase()
      && !materialPhaseSet?.has(evidence.query.phase)
    const alternateMaterial = !!test.material
      && test.material.trim().toLowerCase() !== evidence.query.material?.trim().toLowerCase()
    const alternateHasOutcomeContrast = !alternateMaterial || differentOutcomeClaimSupported(test.material, cites)
    const claimsDifferentOutcome = /different (?:reported )?outcome/i.test(test.why)
    if (!test.why.trim() || hasUnsupportedRiskClaim(test.why) || unsupportedWhyNumbers.length || !cites.length || seenTests.has(signature)
      || crossPhaseMaterial || ungroundedAlternateMaterial || alternateMaterial && !alternateHasOutcomeContrast
      || claimsDifferentOutcome && !differentOutcomeClaimSupported(test.material, cites)) return false
    seenTests.add(signature)
    test.cites = cites
    return true
  }).slice(0, 3)
  citationsDropped += nextTestCitationsDropped
  return {
    briefing: { ...briefing, sentences, next_tests },
    verification: {
      sentences_total: briefing.sentences.length,
      sentences_kept: sentences.length,
      citations_dropped: citationsDropped,
      numbers_unverified: numbersUnverified,
    },
  }
}
