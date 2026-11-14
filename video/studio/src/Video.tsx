import React from 'react'
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion'
import { Grain, fade } from './components'
import { Ask, Atlas, Briefing, Coverage, End, Hook, Moon, Receipt, Towers } from './scenes'
import { C, F, loadFonts, SCENES, TOTAL_FRAMES, VO, ZERO_FRAME } from './theme'

loadFonts()

const scene = (key: keyof typeof SCENES) => ({ from: SCENES[key][0], durationInFrames: SCENES[key][1] - SCENES[key][0] })

/** Short cross-dissolve at each cut so scenes never pop. */
const Cut: React.FC<{ children: React.ReactNode; len: number; fadeIn?: number; fadeOut?: number }> = ({ children, len, fadeIn = 5, fadeOut = 5 }) => {
  const frame = useCurrentFrame()
  const opacity = Math.min(fadeIn ? fade(frame, 0, fadeIn) : 1, fadeOut ? 1 - fade(frame, len - fadeOut, fadeOut) : 1)
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>
}

const Captions: React.FC = () => {
  const frame = useCurrentFrame()
  const line = VO.find((item) => frame >= item.from && frame < item.from + Math.round(item.dur * 30) + 6)
  if (!line || line === VO[VO.length - 1]) return null // end card already shows the tagline
  const local = frame - line.from
  const end = Math.round(line.dur * 30) + 6
  const opacity = Math.min(fade(local, 0, 5), 1 - fade(local, end - 5, 5))
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 64, pointerEvents: 'none' }}>
      <div style={{ opacity, maxWidth: 1780, textAlign: 'center', fontFamily: F.body, fontWeight: 500, fontSize: 36, lineHeight: 1.3, color: '#f2f5ff', background: 'rgba(3,5,10,0.72)', padding: '10px 26px', borderRadius: 6, textShadow: '0 2px 8px rgba(0,0,0,0.6)' }}>{line.text}</div>
    </AbsoluteFill>
  )
}

const Watermark: React.FC = () => (
  <div style={{ position: 'absolute', right: 26, bottom: 20, fontFamily: F.mono, fontSize: 15, letterSpacing: '0.12em', color: 'rgba(230,236,255,0.38)' }}>SI-ASSISTED PRODUCTION</div>
)

/** Sound design: volumes chosen against measured source loudness (see video/README). */
const SFX: Array<{ file: string; at: number; volume: number; trim?: number; len?: number }> = [
  { file: 'sfx/boom_open.wav', at: 4, volume: 0.45 },
  { file: 'sfx/subsonic.wav', at: 126, volume: 0.55, len: 120 },
  { file: 'sfx/whoosh.wav', at: 172, volume: 0.42 },
  { file: 'sfx/digits.wav', at: 192, volume: 0.22, len: 42 },
  { file: 'sfx/swoosh_fast.wav', at: 270, volume: 0.5 },
  { file: 'sfx/data_transfer.wav', at: 282, volume: 0.42 },
  { file: 'sfx/power_up.wav', at: 410, volume: 0.42 },
  { file: 'sfx/whoosh.wav', at: 522, volume: 0.42 },
  { file: 'sfx/buildup.wav', at: ZERO_FRAME - 56, volume: 1.0 },
  { file: 'sfx/grand_hit.wav', at: ZERO_FRAME, volume: 0.75, len: 110 },
  { file: 'sfx/sub_drop.wav', at: ZERO_FRAME, volume: 0.5, len: 100 },
  { file: 'sfx/swoosh_fast.wav', at: 606, volume: 0.5 },
  { file: 'sfx/keys.wav', at: 614, volume: 0.28 },
  { file: 'sfx/keys.wav', at: 627, volume: 0.24 },
  { file: 'sfx/click.wav', at: 650, volume: 0.5 },
  { file: 'sfx/access.wav', at: 662, volume: 0.55 },
  { file: 'sfx/swoosh_fast.wav', at: 699, volume: 0.45 },
  { file: 'sfx/click.wav', at: 712, volume: 0.45 },
  { file: 'sfx/whoosh.wav', at: 756, volume: 0.45 },
  { file: 'sfx/space_impact.wav', at: 764, volume: 0.6 },
]

const SoundBed: React.FC = () => (
  <>
    <Audio src={staticFile('sfx/drone.wav')} volume={(f) => {
      const swell = interpolate(f, [0, 30, 380, 520, ZERO_FRAME, ZERO_FRAME + 30, 760, 860, TOTAL_FRAMES], [0, 0.55, 0.55, 0.75, 0.9, 0.5, 0.55, 0.45, 0], { extrapolateRight: 'clamp' })
      return swell
    }} />
    <Sequence from={0} durationInFrames={176}>
      <Audio src={staticFile('sfx/heartbeat.wav')} volume={(f) => interpolate(f, [0, 20, 150, 176], [0, 0.32, 0.32, 0], { extrapolateRight: 'clamp' })} />
    </Sequence>
    {SFX.map((item, index) => (
      <Sequence key={index} from={item.at} durationInFrames={item.len ?? 90}>
        <Audio src={staticFile(item.file)} volume={(f) => item.volume * (item.len ? interpolate(f, [item.len - 20, item.len], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 1)} />
      </Sequence>
    ))}
    {VO.map((line) => (
      <Sequence key={line.file} from={line.from} durationInFrames={Math.round(line.dur * 30) + 8}>
        <Audio src={staticFile(line.file)} volume={1} />
      </Sequence>
    ))}
  </>
)

export const FireAtlasDemo: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.bg }}>
    <Sequence {...scene('hook')}><Hook /></Sequence>
    <Sequence {...scene('moon')}><Moon /></Sequence>
    <Sequence {...scene('atlas')}><Cut len={108}><Atlas /></Cut></Sequence>
    <Sequence {...scene('coverage')}><Cut len={144}><Coverage /></Cut></Sequence>
    <Sequence {...scene('towers')}><Cut len={84} fadeOut={4}><Towers /></Cut></Sequence>
    <Sequence {...scene('ask')}><Cut len={45} fadeOut={3}><Ask /></Cut></Sequence>
    <Sequence {...scene('briefing')}><Cut len={45} fadeIn={3} fadeOut={3}><Briefing /></Cut></Sequence>
    <Sequence {...scene('receipt')}><Cut len={60} fadeIn={3}><Receipt /></Cut></Sequence>
    <Sequence {...scene('end')}><Cut len={114} fadeOut={0}><End /></Cut></Sequence>
    <Grain strength={0.05} />
    <Captions />
    <Watermark />
    <SoundBed />
  </AbsoluteFill>
)
