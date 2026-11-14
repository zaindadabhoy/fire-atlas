import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseQuestionRules, type HabitatRef, type ParsedQuestion } from '../../src/lib/parseQuestion.ts'
import type { FuelPhase } from '../../src/types.ts'
import { generateJSON } from './llm.ts'
import type { EndpointResult } from './endpoint.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(HERE, '../../public/data')
const PROMPT = resolve(HERE, '../prompts/parse.system.txt')
const PARSE_BUDGET_MS = 4_500
const PHASES = new Set<FuelPhase>(['solid', 'liquid', 'gas'])

let cache: { habitats: HabitatRef[]; catalog: string[] } | null = null
async function reference() {
  if (cache) return cache
  const habitats = JSON.parse(await readFile(resolve(DATA_DIR, 'habitats.json'), 'utf8')) as HabitatRef[]
  const tests = JSON.parse(await readFile(resolve(DATA_DIR, 'tests.json'), 'utf8')) as Array<{ material?: string | null }>
  const catalog = [...new Set(tests.map((test) => test.material?.trim()).filter((value): value is string => !!value))]
  cache = { habitats, catalog }
  return cache
}

const requests = new Map<string, { started: number; count: number }>()
function rateLimited(ip: string): boolean {
  const now = Date.now()
  const prior = requests.get(ip)
  if (!prior || now - prior.started > 60_000) { requests.set(ip, { started: now, count: 1 }); return false }
  prior.count += 1
  return prior.count > 15
}

function num(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > min && value <= max ? value : null
}

/** Merge an SI interpretation onto the rule-based one; anything invalid from the SI is ignored. */
function mergeSi(raw: unknown, rules: ParsedQuestion, habitats: HabitatRef[], catalog: string[]): ParsedQuestion | null {
  if (!raw || typeof raw !== 'object') return null
  const si = raw as Record<string, unknown>
  const out: ParsedQuestion = { ...rules, notes: [] }
  const habitat = typeof si.habitat_id === 'string' ? habitats.find((item) => item.id === si.habitat_id) : undefined
  if (habitat && habitat.o2_pct != null && habitat.pressure_psi != null) {
    out.habitat_id = habitat.id; out.o2_pct = habitat.o2_pct; out.pressure_psi = habitat.pressure_psi
    out.notes.push(`habitat "${habitat.name}"`)
  }
  const o2 = num(si.o2_pct, 0, 100)
  const pressure = num(si.pressure_psi, 0, 119.9)
  if (o2 != null) { out.o2_pct = o2; out.habitat_id = null; out.notes.push(`O₂ ${o2} %`) }
  if (pressure != null) { out.pressure_psi = Math.round(pressure * 100) / 100; out.habitat_id = null; out.notes.push(`pressure ${out.pressure_psi} psi`) }
  const flow = num(si.flow_cm_s, -0.0001, 1000)
  if (flow != null) out.flow_cm_s = flow
  if (typeof si.material === 'string' && si.material.trim()) {
    // canonicalize through the same keyword table so the material matches the app's catalog
    const canonical = parseQuestionRules(si.material, habitats, catalog)
    out.material = canonical.material ?? si.material.trim().slice(0, 60)
    out.phase = canonical.material ? canonical.phase : out.phase
    out.notes.push(`material ${out.material}`)
  }
  if (typeof si.phase === 'string' && PHASES.has(si.phase as FuelPhase) && !out.material) out.phase = si.phase as FuelPhase
  if (out.o2_pct == null || out.pressure_psi == null) return null
  return out
}

export async function handleParseRequest(body: unknown, ip = 'local'): Promise<EndpointResult> {
  if (rateLimited(ip)) return { status: 429, body: { error: 'Too many questions; try again in a minute.' } }
  const question = body && typeof body === 'object' && typeof (body as Record<string, unknown>).question === 'string'
    ? ((body as Record<string, unknown>).question as string).trim() : ''
  if (!question || question.length > 300) return { status: 400, body: { error: 'Ask a question of 1–300 characters.' } }
  const { habitats, catalog } = await reference()
  const rules = parseQuestionRules(question, habitats, catalog)
  try {
    const system = await readFile(PROMPT, 'utf8')
    const generated = await generateJSON(system, `Question: ${JSON.stringify(question)}`, [], Date.now() + PARSE_BUDGET_MS)
    const merged = mergeSi(generated.json, rules, habitats, catalog)
    if (merged) return { status: 200, body: { parsed: merged, source: 'si', provider: generated.provider, model: generated.model } }
  } catch {
    // fall through to the deterministic interpretation
  }
  return { status: 200, body: { parsed: rules, source: 'rules', provider: null, model: null } }
}
