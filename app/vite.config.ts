import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { handleBriefingRequest } from './api/_lib/endpoint.ts'
import { handleParseRequest } from './api/_lib/parse.ts'

const repoRoot = resolve(process.cwd(), '..')

function localBriefingPlugin(): Plugin {
  return {
    name: 'fire-atlas-local-briefing',
    configResolved(config) {
      const values = loadEnv(config.mode, repoRoot, '')
      for (const name of ['GEMINI_API_KEY', 'GEMINI_MODEL', 'GEMINI_FALLBACK_MODEL', 'GEMINI_FALLBACK_MODEL_2', 'GROQ_API_KEY', 'GROQ_MODEL']) {
        if (process.env[name] === undefined && values[name] !== undefined) process.env[name] = values[name]
      }
    },
    configureServer(server) {
      const routes = [['/api/briefing', handleBriefingRequest], ['/api/parse-question', handleParseRequest]] as const
      for (const [route, handle] of routes) server.middlewares.use(route, (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'POST is required.' }))
          return
        }
        const chunks: Buffer[] = []
        let tooLarge = false
        req.on('data', (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          if (Buffer.concat(chunks).length + buffer.length > 1_000_000) {
            tooLarge = true
            return
          }
          chunks.push(buffer)
        })
        req.on('end', async () => {
          if (tooLarge) {
            res.statusCode = 413
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: 'Request body is too large.' }))
            return
          }
          let body: unknown = null
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
          } catch {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: 'Request body must be valid JSON.' }))
            return
          }
          const forwarded = req.headers['x-forwarded-for']
          const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0])?.trim() || req.socket.remoteAddress || 'local'
          const result = await handle(body, ip)
          res.statusCode = result.status
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(result.body))
        })
        req.on('error', (error) => next(error))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), localBriefingPlugin()],
  define: { global: 'globalThis' },
})
