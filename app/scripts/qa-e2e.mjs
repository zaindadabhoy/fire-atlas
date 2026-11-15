// End-to-end QA: clicks through every feature at desktop and phone widths and fails on any
// console error, failed request, horizontal overflow, or missing UI state.
// Usage (app/):  node scripts/qa-e2e.mjs http://localhost:5173   (optional: CHROME_PATH=/path/to/chrome)
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:5176'
const results = []
const failures = []
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failures.push(name) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function run(viewport, label) {
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
  const errors = []
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource: net::ERR_FAILED/.test(msg.text())) errors.push(msg.text()) })
  page.on('pageerror', (err) => errors.push(String(err)))
  page.on('requestfailed', (req) => { if (!req.url().includes('fonts.g') && !req.url().includes('/api/parse-question')) errors.push(`requestfailed ${req.url()}`) })
  page.on('response', (res) => { if (res.status() >= 400 && !res.url().includes('/api/')) errors.push(`HTTP ${res.status()} ${res.url()}`) })

  // Landing: 3D scene + entry into the atlas
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await sleep(2500)
  const canvas = await page.locator('.landing-canvas canvas').count()
  check(`${label}: landing 3D canvas`, canvas === 1)
  await page.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.5)); await sleep(1200)
  const gap = await page.locator('.story-block.active h2').innerText().catch(() => '')
  check(`${label}: landing gap section`, /22\.2/.test(gap) && /zero/i.test(gap), gap.replace(/\s+/g, ' ').slice(0, 60))
  await page.locator('.landing-nav .landing-cta').click(); await sleep(2500)
  check(`${label}: landing CTA opens atlas`, page.url().includes('#/atlas'))
  await page.goto(BASE + '/#/atlas', { waitUntil: 'networkidle' })
  await sleep(2500)
  const header = await page.locator('header').innerText()
  check(`${label}: header counts`, /25\s*INVESTIGATIONS/.test(header) && /1,719\s*TESTS/.test(header), header.replace(/\s+/g, ' ').slice(0, 80))
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check(`${label}: no horizontal overflow`, overflow <= 0, `${overflow}px`)

  // 2D layers
  const traceTypes = async () => page.evaluate(() => document.querySelector('.js-plotly-plot')?.data?.map((d) => d.type) ?? [])
  let types = await traceTypes()
  check(`${label}: 2D renders isobars (scatter lines)`, types.filter((t) => t === 'scatter').length > 6, `${types.length} traces`)
  for (const chip of ['All', 'Solid', 'Droplet', 'Gas', 'Off']) {
    await page.locator('.layer-chip', { hasText: new RegExp(`^${chip}$`) }).first().click()
    await sleep(500)
  }
  await page.locator('.layer-chip', { hasText: /^Solid$/ }).first().click(); await sleep(600)
  types = await traceTypes()
  check(`${label}: coverage heatmap present for Solid`, types.includes('heatmap'))
  await page.locator('.layer-chip', { hasText: /^Off$/ }).first().click(); await sleep(400)
  await page.locator('.layer-chip', { hasText: /isobars/ }).click(); await sleep(400)
  types = await traceTypes()
  check(`${label}: isobars toggle off`, types.filter((t) => t === 'scatter').length < 20)
  await page.locator('.layer-chip', { hasText: /isobars/ }).click(); await sleep(300)

  // 3D towers
  await page.locator('.chart-toggle button', { hasText: '3D' }).click(); await sleep(2500)
  types = await traceTypes()
  check(`${label}: 3D towers (mesh3d)`, types.filter((t) => t === 'mesh3d').length >= 2, types.join(','))
  await page.locator('.layer-chip', { hasText: /^Solid$/ }).first().click(); await sleep(1200)
  const solidVerts = await page.evaluate(() => document.querySelector('.js-plotly-plot')?.data?.[0]?.x?.length ?? 0)
  check(`${label}: 3D solid filter = 3 towers`, solidVerts === 24, `${solidVerts / 8} towers`)
  await page.locator('.layer-chip', { hasText: /^All$/ }).first().click(); await sleep(400)
  await page.locator('.chart-toggle button', { hasText: '2D' }).click(); await sleep(1500)

  // Story mode (all four steps)
  await page.locator('.story-button').click()
  const seen = new Set()
  for (let i = 0; i < 22; i += 1) {
    await sleep(1000)
    const step = await page.locator('.story-step').innerText().catch(() => '')
    if (step) seen.add(step.trim())
  }
  check(`${label}: story shows 4 steps`, seen.size === 4, [...seen].join(' '))
  await page.keyboard.press('Escape'); await sleep(400)
  await page.locator('button[aria-label="Exit story mode"]').click().catch(() => {})

  // Test card + NASA receipt
  await page.evaluate(() => {
    const gd = document.querySelector('.js-plotly-plot')
    const index = gd.data.findIndex((d) => /Burned · Solid|Self-extinguished · Solid/.test(d.name || ''))
    const trace = gd.data[index]
    gd.emit('plotly_click', { points: [{ curveNumber: index, pointNumber: 0, data: trace, customdata: trace.customdata[0] }] })
  })
  await sleep(800)
  await page.locator('.receipt-button').click(); await sleep(1500)
  const receipt = await page.locator('.source-modal').innerText().catch(() => '')
  const sourceRows = await page.locator('.source-table .source-row').count()
  check(`${label}: NASA receipt modal`, sourceRows >= 1 && /ORIGINAL NASA RECORD/.test(receipt), `${sourceRows} source rows`)
  await page.keyboard.press('Escape'); await sleep(300)
  check(`${label}: receipt closes on Escape`, (await page.locator('.source-modal').count()) === 0)

  // Ask box (forced offline fallback to test the deterministic path)
  await page.route('**/api/parse-question', (route) => route.abort())
  await page.locator('#ask-input').fill('PMMA at 30% O2 and 10 psi')
  await page.locator('.ask-row button').click(); await sleep(1500)
  const ask = await page.locator('.ask-result').innerText().catch(() => '')
  check(`${label}: ask fallback parses`, /30 % O₂/.test(ask) && /10 psi/.test(ask) && /PMMA/i.test(ask), ask.replace(/\s+/g, ' '))
  const o2 = await page.locator('#o2-value, input[aria-label*="O₂"]').first().inputValue().catch(() => '')
  check(`${label}: ask fills O₂ input`, o2 === '30', o2)
  await page.unroute('**/api/parse-question')

  // Tabs
  for (const tab of ['Insights', 'Compare', 'Data', 'Atlas']) {
    await page.locator('.view-tabs button, nav button', { hasText: new RegExp(`^${tab}$`) }).first().click(); await sleep(700)
  }
  await page.locator('nav button, .view-tabs button', { hasText: /^Insights$/ }).first().click(); await sleep(600)
  const gravityRows = await page.locator('.gravity-row').count()
  const readinessRows = await page.locator('.readiness-table tbody tr').count()
  check(`${label}: insights gravity rows`, gravityRows === 10, `${gravityRows}`)
  check(`${label}: insights readiness rows`, readinessRows >= 8, `${readinessRows}`)
  const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check(`${label}: insights no overflow`, overflow2 <= 0, `${overflow2}px`)
  await page.locator('nav button, .view-tabs button', { hasText: /^Atlas$/ }).first().click(); await sleep(500)

  // About
  await page.locator('header button', { hasText: 'About' }).click(); await sleep(600)
  const about = await page.locator('[role=dialog]').innerText().catch(() => '')
  check(`${label}: about shows team`, /Guatians/.test(about))
  await page.keyboard.press('Escape')

  check(`${label}: no console/page/network errors`, errors.length === 0, errors.slice(0, 4).join(' | '))
  await page.screenshot({ path: `../worklog/screens/qa-${label}.png`, fullPage: false })
  await browser.close()
}

await run({ width: 1440, height: 900 }, 'desktop')
await run({ width: 375, height: 812 }, 'mobile')
console.log(results.join('\n'))
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED')
process.exit(failures.length ? 1 : 0)
