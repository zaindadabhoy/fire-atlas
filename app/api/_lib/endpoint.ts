import type { FuelPhase } from '../../src/types.ts'
import { runBriefing } from './briefing.ts'
import type { BriefingQuery } from './evidence.ts'

export interface EndpointResult {
  status: number
  body: unknown
}

const PHASES = new Set<FuelPhase>(['solid', 'liquid', 'gas'])
const PILLARS = new Set(['prevention', 'detection', 'suppression'])
const rateWindow = 60_000
const requestLimit = 10
const requestsByIp = new Map<string, { started: number; count: number }>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function validNumber(value: unknown, min: number, max: number, inclusiveMin = true, inclusiveMax = false): value is number {
  return typeof value === 'number' && Number.isFinite(value)
    && (inclusiveMin ? value >= min : value > min)
    && (inclusiveMax ? value <= max : value < max)
}

function validateQuery(body: unknown): BriefingQuery | string {
  if (!isRecord(body)) return 'Request body must be a JSON object.'
  const nested = 'query' in body ? body.query : body
  if (!isRecord(nested)) return 'query must be an object.'
  if (!validNumber(nested.o2_pct, 0, 100, true, true)) return 'o2_pct must be between 0 and 100.'
  if (!validNumber(nested.pressure_psi, 0, 120, false)) return 'pressure_psi must be greater than 0 and less than 120 psi.'
  if (nested.flow_cm_s != null && !validNumber(nested.flow_cm_s, 0, 1000, true, true)) return 'flow_cm_s must be between 0 and 1000 cm/s or null.'
  if (nested.phase != null && !PHASES.has(nested.phase as FuelPhase)) return 'phase must be solid, liquid, or gas.'
  if (nested.pillar != null && !PILLARS.has(String(nested.pillar))) return 'pillar must be prevention, detection, or suppression.'
  if (nested.material != null && (typeof nested.material !== 'string' || nested.material.trim().length > 120)) return 'material must be text up to 120 characters or null.'
  if (nested.habitat_id != null && (typeof nested.habitat_id !== 'string' || nested.habitat_id.length > 80)) return 'habitat_id must be text up to 80 characters or null.'
  return {
    o2_pct: nested.o2_pct,
    pressure_psi: nested.pressure_psi,
    flow_cm_s: nested.flow_cm_s as number | null | undefined,
    material: nested.material as string | null | undefined,
    phase: nested.phase as FuelPhase | undefined,
    pillar: nested.pillar as 'prevention' | 'detection' | 'suppression' | null | undefined,
    habitat_id: nested.habitat_id as string | null | undefined,
  }
}

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const prior = requestsByIp.get(ip)
  if (!prior || now - prior.started >= rateWindow) {
    requestsByIp.set(ip, { started: now, count: 1 })
    return false
  }
  prior.count += 1
  return prior.count > requestLimit
}

export async function handleBriefingRequest(body: unknown, ip = 'local'): Promise<EndpointResult> {
  if (rateLimited(ip)) return { status: 429, body: { error: 'Soft rate limit reached. Try again in a minute.' } }
  const query = validateQuery(body)
  if (typeof query === 'string') return { status: 400, body: { error: query } }
  try {
    return { status: 200, body: await runBriefing(query) }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Briefing generation failed.'
    return { status: 500, body: { error: message } }
  }
}
