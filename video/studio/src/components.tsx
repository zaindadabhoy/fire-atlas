import React from 'react'
import { AbsoluteFill, Easing, interpolate, OffthreadVideo, staticFile, useCurrentFrame } from 'remotion'
import { C, F, H, rand, W } from './theme'

export const ease = Easing.bezier(0.2, 0.8, 0.2, 1)
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1)

export function fade(frame: number, start: number, dur = 10, from = 0, to = 1) {
  return interpolate(frame, [start, start + dur], [from, to], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease })
}

/** Rising embers: deterministic particles drifting upward. */
export const Embers: React.FC<{ count?: number; intensity?: number; color?: string }> = ({ count = 70, intensity = 1, color = C.flame }) => {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        {Array.from({ length: count }, (_, i) => {
          const speed = 0.6 + rand(i + 1) * 1.8
          const x0 = rand(i + 11) * W
          const sway = Math.sin((frame + i * 37) / (30 + rand(i + 3) * 40)) * (18 + rand(i + 7) * 30)
          const y = (H + 40) - ((frame * speed * 2.2 + rand(i + 5) * (H + 200)) % (H + 200))
          const r = 0.8 + rand(i + 9) * 2.4
          const life = Math.max(0, Math.min(1, y / H))
          const flicker = 0.55 + 0.45 * Math.sin(frame / (3 + rand(i) * 4) + i)
          return <circle key={i} cx={x0 + sway} cy={y} r={r} fill={color} opacity={life * flicker * 0.75 * intensity} style={{ filter: 'blur(0.6px)' }} />
        })}
      </svg>
    </AbsoluteFill>
  )
}

/** Film grain + vignette for a cinematic finish. */
export const Grain: React.FC<{ strength?: number }> = ({ strength = 0.06 }) => {
  const frame = useCurrentFrame()
  const seed = frame % 8
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)' }} />
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0, opacity: strength, mixBlendMode: 'overlay' }}>
        <filter id={`grain${seed}`}><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={seed} /></filter>
        <rect width={W} height={H} filter={`url(#grain${seed})`} />
      </svg>
    </AbsoluteFill>
  )
}

/** App footage with a keyframed virtual camera (scale + focus point in source pixels). */
export const Footage: React.FC<{
  src: string
  startFrom: number // seconds into the clip
  rate?: number
  keys: Array<{ f: number; scale: number; x: number; y: number }> // f = local frame
  dim?: number
  blur?: number
}> = ({ src, startFrom, rate = 1, keys, dim = 0, blur = 0 }) => {
  const frame = useCurrentFrame()
  const fs = keys.map((k) => k.f)
  const opts = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const, easing: easeInOut }
  const scale = keys.length > 1 ? interpolate(frame, fs, keys.map((k) => k.scale), opts) : keys[0].scale
  const fx = keys.length > 1 ? interpolate(frame, fs, keys.map((k) => k.x), opts) : keys[0].x
  const fy = keys.length > 1 ? interpolate(frame, fs, keys.map((k) => k.y), opts) : keys[0].y
  // keep the focus point centered, but never show outside the 1920x1080 source
  const half = (v: number, size: number) => Math.min(Math.max(v, size / (2 * scale)), size - size / (2 * scale))
  const cx = half(fx, W)
  const cy = half(fy, H)
  const tx = W / 2 - cx * scale
  const ty = H / 2 - cy * scale
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', width: W, height: H, transformOrigin: '0 0', transform: `translate(${tx}px, ${ty}px) scale(${scale})`, filter: blur ? `blur(${blur}px)` : undefined }}>
        <OffthreadVideo src={staticFile(src)} startFrom={Math.round(startFrom * 30)} playbackRate={rate} muted style={{ width: W, height: H }} />
      </div>
      {dim > 0 && <AbsoluteFill style={{ backgroundColor: `rgba(3,5,10,${dim})` }} />}
    </AbsoluteFill>
  )
}

export const Kicker: React.FC<{ children: React.ReactNode; color?: string; style?: React.CSSProperties }> = ({ children, color = C.flame, style }) => (
  <div style={{ fontFamily: F.mono, fontSize: 22, letterSpacing: '0.16em', textTransform: 'uppercase', color, ...style }}>{children}</div>
)

/** Glass-free, hairline "instrument" panel used for overlays on footage. */
export const Panel: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ background: 'rgba(5,7,13,0.86)', border: `1px solid ${C.line}`, borderRadius: 6, padding: '22px 28px', boxShadow: '0 20px 60px rgba(0,0,0,0.55)', ...style }}>{children}</div>
)

/** Counts a number up between two frames with tabular digits. */
export const Count: React.FC<{ from?: number; to: number; start: number; dur?: number; decimals?: number; style?: React.CSSProperties; suffix?: string }> = ({ from = 0, to, start, dur = 24, decimals = 0, style, suffix = '' }) => {
  const frame = useCurrentFrame()
  const value = interpolate(frame, [start, start + dur], [from, to], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease })
  return <span style={{ fontVariantNumeric: 'tabular-nums', ...style }}>{value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</span>
}

/** Thin corner brackets — the app's instrument-frame motif. */
export const Brackets: React.FC<{ opacity?: number; inset?: number; color?: string }> = ({ opacity = 1, inset = 40, color = '#2a3558' }) => {
  const s = 34
  const common: React.CSSProperties = { position: 'absolute', width: s, height: s, borderColor: color, borderStyle: 'solid', opacity }
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ ...common, left: inset, top: inset, borderWidth: '2px 0 0 2px' }} />
      <div style={{ ...common, right: inset, top: inset, borderWidth: '2px 2px 0 0' }} />
      <div style={{ ...common, left: inset, bottom: inset, borderWidth: '0 0 2px 2px' }} />
      <div style={{ ...common, right: inset, bottom: inset, borderWidth: '0 2px 2px 0' }} />
    </AbsoluteFill>
  )
}
