import React from 'react'
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion'
import { Grain, fade } from '../components'
import { C, F, loadFonts } from '../theme'
import { CARDS, CHAPTER_START, CHAPTERS, LINES, LINE_TEXT, TOTAL, line, segment } from './timeline'
import * as Sc from './scenes'

loadFonts()

const VISUALS: Array<[string, string, React.FC]> = [
  ['01', '02', Sc.Hook], ['03', '03', Sc.FlameScience], ['04', '04', Sc.Team],
  ['05', '05', Sc.MoonAir], ['06', '06', Sc.Question], ['07', '07', Sc.Sheets],
  ['08', '08', Sc.Pipeline], ['09', '09', Sc.Units], ['10', '10', Sc.Hollow],
  ['11', '11', Sc.MapMorph], ['12', '12', Sc.Isobars], ['13', '14', Sc.Solids], ['15', '15', Sc.Towers],
  ['16', '16', Sc.Ask], ['17', '17', Sc.Brief], ['18', '18', Sc.Verifier], ['19', '19', Sc.Receipt],
  ['20', '20', Sc.Gravity], ['21', '21', Sc.Readiness], ['22', '22', Sc.CompareExport],
  ['23', '25', Sc.Trust], ['26', '26', Sc.Impact], ['27', '27', Sc.Earth], ['28', '28', Sc.Finale],
]

/** Every visual gets a short dissolve in/out so cuts never pop. */
const Dissolve: React.FC<{ len: number; children: React.ReactNode }> = ({ len, children }) => {
  const frame = useCurrentFrame()
  const opacity = Math.min(fade(frame, 0, 8), 1 - fade(frame, len - 8, 8))
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>
}

const Captions: React.FC = () => {
  const frame = useCurrentFrame()
  const current = LINES.find((item) => frame >= item.from && frame < item.from + item.dur + 8)
  if (!current || current.id === '28') return null
  const local = frame - current.from
  const opacity = Math.min(fade(local, 0, 6), 1 - fade(local, current.dur + 2, 6))
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 54, pointerEvents: 'none' }}>
      <div style={{ opacity, maxWidth: 1640, textAlign: 'center', fontFamily: F.body, fontWeight: 500, fontSize: 34, lineHeight: 1.35, color: '#f2f5ff', background: 'rgba(3,5,10,0.74)', padding: '10px 26px', borderRadius: 8 }}>{LINE_TEXT[current.id]}</div>
    </AbsoluteFill>
  )
}

const ChapterTag: React.FC = () => {
  const frame = useCurrentFrame()
  const chapter = [...CHAPTERS].reverse().find((item) => item.kicker && frame >= CHAPTER_START[item.key])
  const card = CARDS.find((item) => frame >= item.from && frame < item.from + item.dur)
  if (!chapter || card || frame >= line('28').from) return null
  return <div style={{ position: 'absolute', left: 34, top: 28, fontFamily: F.mono, fontSize: 18, letterSpacing: '0.16em', color: 'rgba(230,236,255,0.6)', textTransform: 'uppercase' }}><span style={{ color: C.flame }}>●</span> {chapter.kicker}</div>
}

const Progress: React.FC = () => {
  const frame = useCurrentFrame()
  return <div style={{ position: 'absolute', left: 0, bottom: 0, height: 4, width: `${(frame / TOTAL) * 100}%`, background: 'linear-gradient(90deg, #ff5a1f, #c9b6ff)', opacity: 0.8 }} />
}

const Watermark: React.FC = () => (
  <div style={{ position: 'absolute', right: 26, top: 26, fontFamily: F.mono, fontSize: 14, letterSpacing: '0.12em', color: 'rgba(230,236,255,0.35)' }}>SI-ASSISTED PRODUCTION</div>
)

