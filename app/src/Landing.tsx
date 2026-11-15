import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, Stars } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { Outcome, TestPoint } from './types'
import { TEAM_MEMBERS, TEAM_NAME } from './config'

/* ------------------------------------------------------------------ */
/* Scroll progress shared between the DOM story and the 3D scene       */
/* ------------------------------------------------------------------ */
const scroll = { progress: 0, section: 0 }
const SECTIONS = 7

const OUTCOME_RGB: Record<Outcome, [number, number, number]> = {
  burned: [1, 0.35, 0.12],
  self_extinguished: [1, 0.77, 0.26],
  no_ignition: [0.25, 0.65, 1],
  unknown: [0.55, 0.6, 0.72],
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// atlas layout: O₂ 10..100 % -> x -7..7, pressure 0..22 psi -> y -3.6..3.6
const ATLAS_SHIFT = -1.9
const ax = (o2: number) => ATLAS_SHIFT - 6.2 + ((Math.min(100, Math.max(10, o2)) - 10) / 90) * 12.4
const ay = (p: number) => -3.4 + (Math.min(22, Math.max(0, p)) / 22) * 6.8

/* ------------------------------------------------------------------ */
/* The microgravity flame: a glowing blue sphere (what a candle does   */
/* without buoyancy)                                                   */
/* ------------------------------------------------------------------ */
function Flame() {
  const core = useRef<THREE.Mesh>(null)
  const halo = useRef<THREE.Mesh>(null)
  const group = useRef<THREE.Group>(null)
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFade: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec3 vNormal; varying vec3 vView; uniform float uTime;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal); vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vNormal; varying vec3 vView; uniform float uTime; uniform float uFade;
      void main() {
        float facing = max(dot(vNormal, vView), 0.0);
        float rim = pow(1.0 - facing, 2.6);
        float flicker = 0.9 + 0.1 * sin(uTime * 6.0 + vNormal.y * 4.0);
        vec3 blue = vec3(0.22, 0.5, 1.0);
        vec3 white = vec3(0.82, 0.92, 1.0);
        vec3 col = mix(blue * 0.55, white, rim) * flicker;
        float a = (0.07 + rim * 1.05) * uFade;
        gl_FragColor = vec4(col, a);
      }`,
  }), [])
  const haloMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uFade: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying vec3 vN; varying vec3 vV; uniform float uFade; void main(){ float d = max(dot(vN, vV), 0.0); float a = pow(d, 3.0) * 0.42 * uFade; gl_FragColor = vec4(0.3, 0.55, 1.0, a); }`,
  }), [])
  const coreMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uFade: { value: 1 }, uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying vec3 vN; varying vec3 vV; uniform float uFade; uniform float uTime; void main(){ float d = max(dot(vN, vV), 0.0); float a = pow(d, 1.6) * (0.55 + 0.1 * sin(uTime * 9.0)) * uFade; gl_FragColor = vec4(1.0, 0.62, 0.25, a); }`,
  }), [])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    material.uniforms.uTime.value = t
    coreMat.uniforms.uTime.value = t
    // the flame shrinks away as the particles form the atlas
    const fade = Math.max(1 - smooth(0.16, 0.3, scroll.progress), smooth(0.82, 0.97, scroll.progress))
    material.uniforms.uFade.value = fade
    haloMat.uniforms.uFade.value = fade
    coreMat.uniforms.uFade.value = fade
    if (group.current) {
      const s = 1 + Math.sin(t * 1.3) * 0.025
      group.current.scale.setScalar(s * (0.35 + fade * 0.65))
      group.current.visible = fade > 0.01
    }
    if (core.current) core.current.rotation.y = t * 0.2
    if (halo.current) halo.current.rotation.y = -t * 0.1
  })
  return (
    <group ref={group}>
      <mesh ref={core} material={material}><sphereGeometry args={[1.15, 96, 96]} /></mesh>
      <mesh ref={halo} material={haloMat}><sphereGeometry args={[2.3, 64, 64]} /></mesh>
      <mesh material={coreMat}><sphereGeometry args={[0.42, 48, 48]} /></mesh>
      <pointLight color="#5b8cff" intensity={6} distance={14} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* 1,719 NASA tests as particles: orbit cloud -> atlas layout           */
/* ------------------------------------------------------------------ */
function TestParticles({ tests }: { tests: TestPoint[] }) {
  const points = useRef<THREE.Points>(null)
  const { cloud, atlas, colors, solid } = useMemo(() => {
    const n = tests.length
    const cloud = new Float32Array(n * 3)
    const atlas = new Float32Array(n * 3)
    const colors = new Float32Array(n * 3)
    const solid = new Float32Array(n)
    tests.forEach((test, i) => {
      // golden-spiral shell around the flame, radius by investigation for subtle banding
      const k = i + 0.5
      const phi = Math.acos(1 - (2 * k) / n)
      const theta = Math.PI * (1 + Math.sqrt(5)) * k
      const r = 3.2 + ((test.investigation.charCodeAt(test.investigation.length - 1) % 7) / 7) * 2.4 + Math.sin(i) * 0.25
      cloud[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      cloud[i * 3 + 1] = r * Math.cos(phi) * 0.8
      cloud[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
      const o2 = test.o2_pct ?? 21
      const p = test.pressure_psi ?? 14.7
      const jitter = (Math.sin(i * 12.9898) * 43758.5453) % 1
      atlas[i * 3] = ax(o2) + jitter * 0.05
      atlas[i * 3 + 1] = ay(p) + ((Math.cos(i * 7.31) * 9999) % 1) * 0.05
      atlas[i * 3 + 2] = test.fuel_phase === 'solid' ? 0.6 : test.fuel_phase === 'liquid' ? 0 : -0.6
      const [r0, g0, b0] = OUTCOME_RGB[test.outcome]
      colors[i * 3] = r0; colors[i * 3 + 1] = g0; colors[i * 3 + 2] = b0
      solid[i] = test.fuel_phase === 'solid' ? 1 : 0
    })
    return { cloud, atlas, colors, solid }
  }, [tests])

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(cloud.slice(), 3))
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    g.setAttribute('aSolid', new THREE.BufferAttribute(solid, 1))
    return g
  }, [cloud, colors, solid])

  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uSize: { value: 0.15 }, uSolidFocus: { value: 0 }, uPixel: { value: 1 }, uMorph: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    vertexShader: `
      attribute float aSolid; varying vec3 vColor; varying float vAlpha;
      uniform float uSize; uniform float uSolidFocus; uniform float uPixel; uniform float uMorph;
      void main() {
        vColor = color;
        vAlpha = mix(0.95, aSolid > 0.5 ? 1.0 : 0.06, uSolidFocus);
        if (aSolid > 0.5) vColor = mix(color, vec3(1.0, 0.85, 0.6), uSolidFocus * 0.5);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float boost = (aSolid > 0.5 ? 1.0 + uSolidFocus * 2.2 : 1.0) * (1.0 + uMorph * 0.45);
        gl_PointSize = uSize * boost * uPixel * (300.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vColor; varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5; float d = length(c);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vColor * (0.6 + a), a * vAlpha);
      }`,
  }), [])

  const { gl } = useThree()
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const p = scroll.progress
    const morph = smooth(0.18, 0.36, p) * (1 - smooth(0.66, 0.8, p) * 0.85)
    material.uniforms.uSolidFocus.value = smooth(0.4, 0.48, p) * (1 - smooth(0.6, 0.66, p))
    material.uniforms.uPixel.value = gl.getPixelRatio()
    material.uniforms.uMorph.value = morph
    const pos = geometry.attributes.position.array as Float32Array
    const spin = t * 0.06
    const cs = Math.cos(spin); const sn = Math.sin(spin)
    for (let i = 0; i < pos.length; i += 3) {
      const cx = cloud[i] * cs - cloud[i + 2] * sn
      const cz = cloud[i] * sn + cloud[i + 2] * cs
      const cy = cloud[i + 1] + Math.sin(t * 0.6 + i) * 0.04
      pos[i] = cx + (atlas[i] - cx) * morph
      pos[i + 1] = cy + (atlas[i + 1] - cy) * morph
      pos[i + 2] = cz + (atlas[i + 2] - cz) * morph
    }
    geometry.attributes.position.needsUpdate = true
  })
  return <points ref={points} geometry={geometry} material={material} />
}

/* ------------------------------------------------------------------ */
/* Lunar habitat envelope (≥30 % O₂, ≤10.2 psi) and atlas axes          */
/* ------------------------------------------------------------------ */
function AtlasFrame() {
  const group = useRef<THREE.Group>(null)
  const boxMat = useRef<THREE.LineBasicMaterial>(null)
  const fillMat = useRef<THREE.MeshBasicMaterial>(null)
  const axisMat = useRef<THREE.LineBasicMaterial>(null)
  const [visible, setVisible] = useState(false)
  const box = useMemo(() => {
    const x0 = ax(30); const x1 = ax(100); const y0 = ay(0); const y1 = ay(10.2)
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 }
  }, [])
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(box.w, box.h, 2.2)), [box])
  const axes = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([ax(10), ay(0), 0, ax(100), ay(0), 0, ax(10), ay(0), 0, ax(10), ay(22), 0]), 3))
    return g
  }, [])
  useFrame(({ clock }) => {
    const p = scroll.progress
    const show = smooth(0.28, 0.38, p) * (1 - smooth(0.66, 0.76, p))
    const pulse = smooth(0.42, 0.5, p) * (1 - smooth(0.6, 0.66, p))
    if (boxMat.current) boxMat.current.opacity = show * (0.55 + pulse * 0.45 * (0.6 + 0.4 * Math.sin(clock.elapsedTime * 4)))
    if (fillMat.current) fillMat.current.opacity = show * (0.05 + pulse * 0.08)
    if (axisMat.current) axisMat.current.opacity = show * 0.5
    const v = show > 0.05
    if (group.current) group.current.visible = show > 0.005
    if (v !== visible) setVisible(v)
  })
  return (
    <group ref={group}>
      <lineSegments geometry={edges} position={[box.cx, box.cy, 0]}>
        <lineBasicMaterial ref={boxMat} color="#c9b6ff" transparent opacity={0} depthWrite={false} />
      </lineSegments>
      <mesh position={[box.cx, box.cy, 0]}>
        <boxGeometry args={[box.w, box.h, 2.2]} />
        <meshBasicMaterial ref={fillMat} color="#c9b6ff" transparent opacity={0} depthWrite={false} />
      </mesh>
      <lineSegments geometry={axes}><lineBasicMaterial ref={axisMat} color="#7d8bb3" transparent opacity={0} depthWrite={false} /></lineSegments>
      {visible && <>
        <Html position={[box.cx, ay(10.2) + 0.25, 1.2]} center className="landing-3d-label lunar">LUNAR HABITAT ENVELOPE · ≥30 % O₂ · ≤10.2 psi</Html>
        <Html position={[ax(17), ay(14.7) + 0.55, 0.8]} center className="landing-3d-label earth">EARTH AIR · ALL 263 SOLID TESTS</Html>
        <Html position={[ax(100), ay(0) - 0.45, 0]} center className="landing-3d-label axis">O₂ % →</Html>
        <Html position={[ax(10) - 0.6, ay(22), 0]} center className="landing-3d-label axis">pressure ↑</Html>
      </>}
    </group>
  )
}

/* A quiet Moon in the distance */
function Moon() {
  const ref = useRef<THREE.Mesh>(null)
  const texture = useMemo(() => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256
    const g = c.getContext('2d')!
    g.fillStyle = '#9a96ad'; g.fillRect(0, 0, 512, 256)
    for (let i = 0; i < 260; i += 1) {
      const x = (Math.sin(i * 91.7) * 0.5 + 0.5) * 512; const y = (Math.cos(i * 37.3) * 0.5 + 0.5) * 256
      const r = 2 + ((Math.sin(i * 13.1) * 0.5 + 0.5) ** 3) * 26
      g.fillStyle = `rgba(${50 + (i % 40)},${48 + (i % 35)},${66 + (i % 30)},${0.18 + (i % 5) * 0.05})`
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t
  }, [])
  useFrame(({ clock }) => {
    if (!ref.current) return
    ref.current.rotation.y = clock.elapsedTime * 0.03
    const p = scroll.progress
    ref.current.position.y = 5.2 - p * 3.5
  })
  return (
    <mesh ref={ref} position={[11, 5.2, -14]}>
      <sphereGeometry args={[3.4, 64, 64]} />
      <meshStandardMaterial map={texture} roughness={1} metalness={0} />
    </mesh>
  )
}

function CameraRig() {
  const { camera, pointer, size } = useThree()
  useFrame(() => {
    const p = scroll.progress
    const atlas = smooth(0.18, 0.36, p) * (1 - smooth(0.66, 0.8, p))
    // portrait screens need a wider view so the whole atlas fits
    const fit = Math.max(1, 1.45 / Math.max(0.4, size.width / size.height))
    const z = (11 + atlas * 1.6 - smooth(0.85, 1, p) * 1.5) * fit
    const targetX = pointer.x * 0.6 + atlas * 0.9
    const targetY = pointer.y * 0.35 + 0.4 * (1 - atlas)
    camera.position.x += (targetX - camera.position.x) * 0.05
    camera.position.y += (targetY - camera.position.y) * 0.05
    camera.position.z += (z - camera.position.z) * 0.06
    const portrait = size.width < size.height
    camera.lookAt(atlas * (portrait ? 0 : 0.9), portrait ? -2.6 : 0, 0)
  })
  return null
}

/* ------------------------------------------------------------------ */
/* DOM story                                                           */
/* ------------------------------------------------------------------ */
function useScrollProgress() {
  const [section, setSection] = useState(0)
  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      scroll.progress = max > 0 ? window.scrollY / max : 0
      const s = Math.min(SECTIONS - 1, Math.floor(window.scrollY / window.innerHeight + 0.45))
      scroll.section = s
      setSection(s)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll) }
  }, [])
  return section
}

export default function Landing({ onEnter }: { onEnter: () => void }) {
  const [tests, setTests] = useState<TestPoint[]>([])
  const section = useScrollProgress()
  const [webgl] = useState(() => {
    try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')) } catch { return false }
  })
  useEffect(() => {
    window.scrollTo(0, 0)
    fetch('/data/tests.json').then((r) => r.json()).then((rows: TestPoint[]) => setTests(rows)).catch(() => setTests([]))
  }, [])
  const solidCount = tests.filter((test) => test.fuel_phase === 'solid').length || 263
  const solidMax = tests.reduce((max, test) => test.fuel_phase === 'solid' && test.quality.o2_pct === 'measured' && (test.o2_pct ?? 0) > max ? (test.o2_pct ?? 0) : max, 0) || 22.2

  return (
    <div className="landing">
      <div className="landing-canvas" aria-hidden="true">
        {webgl ? <Canvas camera={{ position: [0, 0.4, 11], fov: 50 }} dpr={[1, 1.8]} gl={{ antialias: true, alpha: false }}>
          <color attach="background" args={['#03050b']} />
          <fog attach="fog" args={['#03050b', 16, 34]} />
          <ambientLight intensity={0.25} />
          <directionalLight position={[-6, 4, 6]} intensity={1.4} color="#dfe6ff" />
          <Stars radius={60} depth={40} count={2600} factor={3.2} saturation={0} fade speed={0.6} />
          <Moon />
          <Flame />
          {tests.length > 0 && <TestParticles tests={tests} />}
          <AtlasFrame />
          <CameraRig />
        </Canvas> : <div className="landing-fallback" />}
      </div>

      <nav className="landing-nav">
        <span className="brand"><span className="brand-mark" aria-hidden="true">⌖</span><span className="brand-name">FIRE <b>ATLAS</b></span></span>
        <div className="landing-progress" aria-hidden="true">{Array.from({ length: SECTIONS }, (_, i) => <i key={i} className={i === section ? 'on' : ''} />)}</div>
        <button type="button" className="landing-cta small" onClick={onEnter}>Open the atlas →</button>
      </nav>

      <main className="landing-story">
        <section className={`story-block hero ${section === 0 ? 'active' : ''}`}>
          <p className="eyebrow-line">NASA Space Apps 2026 · Flame in Freefall</p>
          <h1>Fire behaves differently<br />when nothing falls.</h1>
          <p className="lede">Without gravity a candle flame becomes a ghostly blue sphere. NASA has burned hundreds of materials in orbit to learn how. FIRE ATLAS puts every one of those tests on a single map — and checks it against the habitats we are about to build on the Moon.</p>
          <div className="hero-actions"><button type="button" className="landing-cta" onClick={onEnter}>Open the atlas</button><span className="scroll-cue">Scroll to see what the data says ↓</span></div>
        </section>

        <section className={`story-block left ${section === 1 ? 'active' : ''}`}>
          <p className="eyebrow-line">01 · The data</p>
          <h2><span className="big-number">{(tests.length || 1719).toLocaleString()}</span> microgravity fire tests</h2>
          <p className="lede">From <b>25 investigations</b> and <b>22 experimental tables</b> in NASA's Physical Sciences Informatics database — BASS, SAFFIRE, FLEX, CFI, ACME and more. Every particle around the flame is one real test, colored by what happened: <span className="c-burn">burned</span>, <span className="c-self">self-extinguished</span>, <span className="c-noign">did not ignite</span>.</p>
        </section>

        <section className={`story-block right ${section === 2 ? 'active' : ''}`}>
          <p className="eyebrow-line">02 · The atlas</p>
          <h2>Now put every test where it belongs.</h2>
          <p className="lede">Left to right: more oxygen. Bottom to top: more pressure. The violet box is where planned lunar habitats will live — at least <b>30 % oxygen</b> and no more than <b>10.2 psi</b>, so astronauts can step into their suits faster.</p>
        </section>

        <section className={`story-block right ${section === 3 ? 'active' : ''}`}>
          <p className="eyebrow-line alert">03 · The gap</p>
          <h2>Every solid material: <span className="c-burn">≤ {solidMax.toFixed(1)} % O₂</span>.<br />Inside the lunar box: <span className="c-alert">zero</span>.</h2>
          <p className="lede">All <b>{solidCount}</b> tests of fabrics and plastics — the things that actually burn in a cabin — were run at Earth-like air. The Moon base example is <b>34 % oxygen at 8.2 psi</b>. No solid material in NASA's database has been tested there.</p>
        </section>

        <section className={`story-block right ${section === 4 ? 'active' : ''}`}>
          <p className="eyebrow-line">04 · SI with receipts</p>
          <h2>Ask in plain English. Get answers you can audit.</h2>
          <ul className="proof-list">
            <li><b>Deterministic facts first.</b> Code computes 97 source-backed facts; the SI only explains them.</li>
            <li><b>Every sentence cited, every number verified.</b> Unsupported claims are removed before you see them.</li>
            <li><b>The original NASA row.</b> Any point opens the exact spreadsheet row it came from — unmodified.</li>
          </ul>
        </section>

        <section className={`story-block left ${section === 5 ? 'active' : ''}`}>
          <p className="eyebrow-line">05 · Beyond the gap</p>
          <h2>Gravity bounds, material readiness, comparisons, export.</h2>
          <p className="lede">The same SAFFIRE-II samples burned at 1 g and in microgravity give different answers — the Moon sits in between. A readiness matrix shows which cabin materials have no lunar-oxygen data, and every filtered test exports with its DOI for modeling.</p>
        </section>

        <section className={`story-block center final ${section === 6 ? 'active' : ''}`}>
          <h2>Find the gap before the fire does.</h2>
          <button type="button" className="landing-cta big" onClick={onEnter}>Open the atlas →</button>
          <p className="credits">Team {TEAM_NAME} · {TEAM_MEMBERS.join(' · ')}<br />Data: NASA Physical Sciences Informatics (psi.nasa.gov) · NASA Space Apps Challenge 2026 · Karachi</p>
        </section>
      </main>
    </div>
  )
}
