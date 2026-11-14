// Visual layers for the condition-space atlas. Everything here is derived from the
// normalized PSI test points; nothing is modeled or interpolated beyond simple counting.
import type { Data } from 'plotly.js'
import type { FuelPhase, TestPoint } from '../types'

const MONO = 'JetBrains Mono, monospace'

/* ------------------------------------------------------------------ */
/* 1. O₂ partial-pressure isobars: pressure = pO₂ · 100 / O₂%           */
/* ------------------------------------------------------------------ */

export const EARTH_PO2_PSI = 20.9 * 14.7 / 100 // 3.07 psi, sea-level reference used across the app

export interface Isobar { po2: number; label: string; emphasis: boolean }

export const ISOBARS: Isobar[] = [
  { po2: 2, label: 'pO₂ 2.0', emphasis: false },
  { po2: EARTH_PO2_PSI, label: 'EARTH pO₂ 3.07 psi', emphasis: true },
  { po2: 4.3, label: 'pO₂ 4.3', emphasis: false },
  { po2: 6, label: 'pO₂ 6.0', emphasis: false },
  { po2: 10, label: 'pO₂ 10', emphasis: false },
  { po2: 16.7, label: 'pO₂ 16.7', emphasis: false },
]

/** Curves of constant O₂ partial pressure across the visible O₂ range (2D only). */
export function isobarTraces(xRange: [number, number], yMax: number): Data[] {
  const x0 = Math.max(1, xRange[0])
  const steps = 90
  return ISOBARS.map((isobar) => {
    const xs: number[] = []
    const ys: number[] = []
    for (let i = 0; i <= steps; i += 1) {
      const x = x0 + (xRange[1] - x0) * (i / steps)
      const y = isobar.po2 * 100 / x
      if (y <= yMax * 1.02) { xs.push(x); ys.push(y) }
    }
    return {
      type: 'scatter',
      mode: 'lines',
      name: `Isobar ${isobar.po2.toFixed(2)}`,
      x: xs,
      y: ys,
      line: {
        color: isobar.emphasis ? 'rgba(127, 212, 193, 0.75)' : 'rgba(170, 182, 222, 0.22)',
        width: isobar.emphasis ? 1.6 : 1,
        dash: isobar.emphasis ? 'solid' : 'dot',
      },
      hovertemplate: `${isobar.emphasis ? 'EARTH REFERENCE · ' : ''}O₂ partial pressure ${isobar.po2.toFixed(2)} psi<br>O₂ %{x:.1f}% × %{y:.2f} psi<extra></extra>`,
      hoverlabel: { bgcolor: '#0f1528', bordercolor: '#7fd4c1', font: { family: MONO, color: '#e6ecff', size: 11 } },
      showlegend: false,
    } as unknown as Data
  })
}

/** Label positions for isobars: place each label where the curve leaves the top or right edge. */
export function isobarAnnotations(xRange: [number, number], yRange: [number, number], narrow: boolean) {
  return ISOBARS.map((isobar) => {
    // Put the label near the right edge if the curve is inside the plot there, otherwise at the top edge.
    const yAtRight = isobar.po2 * 100 / (xRange[1] - 1)
    const inside = yAtRight >= yRange[0] && yAtRight <= yRange[1] * 0.97
    const x = inside ? xRange[1] - 1 : isobar.po2 * 100 / (yRange[1] * 0.97)
    const y = inside ? yAtRight : yRange[1] * 0.97
    if (x < xRange[0] || x > xRange[1]) return null
    return {
      x, y, xref: 'x' as const, yref: 'y' as const,
      text: isobar.emphasis ? isobar.label : isobar.label,
      showarrow: false,
      xanchor: inside ? 'right' as const : 'left' as const,
      yanchor: 'bottom' as const,
      font: { family: MONO, size: narrow ? 7 : 8, color: isobar.emphasis ? '#7fd4c1' : 'rgba(170,182,222,0.55)' },
    }
  }).filter((item): item is NonNullable<typeof item> => item != null)
}

/* ------------------------------------------------------------------ */
/* 2. Aggregation of stacked tests at identical coordinates            */
/* ------------------------------------------------------------------ */

export interface AggregatedPoint {
  x: number
  y: number
  ids: string[]
  investigations: string[]
  materials: string[]
  flow: number | null
}

