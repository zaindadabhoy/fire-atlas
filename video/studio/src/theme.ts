import { continueRender, delayRender, staticFile } from 'remotion'

export const FPS = 30
export const W = 1920
export const H = 1080

export const C = {
  bg: '#05070d',
  panel: '#0b1020',
  line: '#1c2540',
  text: '#e6ecff',
  muted: '#7d8bb3',
  flame: '#ff5a1f',
  amber: '#ffc542',
  moon: '#c9b6ff',
  teal: '#7fd4c1',
  alert: '#ff2d55',
}

export const F = {
  head: '"Space Grotesk", "Inter", sans-serif',
  body: '"Inter", sans-serif',
  mono: '"JetBrains Mono", monospace',
}

// ---- timeline (frames @30fps). VO clip starts are set from measured clip lengths. ----
export const VO = [
  { file: 'vo/vo_01.wav', from: 12, dur: 5.35, text: 'January 1967. A fire in a pure-oxygen cabin kills the Apollo 1 crew.' },
  { file: 'vo/vo_02.wav', from: 182, dur: 2.95, text: 'Our Moon bases will breathe thirty-four percent oxygen.' },
  { file: 'vo/vo_03.wav', from: 278, dur: 3.36, text: "We mapped every microgravity fire test in NASA's database." },
  { file: 'vo/vo_04.wav', from: 387, dur: 4.68, text: 'Every solid material in that data was tested at twenty-two percent oxygen or less.' },
  { file: 'vo/vo_05.wav', from: 534, dur: 2.41, text: 'Inside the lunar envelope: zero tests.' },
  { file: 'vo/vo_06.wav', from: 618, dur: 4.63, text: "Ask in plain English. Every SI answer is checked against NASA's original rows." },
  { file: 'vo/vo_07.wav', from: 767, dur: 2.87, text: 'Fire Atlas. Find the gap before the fire does.' },
]

export const SCENES = {
  hook: [0, 180],
  moon: [180, 276],
  atlas: [276, 384],
  coverage: [384, 528],
  towers: [528, 612],
  ask: [612, 657],
  briefing: [657, 702],
  receipt: [702, 762],
  end: [762, 876],
} as const

export const ZERO_FRAME = 534 + 48 // "zero" lands 1.59 s into line 5
export const TAGLINE_FRAME = 767 + 31 // "Find the gap" lands 1.02 s into line 7
export const TOTAL_FRAMES = 876 // 29.2 s

const FONT_FILES: Array<[string, string, number]> = []
for (const [family, slug] of [['Space Grotesk', 'space-grotesk'], ['Inter', 'inter'], ['JetBrains Mono', 'jetbrains-mono']] as const) {
  for (const weight of [400, 500, 600, 700]) {
    FONT_FILES.push([family, `fonts/${slug}-latin-${weight}-normal.woff2`, weight])
    FONT_FILES.push([family, `fonts/${slug}-latin-ext-${weight}-normal.woff2`, weight])
  }
}

let fontsRequested = false
export function loadFonts() {
  if (fontsRequested || typeof document === 'undefined') return
  fontsRequested = true
  const handle = delayRender('fonts')
  Promise.all(FONT_FILES.map(([family, file, weight]) => {
    const face = new FontFace(family, `url(${staticFile(file)})`, { weight: String(weight) })
    return face.load().then((loaded) => { document.fonts.add(loaded) }).catch(() => undefined)
  })).then(() => continueRender(handle))
}

/** Deterministic pseudo-random for particles. */
export function rand(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}
