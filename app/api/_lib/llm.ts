type ProviderName = 'gemini' | 'groq'

export interface GeneratedJSON {
  json: unknown
  provider: ProviderName
  model: string
}

interface ProviderConfig {
  provider: ProviderName
  model: string | undefined
  key: string | undefined
}

class ProviderError extends Error {
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ProviderError'
    this.status = status
  }
}

const CALL_TIMEOUT_MS = 12_000
/** Whole-request SI budget across every provider attempt; after it, the caller falls back to computed facts. */
export const SI_TOTAL_BUDGET_MS = 20_000
const MIN_USEFUL_MS = 3_000
const RETRY_DELAY_MS = 300
const QUOTA_COOLDOWN_MS = 10 * 60_000
const quotaCooldowns = new Map<string, number>()

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseJSON(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(trimmed) as unknown
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function requestJSON<T>(provider: ProviderName, model: string, url: string, init: RequestInit, extract: (body: T) => string, deadline: number): Promise<GeneratedJSON> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await wait(RETRY_DELAY_MS)
    const remaining = deadline - Date.now()
    if (remaining < MIN_USEFUL_MS) throw new ProviderError(`${provider} skipped: SI time budget used up.`)
    let response: Response
    try {
      response = await fetchWithTimeout(url, init, Math.min(CALL_TIMEOUT_MS, remaining))
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // A slow model is not retried; the next candidate gets the remaining budget.
        throw new ProviderError(`${provider} request timed out.`)
      }
      throw new ProviderError(`${provider} request failed.`)
    }
    if (!response.ok) {
      const message = `${provider} returned HTTP ${response.status}.`
      if ([500, 503].includes(response.status) && attempt === 0) continue
      throw new ProviderError(message, response.status)
    }
    const body = await response.json() as T
    try {
      return { json: parseJSON(extract(body)), provider, model }
    } catch {
      throw new ProviderError(`${provider} returned invalid JSON.`)
    }
  }
  throw new ProviderError(`${provider} request failed after a temporary retry.`)
}

async function callGemini(config: ProviderConfig, system: string, user: string, deadline: number): Promise<GeneratedJSON> {
  const model = config.model!
  return requestJSON('gemini', model, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.key! },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 1200 },
    }),
  }, (body) => {
    const data = body as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    return data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim() ?? ''
  }, deadline)
}

async function callGroq(config: ProviderConfig, system: string, user: string, deadline: number): Promise<GeneratedJSON> {
  const model = config.model!
  return requestJSON('groq', model, 'https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key!}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  }, (body) => {
    const data = body as { choices?: Array<{ message?: { content?: string } }> }
    return data.choices?.[0]?.message?.content ?? ''
  }, deadline)
}

function isCoolingDown(key: string, now: number): boolean {
  const until = quotaCooldowns.get(key)
  if (until == null) return false
  if (until > now) return true
  quotaCooldowns.delete(key)
  return false
}

export async function generateJSON(system: string, user: string, excludedCandidates: string[] = [], deadline = Date.now() + SI_TOTAL_BUDGET_MS): Promise<GeneratedJSON> {
  const providers: ProviderConfig[] = [
    { provider: 'gemini', model: process.env.GEMINI_MODEL, key: process.env.GEMINI_API_KEY },
    { provider: 'gemini', model: process.env.GEMINI_FALLBACK_MODEL, key: process.env.GEMINI_API_KEY },
    { provider: 'gemini', model: process.env.GEMINI_FALLBACK_MODEL_2?.trim() || 'gemini-flash-lite-latest', key: process.env.GEMINI_API_KEY },
    { provider: 'groq', model: process.env.GROQ_MODEL, key: process.env.GROQ_API_KEY },
  ]
  const errors: string[] = []
  const excluded = new Set(excludedCandidates)
  const visited = new Set<string>()
  for (const config of providers) {
    const model = config.model?.trim()
    const key = config.key?.trim()
    if (!model || !key) continue
    const candidate = `${config.provider}/${model}`
    if (excluded.has(candidate) || visited.has(candidate)) continue
    visited.add(candidate)
    if (deadline - Date.now() < MIN_USEFUL_MS) {
      errors.push(`${candidate}: skipped, SI time budget used up.`)
      break
    }
    if (isCoolingDown(candidate, Date.now())) {
      errors.push(`${candidate}: cooling down after HTTP 429.`)
      continue
    }
    try {
      return config.provider === 'gemini'
        ? await callGemini({ ...config, model, key }, system, user, deadline)
        : await callGroq({ ...config, model, key }, system, user, deadline)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'provider failure'
      if (error instanceof ProviderError && error.status === 429) quotaCooldowns.set(candidate, Date.now() + QUOTA_COOLDOWN_MS)
      errors.push(`${candidate}: ${message}`)
      console.warn(`[SI] ${config.provider} ${model} unavailable: ${message}`)
    }
  }
  throw new Error(errors.length ? errors.join('; ') : 'No configured SI provider is available.')
}