/** Groups tests that share the same plotted coordinate (0.05 resolution) so stacks become one sized marker. */
export function aggregatePoints(points: TestPoint[], yFor: (point: TestPoint) => number | null): AggregatedPoint[] {
  const groups = new Map<string, AggregatedPoint>()
  for (const point of points) {
    const y = yFor(point)
    if (point.o2_pct == null || y == null) continue
    const key = `${Math.round(point.o2_pct * 20)}|${Math.round(y * 20)}`
    const group = groups.get(key)
    if (group) {
      group.ids.push(point.id)
      if (!group.investigations.includes(point.investigation)) group.investigations.push(point.investigation)
      if (point.material && !group.materials.includes(point.material) && group.materials.length < 4) group.materials.push(point.material)
    } else {
      groups.set(key, { x: point.o2_pct, y, ids: [point.id], investigations: [point.investigation], materials: point.material ? [point.material] : [], flow: point.flow_cm_s })
    }
  }
  return [...groups.values()]
}

/** Marker diameter grows with the log of the stack size so a 400-test stack stays readable. */
export function stackSize(count: number, base: number): number {
  return Math.min(base + 3.2 * Math.log2(count), base + 18)
}

/* ------------------------------------------------------------------ */
/* 3. Evidence-coverage heat layer                                     */
/* ------------------------------------------------------------------ */

export type CoverageLayer = 'off' | 'all' | FuelPhase

/** Smoothed test density on a grid; empty regions stay fully transparent so gaps read as dark. */
export function coverageHeatmap(points: TestPoint[], xRange: [number, number], yRange: [number, number]): Data | null {
  const nx = 84
  const ny = 60
  const dx = (xRange[1] - xRange[0]) / nx
  const dy = (yRange[1] - yRange[0]) / ny
  const grid = Array.from({ length: ny }, () => new Array<number>(nx).fill(0))
  let any = false
  // Gaussian kernel ~2 % O₂ and ~0.6 psi wide: enough to read as a region, small enough not to invent coverage.
  const sx = 2.0
  const sy = 0.6
  const rx = Math.ceil((4 * sx) / dx)
  const ry = Math.ceil((4 * sy) / dy)
  for (const point of points) {
    if (point.o2_pct == null || point.pressure_psi == null) continue
    const cx = Math.floor((point.o2_pct - xRange[0]) / dx)
    const cy = Math.floor((point.pressure_psi - yRange[0]) / dy)
    if (cx < -rx || cx > nx + rx || cy < -ry || cy > ny + ry) continue
    any = true
    for (let j = Math.max(0, cy - ry); j <= Math.min(ny - 1, cy + ry); j += 1) {
      const gy = yRange[0] + (j + 0.5) * dy
      for (let i = Math.max(0, cx - rx); i <= Math.min(nx - 1, cx + rx); i += 1) {
        const gx = xRange[0] + (i + 0.5) * dx
        const w = Math.exp(-(((gx - point.o2_pct) / sx) ** 2 + ((gy - point.pressure_psi) / sy) ** 2) / 2)
        grid[j][i] += w
      }
    }
  }
  if (!any) return null
  // log scaling keeps a single test visible next to a 400-test stack
  const z = grid.map((row) => row.map((value) => value < 0.004 ? null : Math.log1p(value)))
  const zMax = Math.max(...z.flat().map((value) => value ?? 0))
  return {
    type: 'heatmap',
    name: 'Evidence coverage',
    x: Array.from({ length: nx }, (_, i) => xRange[0] + (i + 0.5) * dx),
    y: Array.from({ length: ny }, (_, j) => yRange[0] + (j + 0.5) * dy),
    z,
    zsmooth: 'best',
    zmin: 0,
    zmax: zMax || 1,
    zauto: false,
    colorscale: [
      [0, 'rgba(127,212,193,0)'],
      [0.12, 'rgba(127,212,193,0.14)'],
      [0.45, 'rgba(127,212,193,0.32)'],
      [1, 'rgba(127,212,193,0.58)'],
    ],
    showscale: false,
    hoverinfo: 'skip',
  } as unknown as Data
}

/* ------------------------------------------------------------------ */
/* 4. 3D evidence towers                                               */
/* ------------------------------------------------------------------ */

export interface TowerCell { o2: [number, number]; p: [number, number]; count: number; burned: number; selfExt: number; noIgn: number; unknown: number; investigations: string[] }

export const TOWER_O2_STEP = 5
export const TOWER_P_STEP = 1

