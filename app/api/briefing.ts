import { handleBriefingRequest } from './_lib/endpoint.ts'

export const config = { runtime: 'nodejs' }

interface ApiRequest {
  method?: string
  body?: unknown
  headers?: Record<string, string | string[] | undefined>
  socket?: { remoteAddress?: string }
}

interface ApiResponse {
  status(code: number): ApiResponse
  json(value: unknown): void
}

function parseBody(body: unknown): unknown {
  if (typeof body !== 'string') return body
  try {
    return JSON.parse(body) as unknown
  } catch {
    return null
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST is required.' })
    return
  }
  const forwarded = req.headers?.['x-forwarded-for']
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0])?.trim() || req.socket?.remoteAddress || 'unknown'
  const result = await handleBriefingRequest(parseBody(req.body), ip)
  res.status(result.status).json(result.body)
}
