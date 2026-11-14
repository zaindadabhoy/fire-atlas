import React from 'react'
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { Brackets, Count, Embers, Footage, Kicker, Panel, ease, fade } from './components'
import { C, F, TAGLINE_FRAME, ZERO_FRAME } from './theme'

/* ---------- 1. Hook: Apollo 1 (0–180) ---------- */
export const Hook: React.FC = () => {
  const frame = useCurrentFrame()
  const typed = 'JANUARY 27, 1967'
  const chars = Math.floor(interpolate(frame, [12, 34], [0, typed.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }))
  const titleIn = spring({ frame: frame - 58, fps: 30, config: { damping: 200, mass: 0.8 } })
  const memoriam = fade(frame, 128, 16)
  const glow = interpolate(frame, [124, 136, 176], [0, 1, 0.35], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const out = 1 - fade(frame, 166, 14)
  return (
    <AbsoluteFill style={{ backgroundColor: '#020306', opacity: out }}>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 75%, rgba(255,60,20,${0.10 + glow * 0.22}) 0%, rgba(2,3,6,0) 60%)` }} />
      <Embers count={80} intensity={0.35 + glow * 0.8} />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', flexDirection: 'column' }}>
        <div style={{ fontFamily: F.mono, fontSize: 30, letterSpacing: '0.32em', color: '#c8cfe4', height: 40 }}>
          {typed.slice(0, chars)}<span style={{ opacity: frame % 20 < 10 && chars < typed.length + 1 ? 1 : 0, color: C.flame }}>▍</span>
        </div>
        <div style={{ fontFamily: F.mono, fontSize: 20, letterSpacing: '0.22em', color: C.muted, marginTop: 14, opacity: fade(frame, 36, 14) }}>LAUNCH COMPLEX 34 · CAPE KENNEDY</div>
        <div style={{ fontFamily: F.head, fontWeight: 700, fontSize: 168, color: C.text, letterSpacing: '-0.02em', marginTop: 34, opacity: titleIn, transform: `translateY(${(1 - titleIn) * 40}px)`, textShadow: `0 0 ${40 + glow * 60}px rgba(255,90,31,${0.25 + glow * 0.45})` }}>APOLLO 1</div>
        <div style={{ display: 'flex', gap: 22, marginTop: 30 }}>
          {[['CABIN ATMOSPHERE', '100 % O₂', 78], ['PRESSURE', '16.7 psi', 92]].map(([label, value, at]) => (
            <div key={String(label)} style={{ opacity: fade(frame, Number(at), 12), transform: `translateY(${(1 - fade(frame, Number(at), 12)) * 16}px)`, border: `1px solid ${C.flame}`, borderRadius: 4, padding: '12px 22px', background: 'rgba(255,90,31,0.08)' }}>
              <div style={{ fontFamily: F.mono, fontSize: 17, letterSpacing: '0.16em', color: '#ff9a72' }}>{label}</div>
              <div style={{ fontFamily: F.mono, fontSize: 40, fontWeight: 600, color: '#fff', marginTop: 4 }}>{value}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 44, opacity: memoriam, textAlign: 'center' }}>
          <div style={{ fontFamily: F.mono, fontSize: 18, letterSpacing: '0.3em', color: C.alert }}>IN MEMORIAM</div>
          <div style={{ fontFamily: F.head, fontSize: 34, color: '#d9dff2', marginTop: 8, letterSpacing: '0.04em' }}>Gus Grissom · Ed White · Roger Chaffee</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

/* ---------- 2. The Moon: 21 % -> 34 % O₂ (180–276) ---------- */
export const Moon: React.FC = () => {
  const frame = useCurrentFrame() // local
  const inn = fade(frame, 0, 12)
  const moonX = interpolate(frame, [0, 96], [-30, 10], { extrapolateRight: 'clamp' })
  const value = interpolate(frame, [12, 50], [20.9, 34], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease })
  const lunar = fade(frame, 44, 10)
  const out = 1 - fade(frame, 86, 10)
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, opacity: inn * out }}>
      <Embers count={30} intensity={0.18} color={C.moon} />
      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <radialGradient id="moonfill" cx="38%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#e9e6f5" /><stop offset="55%" stopColor="#9a96b2" /><stop offset="100%" stopColor="#2a2838" />
          </radialGradient>
          <mask id="crescent"><rect width="1920" height="1080" fill="white" /><circle cx={560 + moonX + 120} cy={500} r={330} fill="black" /></mask>
        </defs>
        <circle cx={560 + moonX} cy={540} r={330} fill="url(#moonfill)" mask="url(#crescent)" opacity={0.92} />
        <circle cx={560 + moonX} cy={540} r={332} fill="none" stroke={C.moon} strokeOpacity={0.25} />
      </svg>
      <div style={{ position: 'absolute', left: 1000, top: 300 }}>
        <Kicker color={value > 30 ? C.moon : C.muted}>{value > 30 ? 'Planned lunar habitat' : value > 21.5 ? 'Rising…' : 'Earth air'}</Kicker>
        <div style={{ fontFamily: F.head, fontWeight: 700, fontSize: 250, lineHeight: 1, color: value > 30 ? C.moon : C.text, marginTop: 10, fontVariantNumeric: 'tabular-nums' }}>
          {value.toFixed(value < 33.95 ? 1 : 0)}<span style={{ fontSize: 110 }}> %</span>
        </div>
        <div style={{ fontFamily: F.mono, fontSize: 40, color: C.text, marginTop: 6 }}>oxygen</div>
        <div style={{ opacity: lunar, marginTop: 28, fontFamily: F.mono, fontSize: 22, color: C.muted, letterSpacing: '0.06em' }}>≥ 30 % O₂ · ≤ 10.2 psi · Space Apps 2026 challenge spec</div>
        <div style={{ opacity: lunar, marginTop: 10, fontFamily: F.mono, fontSize: 22, color: '#ff9a72', letterSpacing: '0.06em' }}>+63 % more oxygen by fraction than Earth air</div>
      </div>
    </AbsoluteFill>
  )
}

/* ---------- 3. The atlas assembles (276–384) ---------- */
export const Atlas: React.FC = () => {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill>
      <Footage src="footage/a_boot.mp4" startFrom={0.3} keys={[{ f: 0, scale: 1.02, x: 960, y: 540 }, { f: 108, scale: 1.32, x: 1150, y: 520 }]} />
      <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(5,7,13,0.92) 0%, rgba(5,7,13,0.6) 26%, rgba(5,7,13,0) 48%)', opacity: fade(frame, 6, 12) }} />
      <div style={{ position: 'absolute', left: 110, top: 300, opacity: fade(frame, 8, 12) }}>
        <Kicker>NASA Physical Sciences Informatics</Kicker>
        {[[25, 'investigations', 10], [22, 'NASA data tables', 24], [1719, 'microgravity fire tests', 38]].map(([n, label, at]) => (
          <div key={String(label)} style={{ marginTop: 18, opacity: fade(frame, Number(at), 10), transform: `translateX(${(1 - fade(frame, Number(at), 10)) * -30}px)` }}>
            <div style={{ fontFamily: F.head, fontWeight: 700, fontSize: Number(n) > 1000 ? 120 : 92, color: Number(n) > 1000 ? C.flame : C.text, lineHeight: 1 }}>
              <Count to={Number(n)} start={Number(at)} dur={Number(n) > 1000 ? 30 : 16} />
            </div>
            <div style={{ fontFamily: F.mono, fontSize: 24, color: C.muted, letterSpacing: '0.08em' }}>{label}</div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  )
}

/* ---------- 4. Every solid test sits at ≤ 22.2 % (384–528) ---------- */
export const Coverage: React.FC = () => {
  const frame = useCurrentFrame()
  const card = fade(frame, 34, 12)
  const lunarCard = fade(frame, 92, 12)
  return (
    <AbsoluteFill>
      <Footage src="footage/b_coverage.mp4" startFrom={1.8}
        keys={[{ f: 0, scale: 1.3, x: 1170, y: 520 }, { f: 30, scale: 1.3, x: 1170, y: 520 }, { f: 62, scale: 2.05, x: 760, y: 470 }, { f: 98, scale: 2.05, x: 760, y: 470 }, { f: 144, scale: 1.55, x: 1120, y: 600 }]} />
      <div style={{ position: 'absolute', right: 110, top: 150, opacity: card, transform: `translateY(${(1 - card) * 20}px)` }}>
        <Panel style={{ minWidth: 560 }}>
          <Kicker color="#ff9a72">Every solid-material test in PSI</Kicker>
          <div style={{ fontFamily: F.head, fontWeight: 700, fontSize: 132, color: C.flame, lineHeight: 1.05, marginTop: 6 }}>≤ <Count from={13.6} to={22.2} start={34} dur={22} decimals={1} />%</div>
          <div style={{ fontFamily: F.mono, fontSize: 24, color: C.text }}>oxygen · 263 tests · BASS, BASS-II, SAFFIRE</div>
        </Panel>
      </div>
      <div style={{ position: 'absolute', right: 110, top: 520, opacity: lunarCard, transform: `translateY(${(1 - lunarCard) * 20}px)` }}>
        <Panel style={{ minWidth: 560, borderColor: 'rgba(201,182,255,0.5)' }}>
          <Kicker color={C.moon}>Planned lunar habitat</Kicker>
          <div style={{ fontFamily: F.head, fontWeight: 700, fontSize: 132, color: C.moon, lineHeight: 1.05, marginTop: 6 }}>34 %</div>
          <div style={{ fontFamily: F.mono, fontSize: 24, color: C.text }}>oxygen · 11.8 points beyond any solid test</div>
        </Panel>
      </div>
    </AbsoluteFill>
  )
}

/* ---------- 5. 3D towers + the ZERO slam (528–612) ---------- */
export const Towers: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const zeroLocal = ZERO_FRAME - 528
  const slam = spring({ frame: frame - zeroLocal, fps, config: { damping: 11, stiffness: 180, mass: 0.7 } })
  const hit = frame >= zeroLocal
  const shake = hit && frame < zeroLocal + 8 ? Math.sin(frame * 2.7) * (8 - (frame - zeroLocal)) * 1.6 : 0
  const flash = interpolate(frame, [zeroLocal, zeroLocal + 2, zeroLocal + 10], [0, 0.55, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ transform: `translate(${shake}px, ${shake * 0.4}px)` }}>
      <Footage src="footage/c_towers.mp4" startFrom={0.4} rate={1.5} dim={hit ? 0.62 : 0}
        keys={[{ f: 0, scale: 1.75, x: 1150, y: 590 }, { f: 84, scale: 1.95, x: 1150, y: 600 }]} />
      {!hit && <div style={{ position: 'absolute', left: 120, top: 120, opacity: fade(frame, 4, 10) }}>
        <Kicker color={C.moon}>Solid tests · 3D evidence towers</Kicker>
        <div style={{ fontFamily: F.mono, fontSize: 24, color: C.muted, marginTop: 8 }}>tower height = number of NASA tests per condition</div>
      </div>}
      {hit && <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', flexDirection: 'column' }}>
        <div style={{ fontFamily: F.head, fontWeight: 700, fontSize: 460, lineHeight: 0.9, color: C.alert, transform: `scale(${0.4 + slam * 0.6})`, textShadow: '0 0 80px rgba(255,45,85,0.55)' }}>0</div>
        <div style={{ fontFamily: F.mono, fontSize: 34, letterSpacing: '0.12em', color: C.text, marginTop: 18, opacity: slam }}>SOLID TESTS INSIDE THE LUNAR ENVELOPE</div>
      </AbsoluteFill>}
      <AbsoluteFill style={{ backgroundColor: '#fff', opacity: flash }} />
    </AbsoluteFill>
  )
}

/* ---------- 6a. Ask in plain English (612–657) ---------- */
export const Ask: React.FC = () => {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill>
      <Footage src="footage/d_ask.mp4" startFrom={2.0} rate={2.5} keys={[{ f: 0, scale: 2.7, x: 345, y: 320 }, { f: 45, scale: 2.5, x: 360, y: 330 }]} />
      <div style={{ position: 'absolute', right: 120, bottom: 200, opacity: fade(frame, 4, 10) }}>
        <Panel><Kicker color={C.teal}>Question → SI → conditions</Kicker><div style={{ fontFamily: F.body, fontSize: 28, color: C.text, marginTop: 8 }}>Moon base · 34 % O₂ · 8.2 psi · acrylic</div></Panel>
      </div>
    </AbsoluteFill>
  )
}

/* ---------- 6b. Cited briefing (657–702) ---------- */
export const Briefing: React.FC = () => {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill>
      <Footage src="footage/d_ask.mp4" startFrom={9.6} keys={[{ f: 0, scale: 1.9, x: 640, y: 545 }, { f: 45, scale: 2.05, x: 620, y: 545 }]} />
      <div style={{ position: 'absolute', right: 110, top: 110, opacity: fade(frame, 6, 10) }}>
        <Panel style={{ borderColor: 'rgba(127,212,193,0.5)' }}><Kicker color={C.teal}>Verified 5 / 5 sentences</Kicker><div style={{ fontFamily: F.body, fontSize: 28, color: C.text, marginTop: 8 }}>Every sentence cited · every number checked</div></Panel>
      </div>
    </AbsoluteFill>
  )
}

/* ---------- 6c. The original NASA row (702–762) ---------- */
export const Receipt: React.FC = () => {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill>
      <Footage src="footage/e_receipt.mp4" startFrom={0.7} keys={[{ f: 0, scale: 1.35, x: 960, y: 560 }, { f: 60, scale: 1.62, x: 900, y: 540 }]} />
      <div style={{ position: 'absolute', right: 120, top: 120, opacity: fade(frame, 14, 10) }}>
        <Panel style={{ borderColor: 'rgba(255,90,31,0.6)' }}><Kicker>The receipt</Kicker><div style={{ fontFamily: F.body, fontSize: 28, color: C.text, marginTop: 8 }}>NASA's original row, unmodified</div></Panel>
      </div>
    </AbsoluteFill>
  )
}

/* ---------- 7. End card (762–876) ---------- */
export const End: React.FC = () => {
  const frame = useCurrentFrame() // local
  const { fps } = useVideoConfig()
  const logo = spring({ frame: frame - 4, fps, config: { damping: 200 } })
  const taglineLocal = TAGLINE_FRAME - 762
  const tag = fade(frame, taglineLocal - 2, 12)
  const meta = fade(frame, taglineLocal + 18, 14)
  const letters = 'FIRE ATLAS'.split('')
  return (
    <AbsoluteFill style={{ backgroundColor: '#020306', justifyContent: 'center', alignItems: 'center', flexDirection: 'column' }}>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 60%, rgba(255,70,20,0.16) 0%, rgba(2,3,6,0) 62%)' }} />
      <Embers count={60} intensity={0.5} />
      <Brackets opacity={fade(frame, 0, 14)} inset={70} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 34, opacity: logo, transform: `scale(${0.92 + logo * 0.08})` }}>
        <svg width="86" height="86" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="none" stroke={C.flame} strokeWidth="1.6" /><path d="M12 1v5M12 18v5M1 12h5M18 12h5" stroke={C.flame} strokeWidth="1.6" /></svg>
        <div style={{ display: 'flex', fontFamily: F.head, fontWeight: 700, fontSize: 150, letterSpacing: '0.06em', color: C.text }}>
          {letters.map((ch, i) => {
            const t = spring({ frame: frame - 2 - i * 2, fps, config: { damping: 200 } })
            return <span key={i} style={{ display: 'inline-block', width: ch === ' ' ? 50 : undefined, opacity: t, transform: `translateY(${(1 - t) * 30}px)`, color: i < 4 ? C.text : C.flame }}>{ch}</span>
          })}
        </div>
      </div>
      <div style={{ fontFamily: F.head, fontSize: 52, color: '#d9dff2', marginTop: 26, opacity: tag, transform: `translateY(${(1 - tag) * 14}px)` }}>Find the gap before the fire does.</div>
      <div style={{ marginTop: 46, opacity: meta, textAlign: 'center' }}>
        <div style={{ fontFamily: F.mono, fontSize: 30, color: C.flame, letterSpacing: '0.04em' }}>fire-atlas-tau.vercel.app</div>
        <div style={{ fontFamily: F.mono, fontSize: 24, color: C.text, marginTop: 14, letterSpacing: '0.1em' }}>TEAM GUATIANS · NASA SPACE APPS CHALLENGE 2026 · KARACHI</div>
        <div style={{ fontFamily: F.mono, fontSize: 17, color: C.muted, marginTop: 12, letterSpacing: '0.06em' }}>Data: NASA Physical Sciences Informatics (PSI) · Narration: ElevenLabs SI voice · Made with SI tools</div>
      </div>
    </AbsoluteFill>
  )
}