const S = (n: number) => Math.round(n * 30)
const sfx = (file: string, at: number, volume: number, len = 90) => ({ file, at, volume, len })
const SFX = [
  sfx('sfx/boom_open.wav', 6, 0.45),
  sfx('sfx/subsonic.wav', line('01').from + S(6.0), 0.5, 110),
  sfx('sfx/grand_hit.wav', line('02').from + S(2.85), 0.35, 100),
  sfx('sfx/whoosh.wav', line('03').from - 6, 0.4),
  sfx('sfx/power_up.wav', line('03').from + S(8.2), 0.35),
  sfx('sfx/space_impact.wav', line('04').from, 0.45),
  sfx('sfx/digits.wav', line('05').from + S(6.5), 0.2, 100),
  sfx('sfx/keys.wav', line('06').from + S(4.4), 0.22), sfx('sfx/keys.wav', line('06').from + S(5.6), 0.2), sfx('sfx/keys.wav', line('06').from + S(6.8), 0.2),
  sfx('sfx/data_transfer.wav', line('07').from + S(1.5), 0.32),
  sfx('sfx/click.wav', line('08').from + S(1.2), 0.35), sfx('sfx/click.wav', line('08').from + S(2.7), 0.35), sfx('sfx/click.wav', line('08').from + S(4.2), 0.35), sfx('sfx/click.wav', line('08').from + S(5.7), 0.35), sfx('sfx/access.wav', line('08').from + S(7.2), 0.4),
  sfx('sfx/digits.wav', line('09').from + 6, 0.2, 60),
  sfx('sfx/swoosh_fast.wav', line('11').from, 0.4),
  sfx('sfx/power_up.wav', line('13').from + S(2.2), 0.4),
  sfx('sfx/buildup.wav', line('15').from + S(1.75) - 56, 1.0),
  sfx('sfx/grand_hit.wav', line('15').from + S(1.75), 0.7, 110), sfx('sfx/sub_drop.wav', line('15').from + S(1.75), 0.45, 100),
  sfx('sfx/keys.wav', line('16').from + S(0.8), 0.22), sfx('sfx/keys.wav', line('16').from + S(2.2), 0.2), sfx('sfx/keys.wav', line('16').from + S(3.6), 0.2),
  sfx('sfx/access.wav', line('17').from + S(1.2), 0.4),
  sfx('sfx/access.wav', line('18').from + S(11.5), 0.4),
  sfx('sfx/click.wav', line('19').from + S(1.0), 0.4),
  sfx('sfx/swoosh_fast.wav', line('22').from + S(4) - 4, 0.35),
  sfx('sfx/access.wav', line('24').from + S(0.2), 0.3), sfx('sfx/access.wav', line('24').from + S(4.3), 0.3), sfx('sfx/access.wav', line('24').from + S(7.0), 0.3),
  sfx('sfx/space_impact.wav', line('28').from, 0.55),
  ...CARDS.map((card) => sfx('sfx/whoosh.wav', card.from, 0.42)),
]

export const FireAtlasLong: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.bg }}>
    {VISUALS.map(([first, last, Visual]) => {
      const seg = segment(first, last)
      return <Sequence key={first} from={seg.from} durationInFrames={seg.durationInFrames}><Dissolve len={seg.durationInFrames}><Visual /></Dissolve></Sequence>
    })}
    {CARDS.map((card) => <Sequence key={card.key} from={card.from} durationInFrames={card.dur}><Sc.ChapterCard kicker={card.kicker} title={card.title} /></Sequence>)}
    <Grain strength={0.045} />
    <ChapterTag />
    <Captions />
    <Watermark />
    <Progress />
    {/* sound */}
    <Audio src={staticFile('long/drone_long.wav')} volume={(f) => interpolate(f, [0, 40, TOTAL - 120, TOTAL], [0, 0.5, 0.5, 0], { extrapolateRight: 'clamp' })} />
    <Sequence from={0} durationInFrames={line('03').from}>
      <Audio src={staticFile('sfx/heartbeat.wav')} volume={(f) => interpolate(f, [0, 20, line('03').from - 30, line('03').from], [0, 0.3, 0.3, 0], { extrapolateRight: 'clamp' })} />
    </Sequence>
    {SFX.map((item, index) => (
      <Sequence key={index} from={item.at} durationInFrames={item.len}>
        <Audio src={staticFile(item.file)} volume={(f) => item.volume * interpolate(f, [item.len - 20, item.len], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} />
      </Sequence>
    ))}
    {LINES.map((item) => (
      <Sequence key={item.id} from={item.from} durationInFrames={item.dur + 10}>
        <Audio src={staticFile(`long/vo/vo_${item.id}.wav`)} volume={1} />
      </Sequence>
    ))}
  </AbsoluteFill>
)
