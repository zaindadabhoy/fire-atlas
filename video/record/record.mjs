// Records FIRE ATLAS app footage for the demo video via Chrome DevTools screencast.
// Each clip -> video/footage/<name>.mp4 (1920x1080, 30 fps CFR, high quality).
// Usage (from video/record):  node record.mjs [baseUrl] [clipName...]
import { chromium } from '../../app/node_modules/playwright/index.mjs'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const BASE = process.argv[2] ?? 'https://fire-atlas-tau.vercel.app'
const ONLY = process.argv.slice(3)
const OUT = resolve('../footage')
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg'
const CHROME = process.env.CHROME_PATH // optional; Playwright's bundled Chromium is used when unset
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const CURSOR_JS = `
(() => {
  if (window.__cursor) return
  const c = document.createElement('div')
  c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border:2px solid #fff;border-radius:50%;background:rgba(255,255,255,.18);box-shadow:0 0 0 1px rgba(0,0,0,.6),0 0 18px rgba(255,255,255,.35);pointer-events:none;z-index:2147483647;transition:transform .12s ease, background .12s ease;transform:translate(-100px,-100px)'
  document.documentElement.appendChild(c)
  window.__cursor = c
  window.addEventListener('mousemove', (e) => { c.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)' }, true)
  window.addEventListener('mousedown', () => { c.style.background = 'rgba(255,90,31,.55)'; c.style.transform += ' scale(.8)' }, true)
  window.addEventListener('mouseup', () => { c.style.background = 'rgba(255,255,255,.18)' }, true)
})()`

async function glide(page, from, to, ms = 600) {
  const steps = Math.max(8, Math.round(ms / 16))
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    await page.mouse.move(from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e)
    await sleep(ms / steps)
  }
}

async function centerOf(page, locator) {
  const box = await locator.boundingBox()
  return [box.x + box.width / 2, box.y + box.height / 2]
}

async function record(name, setup, action) {
  if (ONLY.length && !ONLY.includes(name)) return
  const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), headless: false, args: ['--window-size=1940,1180', '--force-device-scale-factor=1', '--hide-scrollbars', '--disable-features=Translate'] })
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  await page.addInitScript(CURSOR_JS)
  const frameDir = join(OUT, `_frames_${name}`)
  if (existsSync(frameDir)) rmSync(frameDir, { recursive: true })
  mkdirSync(frameDir, { recursive: true })
  await setup(page)
  const session = await context.newCDPSession(page)
  const frames = []
  session.on('Page.screencastFrame', async (event) => {
    const file = join(frameDir, `${String(frames.length).padStart(5, '0')}.jpg`)
    writeFileSync(file, Buffer.from(event.data, 'base64'))
    frames.push({ file, t: event.metadata.timestamp })
    session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {})
  })
  await session.send('Page.startScreencast', { format: 'jpeg', quality: 94, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 })
  const started = Date.now() / 1000
  await action(page)
  const ended = Date.now() / 1000
  await session.send('Page.stopScreencast')
  await sleep(300)
  await browser.close()
  // build a constant-frame-rate video from timestamped frames
  const lines = ['ffconcat version 1.0']
  frames.forEach((frame, index) => {
    const next = index + 1 < frames.length ? frames[index + 1].t : Math.max(frame.t + 1 / 30, ended)
    lines.push(`file '${frame.file.replace(/\\/g, '/')}'`, `duration ${Math.max(1 / 60, next - frame.t).toFixed(4)}`)
  })
  lines.push(`file '${frames[frames.length - 1].file.replace(/\\/g, '/')}'`)
  const list = join(frameDir, 'list.ffconcat')
  writeFileSync(list, lines.join('\n'))
  const out = join(OUT, `${name}.mp4`)
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=30,scale=1920:1080:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', out])
  console.log(`${name}: ${frames.length} frames over ${(ended - started).toFixed(1)} s -> ${out}`)
  rmSync(frameDir, { recursive: true })
}

const loadAtlas = async (page) => {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(3500)
  await page.mouse.move(1900, 140)
}

// A — boot + atlas reveal (fresh load is recorded)
await record('a_boot', async (page) => { await page.goto('about:blank') }, async (page) => {
  await page.goto(BASE, { waitUntil: 'commit' })
  await sleep(5200)
})

// B — coverage: switch to Solid evidence (glow + fade)
await record('b_coverage', loadAtlas, async (page) => {
  await sleep(700)
  const chip = page.locator('.layer-chip', { hasText: /^Solid$/ }).first()
  const target = await centerOf(page, chip)
  await glide(page, [1900, 140], target, 900)
  await sleep(150)
  await page.mouse.down(); await page.mouse.up()
  await sleep(300)
  await glide(page, target, [190, 1040], 900)
  await sleep(4200)
})

// C — 3D evidence towers, Solid only, slow orbit
await record('c_towers', async (page) => {
  await loadAtlas(page)
  await page.locator('.chart-toggle button', { hasText: '3D' }).click()
  await sleep(2500)
  await page.locator('.layer-chip', { hasText: /^Solid$/ }).first().click()
  await sleep(1500)
  await page.mouse.move(1900, 1060)
}, async (page) => {
  await page.evaluate(async () => {
    const gd = document.querySelector('.js-plotly-plot')
    const plotly = window.__fireAtlasPlotly
    const start = performance.now()
    const duration = 6000
    while (true) {
      const t = Math.min(1, (performance.now() - start) / duration)
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      const angle = -1.88 + e * 0.95
      await plotly.relayout(gd, { 'scene.camera.eye': { x: 1.9 * Math.cos(angle), y: 1.9 * Math.sin(angle), z: 1.0 - e * 0.22 } })
      if (t >= 1) break
      await new Promise((r) => requestAnimationFrame(r))
    }
  })
  await sleep(300)
})

// D — ask in plain English -> cited briefing
await record('d_ask', loadAtlas, async (page) => {
  const input = page.locator('#ask-input')
  const at = await centerOf(page, input)
  await glide(page, [1900, 140], at, 800)
  await page.mouse.down(); await page.mouse.up()
  await input.pressSequentially('Would acrylic panels burn in a lunar rover?', { delay: 38 })
  await sleep(250)
  const ask = page.locator('.ask-row button')
  const askAt = await centerOf(page, ask)
  await glide(page, at, askAt, 350)
  await page.mouse.down(); await page.mouse.up()
  await page.waitForFunction(() => /Verified \d+\/\d+ sentences/.test(document.body.innerText), null, { timeout: 30000 })
  await sleep(400)
  await page.evaluate(() => document.querySelector('.insight-drawer')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  await sleep(4200)
})

// E — the original NASA row behind a cited test
await record('e_receipt', async (page) => {
  await loadAtlas(page)
  await page.evaluate(() => {
    const gd = document.querySelector('.js-plotly-plot')
    const index = gd.data.findIndex((d) => /Self-extinguished · Solid/.test(d.name || ''))
    const trace = gd.data[index]
    gd.emit('plotly_click', { points: [{ curveNumber: index, pointNumber: 0, data: trace, customdata: trace.customdata[0] }] })
  })
  await sleep(1200)
  await page.evaluate(() => document.querySelector('.receipt-button')?.scrollIntoView({ block: 'center' }))
  await sleep(600)
}, async (page) => {
  const button = page.locator('.receipt-button')
  const at = await centerOf(page, button)
  await glide(page, [1300, 300], at, 800)
  await page.mouse.down(); await page.mouse.up()
  await sleep(3800)
})
