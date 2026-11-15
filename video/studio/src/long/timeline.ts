// Long-form presentation timeline. Every frame position derives from measured narration lengths.
export const LINE_DUR: Record<string, number> = {
  '01': 8.001896, '02': 5.710729, '03': 10.21425, '04': 13.361854, '05': 13.860271, '06': 9.735375, '07': 9.738167,
  '08': 10.681438, '09': 11.472292, '10': 6.9755, '11': 13.694604, '12': 13.063563, '13': 5.125792, '14': 9.235979,
  '15': 6.298708, '16': 6.48725, '17': 8.658604, '18': 13.483063, '19': 8.316917, '20': 16.179375, '21': 8.439896,
  '22': 7.8675, '23': 5.115396, '24': 12.76425, '25': 15.864833, '26': 10.177125, '27': 6.577208, '28': 6.436896,
}

export const LINE_TEXT: Record<string, string> = {
  '01': 'January 27, 1967. During a launch rehearsal, a spark inside Apollo 1 meets a cabin filled with pure oxygen.',
  '02': 'Within seconds, fire races through the cabin. Gus Grissom, Ed White and Roger Chaffee are lost.',
  '03': "Fire in a spacecraft is not like fire on Earth. Without gravity, hot gas doesn't rise. A candle flame doesn't flicker upward. It becomes a dim, blue sphere.",
  '04': "We are Team Guatians, from Karachi. For NASA Space Apps 2026 we took on the challenge Flame in Freefall: turn decades of NASA's microgravity fire research into fire-safety insight for the Moon and Mars.",
  '05': 'Here is why it matters now. So that astronauts can step into their spacesuits faster, lunar habitats and pressurized rovers will run on enriched air: at least 30 % oxygen, at 10.2 psi or less.',
  '06': 'More oxygen means materials ignite more easily and burn harder. So the question is simple. Has anyone tested the materials we will bring, in the air we will breathe?',
  '07': "The answer is buried in NASA's Physical Sciences Informatics database: hundreds of experiments, spread across more than twenty spreadsheets, each in its own format.",
  '08': "So we built Fire Atlas. A Python pipeline pulled every combustion investigation from NASA's open API. Twenty-five investigations. Twenty-two experiment tables.",
  '09': "We unified them into 1,719 tests, converting atmospheres, bars and millimetres of mercury onto one scale, and keeping track of every value's source row.",
  '10': "Where NASA didn't record a value, we say so. Assumed values are flagged, drawn hollow, and never counted as evidence.",
  '11': 'Then we put every test on one map. Oxygen runs left to right. Pressure runs bottom to top. Each point is a real experiment, colored by what happened: it burned, it went out on its own, or it never ignited.',
  '12': "The violet box is the planned lunar habitat. The curves show constant oxygen partial pressure. Notice that the Moon base sits almost on Earth's line, yet breathes 63 % more oxygen by fraction.",
  '13': 'Now switch on the solid materials: the fabrics and plastics that actually burn in a cabin.',
  '14': 'All 263 of them sit here, at Earth-like air. The highest oxygen level any solid was ever tested at is 22.2 %.',
  '15': 'Inside the lunar envelope? Zero solid tests. In three dimensions, the gap is even harder to miss.',
  '16': 'Fire Atlas also answers questions. Ask it, in plain English: would acrylic panels burn in a lunar rover?',
  '17': 'Our SI turns the question into cabin conditions, then writes a short briefing: what the data shows, what is missing, and which tests should be run next.',
  '18': "But we never let the SI do the math. Deterministic code computes 97 facts first. The SI may only explain them, and a verifier removes any citation that doesn't exist and any number that isn't in the data.",
  '19': "Every sentence carries a receipt. Click one, and you see NASA's original spreadsheet row, unmodified, down to the typo in the column name.",
  '20': 'Partial gravity has never been tested in this database. But SAFFIRE-II tested the same materials at 1 g and in orbit. Silicone burned in 3 of 4 samples at 1 g, and in none of 4 in microgravity. The Moon sits between those bounds.',
  '21': 'The readiness matrix makes it plain: six cabin materials have microgravity burn data, and not one has been tested at lunar oxygen levels.',
  '22': 'Every investigation can be compared side by side, and every filtered test exports with its DOI, ready for flammability models.',
  '23': 'Because this is safety data, we built Fire Atlas to be trustworthy, not just beautiful.',
  '24': 'API keys never reach the browser; they live only on the server. Every input is validated and rate limited, and we tested prompt injection attacks. The SI ignores instructions hidden inside a question.',
  '25': 'If every SI provider fails, the app falls back to a computed, fully cited briefing. And we state our limits openly: no partial-gravity data yet, unrecorded pressures are assumed, and these briefings support decisions. They do not certify materials.',
  '26': 'The impact is direct. Fire Atlas shows mission planners which experiments to fly next, on missions like LUCI and FM2, before crews ever breathe lunar air.',
  '27': 'And it matters on Earth too. Hospital rooms with oxygen-enriched air face the same question every day.',
  '28': 'Fire Atlas. Every NASA fire test, on one map, with receipts. Find the gap before the fire does.',
}

