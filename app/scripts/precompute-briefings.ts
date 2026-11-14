import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { runBriefing } from '../api/_lib/briefing.ts'
import type { FuelPhase, Habitat } from '../src/types.ts'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = resolve(APP_ROOT, '..')
const OUTPUT_DIR = resolve(APP_ROOT, 'public/data/briefings')
const HABITATS_PATH = resolve(APP_ROOT, 'public/data/habitats.json')
const PRESET_DELAY_MS = 8_000

const DEFAULT_PHASES: Record<string, FuelPhase> = {
  'earth-sea-level': 'solid',
  iss: 'solid',
  spacesuit: 'solid',
  'moon-base': 'solid',
  'apollo-1': 'solid',
}

function loadServerEnvironment(): void {
  const values = loadEnv('development', REPO_ROOT, '')
  for (const name of ['GEMINI_API_KEY', 'GEMINI_MODEL', 'GEMINI_FALLBACK_MODEL', 'GEMINI_FALLBACK_MODEL_2', 'GROQ_API_KEY', 'GROQ_MODEL']) {
    if (process.env[name] === undefined && values[name] !== undefined) process.env[name] = values[name]
  }
}

async function main(): Promise<void> {
  loadServerEnvironment()
  const habitats = JSON.parse(await (await import('node:fs/promises')).readFile(HABITATS_PATH, 'utf8')) as Habitat[]
  const work: Array<{ habitat: Habitat; phase: FuelPhase }> = []
  for (const habitat of habitats) {
    if (habitat.o2_pct == null || habitat.pressure_psi == null) continue
    const phase = DEFAULT_PHASES[habitat.id]
    if (phase) work.push({ habitat, phase })
  }
  await mkdir(OUTPUT_DIR, { recursive: true })
  for (const [index, { habitat, phase }] of work.entries()) {
    const response = await runBriefing({
      o2_pct: habitat.o2_pct!,
      pressure_psi: habitat.pressure_psi!,
      material: phase === 'solid' ? 'PMMA' : 'heptane',
      phase,
      habitat_id: habitat.id,
      flow_cm_s: null,
    })
    const output = { ...response, cached: true }
    const destination = resolve(OUTPUT_DIR, `${habitat.id}-${phase}.json`)
    await writeFile(destination, JSON.stringify(output, null, 2) + '\n', 'utf8')
    console.log(`Cache ${index + 1}/${work.length} ${habitat.id}/${phase}: provider=${response.provider}; model=${response.model ?? 'none'}; headline=${response.briefing.headline}; verified=${response.verification.sentences_kept}/${response.verification.sentences_total}.`)
    if (index < work.length - 1) await new Promise((resolveDelay) => setTimeout(resolveDelay, PRESET_DELAY_MS))
  }
  console.log(`Wrote ${work.length} preset briefings to ${OUTPUT_DIR}.`)
}

await main()