export function towerCells(points: TestPoint[], xRange: [number, number], yRange: [number, number]): TowerCell[] {
  const cells = new Map<string, TowerCell>()
  for (const point of points) {
    if (point.o2_pct == null || point.pressure_psi == null) continue
    if (point.o2_pct < xRange[0] || point.o2_pct > xRange[1] || point.pressure_psi < yRange[0] || point.pressure_psi > yRange[1]) continue
    const ix = Math.floor(point.o2_pct / TOWER_O2_STEP)
    const iy = Math.floor(point.pressure_psi / TOWER_P_STEP)
    const key = `${ix}|${iy}`
    let cell = cells.get(key)
    if (!cell) {
      cell = { o2: [ix * TOWER_O2_STEP, (ix + 1) * TOWER_O2_STEP], p: [iy * TOWER_P_STEP, (iy + 1) * TOWER_P_STEP], count: 0, burned: 0, selfExt: 0, noIgn: 0, unknown: 0, investigations: [] }
      cells.set(key, cell)
    }
    cell.count += 1
    if (point.outcome === 'burned') cell.burned += 1
    else if (point.outcome === 'self_extinguished') cell.selfExt += 1
    else if (point.outcome === 'no_ignition') cell.noIgn += 1
    else cell.unknown += 1
    if (!cell.investigations.includes(point.investigation)) cell.investigations.push(point.investigation)
  }
  return [...cells.values()]
}

export const towerHeight = (count: number) => Math.log10(1 + count)

/** One mesh3d trace holding every tower (a box per non-empty cell), colored by test count. */
export function towerTraces(cells: TowerCell[]): Data[] {
  const x: number[] = []; const y: number[] = []; const z: number[] = []
  const i: number[] = []; const j: number[] = []; const k: number[] = []
  const intensity: number[] = []
  const text: string[] = []
  // box faces as triangles over 8 vertices (0-3 bottom, 4-7 top)
  const faces = [[0, 1, 2], [0, 2, 3], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]
  const pad = 0.12
  for (const cell of cells) {
    const h = towerHeight(cell.count)
    const x0 = cell.o2[0] + TOWER_O2_STEP * pad; const x1 = cell.o2[1] - TOWER_O2_STEP * pad
    const y0 = cell.p[0] + TOWER_P_STEP * pad; const y1 = cell.p[1] - TOWER_P_STEP * pad
    const base = x.length
    const corners: Array<[number, number, number]> = [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0], [x0, y0, h], [x1, y0, h], [x1, y1, h], [x0, y1, h]]
    const label = `<b>${cell.count} test${cell.count === 1 ? '' : 's'}</b><br>O₂ ${cell.o2[0]}–${cell.o2[1]} % · ${cell.p[0]}–${cell.p[1]} psi<br>burned ${cell.burned} · self-ext ${cell.selfExt} · no ign ${cell.noIgn} · unknown ${cell.unknown}<br>${cell.investigations.join(', ')}`
    for (const [cx, cy, cz] of corners) { x.push(cx); y.push(cy); z.push(cz); intensity.push(h); text.push(label) }
    for (const [a, b, c] of faces) { i.push(base + a); j.push(base + b); k.push(base + c) }
  }
  if (!x.length) return []
  return [{
    type: 'mesh3d',
    name: 'Evidence towers',
    x, y, z, i, j, k,
    intensity,
    colorscale: [[0, '#3a2a40'], [0.35, '#a33d1f'], [0.7, '#ff5a1f'], [1, '#ffc542']],
    showscale: false,
    flatshading: true,
    lighting: { ambient: 0.65, diffuse: 0.7, specular: 0.15, roughness: 0.6 },
    lightposition: { x: 100, y: 200, z: 300 },
    text,
    hovertemplate: '%{text}<extra></extra>',
    hoverlabel: { bgcolor: '#0f1528', bordercolor: '#ff5a1f', font: { family: MONO, color: '#e6ecff', size: 11 } },
    opacity: 1,
  } as unknown as Data]
}

/** Translucent box marking the planned lunar habitat envelope in the tower view. */
export function lunarEnvelopeBox(xMax: number, zMax: number): Data {
  const x0 = 30; const x1 = xMax; const y0 = 0; const y1 = 10.2; const z0 = 0; const z1 = zMax
  return {
    type: 'mesh3d',
    name: 'Lunar habitat envelope',
    x: [x0, x1, x1, x0, x0, x1, x1, x0],
    y: [y0, y0, y1, y1, y0, y0, y1, y1],
    z: [z0, z0, z0, z0, z1, z1, z1, z1],
    i: [0, 0, 4, 4, 0, 0, 1, 1, 2, 2, 3, 3],
    j: [1, 2, 5, 6, 1, 5, 2, 6, 3, 7, 0, 4],
    k: [2, 3, 6, 7, 5, 4, 6, 5, 7, 6, 4, 7],
    color: '#c9b6ff',
    opacity: 0.1,
    flatshading: true,
    hoverinfo: 'skip',
    showscale: false,
  } as unknown as Data
}