interface Chapter { key: string; kicker?: string; title?: string; lines: string[] }
export const CHAPTERS: Chapter[] = [
  { key: 'hook', lines: ['01', '02', '03'] },
  { key: 'team', lines: ['04'] },
  { key: 'problem', kicker: '01 · The problem', title: 'Why it matters now', lines: ['05', '06', '07'] },
  { key: 'data', kicker: '02 · The data', title: 'Hundreds of experiments. One format.', lines: ['08', '09', '10'] },
  { key: 'finding', kicker: '03 · The finding', title: 'The gap', lines: ['11', '12', '13', '14', '15'] },
  { key: 'si', kicker: '04 · SI with receipts', title: 'Answers you can audit', lines: ['16', '17', '18', '19'] },
  { key: 'insights', kicker: '05 · Insights', title: 'Beyond the gap', lines: ['20', '21', '22'] },
  { key: 'security', kicker: '06 · Security & trust', title: 'Built to be trusted', lines: ['23', '24', '25'] },
  { key: 'impact', kicker: '07 · Impact', title: 'From data to the next flight', lines: ['26', '27'] },
  { key: 'close', lines: ['28'] },
]

export const FPS = 30
const CARD = 66
const GAP = 18
const START = 30
export const END_HOLD = 165

export interface LineSlot { id: string; from: number; dur: number; chapter: string }
export interface CardSlot { key: string; kicker: string; title: string; from: number; dur: number }

export const LINES: LineSlot[] = []
export const CARDS: CardSlot[] = []
export const CHAPTER_START: Record<string, number> = {}
let t = START
for (const chapter of CHAPTERS) {
  CHAPTER_START[chapter.key] = t
  if (chapter.title && chapter.kicker) {
    CARDS.push({ key: chapter.key, kicker: chapter.kicker, title: chapter.title, from: t, dur: CARD })
    t += CARD
  }
  for (const id of chapter.lines) {
    const dur = Math.round(LINE_DUR[id] * FPS)
    LINES.push({ id, from: t, dur, chapter: chapter.key })
    t += dur + GAP
  }
  t += 10
}
export const LAST_LINE_END = LINES[LINES.length - 1].from + LINES[LINES.length - 1].dur
export const TOTAL = LAST_LINE_END + END_HOLD

export const line = (id: string) => LINES.find((item) => item.id === id)!
/** A visual segment spanning lines [first..last], extended to the start of whatever comes next. */
export function segment(first: string, last = first) {
  const a = line(first)
  const b = line(last)
  const index = LINES.indexOf(b)
  const next = LINES[index + 1]
  const card = CARDS.find((item) => item.from > b.from)
  const nextStart = Math.min(next ? next.from : TOTAL, card ? card.from : TOTAL)
  return { from: a.from, durationInFrames: (index === LINES.length - 1 ? TOTAL : nextStart) - a.from }
}
/** Frame (relative to a segment start) where line `id` begins, plus an offset in seconds. */
export const at = (segFirst: string, id: string, offsetSec = 0) => line(id).from - line(segFirst).from + Math.round(offsetSec * FPS)
