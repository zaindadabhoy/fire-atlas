// Deterministic interpreter for plain-English questions such as
// "Would Nomex burn in a lunar rover?" or "PMMA at 30% oxygen and 10 psi".
// Used directly in the browser as a fallback and on the server to check SI output.
import type { FuelPhase } from '../types.js'

export interface ParsedQuestion {
  o2_pct: number | null
  pressure_psi: number | null
  flow_cm_s: number | null
  material: string | null
  phase: FuelPhase | null
  habitat_id: string | null
  notes: string[]
}

export interface HabitatRef { id: string; name: string; o2_pct: number | null; pressure_psi: number | null }

const HABITAT_WORDS: Array<[RegExp, string]> = [
  [/\b(moon|lunar|rover|artemis base|moon ?base|gateway lander)\b/i, 'moon-base'],
  [/\bapollo\b/i, 'apollo-1'],
  [/\b(space ?suit|eva suit|eva\b|suit)\b/i, 'spacesuit'],
  [/\b(iss|space station|station)\b/i, 'iss'],
  [/\b(earth|sea level|on the ground|terrestrial)\b/i, 'earth-sea-level'],
]

/** Canonical material names; `catalog` match is attempted first so the app's own option label wins. */
const MATERIAL_WORDS: Array<[RegExp, string, FuelPhase]> = [
  [/\bnomex\b/i, 'Nomex', 'solid'],
  [/\b(pmma|acrylic|plexiglas+)\b/i, 'PMMA', 'solid'],
  [/\b(sibal|cotton)\b/i, 'SIBAL', 'solid'],
  [/\bsilicone\b/i, 'Silicone', 'solid'],
  [/\b(paraffin|wax)\b/i, 'paraffin wax', 'solid'],
  [/\bultem\b/i, 'ultem sheet', 'solid'],
  [/\b(kapton|teflon|ptfe|paper|foam|plastic|wire insulation|velcro|nylon|fabric|cloth|clothing|textile)\b/i, 'Other Solid', 'solid'],
  [/\bn-?heptane|\bheptane\b/i, 'heptane', 'liquid'],
  [/\bmethanol\b/i, 'Methanol', 'liquid'],
  [/\bethanol\b/i, 'Ethanol', 'liquid'],
  [/\b(n-?)?decane\b/i, 'decane', 'liquid'],
  [/\b(n-?)?dodecane\b/i, 'C12H26', 'liquid'],
  [/\b(iso-?octane|octane)\b/i, 'Other Droplet', 'liquid'],
  [/\b(droplet|fuel droplet|liquid fuel)\b/i, 'Other Droplet', 'liquid'],
  [/\bethylene\b/i, 'Ethylene', 'gas'],
  [/\bmethane\b/i, 'methane', 'gas'],
  [/\bpropane\b/i, 'propane', 'gas'],
  [/\bethane\b/i, 'ethane', 'gas'],
  [/\bpropylene\b/i, 'Propylene', 'gas'],
  [/\b(gas flame|gaseous fuel)\b/i, 'Other Gas', 'gas'],
]

const PRESSURE_UNITS: Array<[RegExp, number]> = [
  [/(\d+(?:\.\d+)?)\s*(?:psia|psi)\b/i, 1],
  [/(\d+(?:\.\d+)?)\s*kpa\b/i, 0.145038],
  [/(\d+(?:\.\d+)?)\s*atm\b/i, 14.6959],
  [/(\d+(?:\.\d+)?)\s*bar\b/i, 14.5038],
]

export function parseQuestionRules(question: string, habitats: HabitatRef[], catalog: string[] = []): ParsedQuestion {
  const text = question.slice(0, 400)
  const notes: string[] = []
  const result: ParsedQuestion = { o2_pct: null, pressure_psi: null, flow_cm_s: null, material: null, phase: null, habitat_id: null, notes }

  for (const [pattern, id] of HABITAT_WORDS) {
    if (pattern.test(text)) {
      const habitat = habitats.find((item) => item.id === id)
      if (habitat && habitat.o2_pct != null && habitat.pressure_psi != null) {
        result.habitat_id = id
        result.o2_pct = habitat.o2_pct
        result.pressure_psi = habitat.pressure_psi
        notes.push(`habitat "${habitat.name}"`)
      }
      break
    }
  }

  const o2 = text.match(/(\d+(?:\.\d+)?)\s*%\s*(?:o2|o₂|oxygen)?/i) ?? text.match(/(?:o2|o₂|oxygen)\D{0,12}(\d+(?:\.\d+)?)/i)
  if (o2) {
    const value = Number(o2[1])
    if (value > 0 && value <= 100) { result.o2_pct = value; result.habitat_id = null; notes.push(`O₂ ${value} %`) }
  }
  for (const [pattern, factor] of PRESSURE_UNITS) {
    const match = text.match(pattern)
    if (match) {
      const value = Math.round(Number(match[1]) * factor * 100) / 100
      if (value > 0 && value < 120) { result.pressure_psi = value; result.habitat_id = null; notes.push(`pressure ${value} psi`) }
      break
    }
  }
  const flow = text.match(/(\d+(?:\.\d+)?)\s*cm\/s/i)
  if (flow) { result.flow_cm_s = Number(flow[1]); notes.push(`flow ${result.flow_cm_s} cm/s`) }

  for (const [pattern, name, phase] of MATERIAL_WORDS) {
    if (pattern.test(text)) {
      const exact = catalog.find((item) => item === name) ?? catalog.find((item) => item.toLowerCase() === name.toLowerCase())
        ?? catalog.find((item) => pattern.test(item) && item.length < 40)
      result.material = exact ?? name
      result.phase = phase
      notes.push(`material ${result.material}`)
      break
    }
  }
  if (!result.phase) result.phase = 'solid'
  // A habitat with explicit numbers becomes a custom atmosphere; partially given numbers fall back to the habitat.
  if (result.o2_pct == null || result.pressure_psi == null) {
    const fallback = habitats.find((item) => item.id === 'moon-base')
    if (result.o2_pct == null && result.pressure_psi != null) { result.o2_pct = 20.9; notes.push('O₂ not stated; assumed 20.9 % (air)') }
    if (result.pressure_psi == null && result.o2_pct != null) { result.pressure_psi = 14.7; notes.push('pressure not stated; assumed 14.7 psi (sea level)') }
    if (result.o2_pct == null && result.pressure_psi == null && fallback) {
      result.habitat_id = 'moon-base'; result.o2_pct = fallback.o2_pct; result.pressure_psi = fallback.pressure_psi
      notes.push('no atmosphere stated; defaulted to the Moon base')
    }
  }
  return result
}

export function isCompleteQuestion(parsed: ParsedQuestion): boolean {
  return parsed.o2_pct != null && parsed.pressure_psi != null && parsed.phase != null
}
