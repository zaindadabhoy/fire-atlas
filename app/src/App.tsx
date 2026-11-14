import { AnimatePresence, animate, motion, useMotionValue } from 'motion/react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { Config, Data, Layout, PlotlyHTMLElement } from 'plotly.js'
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react'
import { rankInvestigations, type RankedInvestigation, type SafetyPillar } from './lib/rank'
import { citeLabel } from './lib/cite'
import { SourceRowModal } from './SourceRowModal'
import { InsightsView } from './InsightsView'
import { parseQuestionRules, type ParsedQuestion } from './lib/parseQuestion'
import { aggregatePoints, coverageHeatmap, isobarAnnotations, isobarTraces, lunarEnvelopeBox, stackSize, towerCells, towerHeight, towerTraces, type CoverageLayer } from './lib/layers'
import CompareView from './CompareView'
import DataView from './DataView'
import { EVENT_LINE, TEAM_MEMBERS, TEAM_NAME } from './config'
import type { BriefingResponse, CoveragePhase, DetectionRecord, Envelope, FindingFact, FindingsData, FuelPhase, Habitat, Investigation, Outcome, QualityFlag, TestPoint } from './types'

type PlotlyRuntime = typeof import('plotly.js/lib/core').default
let plotlyRuntimePromise: Promise<PlotlyRuntime> | null = null

function loadPlotlyRuntime(): Promise<PlotlyRuntime> {
  if (!plotlyRuntimePromise) {
    plotlyRuntimePromise = Promise.all([
      import('plotly.js/lib/core'),
      import('plotly.js/lib/scatter3d'),
      import('plotly.js/lib/heatmap'),
      import('plotly.js/lib/mesh3d'),
    ]).then(([core, scatter3d, heatmap, mesh3d]) => {
      const plotly = core.default
      plotly.register([scatter3d.default, heatmap.default, mesh3d.default])
      ;(window as unknown as { __fireAtlasPlotly?: PlotlyRuntime }).__fireAtlasPlotly = plotly // used by the demo recorder for smooth camera moves
      return plotly
    })
  }
  return plotlyRuntimePromise
}

const Plot = lazy(async () => {
  const [plotly, factory] = await Promise.all([loadPlotlyRuntime(), import('react-plotly.js/factory')])
  return { default: factory.default(plotly) }
})

const outcomes: Outcome[] = ['burned', 'self_extinguished', 'no_ignition', 'unknown']
const phases: FuelPhase[] = ['gas', 'liquid', 'solid']
const pillars: SafetyPillar[] = ['prevention', 'detection', 'suppression']
const outcomeStyles: Record<Outcome, { label: string; color: string }> = {
  burned: { label: 'Burned', color: '#ff5a1f' },
  self_extinguished: { label: 'Self-extinguished', color: '#ffc542' },
  no_ignition: { label: 'No ignition', color: '#3fa7ff' },
  unknown: { label: 'Unknown', color: '#8290aa' },
}
const phaseStyles: Record<FuelPhase, { label: string; symbol: string }> = {
  gas: { label: 'Gas', symbol: 'circle' },
  liquid: { label: 'Droplet', symbol: 'diamond' },
  solid: { label: 'Solid', symbol: 'square' },
}
const investigationColors = ['#56627b', '#65728a', '#737f96', '#4e5a70', '#7c879c', '#5c6a82', '#68758b', '#535f75', '#78849a', '#606d84', '#707c91', '#4c5870']
const plotConfig: Partial<Config> = { displaylogo: false, responsive: true, displayModeBar: false, scrollZoom: true }
const towerTickValues = [1, 10, 100, 500]

interface MaterialOption { key: string; label: string; phase: FuelPhase; material: string }
interface ZoomRange { x: [number, number]; y: [number, number] }

function formatValue(value: number | null | undefined, suffix = '', digits = 2): string {
  if (value == null || !Number.isFinite(value)) return 'Not reported'
  return `${Number.isInteger(value) ? value : value.toFixed(digits)}${suffix}`
}

function labelFromKey(key: string): string {
  const units: Record<string, string> = {
    burn_time_s: 'Burn time (s)', tad_k: 'Adiabatic flame temperature (K)', peak_burner_t_c: 'Peak burner temperature (°C)',
    hydrocarbon_burn_rate_mg_s: 'Hydrocarbon burn rate (mg/s)', oxygen_flow_rate_mg_s: 'Oxygen flow rate (mg/s)',
    fuel_rate_mg_s: 'Fuel rate (mg/s)', nitrogen_rate_mg_s: 'Nitrogen rate (mg/s)', fuel_fraction: 'Fuel fraction',
    mean_stoichiometric_fraction: 'Mean stoichiometric fraction', initial_droplet_diameter_mm: 'Initial droplet diameter (mm)',
    visible_extinction_diameter_mm: 'Visible flame extinction diameter (mm)', burning_rate_mm_s: 'Burning rate (mm/s)',
    fan_display: 'Fan display (setting)', o2_drop_pct: 'O₂ decrease (percentage points)', co_rise_ppm: 'CO increase (ppm)',
    sample_thickness_um: 'Sample thickness (µm)', sample_geometry: 'Geometry', sample_diameter_cm: 'Sample diameter (cm)',
    sample_thickness_cm: 'Sample thickness (cm)', sample_thickness_raw: 'Sample thickness (raw PSI text)',
    sample_thickness_mm_values: 'Sample thickness values (mm)', sample_length_cm: 'Sample length (cm)',
    sample_width_cm: 'Sample width (cm)', flow_direction: 'Flow direction', ignition_time_s: 'Ignition time (s)',
    source_row_count: 'Grouped raw rows', source_pressure_psi: 'Converted source pressure (psi)', source_flow_cm_s: 'Signed source flow (cm/s)',
    nozzle_mm: 'Nozzle diameter (mm)', fuel_rate_sccm: 'Fuel flow (sccm)', hc_fuel_rate_mg_s: 'Hydrocarbon fuel rate (mg/s)',
    flex_number: 'FLEX number', fiber_present: 'Fiber present',
  }
  return units[key] ?? key.replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase())
}

function qualityLabel(quality: QualityFlag): string {
  if (quality === 'quiescent_chamber') return 'quiescent chamber'
  if (quality === 'from_range') return 'from source range'
  if (quality === 'assumed') return 'assumed'
  if (quality === 'measured') return 'measured'
  if (quality === 'derived') return 'derived'
  return 'not reported'
}

function configSentence(configuration: string): string {
  const sentences: Record<string, string> = {
    normal_flame: 'Normal flame: fuel issues from the burner into an oxygen-containing atmosphere.',
    inverse_flame: 'Inverse flame: oxygen flows out of the burner into a fuel-rich chamber.',
    droplet: 'A liquid fuel droplet burns in the chamber.',
    thin_sample: 'A thin solid sample was tested in the MSG; the fan display is a setting, not a measured speed.',
    solid_sample: 'A solid sample was logged; this table does not report oxygen or ventilation speed.',
    large_sample: 'A large solid sample was tested in the Cygnus flow duct.',
    coflow_jet: 'A fuel jet burns with surrounding co-flow.',
  }
  return sentences[configuration] ?? configuration.replaceAll('_', ' ')
}

function colorForInvestigation(investigation: string): string {
  let hash = 0
  for (const character of investigation) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return investigationColors[hash % investigationColors.length]
}

function habitatColor(habitat: Habitat): string {
  if (habitat.id === 'moon-base') return '#c9b6ff'
  if (habitat.id === 'apollo-1') return '#ff2d55'
  if (habitat.id === 'spacesuit') return '#f2ba70'
  return '#e6ecff'
}

function finiteInput(raw: string): number | null {
  if (!raw.trim()) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function phaseLabel(phase: FuelPhase | null | undefined): string {
  if (phase === 'liquid') return 'Droplet'
  if (phase === 'solid') return 'Solid'
  if (phase === 'gas') return 'Gas'
  return 'Not reported'
}

function coordinatesAssumed(point: TestPoint, chartMode: '2d' | '3d', yAxis: 'pressure' | 'o2_partial'): boolean {
  if (point.quality.o2_pct === 'assumed') return true
  if (chartMode === '2d' || yAxis === 'pressure') return point.quality.pressure_psi === 'assumed'
  return point.quality.pressure_psi === 'assumed' || point.quality.flow_cm_s === 'assumed'
}

function coverageFor(phase: FuelPhase, tests: TestPoint[], o2: number | null, pressure: number | null): CoveragePhase {
  const rows = tests.filter((point) => point.fuel_phase === phase)
  const measured = rows.filter((point) => point.o2_pct != null && point.pressure_psi != null && point.quality.o2_pct === 'measured' && point.quality.pressure_psi === 'measured')
  const known = rows.filter((point) => point.o2_pct != null && point.pressure_psi != null)
  const inWindow = (point: TestPoint) => o2 != null && pressure != null && point.o2_pct != null && point.pressure_psi != null
    && Math.abs(point.o2_pct - o2) <= 5 && Math.abs(point.pressure_psi - pressure) <= 2
  const near = measured.filter(inWindow)
  const nearAssumedPressure = rows.filter((point) => point.o2_pct != null
    && point.quality.o2_pct === 'measured'
    && point.quality.pressure_psi === 'assumed'
    && Math.abs((point.pressure_psi ?? 0) - 14.7) <= 0.05
    && inWindow(point))
  const nearWithAssumedPressure = near.length + nearAssumedPressure.length
  const nearest = (points: TestPoint[]) => [...points]
    .sort((left, right) => {
      const distance = (point: TestPoint) => Math.sqrt(((point.o2_pct! - (o2 ?? 0)) / 10) ** 2 + ((point.pressure_psi! - (pressure ?? 0)) / 3) ** 2)
      return distance(left) - distance(right) || left.id.localeCompare(right.id)
    })
    .slice(0, 8)
    .map((point) => ({ id: point.id, distance: Math.sqrt(((point.o2_pct! - (o2 ?? 0)) / 10) ** 2 + ((point.pressure_psi! - (pressure ?? 0)) / 3) ** 2) }))
  const oxygen = rows.filter((point) => point.o2_pct != null && point.quality.o2_pct === 'measured').sort((left, right) => right.o2_pct! - left.o2_pct!)
  const pressures = rows.filter((point) => point.pressure_psi != null && point.quality.pressure_psi === 'measured').sort((left, right) => left.pressure_psi! - right.pressure_psi!)
  return {
    n_near: near.length,
    n_near_incl_assumed: known.filter(inWindow).length,
    n_near_assumed_pressure: nearAssumedPressure.length,
    n_near_with_assumed_pressure: nearWithAssumedPressure,
    coverage: near.length >= 5 ? 'covered' : nearWithAssumedPressure >= 5 ? 'covered_assumed_pressure' : nearWithAssumedPressure ? 'sparse' : 'none',
    nearest: nearest(measured),
    nearest_incl_assumed: nearest(known),
    max_o2_tested: oxygen[0] ? { value: oxygen[0].o2_pct!, test_id: oxygen[0].id } : null,
    min_pressure_tested: pressures[0] ? { value: pressures[0].pressure_psi!, test_id: pressures[0].id } : null,
    measured_test_count: measured.length,
  }
}

function AnimatedCount({ value }: { value: number }) {
  const motionValue = useMotionValue(0)
  const [display, setDisplay] = useState(0)
  useEffect(() => {
    const controls = animate(motionValue, value, { duration: 0.4, onUpdate: (current) => setDisplay(Math.round(current)) })
    // Frame-driven animation pauses while the tab is not painting; never leave a stale number behind.
    const settle = window.setTimeout(() => { controls.stop(); motionValue.set(value); setDisplay(value) }, 600)
    return () => { controls.stop(); window.clearTimeout(settle) }
  }, [motionValue, value])
  return <motion.span>{display.toLocaleString()}</motion.span>
}

function App() {
  const [tests, setTests] = useState<TestPoint[]>([])
  const [envelopes, setEnvelopes] = useState<Envelope[]>([])
  const [investigations, setInvestigations] = useState<Investigation[]>([])
  const [detections, setDetections] = useState<DetectionRecord[]>([])
  const [habitats, setHabitats] = useState<Habitat[]>([])
  const [findings, setFindings] = useState<FindingsData | null>(null)
  const [dataError, setDataError] = useState('')
  const [selectedPreset, setSelectedPreset] = useState('moon-base')
  const [o2Input, setO2Input] = useState('34')
  const [pressureInput, setPressureInput] = useState('8.2')
  const [flowInput, setFlowInput] = useState('0')
  const [materialKey, setMaterialKey] = useState('solid::PMMA')
  const [chartMode, setChartMode] = useState<'2d' | '3d'>('2d')
  const [yAxis] = useState<'pressure' | 'o2_partial'>('pressure')
  const [showRanges, setShowRanges] = useState(true)
  const [includeAssumed, setIncludeAssumed] = useState(true)
  const [showIsobars, setShowIsobars] = useState(true)
  const [receiptTest, setReceiptTest] = useState<TestPoint | null>(null)
  const [askText, setAskText] = useState('')
  const [askBusy, setAskBusy] = useState(false)
  const [askResult, setAskResult] = useState<{ summary: string; source: string } | null>(null)
  const [pendingRun, setPendingRun] = useState(false)
  const [coverageLayer, setCoverageLayer] = useState<CoverageLayer>('off')
  const [selectedInvestigations, setSelectedInvestigations] = useState<string[]>([])
  const [selectedPhases, setSelectedPhases] = useState<FuelPhase[]>(phases)
  const [selectedOutcomes, setSelectedOutcomes] = useState<Outcome[]>(outcomes)
  const [selectedTest, setSelectedTest] = useState<TestPoint | null>(null)
  const [drawerTab, setDrawerTab] = useState<'briefing' | 'test'>('briefing')
  const [briefingResult, setBriefingResult] = useState<BriefingResponse | null>(null)
  const [briefingLoading, setBriefingLoading] = useState(false)
  const [briefingProgressStage, setBriefingProgressStage] = useState<'building' | 'asking' | 'verifying'>('building')
  const [briefingElapsedSeconds, setBriefingElapsedSeconds] = useState(0)
  const [briefingError, setBriefingError] = useState('')
  const [selectedPillar, setSelectedPillar] = useState<SafetyPillar | null>(null)
  const [expandedRankId, setExpandedRankId] = useState<string | null>(null)
  const [selectedFact, setSelectedFact] = useState<FindingFact | null>(null)
  const [tickerIndex, setTickerIndex] = useState(0)
  const [aboutOpen, setAboutOpen] = useState(false)
  const aboutModalRef = useRef<HTMLElement | null>(null)
  const aboutCloseRef = useRef<HTMLButtonElement | null>(null)
  const [habitatPulse, setHabitatPulse] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [narrowChart, setNarrowChart] = useState(false)
  const [booting, setBooting] = useState(false)
  const [bootStep, setBootStep] = useState(0)
  const [bootRevealedCount, setBootRevealedCount] = useState(0)
  const [activeView, setActiveView] = useState<'atlas' | 'insights' | 'compare' | 'data'>('atlas')
  const [viewRange, setViewRange] = useState<'habitat' | 'full'>('habitat')
  const [storyStep, setStoryStep] = useState(0)
  const [storyPaused, setStoryPaused] = useState(false)
  const [storyPingTestId, setStoryPingTestId] = useState<string | null>(null)
  const [storyPingCite, setStoryPingCite] = useState<string | null>(null)
  const [storyPulse, setStoryPulse] = useState(false)
  const [filtersExpanded, setFiltersExpanded] = useState(false)
  const [scanKey, setScanKey] = useState(0)
  const [zoomRange, setZoomRange] = useState<ZoomRange | null>(null)
  const plotDiv = useRef<PlotlyHTMLElement | null>(null)
  const briefingDrawerRef = useRef<HTMLElement | null>(null)
  const storyStepRef = useRef(0)
  const storyGenerationRef = useRef(0)
  const storyTimerRef = useRef<number | null>(null)
  const lastModelRef = useRef<string | null>(null)
  const progressIntervalRef = useRef<number | null>(null)
  const progressStageTimerRef = useRef<number | null>(null)

  function goToStoryStep(nextStep: number) {
    if (storyTimerRef.current != null) window.clearTimeout(storyTimerRef.current)
    storyTimerRef.current = null
    storyGenerationRef.current += 1
    const next = Math.max(0, Math.min(4, nextStep))
    storyStepRef.current = next
    setStoryStep(next)
    if (next === 0) {
      setStoryPaused(false)
      setStoryPingTestId(null)
      setStoryPingCite(null)
    }
  }
  const previousExtrapolating = useRef(false)
  const interactionTimer = useRef<number | null>(null)
  const [orbitAllowed, setOrbitAllowed] = useState(false)

  useEffect(() => {
    let active = true
    Promise.all([
      fetch('/data/tests.json').then((response) => { if (!response.ok) throw new Error(`PSI tests unavailable (${response.status})`); return response.json() as Promise<TestPoint[]> }),
      fetch('/data/envelopes.json').then((response) => { if (!response.ok) throw new Error(`PSI summaries unavailable (${response.status})`); return response.json() as Promise<Envelope[]> }),
      fetch('/data/investigations.json').then((response) => { if (!response.ok) throw new Error(`PSI investigations unavailable (${response.status})`); return response.json() as Promise<Investigation[]> }),
      fetch('/data/detection.json').then((response) => { if (!response.ok) throw new Error(`PSI detection records unavailable (${response.status})`); return response.json() as Promise<DetectionRecord[]> }),
      fetch('/data/habitats.json').then((response) => { if (!response.ok) throw new Error(`Habitat references unavailable (${response.status})`); return response.json() as Promise<Habitat[]> }),
      fetch('/data/findings.json').then((response) => { if (!response.ok) throw new Error(`Computed findings unavailable (${response.status})`); return response.json() as Promise<FindingsData> }),
    ]).then(([testRows, envelopeRows, investigationRows, detectionRows, habitatRows, findingsRows]) => {
      if (!active) return
      setTests(testRows)
      setEnvelopes(envelopeRows)
      setInvestigations(investigationRows)
      setDetections(detectionRows)
      setHabitats(habitatRows)
      setFindings(findingsRows)
      setSelectedInvestigations(investigationRows.filter((item) => item.n_tests > 0).map((item) => item.id))
      const preset = habitatRows.find((item) => item.id === 'moon-base') ?? habitatRows[0]
      if (preset) {
        setSelectedPreset(preset.id)
        setO2Input(preset.o2_pct == null ? '' : String(preset.o2_pct))
        setPressureInput(preset.pressure_psi == null ? '' : String(preset.pressure_psi))
      }
      const materials = new Set(testRows.filter((item) => item.fuel_phase === 'solid').map((item) => item.material?.trim()).filter(Boolean))
      setMaterialKey(materials.has('PMMA') ? 'solid::PMMA' : `solid::${Array.from(materials)[0] ?? 'Other solid'}`)
    }).catch((error: unknown) => {
      if (active) setDataError(error instanceof Error ? error.message : 'Could not load normalized PSI data.')
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const resize = () => setNarrowChart(window.innerWidth < 640)
    resize()
    window.addEventListener('resize', resize)
    setReducedMotion(reduced)
    if (!reduced) {
      setBooting(true)
      setBootStep(0)
      const tick = window.setInterval(() => setBootStep((step) => Math.min(4, step + 1)), 310)
      const timer = window.setTimeout(() => setBooting(false), 1550)
      return () => { window.clearInterval(tick); window.clearTimeout(timer); window.removeEventListener('resize', resize) }
    }
    return () => window.removeEventListener('resize', resize)
  }, [])

  useEffect(() => {
    if (!booting || reducedMotion) { setBootRevealedCount(Number.MAX_SAFE_INTEGER); return }
    const count = new Set(tests.map((point) => point.investigation)).size
    setBootRevealedCount(0)
    if (!count) return
    let visible = 0
    const timer = window.setInterval(() => {
      visible += 1
      setBootRevealedCount(visible)
      if (visible >= count) window.clearInterval(timer)
    }, 40)
    return () => window.clearInterval(timer)
  }, [booting, reducedMotion, tests])

  useEffect(() => {
    if (!storyStep || storyStep === 4 || storyPaused) return
    const generation = storyGenerationRef.current
    const timer = window.setTimeout(() => {
      if (generation !== storyGenerationRef.current) return
      const next = Math.min(4, storyStepRef.current + 1)
      storyStepRef.current = next
      storyTimerRef.current = null
      setStoryStep(next)
    }, 4500)
    storyTimerRef.current = timer
    return () => {
      window.clearTimeout(timer)
      if (storyTimerRef.current === timer) storyTimerRef.current = null
    }
  }, [storyStep, storyPaused])

  useEffect(() => {
    if (storyStep !== 3 || reducedMotion) { setStoryPulse(false); return }
    setStoryPulse(true)
    const timer = window.setTimeout(() => setStoryPulse(false), 1200)
    return () => window.clearTimeout(timer)
  }, [storyStep, reducedMotion])

  useEffect(() => {
    if (!storyStep) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') goToStoryStep(0) }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [storyStep])

  useEffect(() => {
    if (storyStep === 2) {
      setSelectedPhases(phases)
      setSelectedOutcomes(outcomes)
      setSelectedInvestigations(investigations.filter((item) => item.n_tests > 0).map((item) => item.id))
      setIncludeAssumed(true)
    }
    if (storyStep === 3) {
      setViewRange('habitat')
      setSelectedPreset('moon-base')
      setO2Input('34')
      setPressureInput('8.2')
      setSelectedTest(null)
      setSelectedFact(null)
      setZoomRange(null)
    }
    if (storyStep === 4) {
      setDrawerTab('briefing')
    }
  }, [storyStep, investigations])

  const numericO2 = finiteInput(o2Input)
  const numericPressure = finiteInput(pressureInput)
  const numericFlow = finiteInput(flowInput)
  const validAtmosphere = numericO2 != null && numericO2 >= 0 && numericO2 <= 100
    && numericPressure != null && numericPressure > 0 && numericPressure < 120
  const validFlow = numericFlow != null && numericFlow >= 0 && numericFlow <= 1000
  const materialOptions = useMemo(() => {
    const unique = new Map<FuelPhase, Set<string>>(phases.map((phase) => [phase, new Set<string>()]))
    for (const point of tests) {
      if (point.fuel_phase && point.material?.trim()) unique.get(point.fuel_phase)?.add(point.material.trim())
    }
    const result: MaterialOption[] = []
    for (const phase of ['solid', 'liquid', 'gas'] as FuelPhase[]) {
      for (const material of [...(unique.get(phase) ?? [])].sort((left, right) => left.localeCompare(right))) {
        result.push({ key: `${phase}::${material}`, label: material, phase, material })
      }
      const label = `Other ${phaseLabel(phase)}`
      result.push({ key: `${phase}::other`, label, phase, material: label })
    }
    return result
  }, [tests])
  const selectedMaterial = materialOptions.find((item) => item.key === materialKey) ?? materialOptions.find((item) => item.key === 'solid::PMMA') ?? materialOptions[0]
  const selectedPhase: FuelPhase = selectedMaterial?.phase ?? 'solid'
  const selectedMaterialName = selectedMaterial?.material ?? 'Other solid'
  const activeQuery = validAtmosphere
    ? { o2_pct: numericO2, pressure_psi: numericPressure, phase: selectedPhase, pillar: selectedPillar }
    : null
  const coverage = useMemo(() => Object.fromEntries(phases.map((phase) => [phase, coverageFor(phase, tests, numericO2, numericPressure)])) as Record<FuelPhase, CoveragePhase>, [tests, numericO2, numericPressure])
  const selectedCoverage = coverage[selectedPhase]
  const extrapolating = validAtmosphere && selectedCoverage.coverage === 'none'

  useEffect(() => {
    if (extrapolating && !previousExtrapolating.current) setScanKey((value) => value + 1)
    previousExtrapolating.current = extrapolating
  }, [extrapolating])

  useEffect(() => {
    if (reducedMotion) return
    setHabitatPulse(true)
    const timer = window.setTimeout(() => setHabitatPulse(false), 800)
    return () => window.clearTimeout(timer)
  }, [selectedPreset, reducedMotion])

  const factIndex = useMemo(() => new Map((findings?.facts ?? []).map((fact) => [fact.id, fact])), [findings])
  const headlineFacts = (findings?.headline_fact_ids ?? []).map((id) => factIndex.get(id)).filter((fact): fact is FindingFact => !!fact)
  const solidMaxFinding = factIndex.get('fact:solid_max_o2')
  const lunarO2MinimumFinding = factIndex.get('fact:moon-base_o2_min')
  const aboutFacts = ['fact:solid_max_o2', 'fact:moon-base_near_solid'].map((id) => factIndex.get(id)).filter((fact): fact is FindingFact => !!fact)
  const sourceTableCount = useMemo(() => new Set([...tests, ...envelopes, ...detections].map((item) => item.source?.file).filter((file): file is string => typeof file === 'string' && !!file)).size, [tests, envelopes, detections])
  useEffect(() => {
    if (headlineFacts.length < 2) return
    const timer = window.setInterval(() => setTickerIndex((index) => (index + 1) % headlineFacts.length), 6000)
    return () => window.clearInterval(timer)
  }, [headlineFacts.length])

  const filteredTests = useMemo(() => tests.filter((point) => selectedInvestigations.includes(point.investigation)
    && (point.fuel_phase == null || selectedPhases.includes(point.fuel_phase))
    && selectedOutcomes.includes(point.outcome)), [tests, selectedInvestigations, selectedPhases, selectedOutcomes])
  const plottableTests = useMemo(() => filteredTests.filter((point) => point.o2_pct != null && point.pressure_psi != null), [filteredTests])
  const hiddenTestCount = filteredTests.length - plottableTests.length
  const xAxisRange = zoomRange?.x ?? (viewRange === 'habitat' ? [10, 105] as [number, number] : [0, 105] as [number, number])
  const yAxisRange = zoomRange?.y ?? (viewRange === 'habitat' ? [0, 22] as [number, number] : null)
  const rangeCandidates = includeAssumed ? plottableTests : plottableTests.filter((point) => !coordinatesAssumed(point, chartMode, yAxis))
  const shownTests = useMemo(() => rangeCandidates.filter((point) => {
    const y = chartMode === '2d' || yAxis === 'pressure' ? point.pressure_psi : point.o2_partial_psi
    if (point.o2_pct == null || y == null || point.o2_pct < xAxisRange[0] || point.o2_pct > xAxisRange[1]) return false
    if (yAxisRange && (y < yAxisRange[0] || y > yAxisRange[1])) return false
    return true
  }), [rangeCandidates, chartMode, yAxis, xAxisRange[0], xAxisRange[1], yAxisRange?.[0], yAxisRange?.[1]])
  const outsideAxisRangeCount = rangeCandidates.length - shownTests.length
  const assumedPointCount = shownTests.filter((point) => coordinatesAssumed(point, chartMode, yAxis)).length
  const filteredEnvelopes = useMemo(() => envelopes.filter((item) => selectedInvestigations.includes(item.investigation)
    && (item.fuel_phase == null || selectedPhases.includes(item.fuel_phase))), [envelopes, selectedInvestigations, selectedPhases])
  const selectedHabitat: Habitat = selectedPreset === 'custom'
    ? { id: 'custom', name: 'Custom atmosphere', o2_pct: numericO2, pressure_psi: numericPressure, source: 'User-entered conditions' }
    : habitats.find((item) => item.id === selectedPreset) ?? { id: selectedPreset, name: 'Habitat preset', o2_pct: numericO2, pressure_psi: numericPressure, source: 'Preset value' }
  const markerRows = useMemo(() => {
    const rows = habitats.filter((item) => item.o2_pct != null && item.pressure_psi != null).map((item) => item.id === selectedHabitat.id ? selectedHabitat : item)
    if (selectedHabitat.o2_pct != null && selectedHabitat.pressure_psi != null && !rows.some((item) => item.id === selectedHabitat.id)) rows.push(selectedHabitat)
    return rows
  }, [habitats, selectedHabitat])
  const investigationById = useMemo(() => new Map(investigations.map((item) => [item.id, item])), [investigations])
  const rankedInvestigations = useMemo(() => activeQuery ? rankInvestigations(activeQuery, tests, investigations) : [], [activeQuery, tests, investigations])
  const visibleRankings = useMemo(() => selectedPillar
    ? rankInvestigations({ ...(activeQuery ?? { o2_pct: 0, pressure_psi: 0 }), pillar: selectedPillar, phase: selectedPhase }, tests, investigations)
    : rankedInvestigations, [selectedPillar, activeQuery, selectedPhase, tests, investigations, rankedInvestigations])

  const plotData = useMemo(() => {
    const data: Data[] = []
    const yForTest = (point: TestPoint) => chartMode === '2d' ? point.pressure_psi : yAxis === 'pressure' ? point.pressure_psi : point.o2_partial_psi
    const investigationOrder = new Map([...new Set(tests.map((point) => point.investigation))].sort().map((id, index) => [id, index]))
    const revealed = (point: TestPoint) => !booting || (investigationOrder.get(point.investigation) ?? 0) < bootRevealedCount
    const activeCoverage: CoverageLayer = storyStep === 2 || storyStep === 3 ? 'solid' : coverageLayer
    const dataYMax = Math.max(22, ...shownTests.map((point) => point.pressure_psi ?? 0))
    const yRangeForLayers: [number, number] = yAxisRange ?? [0, dataYMax * 1.05]
    if (chartMode === '2d') {
      if (activeCoverage !== 'off') {
        const coveragePoints = tests.filter((point) => point.o2_pct != null && point.pressure_psi != null
          && selectedInvestigations.includes(point.investigation)
          && (activeCoverage === 'all' || point.fuel_phase === activeCoverage))
        const heat = coverageHeatmap(coveragePoints, xAxisRange, yRangeForLayers)
        if (heat) data.push(heat)
      }
      if (showIsobars) data.push(...isobarTraces(xAxisRange, yRangeForLayers[1]))
    } else {
      const cells = towerCells(shownTests.filter((point) => revealed(point) && (activeCoverage === 'off' || activeCoverage === 'all' || point.fuel_phase === activeCoverage)), xAxisRange, yRangeForLayers)
      data.push(...towerTraces(cells))
      const tallest = Math.max(towerHeight(10), ...cells.map((cell) => towerHeight(cell.count)))
      data.push(lunarEnvelopeBox(Math.min(105, xAxisRange[1]), tallest))
    }
    for (const assumed of [true, false]) {
      if (chartMode === '3d') break
      if (assumed && !includeAssumed) continue
      for (const outcome of outcomes) {
        for (const phase of phases) {
          const points = shownTests.filter((point) => point.outcome === outcome && point.fuel_phase === phase && coordinatesAssumed(point, chartMode, yAxis) === assumed && revealed(point))
          if (!points.length) continue
          const groups = aggregatePoints(points, yForTest)
          data.push({
            type: 'scatter',
            mode: 'markers',
            name: `${outcomeStyles[outcome].label} · ${phaseStyles[phase].label}`,
            x: groups.map((group) => group.x),
            y: groups.map((group) => group.y),
            customdata: groups.map((group) => [group.ids[0], group.flow, group.investigations.join(', '), group.materials.join(', ') || 'material not recorded', group.ids.length, outcomeStyles[outcome].label]),
            marker: {
              color: outcomeStyles[outcome].color,
              size: groups.map((group) => stackSize(group.ids.length, 7)),
              symbol: phaseStyles[phase].symbol + (assumed ? '-open' : ''),
              opacity: activeCoverage !== 'off' && activeCoverage !== 'all' ? (phase === activeCoverage ? (assumed ? 0.6 : 1) : 0.12) : assumed ? 0.35 : 0.86,
              line: { color: outcomeStyles[outcome].color, width: assumed ? 1.1 : 0.4 },
            },
            hovertemplate: '<b>%{customdata[4]} test(s) · %{customdata[5]}</b><br>O₂ %{x:.2f}% · %{y:.2f} psi<br>%{customdata[2]} · %{customdata[3]}<br><span style="color:#7d8bb3">click to open %{customdata[0]}</span><extra></extra>',
            hoverlabel: { bgcolor: '#0f1528', bordercolor: outcomeStyles[outcome].color, font: { family: 'JetBrains Mono, monospace', color: '#e6ecff', size: 11 } },
          } as unknown as Data)
        }
      }
    }

    if (showRanges && chartMode === '2d') {
      for (const envelope of filteredEnvelopes) {
        if (!envelope.o2_pct_range || !envelope.pressure_psi_range) continue
        const x = envelope.o2_pct_range[0] === envelope.o2_pct_range[1] ? [envelope.o2_pct_range[0]] : [envelope.o2_pct_range[0], envelope.o2_pct_range[1]]
        const pressure = (envelope.pressure_psi_range[0] + envelope.pressure_psi_range[1]) / 2
        data.push({
          type: chartMode === '2d' ? 'scatter' : 'scatter3d',
          mode: 'lines+markers',
          name: `Range · ${envelope.investigation}`,
          x,
          y: chartMode === '2d' ? x.map(() => pressure) : x.map((value) => yAxis === 'pressure' ? pressure : value * pressure / 100),
          customdata: x.map(() => [envelope.id, envelope.source.file, envelope.source.row]),
          line: { color: colorForInvestigation(envelope.investigation), width: 4 },
          marker: { color: colorForInvestigation(envelope.investigation), size: 3 },
          opacity: 0.22,
          hovertemplate: '<span style="color:#7d8bb3">SUMMARY RANGE</span><br><b>%{customdata[0]}</b><br>O₂ range %{x:.1f}%<br>Pressure segment at %{y:.1f} psi<br>Source %{customdata[1]} · row %{customdata[2]}<extra></extra>',
          hoverlabel: { bgcolor: '#0f1528', bordercolor: '#2a3558', font: { family: 'JetBrains Mono, monospace', color: '#e6ecff', size: 11 } },
        } as unknown as Data)
      }
    }

    if (markerRows.length) {
      const markerFlow = numericFlow ?? 0
      data.push({
        type: chartMode === '2d' ? 'scatter' : 'scatter3d',
        mode: 'markers',
        name: 'Habitat references',
        x: markerRows.map((item) => item.o2_pct),
        y: chartMode === '2d' ? markerRows.map((item) => item.pressure_psi) : markerRows.map((item) => yAxis === 'pressure' ? item.pressure_psi : (item.o2_pct ?? 0) * (item.pressure_psi ?? 0) / 100),
        z: chartMode === '3d' ? markerRows.map(() => 0.02) : undefined,
        ...(chartMode === '3d' ? { mode: 'markers+text', text: markerRows.map((item) => item.name.replace(/ \(.*\)$/, '').replace(' / pressurized rover', '').toUpperCase()), textposition: 'top center', textfont: { family: 'JetBrains Mono, monospace', size: 10, color: markerRows.map(habitatColor) } } : {}),
        customdata: markerRows.map((item) => [item.name, item.o2_pct, item.pressure_psi, item.o2_pct == null || item.pressure_psi == null ? null : item.o2_pct * item.pressure_psi / 100, tests.filter((point) => point.o2_pct != null && point.pressure_psi != null && item.o2_pct != null && item.pressure_psi != null && Math.abs(point.o2_pct - item.o2_pct) <= 5 && Math.abs(point.pressure_psi - item.pressure_psi) <= 2).length, item.id, item.source, markerFlow]),
        hovertemplate: '<span style="color:#c9b6ff">HABITAT REFERENCE</span><br><b>%{customdata[0]}</b><br>O₂ %{customdata[1]:.2f}%<br>Pressure %{customdata[2]:.2f} psi<br>O₂ partial pressure %{customdata[3]:.2f} psi<br>%{customdata[4]} PSI tests within ±5% O₂ and ±2 psi<br>Comparison flow %{customdata[7]:.1f} cm/s<br>%{customdata[6]}<extra></extra>',
        hoverlabel: { bgcolor: '#0f1528', bordercolor: '#c9b6ff', font: { family: 'JetBrains Mono, monospace', color: '#e6ecff', size: 11 } },
        marker: {
          symbol: 'diamond',
          size: markerRows.map((item) => item.id === selectedHabitat.id ? 11 : 8),
          color: markerRows.map(habitatColor),
          opacity: 1,
          line: { color: '#ffffff', width: 1.5 },
        },
      } as unknown as Data)
      const selectedMarker = markerRows.find((item) => item.id === selectedHabitat.id)
      if (selectedMarker && selectedMarker.o2_pct != null && selectedMarker.pressure_psi != null && habitatPulse) {
        data.push({
          type: chartMode === '2d' ? 'scatter' : 'scatter3d',
          mode: 'markers',
          name: 'Selected habitat ring',
          x: [selectedMarker.o2_pct],
          y: [chartMode === '2d' || yAxis === 'pressure' ? selectedMarker.pressure_psi : selectedMarker.o2_pct * selectedMarker.pressure_psi / 100],
          z: chartMode === '3d' ? [0.02] : undefined,
          marker: { symbol: 'diamond-open', size: 17, color: habitatColor(selectedMarker), line: { color: '#ffffff', width: 1.5 } },
          hoverinfo: 'skip',
          showlegend: false,
        } as unknown as Data)
      }
    }

    if (chartMode === '2d' && selectedTest && selectedTest.o2_pct != null && selectedTest.pressure_psi != null && plottableTests.some((point) => point.id === selectedTest.id)) {
      const y = chartMode === '2d' || yAxis === 'pressure' ? selectedTest.pressure_psi : selectedTest.o2_partial_psi
      data.push({
        type: chartMode === '2d' ? 'scatter' : 'scatter3d',
        mode: 'markers',
        name: 'Selected test',
        x: [selectedTest.o2_pct],
        y: [y],
        customdata: [[selectedTest.id, selectedTest.flow_cm_s]],
        marker: { size: chartMode === '2d' ? 14 : 12, color: 'rgba(0,0,0,0)', symbol: 'circle-open', line: { color: '#ffffff', width: 2.2 } },
        hoverinfo: 'skip',
        showlegend: false,
      } as unknown as Data)
    }
    const storyPoint = storyPingTestId ? tests.find((point) => point.id === storyPingTestId) : undefined
    if (chartMode === '2d' && storyPoint && storyPoint.o2_pct != null && storyPoint.pressure_psi != null && plottableTests.some((point) => point.id === storyPoint.id)) {
      const y = chartMode === '2d' || yAxis === 'pressure' ? storyPoint.pressure_psi : storyPoint.o2_partial_psi
      if (y != null) data.push({
        type: chartMode === '2d' ? 'scatter' : 'scatter3d',
        mode: 'markers',
        name: 'Story citation ping',
        x: [storyPoint.o2_pct],
        y: [y],
        marker: { size: chartMode === '2d' ? 20 : 16, color: 'rgba(0,0,0,0)', symbol: 'circle-open', line: { color: '#ffffff', width: 2.5 } },
        hoverinfo: 'skip',
        showlegend: false,
      } as unknown as Data)
    }
    return data
  }, [shownTests, chartMode, yAxis, showRanges, filteredEnvelopes, markerRows, selectedHabitat, numericFlow, tests, selectedTest, storyPingTestId, plottableTests, includeAssumed, habitatPulse, storyStep, booting, bootRevealedCount, coverageLayer, showIsobars, selectedInvestigations, xAxisRange[0], xAxisRange[1], yAxisRange?.[0], yAxisRange?.[1]])

  const solidTestCount = tests.filter((point) => point.fuel_phase === 'solid').length
  const solidO2Fact = factIndex.get('fact:solid_test_o2_range')
  const solidMinO2 = typeof solidO2Fact?.min_o2_pct === 'number' ? solidO2Fact.min_o2_pct : null
  const solidMaxO2 = typeof solidO2Fact?.max_o2_pct === 'number' ? solidO2Fact.max_o2_pct : null
  const lunarSolidCount = tests.filter((point) => point.fuel_phase === 'solid' && point.o2_pct != null && point.pressure_psi != null
    && point.quality.o2_pct === 'measured' && point.quality.pressure_psi === 'measured' && point.o2_pct >= 30 && point.pressure_psi <= 10.2).length
  const aboveHabitatCount = rangeCandidates.filter((point) => point.pressure_psi != null && point.pressure_psi > 22).length
  const storyCaptions = [
    '',
    `${findings?.summary.total_tests.toLocaleString() ?? tests.length.toLocaleString()} microgravity combustion tests from ${findings?.summary.total_investigations ?? investigations.length} NASA PSI investigations.`,
    `Every solid-material test: ${solidMinO2?.toFixed(1) ?? '—'}–${solidMaxO2?.toFixed(1) ?? '—'} % O₂ at cabin pressure; ${solidTestCount.toLocaleString()} tests total.`,
    `Planned lunar habitats: ≥30 % O₂ at ≤10.2 psi. ${lunarSolidCount} solid tests inside that envelope.`,
    briefingResult?.cached && briefingResult.provider !== 'computed'
      ? `The SI briefing: every sentence cited to PSI data and verified · ${briefingResult.verification.sentences_kept}/${briefingResult.verification.sentences_total} passed.`
      : 'Loading the SI-written cached briefing…',
  ]
  const storyCaption = storyCaptions[storyStep] ?? ''

  const layout: Partial<Layout> = {
    autosize: true,
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'Inter, sans-serif', color: '#a8b3d4', size: 13 },
    margin: chartMode === '3d' ? { l: 5, r: 8, t: 5, b: 2 } : { l: 52, r: 12, t: 18, b: 48 },
    showlegend: false,
    hoverlabel: { bgcolor: '#0f1528', bordercolor: '#2a3558', font: { family: 'JetBrains Mono, monospace', color: '#e6ecff', size: 11 } },
    scene: {
      bgcolor: 'rgba(0,0,0,0)',
      camera: { eye: { x: -0.55, y: -1.75, z: 0.95 }, center: { x: 0, y: 0.05, z: -0.12 } },
      xaxis: { title: { text: 'O₂ concentration (%)', font: { family: 'JetBrains Mono, monospace', size: 11 } }, gridcolor: '#1c2540', zerolinecolor: '#2a3558', color: '#7d8bb3', range: zoomRange?.x ?? (viewRange === 'habitat' ? [10, 105] : [0, 105]), tickfont: { family: 'JetBrains Mono, monospace', size: 11 } },
      yaxis: { title: { text: yAxis === 'pressure' ? 'Pressure (psi)' : 'O₂ partial pressure (psi)', font: { family: 'JetBrains Mono, monospace', size: 11 } }, gridcolor: '#1c2540', zerolinecolor: '#2a3558', color: '#7d8bb3', range: zoomRange?.y ?? (viewRange === 'habitat' ? [0, 22] : undefined), autorange: viewRange === 'full' && !zoomRange, tickfont: { family: 'JetBrains Mono, monospace', size: 11 } },
      zaxis: { title: { text: 'Tests per cell (log)', font: { family: 'JetBrains Mono, monospace', size: 11 } }, gridcolor: '#1c2540', zerolinecolor: '#2a3558', color: '#7d8bb3', range: [0, towerHeight(500)], tickvals: towerTickValues.map(towerHeight), ticktext: towerTickValues.map(String), tickfont: { family: 'JetBrains Mono, monospace', size: 11 } },
      aspectmode: 'manual', aspectratio: { x: 1.5, y: 1, z: 0.62 },
    },
    xaxis: { title: { text: 'O₂ concentration (%)', font: { family: 'JetBrains Mono, monospace', size: 11 } }, gridcolor: '#1c2540', zerolinecolor: '#2a3558', color: '#7d8bb3', range: zoomRange?.x ?? (viewRange === 'habitat' ? [10, 105] : [0, 105]), tickfont: { family: 'JetBrains Mono, monospace', size: 11 } },
    yaxis: { title: { text: 'Pressure (psi)', font: { family: 'JetBrains Mono, monospace', size: 11 } }, gridcolor: '#1c2540', zerolinecolor: '#2a3558', color: '#7d8bb3', range: zoomRange?.y ?? (viewRange === 'habitat' ? [0, 22] : undefined), autorange: viewRange === 'full' && !zoomRange, tickfont: { family: 'JetBrains Mono, monospace', size: 11 } },
    shapes: chartMode === '2d' ? [
      { type: 'rect', xref: 'x', yref: 'y', x0: 30, x1: 105, y0: 0, y1: 10.2, fillcolor: storyPulse ? 'rgba(201,182,255,0.15)' : 'rgba(201,182,255,0.08)', line: { color: '#c9b6ff', width: storyPulse ? 2 : 1, dash: 'dash' }, layer: 'below' },
      ...(solidMinO2 != null && solidMaxO2 != null ? [{ type: 'rect' as const, xref: 'x' as const, yref: 'y' as const, x0: solidMinO2, x1: solidMaxO2, y0: 14.3, y1: 15.1, fillcolor: 'rgba(255,90,31,0.12)', line: { color: '#ff5a1f', width: 1 }, layer: 'below' as const }] : []),
    ] as Layout['shapes'] : [],
    annotations: chartMode === '2d' ? [
      ...(showIsobars ? isobarAnnotations(xAxisRange, yAxisRange ?? [0, Math.max(22, ...shownTests.map((point) => point.pressure_psi ?? 0)) * 1.05], narrowChart) : []),
      { x: narrowChart ? 30.5 : 31, y: 9.9, xref: 'x', yref: 'y', text: narrowChart ? 'LUNAR ENVELOPE · ≥30% O₂ · ≤10.2 psi' : 'LUNAR HABITAT ENVELOPE · ≥30% O₂ · ≤10.2 psi', showarrow: false, xanchor: 'left', yanchor: 'top', font: { family: 'JetBrains Mono, monospace', size: narrowChart ? 8 : 9, color: '#c9b6ff' }, bgcolor: 'rgba(12,16,30,0.35)' },
      ...(solidMaxO2 != null ? [{ x: solidMinO2 ?? 13.6, y: 14.05, xref: 'x' as const, yref: 'y' as const, text: `${solidTestCount} SOLID TESTS · ≤${solidMaxO2.toFixed(1)} % O₂`, showarrow: false, xanchor: 'left' as const, yanchor: 'top' as const, font: { family: 'JetBrains Mono, monospace', size: narrowChart ? 8 : 9, color: '#ff9a72' }, bgcolor: 'rgba(5,7,13,0.72)', borderpad: 2 }] : []),
      ...(storyStep === 3 ? [{ x: 34, y: 7.6, xref: 'x' as const, yref: 'y' as const, text: `${lunarSolidCount} SOLID TESTS IN ENVELOPE`, showarrow: true, arrowhead: 2, arrowsize: 0.7, arrowwidth: 1, arrowcolor: '#c9b6ff', ax: 105, ay: -20, xanchor: 'left' as const, font: { family: 'JetBrains Mono, monospace', size: narrowChart ? 8 : 9, color: '#e6ecff' }, bgcolor: 'rgba(5,7,13,0.8)', borderpad: 3 }] : []),
      ...markerRows.filter((item) => item.o2_pct != null && item.pressure_psi != null).map((item) => {
        const offsets: Record<string, [number, number]> = { 'earth-sea-level': [-50, -33], iss: [42, -36], 'moon-base': [55, 22], spacesuit: [-52, -24], 'apollo-1': [-55, 25] }
        const [ax, ay] = offsets[item.id] ?? [24, -24]
        const labels: Record<string, string> = { 'earth-sea-level': 'EARTH', iss: 'ISS', 'moon-base': 'MOON BASE', spacesuit: 'SPACESUIT', 'apollo-1': 'APOLLO 1' }
        return { x: item.o2_pct!, y: item.pressure_psi!, xref: 'x' as const, yref: 'y' as const, text: labels[item.id] ?? item.name.toUpperCase(), showarrow: true, arrowhead: 0, arrowsize: 0.4, arrowwidth: 0.7, arrowcolor: habitatColor(item), ax, ay, font: { family: 'JetBrains Mono, monospace', size: 9, color: habitatColor(item) }, bgcolor: 'rgba(8,12,24,0.72)', borderpad: 2 }
      }),
    ] as Layout['annotations'] : [],
  }

  const selectedSourceRows = selectedTest?.source.rows ?? (selectedTest ? [selectedTest.source.row] : [])
  const plottableRanges = filteredEnvelopes.filter((item) => item.o2_pct_range && item.pressure_psi_range).length
  const noTestInvestigations = investigations.filter((item) => item.n_tests === 0)
  const testInvestigations = investigations.filter((item) => item.n_tests > 0)
  const activeTickerFact = headlineFacts.length ? headlineFacts[tickerIndex % headlineFacts.length] : null
  const dataTests = includeAssumed ? filteredTests : filteredTests.filter((point) => !coordinatesAssumed(point, '2d', 'pressure'))
  const dataFilterSummary = `${selectedInvestigations.length}/${testInvestigations.length} investigations · ${selectedPhases.map(phaseLabel).join(', ') || 'no phases'} · ${selectedOutcomes.map((item) => outcomeStyles[item].label).join(', ') || 'no outcomes'} · assumed coordinates ${includeAssumed ? 'included' : 'excluded'}`
  const atlasFilterSummary = `${selectedInvestigations.length} investigations · ${selectedPhases.map(phaseLabel).join(', ') || 'no phases'} · ${selectedOutcomes.length === outcomes.length ? 'all outcomes' : selectedOutcomes.map((item) => outcomeStyles[item].label).join(', ') || 'no outcomes'} · assumed values ${includeAssumed ? 'on' : 'off'}`
  const dataFilterKey = JSON.stringify({ investigations: [...selectedInvestigations].sort(), phases: [...selectedPhases].sort(), outcomes: [...selectedOutcomes].sort(), includeAssumed })

  function setPlotReference(_figure: unknown, graphDiv: HTMLElement) { plotDiv.current = graphDiv as PlotlyHTMLElement }

  function handlePlotRelayout(event: Record<string, unknown>) {
    const prefix = chartMode === '3d' ? 'scene.' : ''
    if (event[`${prefix}xaxis.autorange`] || event[`${prefix}yaxis.autorange`]) {
      setZoomRange(null)
      return
    }
    const readRange = (axis: 'xaxis' | 'yaxis'): [number, number] | null => {
      const direct = event[`${prefix}${axis}.range`]
      const low = event[`${prefix}${axis}.range[0]`]
      const high = event[`${prefix}${axis}.range[1]`]
      if (Array.isArray(direct) && direct.length === 2 && direct.every((value) => typeof value === 'number' && Number.isFinite(value))) return [direct[0], direct[1]]
      if (typeof low === 'number' && Number.isFinite(low) && typeof high === 'number' && Number.isFinite(high)) return [low, high]
      return null
    }
    const x = readRange('xaxis') ?? zoomRange?.x ?? xAxisRange
    const plottedYRange = (plotDiv.current as (PlotlyHTMLElement & { _fullLayout?: Record<string, { range?: number[] }> }) | null)?._fullLayout?.[`${prefix}yaxis`]?.range
    const currentY: [number, number] | null = zoomRange?.y ?? yAxisRange ?? (plottedYRange?.length === 2 ? [plottedYRange[0], plottedYRange[1]] : null)
    const y = readRange('yaxis') ?? currentY
    if (!y) return
    const next: ZoomRange = { x, y }
    if (zoomRange && zoomRange.x[0] === next.x[0] && zoomRange.x[1] === next.x[1] && zoomRange.y[0] === next.y[0] && zoomRange.y[1] === next.y[1]) return
    setZoomRange(next)
  }

  function updateZoom(o2: number | null, pressure: number | null) {
    if (o2 == null || pressure == null) return
    const y = chartMode === '3d' && yAxis === 'o2_partial' ? o2 * pressure / 100 : pressure
    setZoomRange({ x: [Math.max(0, o2 - 14), Math.min(100, o2 + 14)], y: [Math.max(0, y - 12), Math.min(120, y + 12)] })
  }

  useEffect(() => {
    if (!zoomRange || !plotDiv.current) return
    let active = true
    void loadPlotlyRuntime().then((plotly) => {
      if (!active || !plotDiv.current) return
      const prefix = chartMode === '3d' ? 'scene.' : ''
      const update = {
        [`${prefix}xaxis.range`]: zoomRange.x,
        [`${prefix}yaxis.range`]: zoomRange.y,
        'transition.duration': reducedMotion ? 0 : 800,
      }
      void plotly.relayout(plotDiv.current, update as Parameters<typeof plotly.relayout>[1])
    })
    return () => { active = false }
  }, [zoomRange, reducedMotion])

  function clearQueryResult() {
    setBriefingResult(null)
    setBriefingError('')
  }

  function onPresetChange(event: ChangeEvent<HTMLSelectElement>) {
    const id = event.target.value
    const preset = habitats.find((item) => item.id === id)
    setSelectedPreset(id)
    setO2Input(preset?.o2_pct == null ? '' : String(preset.o2_pct))
    setPressureInput(preset?.pressure_psi == null ? '' : String(preset.pressure_psi))
    setSelectedTest(null)
    setSelectedFact(null)
    clearQueryResult()
    updateZoom(preset?.o2_pct ?? null, preset?.pressure_psi ?? null)
  }

  function editAtmosphere(field: 'o2' | 'pressure', value: string) {
    setSelectedPreset('custom')
    setSelectedTest(null)
    clearQueryResult()
    if (field === 'o2') setO2Input(value)
    else setPressureInput(value)
    updateZoom(field === 'o2' ? finiteInput(value) : numericO2, field === 'pressure' ? finiteInput(value) : numericPressure)
  }

  function onPointClick(event: { points?: Array<{ customdata?: unknown; data?: { name?: string } }> }) {
    const point = event.points?.[0]
    if (!point) return
    if (point.data?.name === 'Habitat references' && Array.isArray(point.customdata)) {
      const id = String(point.customdata[5] ?? '')
      const habitat = habitats.find((item) => item.id === id)
      if (habitat) {
        setSelectedPreset(habitat.id)
        setO2Input(habitat.o2_pct == null ? '' : String(habitat.o2_pct))
        setPressureInput(habitat.pressure_psi == null ? '' : String(habitat.pressure_psi))
        updateZoom(habitat.o2_pct, habitat.pressure_psi)
      }
      setSelectedTest(null)
      return
    }
    const custom = point.customdata
    const id = Array.isArray(custom) ? String(custom[0] ?? '') : String(custom ?? '')
    const selected = tests.find((candidate) => candidate.id === id)
    if (selected) openTest(selected)
  }

  function openTest(point: TestPoint) {
    setSelectedTest(point)
    setDrawerTab('test')
    updateZoom(point.o2_pct, point.pressure_psi)
    window.setTimeout(() => document.getElementById('condition-space')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' }), 40)
  }

  async function focusTestCitation(id: string) {
    const point = tests.find((candidate) => candidate.id === id)
    if (!point) return
    setChartMode('2d')
    setSelectedPhases((current) => current.includes(point.fuel_phase as FuelPhase) ? current : [...current, point.fuel_phase as FuelPhase])
    setSelectedInvestigations((current) => current.includes(point.investigation) ? current : [...current, point.investigation])
    setSelectedOutcomes((current) => current.includes(point.outcome) ? current : [...current, point.outcome])
    openTest(point)
    if (point.o2_pct != null && point.pressure_psi != null) setZoomRange({ x: [Math.max(0, point.o2_pct - 12), Math.min(100, point.o2_pct + 12)], y: [Math.max(0, point.pressure_psi - 10), Math.min(120, point.pressure_psi + 10)] })
    await new Promise((resolve) => window.setTimeout(resolve, 100))
    const graph = plotDiv.current
    if (graph) {
      const plotly = await loadPlotlyRuntime()
      const x0 = point.o2_pct ?? 0
      const y0 = point.pressure_psi ?? 1
      await plotly.relayout(graph, { 'xaxis.range': [Math.max(0, x0 - 12), Math.min(100, x0 + 12)], 'yaxis.range': [Math.max(0, y0 - 10), Math.min(120, y0 + 10)], 'transition.duration': 600 })
    }
  }

  function openInvestigationCitation(id: string) {
    setDrawerTab('briefing')
    setExpandedRankId(id)
    setSelectedFact(null)
    window.setTimeout(() => document.getElementById(`rank-${id}`)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' }), 70)
  }

  function showFact(fact: FindingFact | undefined) {
    if (!fact) return
    setSelectedFact(fact)
    setDrawerTab('briefing')
  }

  function openAboutFinding(fact: FindingFact) {
    setAboutOpen(false)
    setActiveView('atlas')
    showFact(fact)
  }

  function openHowToCite() {
    setAboutOpen(false)
    setActiveView('data')
    window.setTimeout(() => document.getElementById('how-to-cite')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' }), 100)
  }

  function onCitation(id: string) {
    if (id.startsWith('fact:')) return showFact(factIndex.get(id))
    if (id.startsWith('coverage:')) {
      setDrawerTab('briefing')
      setSelectedFact({ id, value: coverage[id.slice('coverage:'.length) as FuelPhase]?.n_near ?? 0, unit: 'tests', support: [], text: `${coverage[id.slice('coverage:'.length) as FuelPhase]?.n_near ?? 0} measured tests are within the active query window.` })
      return
    }
    if (/^PSI-\d+:/.test(id)) return void focusTestCitation(id)
    if (/^PSI-\d+$/.test(id)) return openInvestigationCitation(id)
  }

  function rememberBriefing(response: BriefingResponse) {
    if (response.model) lastModelRef.current = response.model
    setBriefingResult(response)
  }

  function applyParsedQuestion(parsed: ParsedQuestion, source: string) {
    const habitat = parsed.habitat_id ? habitats.find((item) => item.id === parsed.habitat_id) : undefined
    setSelectedPreset(habitat ? habitat.id : 'custom')
    if (parsed.o2_pct != null) setO2Input(String(parsed.o2_pct))
    if (parsed.pressure_psi != null) setPressureInput(String(parsed.pressure_psi))
    if (parsed.flow_cm_s != null) setFlowInput(String(parsed.flow_cm_s))
    const phase = parsed.phase ?? 'solid'
    const wanted = parsed.material?.toLowerCase() ?? ''
    const option = materialOptions.find((item) => item.phase === phase && item.material === parsed.material)
      ?? materialOptions.find((item) => item.phase === phase && item.material.toLowerCase() === wanted)
      ?? materialOptions.find((item) => item.phase === phase && wanted && item.material.toLowerCase().includes(wanted) && !item.key.endsWith('::other'))
      ?? materialOptions.find((item) => item.key === `${phase}::other`)
    if (option) setMaterialKey(option.key)
    setSelectedTest(null)
    setSelectedFact(null)
    clearQueryResult()
    updateZoom(parsed.o2_pct, parsed.pressure_psi)
    const place = habitat ? habitat.name.replace(/ \(.*\)$/, '') : 'Custom atmosphere'
    const material = option ? `${option.label} (${phaseLabel(option.phase)})` : 'material not stated'
    setAskResult({ summary: `${place} · ${parsed.o2_pct} % O₂ · ${parsed.pressure_psi} psi · ${material}`, source })
    setPendingRun(true)
  }

  async function askQuestion(question: string) {
    const text = question.trim()
    if (!text || askBusy) return
    setAskText(text)
    setAskBusy(true)
    setAskResult(null)
    const catalog = materialOptions.map((item) => item.material)
    try {
      const controller = new AbortController()
      const timer = window.setTimeout(() => controller.abort(), 9000)
      const response = await fetch('/api/parse-question', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: text }), signal: controller.signal })
      window.clearTimeout(timer)
      const data = await response.json() as { parsed?: ParsedQuestion; source?: string; model?: string | null; error?: string }
      if (!response.ok || !data.parsed) throw new Error(data.error ?? 'parse failed')
      applyParsedQuestion(data.parsed, data.source === 'si' ? `Interpreted by SI · ${data.model ?? 'model'}` : 'Interpreted by keyword rules')
    } catch {
      applyParsedQuestion(parseQuestionRules(text, habitats, catalog), 'Interpreted by keyword rules (offline)')
    } finally {
      setAskBusy(false)
    }
  }

  useEffect(() => {
    if (!pendingRun) return
    setPendingRun(false)
    void runCheck()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRun])

  async function runCheck() {
    if (!validAtmosphere || numericFlow == null || !validFlow || !selectedMaterial) {
      setBriefingError('Enter O₂, pressure, and comparison flow values within their labeled ranges.')
      return
    }
    if (numericO2 < 0 || numericO2 > 100 || numericPressure <= 0 || numericPressure >= 120 || numericFlow < 0 || numericFlow > 1000) {
      setBriefingError('One or more conditions are outside the supported input range.')
      return
    }
    setBriefingLoading(true)
    setBriefingError('')
    setBriefingProgressStage('building')
    setBriefingElapsedSeconds(0)
    if (progressIntervalRef.current != null) window.clearInterval(progressIntervalRef.current)
    if (progressStageTimerRef.current != null) window.clearTimeout(progressStageTimerRef.current)
    const startedAt = performance.now()
    progressIntervalRef.current = window.setInterval(() => setBriefingElapsedSeconds(Math.floor((performance.now() - startedAt) / 1000)), 1000)
    progressStageTimerRef.current = window.setTimeout(() => setBriefingProgressStage('asking'), 650)
    setSelectedFact(null)
    setDrawerTab('briefing')
    const query = { o2_pct: numericO2, pressure_psi: numericPressure, flow_cm_s: numericFlow, material: selectedMaterialName, phase: selectedPhase, pillar: selectedPillar, habitat_id: selectedPreset === 'custom' ? null : selectedPreset }
    try {
      const cachedMaterial = selectedPhase === 'liquid' ? 'heptane' : 'PMMA'
      if (selectedPreset !== 'custom' && selectedMaterialName === cachedMaterial) {
        const cached = await fetch(`/data/briefings/${selectedPreset}-${selectedPhase}.json`)
        if (cached.ok) {
          const response = await cached.json() as BriefingResponse
          setBriefingProgressStage('verifying')
          rememberBriefing({ ...response, cached: true })
          await new Promise<void>((resolve) => window.setTimeout(resolve, 300))
          return
        }
      }
      const response = await fetch('/api/briefing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })
      const data = await response.json() as BriefingResponse & { error?: string }
      if (!response.ok) throw new Error(data.error ?? `Briefing service unavailable (${response.status}).`)
      setBriefingProgressStage('verifying')
      rememberBriefing({ ...data, cached: false })
      await new Promise<void>((resolve) => window.setTimeout(resolve, 300))
    } catch (error) {
      setBriefingError(error instanceof Error ? error.message : 'Briefing service unavailable.')
    } finally {
      if (progressIntervalRef.current != null) window.clearInterval(progressIntervalRef.current)
      if (progressStageTimerRef.current != null) window.clearTimeout(progressStageTimerRef.current)
      progressIntervalRef.current = null
      progressStageTimerRef.current = null
      setBriefingLoading(false)
    }
  }

  useEffect(() => {
    const cachedMaterial = selectedPhase === 'liquid' ? 'heptane' : 'PMMA'
    if (selectedPreset === 'custom' || !selectedPhase || selectedMaterialName !== cachedMaterial) return
    let active = true
    fetch(`/data/briefings/${selectedPreset}-${selectedPhase}.json`).then(async (response) => {
      if (!response.ok) return null
      return await response.json() as BriefingResponse
    }).then((response) => {
      if (active && response) rememberBriefing({ ...response, cached: true })
    }).catch(() => undefined)
    return () => { active = false }
  }, [selectedPreset, selectedPhase, selectedMaterialName])

  useEffect(() => {
    if (storyStep !== 4) return
    let active = true
    setDrawerTab('briefing')
    fetch('/data/briefings/moon-base-solid.json').then(async (response) => {
      if (!response.ok) return null
      return await response.json() as BriefingResponse
    }).then((response) => {
      if (active && response?.cached && response.provider !== 'computed') rememberBriefing(response)
    }).catch(() => undefined)
    return () => { active = false }
  }, [storyStep])

  useEffect(() => {
    if (storyStep !== 4 || storyPaused) return
    briefingDrawerRef.current?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
    if (!briefingResult?.cached) return
    const testsById = new Map(tests.map((point) => [point.id, point]))
    const pings: Array<{ cite: string; testId: string }> = []
    const seen = new Set<string>()
    for (const sentence of briefingResult.briefing.sentences) {
      for (const cite of sentence.cites) {
        const fact = factIndex.get(cite)
        const testId = testsById.has(cite) ? cite
          : typeof fact?.test_id === 'string' && testsById.has(fact.test_id) ? fact.test_id
            : fact?.support?.find((id) => testsById.has(id))
        if (testId && !seen.has(testId)) {
          pings.push({ cite, testId })
          seen.add(testId)
        }
      }
    }
    if (!pings.length) return
    let active = true
    let timer: number | null = null
    const pause = () => new Promise<void>((resolve) => { timer = window.setTimeout(resolve, 950) })
    const play = async () => {
      for (const ping of pings) {
        if (!active) return
        const point = testsById.get(ping.testId)
        if (!point || point.o2_pct == null || point.pressure_psi == null) continue
        setStoryPingCite(ping.cite)
        setStoryPingTestId(ping.testId)
        const y = chartMode === '3d' && yAxis === 'o2_partial' ? point.o2_partial_psi : point.pressure_psi
        if (y != null) setZoomRange({ x: [Math.max(0, point.o2_pct - 12), Math.min(100, point.o2_pct + 12)], y: [Math.max(0, y - 10), Math.min(120, y + 10)] })
        await pause()
      }
      if (active) {
        setStoryPingCite(null)
        setStoryPingTestId(null)
      }
    }
    void play()
    return () => {
      active = false
      if (timer != null) window.clearTimeout(timer)
      setStoryPingCite(null)
      setStoryPingTestId(null)
    }
  }, [storyStep, storyPaused, briefingResult, tests, factIndex, reducedMotion, chartMode, yAxis])

  useEffect(() => {
    if (!aboutOpen) return
    const prior = document.activeElement instanceof HTMLElement ? document.activeElement : null
    aboutCloseRef.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setAboutOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const focusable = aboutModalRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      prior?.focus()
    }
  }, [aboutOpen])

  const [visibleSentenceCount, setVisibleSentenceCount] = useState(0)
  useEffect(() => {
    const count = briefingResult?.briefing.sentences.length ?? 0
    setVisibleSentenceCount(0)
    if (!count) return
    if (reducedMotion) { setVisibleSentenceCount(count); return }
    const timer = window.setInterval(() => setVisibleSentenceCount((visible) => {
      if (visible + 1 >= count) window.clearInterval(timer)
      return Math.min(visible + 1, count)
    }), 220)
    return () => window.clearInterval(timer)
  }, [briefingResult, reducedMotion])

  useEffect(() => {
    if (chartMode !== '3d' || reducedMotion) {
      setOrbitAllowed(false)
      if (interactionTimer.current != null) window.clearTimeout(interactionTimer.current)
      return
    }
    setOrbitAllowed(false)
    if (interactionTimer.current != null) window.clearTimeout(interactionTimer.current)
    interactionTimer.current = window.setTimeout(() => setOrbitAllowed(true), 8000)
    return () => { if (interactionTimer.current != null) window.clearTimeout(interactionTimer.current) }
  }, [chartMode, reducedMotion, selectedPreset, yAxis])

  useEffect(() => {
    if (!orbitAllowed || chartMode !== '3d' || reducedMotion) return
    let seconds = 0
    const timer = window.setInterval(async () => {
      seconds += 1
      const graph = plotDiv.current
      if (!graph) return
      const plotly = await loadPlotlyRuntime()
      const angle = 2 * Math.PI * seconds / 60
      await plotly.relayout(graph, { 'scene.camera.eye': { x: 1.6 * Math.cos(angle), y: 1.6 * Math.sin(angle), z: 1.15 } })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [orbitAllowed, chartMode, reducedMotion])

  function stopOrbitFromInteraction(_event: ReactPointerEvent<HTMLElement>) {
    if (chartMode !== '3d' || reducedMotion) return
    setOrbitAllowed(false)
    if (interactionTimer.current != null) window.clearTimeout(interactionTimer.current)
    interactionTimer.current = window.setTimeout(() => setOrbitAllowed(true), 8000)
  }

  const phaseGroups = (phase: FuelPhase) => materialOptions.filter((item) => item.phase === phase && item.key !== `${phase}::other`)
  function startStory() {
    setActiveView('atlas')
    setSelectedPreset('moon-base')
    setMaterialKey('solid::PMMA')
    setDrawerTab('briefing')
    setStoryPaused(false)
    goToStoryStep(1)
    setViewRange('habitat')
  }
  function moveStory(direction: -1 | 1) {
    if (direction < 0) goToStoryStep(storyStep - 1)
    else if (storyStep >= 4) goToStoryStep(0)
    else goToStoryStep(storyStep + 1)
  }
  return (
    <motion.main className="app-shell" onPointerDownCapture={() => booting && setBooting(false)} initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reducedMotion ? 0 : 0.5 }}>
      <header className="topbar" id="top">
        <a className="brand" href="#top" aria-label="Fire Atlas home"><span className="brand-mark" aria-hidden="true">⌖</span><span className="brand-name">FIRE <b>ATLAS</b></span></a>
        <div className="topbar-caption"><span className="status-dot" /> PSI INDEX · <AnimatedCount value={findings?.summary.total_investigations ?? investigations.length} /> INVESTIGATIONS · <AnimatedCount value={tests.length} /> TESTS</div>
        <div className="topbar-actions"><div className="fact-ticker" aria-live="polite">{activeTickerFact && <button type="button" onClick={() => showFact(activeTickerFact)} aria-label={`Open finding: ${activeTickerFact.text}`}>{activeTickerFact.text}</button>}</div><button className="about-button" type="button" onClick={() => setAboutOpen(true)}>About</button></div>
      </header>

      <nav className="view-tabs" aria-label="Main views">
        {(['atlas', 'insights', 'compare', 'data'] as const).map((view) => <button key={view} type="button" className={activeView === view ? 'active' : ''} aria-current={activeView === view ? 'page' : undefined} onClick={() => { if (view !== 'atlas' && storyStepRef.current) goToStoryStep(0); setActiveView(view) }}>{view === 'atlas' ? 'Atlas' : view === 'insights' ? 'Insights' : view === 'compare' ? 'Compare' : 'Data'}</button>)}
      </nav>
      <AnimatePresence>{booting && !reducedMotion && <motion.div className="boot-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} role="status" aria-live="polite">
        <div className="boot-card"><span className="section-kicker">FIRE ATLAS · STARTUP</span><strong>Preparing the PSI evidence map</strong><div className="boot-steps">{['Source rows', 'Condition index', 'Habitat ranges', 'Citations'].map((step, index) => <span className={bootStep > index ? 'complete' : bootStep === index ? 'current' : ''} key={step}><i />{step}</span>)}</div><button type="button" onClick={() => setBooting(false)}>Skip intro</button></div>
      </motion.div>}</AnimatePresence>

      <section className="workspace" hidden={activeView !== 'atlas'}>
        <motion.aside className="control-panel panel" initial={reducedMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: booting ? 0.12 : 0 }}>
          <div className="section-kicker"><span>01</span> HABITAT CHECK <span className="section-status">{tests.length ? 'READY' : 'INDEXING'}</span></div>
          <h1>Atmosphere briefing</h1>
          <p className="panel-intro">Compare a cabin condition with measured NASA PSI tests and their source rows.</p>
          <form className="ask-box" onSubmit={(event) => { event.preventDefault(); void askQuestion(askText) }}>
            <label className="field-label" htmlFor="ask-input">Ask in plain English</label>
            <div className="ask-row">
              <input id="ask-input" type="text" maxLength={300} placeholder="Would Nomex burn in a lunar rover?" value={askText} onChange={(event) => setAskText(event.target.value)} />
              <button type="submit" disabled={askBusy || !askText.trim()}>{askBusy ? '…' : 'Ask'}</button>
            </div>
            <div className="ask-examples">{['Would Nomex burn in a lunar rover?', 'Is cotton safe on the ISS?', 'PMMA at 30% O2 and 10 psi'].map((example) => <button key={example} type="button" className="ask-example" disabled={askBusy} onClick={() => void askQuestion(example)}>{example}</button>)}</div>
            {askResult && <p className="ask-result"><span>{askResult.source}</span>{askResult.summary}</p>}
          </form>
          <label className="field-label" htmlFor="habitat-preset">Habitat preset</label>
          <select id="habitat-preset" value={selectedPreset} onChange={onPresetChange}>
            {habitats.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            <option value="custom">Custom atmosphere</option>
          </select>
          <div className="field-grid">
            <label className="field-label" htmlFor="o2-value">O₂ concentration <span>%</span>
              <input id="o2-value" type="number" min="0" max="100" step="0.1" inputMode="decimal" value={o2Input} placeholder="—" onChange={(event) => editAtmosphere('o2', event.target.value)} />
            </label>
            <label className="field-label" htmlFor="pressure-value">Pressure <span>psi</span>
              <input id="pressure-value" type="number" min="0.1" max="119.9" step="0.1" inputMode="decimal" value={pressureInput} placeholder="—" onChange={(event) => editAtmosphere('pressure', event.target.value)} />
            </label>
          </div>
          <label className="field-label" htmlFor="flow-value">Ventilation speed <span>cm/s</span>
            <input id="flow-value" type="number" min="0" max="1000" step="0.1" inputMode="decimal" value={flowInput} onChange={(event) => { setFlowInput(event.target.value); clearQueryResult() }} />
          </label>
          <label className="field-label" htmlFor="material-select">Material / fuel <span>{phaseLabel(selectedPhase).toUpperCase()}</span>
            <select id="material-select" value={materialKey} onChange={(event) => { setMaterialKey(event.target.value); clearQueryResult() }}>
              {(['solid', 'liquid', 'gas'] as FuelPhase[]).map((phase) => <optgroup key={phase} label={phaseLabel(phase)}>
                {phaseGroups(phase).map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                <option value={`${phase}::other`}>Other {phaseLabel(phase)}</option>
              </optgroup>)}
            </select>
          </label>
          <button className="run-button" type="button" onClick={() => void runCheck()} disabled={briefingLoading || !tests.length || !validAtmosphere || !validFlow || !selectedMaterial}>{briefingLoading ? 'Running…' : 'Run check'} {!briefingLoading && <span aria-hidden="true">→</span>}</button>
          {briefingError && <p className="input-error" role="alert">{briefingError}</p>}

          <section className={`coverage-strip ${extrapolating ? 'extrapolating' : ''}`} aria-label="Live PSI coverage by fuel phase">
            {!validAtmosphere ? <div className="coverage-neutral">Enter O₂ and pressure</div> : <>
            <div className="coverage-heading"><span>COVERAGE · ±5 % O₂ / ±2 psi</span><span>LIVE</span></div>
          {(['solid', 'liquid', 'gas'] as FuelPhase[]).map((phase) => {
              const item = coverage[phase]
              const maxO2 = item.max_o2_tested
              const count = item.coverage === 'covered_assumed_pressure' || item.coverage === 'sparse'
                ? item.n_near_with_assumed_pressure : item.n_near
              const tag = item.coverage === 'covered_assumed_pressure' ? 'ASSUMED PRESSURE' : item.coverage.toUpperCase()
              return <div className={`coverage-row ${phase === selectedPhase ? 'selected' : ''}`} key={phase}>
                <span>{phaseLabel(phase)}</span><strong>{count.toLocaleString()}</strong><span className={`coverage-tag ${item.coverage} ${item.n_near_assumed_pressure ? 'assumed-pressure' : ''}`} title={item.coverage === 'covered_assumed_pressure' ? 'COVERED · ASSUMED CABIN PRESSURE' : undefined} aria-label={item.coverage === 'covered_assumed_pressure' ? 'COVERED · ASSUMED CABIN PRESSURE' : undefined}>{tag}</span><span>MAX O₂ {maxO2 ? `${maxO2.value.toFixed(1)} %` : '—'}</span>
              </div>
            })}
            {extrapolating && <div className="coverage-alert">EXTRAPOLATING — NO PSI TESTS IN THIS REGION</div>}
            </>}
          </section>
          <p className="source-note">Measured O₂ with assumed cabin pressure is tagged separately. Assumed O₂ never counts as measured coverage.</p>
        </motion.aside>

        <motion.section id="condition-space" className={`atlas-panel panel ${extrapolating ? 'extrapolating' : ''}`} aria-label="Combustion test atlas" onPointerDownCapture={stopOrbitFromInteraction} onPointerMoveCapture={stopOrbitFromInteraction} initial={reducedMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: booting ? 0.3 : 0 }}>
          {typeof solidMaxFinding?.value === 'number' && typeof lunarO2MinimumFinding?.value === 'number' && <div className="atlas-key-finding" aria-label="Key finding from NASA PSI and challenge habitat ranges">
            <span className="key-finding-copy">EVERY SOLID-MATERIAL TEST IN PSI: ≤ {solidMaxFinding.value.toFixed(1)} % O₂ · PLANNED LUNAR HABITATS: ≥ {lunarO2MinimumFinding.value.toFixed(0)} % O₂</span>
            <span className="key-finding-citations"><button type="button" className="citation-chip" title="fact:solid_max_o2" onClick={() => showFact(solidMaxFinding)}>{citeLabel('fact:solid_max_o2')}</button><button type="button" className="citation-chip" title="fact:moon-base_o2_min" onClick={() => showFact(lunarO2MinimumFinding)}>{citeLabel('fact:moon-base_o2_min')}</button></span>
          </div>}
          <div className="atlas-heading">
            <div><div className="section-kicker"><span>02</span> CONDITION SPACE <span className="section-status">{plottableTests.length.toLocaleString()} PLOTTABLE</span></div><h2>NASA PSI combustion atlas</h2></div>
            <div className="atlas-actions">
              <div className="chart-toggle" role="group" aria-label="Chart dimension">
                <button className={chartMode === '2d' ? 'active' : ''} type="button" onClick={() => setChartMode('2d')} aria-pressed={chartMode === '2d'}>2D</button>
                <button className={chartMode === '3d' ? 'active' : ''} type="button" onClick={() => setChartMode('3d')} aria-pressed={chartMode === '3d'}>3D</button>
              </div>
              {orbitAllowed && <span className="orbit-status">IDLE ORBIT</span>}
              <div className="view-range-toggle" role="group" aria-label="Chart range">
                <button type="button" className={viewRange === 'habitat' ? 'active' : ''} aria-pressed={viewRange === 'habitat'} onClick={() => { setViewRange('habitat'); setZoomRange(null) }}>Habitat range</button>
                <button type="button" className={viewRange === 'full' ? 'active' : ''} aria-pressed={viewRange === 'full'} onClick={() => { setViewRange('full'); setZoomRange(null) }}>Full range</button>
              </div>
              <span className="above-range-count">{aboveHabitatCount.toLocaleString()} tests above 22 psi</span>
              <button className="story-button" type="button" onClick={startStory}>Story mode <span>▶</span></button>
            </div>
          </div>
          {storyStep > 0 && <div className="story-caption active" aria-live="polite">
            <span className="story-step">{String(storyStep).padStart(2, '0')} / 04</span><p>{storyCaption}</p><div className="story-controls"><button type="button" onClick={() => moveStory(-1)} disabled={storyStep === 1}>Back</button><button type="button" onClick={() => setStoryPaused((paused) => !paused)}>{storyPaused ? 'Play' : 'Pause'}</button><button type="button" onClick={() => moveStory(1)}>{storyStep === 4 ? 'Close' : 'Next'}</button><button type="button" onClick={() => goToStoryStep(0)} aria-label="Exit story mode">×</button></div>
          </div>}
          <div className="axis-summary"><span>O₂ concentration <small>%</small></span><i>×</i><span>{chartMode === '2d' ? 'Pressure' : yAxis === 'pressure' ? 'Pressure' : 'O₂ partial pressure'} <small>psi</small></span>{chartMode === '3d' && <><i>×</i><span>Tests per 5 % × 1 psi cell <small>log height</small></span></>}</div>

          <div className="filter-toolbar"><button className="filters-toggle" type="button" aria-expanded={filtersExpanded} aria-controls="atlas-filters-panel" onClick={() => setFiltersExpanded((expanded) => !expanded)}>Filters {filtersExpanded ? '▴' : '▾'}</button><span className="filters-summary">{atlasFilterSummary}</span>
            {<div className="layer-controls" role="group" aria-label="Chart layers">
              {chartMode === '2d' && <button type="button" className={`layer-chip ${showIsobars ? 'active' : ''}`} aria-pressed={showIsobars} onClick={() => setShowIsobars((value) => !value)} title="Curves of constant O₂ partial pressure (O₂ % × pressure)">pO₂ isobars</button>}
              <span className="layer-label">{chartMode === '2d' ? 'Coverage' : 'Towers'}</span>
              {(chartMode === '2d' ? ['off', 'all', 'solid', 'liquid', 'gas'] as const : ['off', 'solid', 'liquid', 'gas'] as const).map((layer) => { const active = coverageLayer === layer || (chartMode === '3d' && layer === 'off' && coverageLayer === 'all'); return <button key={layer} type="button" className={`layer-chip ${active ? 'active' : ''}`} aria-pressed={active} onClick={() => setCoverageLayer(layer)}>{layer === 'off' ? (chartMode === '2d' ? 'Off' : 'All') : layer === 'all' ? 'All' : phaseLabel(layer)}</button> })}
            </div>}</div>
          {filtersExpanded && <div id="atlas-filters-panel" className="filters-panel" aria-label="Atlas filters">
            <div className="filter-field investigation-filter"><div className="filter-heading">Investigation <span>{selectedInvestigations.length}/{testInvestigations.length}</span></div>
              <div className="investigation-chips" role="group" aria-label="Filter investigations with test-level points">
                {testInvestigations.map((item) => <button type="button" key={item.id} className={`filter-chip ${selectedInvestigations.includes(item.id) ? 'active' : ''}`} aria-pressed={selectedInvestigations.includes(item.id)} onClick={() => setSelectedInvestigations((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])}>{item.acronym || item.id}<small>{item.n_tests}</small></button>)}
              </div>
              {noTestInvestigations.length > 0 && <div className="no-test-group"><span>No test-level data (summaries/models only)</span><p>{noTestInvestigations.map((item) => item.acronym || item.id).join(' · ')}</p></div>}
            </div>
            <div className="filter-field chip-filter"><span className="filter-heading">Fuel phase</span><div className="chip-row">
              {phases.map((phase) => <button key={phase} type="button" className={`filter-chip ${selectedPhases.includes(phase) ? 'active' : ''}`} aria-pressed={selectedPhases.includes(phase)} onClick={() => setSelectedPhases((current) => current.includes(phase) ? current.filter((item) => item !== phase) : [...current, phase])}>{phaseLabel(phase)}</button>)}
            </div></div>
            <div className="filter-field outcome-filter"><span className="filter-heading">Outcome</span><div className="chip-row">
              {outcomes.map((outcome) => <button key={outcome} type="button" className={`filter-chip outcome-${outcome} ${selectedOutcomes.includes(outcome) ? 'active' : ''}`} aria-pressed={selectedOutcomes.includes(outcome)} onClick={() => setSelectedOutcomes((current) => current.includes(outcome) ? current.filter((item) => item !== outcome) : [...current, outcome])}>{outcomeStyles[outcome].label}</button>)}
            </div></div>
            <div className="filter-toggles">
              <label className="toggle-line"><input type="checkbox" checked={includeAssumed} onChange={(event) => setIncludeAssumed(event.target.checked)} /><span>Include assumed values</span><small>{assumedPointCount.toLocaleString()}</small></label>
              <label className="toggle-line"><input type="checkbox" checked={showRanges} onChange={(event) => setShowRanges(event.target.checked)} /><span>Show ranges</span><small>{plottableRanges.toLocaleString()}</small></label>
            </div>
          </div>}

          <div className="plot-wrap">
            {extrapolating && <div key={scanKey} className="scanline" aria-hidden="true" />}
            <Suspense fallback={<div className="plot-skeleton" aria-live="polite"><span>Loading condition space…</span><i /><i /><i /></div>}>
              <Plot key={`${chartMode}-${yAxis}`} data={plotData} layout={layout} config={plotConfig} style={{ width: '100%', height: '100%' }} useResizeHandler onClick={onPointClick} onRelayout={handlePlotRelayout} onInitialized={setPlotReference} onUpdate={setPlotReference} />
            </Suspense>
            {dataError && <div className="plot-overlay error-overlay">{dataError}</div>}
            {!dataError && !tests.length && <div className="plot-overlay">Loading NASA PSI tables…</div>}
            {zoomRange && <button className="reset-zoom" type="button" onClick={() => setZoomRange(null)}>Reset view</button>}
          </div>
          <div className="atlas-footer">
            {chartMode === '3d' ? <div className="legend-group"><div className="shape-key tower-key"><span><i className="tower-swatch" />Tower height = number of PSI tests in each 5 % O₂ × 1 psi cell (log scale)</span><span><i className="lunar-swatch" />Translucent box = planned lunar habitat envelope (≥30 % O₂, ≤10.2 psi)</span></div></div> : <div className="legend-group">
              <div className="outcome-key">{outcomes.map((outcome) => <span key={outcome}><i style={{ background: outcomeStyles[outcome].color }} />{outcomeStyles[outcome].label}</span>)}</div>
              <div className="shape-key">{phases.map((phase) => <span key={phase}><i className={`shape-icon ${phase}`} />{phaseLabel(phase)}</span>)}<span><i className="hollow-icon" />hollow = coordinate assumed</span><span><i className="stack-icon" />larger marker = more tests at that condition</span>{showIsobars && <span><i className="isobar-icon" />curves = constant O₂ partial pressure</span>}</div>
            </div>}
          <div className="point-count"><strong data-testid="shown-count"><AnimatedCount value={shownTests.length} /></strong> points in range / {filteredTests.length.toLocaleString()} filtered <span>·</span> {envelopes.length.toLocaleString()} summaries</div>
          </div>
          <div className="hidden-count">{hiddenTestCount.toLocaleString()} tests lack plotted conditions · {outsideAxisRangeCount.toLocaleString()} outside current axes <span>·</span> {tests.length.toLocaleString()} points total</div>
        </motion.section>
      </section>

      {activeView === 'insights' && <InsightsView tests={tests} detections={detections} onReceipt={setReceiptTest} />}
      {activeView === 'compare' && <CompareView investigations={investigations} tests={tests} detections={detections} envelopes={envelopes} />}
      {activeView === 'data' && <DataView tests={dataTests} allTests={tests} investigations={investigations} filterSummary={dataFilterSummary} filterKey={dataFilterKey} />}

      <motion.section ref={briefingDrawerRef} className="insight-drawer panel" hidden={activeView !== 'atlas'} aria-live="polite" initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, delay: booting ? 0.48 : 0 }}>
        <div className="drawer-heading"><div className="section-kicker"><span>03</span> SI BRIEFING / SOURCE RECEIPT</div><div className="drawer-tabs" role="tablist" aria-label="Briefing and test receipt">
          <button type="button" role="tab" aria-selected={drawerTab === 'briefing'} className={drawerTab === 'briefing' ? 'active' : ''} onClick={() => setDrawerTab('briefing')}>Briefing</button>
          <button type="button" role="tab" aria-selected={drawerTab === 'test'} className={drawerTab === 'test' ? 'active' : ''} onClick={() => setDrawerTab('test')}>Test</button>
        </div></div>
        <AnimatePresence mode="wait">
          {drawerTab === 'briefing' ? <motion.div key="briefing" className="briefing-layout" initial={reducedMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={reducedMotion ? undefined : { opacity: 0 }} transition={{ duration: 0.22 }}>
            <div className="briefing-content">
              <div className="briefing-status"><span className={briefingResult?.provider === 'computed' ? 'status-muted' : ''}>{briefingResult?.provider === 'computed' ? 'SI UNAVAILABLE — COMPUTED FACTS ONLY' : briefingResult ? `PROVIDER ${briefingResult.provider.toUpperCase()}` : 'FACTS READY · RUN CHECK FOR BRIEFING'}</span><span>{briefingResult?.cached ? 'CACHED PRESET' : briefingResult?.provider && briefingResult.provider !== 'computed' ? 'LIVE' : 'DETERMINISTIC'}</span></div>
              {briefingLoading ? <div className="text-status" role="status" aria-live="polite">{briefingProgressStage === 'building'
                ? `Building evidence pack · 6 tests · 12 facts · ${briefingElapsedSeconds}s`
                : briefingProgressStage === 'asking'
                  ? `Asking SI · ${lastModelRef.current ?? 'configured model'} · ${briefingElapsedSeconds}s`
                  : `Verifying citations · ${briefingElapsedSeconds}s`}</div> : briefingResult ? <>
                <h2 className="briefing-headline">{briefingResult.briefing.headline}</h2>
                <div className="briefing-sentences" aria-live="polite">
                  {briefingResult.briefing.sentences.slice(0, visibleSentenceCount).map((sentence, index) => <motion.p key={`${index}-${sentence.text}`} className={sentence.unverified ? 'briefing-sentence unverified' : 'briefing-sentence'} initial={reducedMotion ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
                    <span>{sentence.text}</span>{sentence.unverified && <b className="warning-tag">UNVERIFIED</b>}
                    <span className={`citation-row ${storyPingCite && sentence.cites.includes(storyPingCite) ? 'story-ping' : ''}`}>{sentence.cites.map((cite) => <button key={cite} type="button" className="citation-chip" title={cite} onClick={() => onCitation(cite)}>{citeLabel(cite)}</button>)}</span>
                  </motion.p>)}
                </div>
                <div className="briefing-details">
                  <div><span className="eyebrow">EVIDENCE GAPS</span><ul>{briefingResult.briefing.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul></div>
                  <div><span className="eyebrow">NEXT TEST WINDOWS</span><table className="next-tests-table"><thead><tr><th>Material</th><th>O₂</th><th>Pressure</th><th>Flow</th><th>Why / source</th></tr></thead><tbody>{briefingResult.briefing.next_tests.map((next, index) => <tr key={`${next.material}-${index}`}><td>{next.material ?? 'Not specified'}</td><td>{formatValue(next.o2_pct, ' %', 1)}</td><td>{formatValue(next.pressure_psi, ' psi', 1)}</td><td>{formatValue(next.flow_cm_s, ' cm/s', 1)}</td><td>{next.why}<span className="citation-row">{next.cites.map((cite) => <button key={cite} type="button" className="citation-chip" title={cite} onClick={() => onCitation(cite)}>{citeLabel(cite)}</button>)}</span></td></tr>)}</tbody></table></div>
                </div>
                {briefingResult.verification.numbers_unverified > 0 && <div className="verification-warning">SI text containing {briefingResult.verification.numbers_unverified} unsupported number(s) was dropped before display.</div>}
                <div className="verification-footer">Verified {briefingResult.verification.sentences_kept}/{briefingResult.verification.sentences_total} sentences · {briefingResult.verification.citations_dropped} citations dropped · {briefingResult.verification.numbers_unverified} unsupported numbers · {briefingResult.provider}{briefingResult.model ? ` · ${briefingResult.model}` : ''}{briefingResult.cached ? ' · cached' : ''}{briefingResult.generated_at ? ` · ${new Date(briefingResult.generated_at).toLocaleString()}` : ''}</div>
              </> : <div className="briefing-empty">Select a habitat and material, then run the check. Coverage and ranked investigations update without waiting for a provider.</div>}
              {selectedFact && <div className="fact-detail"><span className="eyebrow">{selectedFact.id.toUpperCase()}</span><p>{selectedFact.text}</p><button type="button" onClick={() => setSelectedFact(null)}>Dismiss</button></div>}
            </div>
            <aside className="ranking-panel" aria-label="Ranked investigations">
              <div className="ranking-heading"><span className="eyebrow">RANKED INVESTIGATIONS</span><span>0–100 pts</span></div>
              <div className="pillar-chips" role="group" aria-label="Filter by safety pillar">
                <button type="button" className={!selectedPillar ? 'active' : ''} aria-pressed={!selectedPillar} onClick={() => setSelectedPillar(null)}>All</button>
                {pillars.map((pillar) => <button key={pillar} type="button" className={selectedPillar === pillar ? 'active' : ''} aria-pressed={selectedPillar === pillar} onClick={() => setSelectedPillar((current) => current === pillar ? null : pillar)}>{pillar}</button>)}
              </div>
              <div className="ranking-list" id="ranking-list">
                {visibleRankings.map((item: RankedInvestigation) => {
                  const investigation = investigationById.get(item.id)
                  const expanded = expandedRankId === item.id
                  return <article className="rank-item" id={`rank-${item.id}`} key={item.id}>
                    <button type="button" className="rank-row" aria-expanded={expanded} onClick={() => setExpandedRankId((current) => current === item.id ? null : item.id)}>
                      <span className="rank-number">{String(item.rank).padStart(2, '0')}</span><span className="rank-title"><b>{item.acronym ?? item.id}</b><small>{investigation?.title ?? 'PSI investigation'}</small></span><span className="rank-score">{item.score.toFixed(1)}</span>
                    </button>
                    <div className="rank-bar"><i style={{ width: `${item.score}%` }} /></div>
                    <div className="rank-tags">{(investigation?.safety_tags ?? []).map((tag) => <span key={tag}>{tag}</span>)}</div>
                    {expanded && <div className="rank-breakdown"><div className="score-breakdown">{Object.entries(item.breakdown).map(([key, score]) => <div key={key}><span>{key.replaceAll('_', ' ')}</span><b>{score.toFixed(1)}</b></div>)}<div><span>proximity phase factor</span><b>{item.phase_factor.toFixed(1)}×</b></div></div>{item.reason_facts.map((reason, index) => <p key={`${item.id}-reason-${index}`}>{reason.text}<span className="citation-row">{reason.cites.map((cite) => <button key={cite} type="button" className="citation-chip" title={cite} onClick={() => onCitation(cite)}>{citeLabel(cite)}</button>)}</span></p>)}</div>}
                  </article>
                })}
                {!visibleRankings.length && <p className="empty-state">No investigations match this ranking filter.</p>}
              </div>
            </aside>
          </motion.div> : <motion.div key="test" className="test-card-content" initial={reducedMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={reducedMotion ? undefined : { opacity: 0 }} transition={{ duration: 0.22 }}>
            {selectedTest ? <>
              <div className="test-title"><div><span className="eyebrow">{selectedTest.acronym || selectedTest.investigation} · {selectedTest.investigation}</span><h2>{investigationById.get(selectedTest.investigation)?.title || 'PSI investigation'} · {selectedTest.test_label}</h2></div><span className={`outcome-chip ${selectedTest.outcome}`}>{outcomeStyles[selectedTest.outcome].label}</span></div>
              <p className="configuration-copy">{configSentence(selectedTest.configuration)}</p>
              {selectedTest.extra.o2_semantics === 'ambient' && <p className="configuration-copy semantic-copy">Reported O₂ describes the ambient chamber atmosphere.</p>}
              {selectedTest.extra.o2_semantics === 'burner_stream' && <p className="configuration-copy semantic-copy">Reported O₂ describes the burner stream, not the ambient chamber atmosphere.</p>}
              <div className="test-facts">
                <div><span>Material</span><strong>{selectedTest.material ?? 'Not reported'}</strong></div>
                <div><span>O₂</span><strong>{formatValue(selectedTest.o2_pct, ' %')} <i className={`quality-tag ${selectedTest.quality.o2_pct ?? 'missing'}`}>{qualityLabel(selectedTest.quality.o2_pct)}</i></strong></div>
                <div><span>Pressure</span><strong>{formatValue(selectedTest.pressure_psi, ' psi')} <i className={`quality-tag ${selectedTest.quality.pressure_psi ?? 'missing'}`}>{qualityLabel(selectedTest.quality.pressure_psi)}</i></strong></div>
                <div><span>O₂ partial pressure</span><strong>{formatValue(selectedTest.o2_partial_psi, ' psi')} <i className="quality-tag derived">derived</i></strong></div>
                <div><span>Flow</span><strong>{formatValue(selectedTest.flow_cm_s, ' cm/s')} <i className={`quality-tag ${selectedTest.quality.flow_cm_s ?? 'missing'}`}>{qualityLabel(selectedTest.quality.flow_cm_s)}</i></strong></div>
                <div><span>Fuel phase · diluent</span><strong>{phaseLabel(selectedTest.fuel_phase)}{selectedTest.diluent ? ` · ${selectedTest.diluent}` : ''}</strong></div>
              </div>
              <div className="receipt-grid">
                <div className="receipt-block"><span className="eyebrow">SOURCE OUTCOME</span><p>{selectedTest.outcome_raw}</p></div>
                {Object.entries(selectedTest.metrics).filter(([, value]) => value != null).length > 0 && <div className="receipt-block"><span className="eyebrow">SOURCE METRICS</span><table className="metrics-table"><tbody>{Object.entries(selectedTest.metrics).filter(([, value]) => value != null).map(([key, value]) => <tr key={key}><th>{labelFromKey(key)}</th><td>{Array.isArray(value) ? value.join(' · ') : String(value)}</td></tr>)}</tbody></table></div>}
                {selectedTest.assumptions.length > 0 && <div className="receipt-block"><span className="eyebrow">ASSUMPTIONS / MAPPING</span><ul>{selectedTest.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul></div>}
                {selectedTest.source_warnings.length > 0 && <div className="receipt-block warning-block"><span className="eyebrow">SOURCE WARNINGS</span><ul>{selectedTest.source_warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
                {Object.entries(selectedTest.missing_reasons).some(([key]) => !key.startsWith('metrics.')) && <div className="receipt-block"><span className="eyebrow">MISSING MEASUREMENTS</span><ul>{Object.entries(selectedTest.missing_reasons).filter(([key]) => !key.startsWith('metrics.')).map(([key, reason]) => <li key={key}><b>{labelFromKey(key)}</b>: {reason}</li>)}</ul></div>}
              </div>
              <div className="source-receipt"><span className="eyebrow">RAW SOURCE</span><strong>{selectedTest.investigation} · {selectedTest.source.file} · row{selectedSourceRows.length > 1 ? 's ' : ' '}{selectedSourceRows.join(', ')}</strong><button type="button" className="receipt-button" onClick={() => setReceiptTest(selectedTest)}>View original NASA row →</button><div>{selectedTest.doi && <a href={`https://doi.org/${selectedTest.doi}`} target="_blank" rel="noreferrer">DOI {selectedTest.doi}</a>}<a href={selectedTest.psi_url} target="_blank" rel="noreferrer">PSI investigation page</a></div></div>
            </> : <div className="empty-drawer"><span className="empty-glyph" aria-hidden="true">⌖</span><div><h2>Select a test point</h2><p>Choose a plotted point to inspect conditions, flags, raw source, and row.</p></div></div>}
          </motion.div>}
        </AnimatePresence>
      </motion.section>

      <footer className="page-footer"><span>DATA · NASA PSI (psi.nasa.gov)</span><span>TEAM {TEAM_NAME.toUpperCase()} · SPACE APPS 2026</span><span>RESEARCH DATA, WITH RECEIPTS</span></footer>
      {aboutOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAboutOpen(false) }}>
        <section ref={aboutModalRef} className="about-modal panel" role="dialog" aria-modal="true" aria-labelledby="about-title">
          <button ref={aboutCloseRef} className="modal-close" type="button" aria-label="Close about" onClick={() => setAboutOpen(false)}>×</button>
          <div className="section-kicker"><span>ABOUT</span> FIRE ATLAS</div>
          <h2 id="about-title">What this is</h2>
          <p className="about-lede">Fire Atlas indexes NASA Physical Sciences Informatics combustion measurements across oxygen fraction, pressure, and flow. It compares selected habitat atmospheres with test evidence and keeps missing or assumed conditions visible.</p>

          <div className="about-grid">
            <section className="about-section">
              <h3>The finding · computed from PSI</h3>
              <div className="about-findings">{aboutFacts.map((fact) => <article className="about-finding" key={fact.id}>
                <p>{fact.text}</p>
                <button type="button" className="citation-chip" onClick={() => openAboutFinding(fact)} aria-label={`Open finding ${fact.id}`} title={fact.id}>{citeLabel(fact.id.startsWith('fact:') ? fact.id : `fact:${fact.id}`)}</button>
              </article>)}</div>
            </section>

            <section className="about-section">
              <h3>Method · source to briefing</h3>
              <div className="method-flow" aria-label="PSI API to briefing workflow">
                {[{ label: 'PSI API', detail: 'NASA source' }, { label: 'Harvest', detail: `${findings?.summary.total_investigations ?? investigations.length} investigations · ${sourceTableCount} tables` }, { label: 'Normalize', detail: `${tests.length.toLocaleString()} tests · provenance per value` }, { label: 'Findings engine', detail: 'Deterministic' }, { label: 'Evidence pack', detail: 'Query bounded' }, { label: 'SI', detail: 'Gemini / Groq' }, { label: 'Verifier', detail: 'Citation and number checks' }, { label: 'Briefing', detail: 'Decision support' }].flatMap((step, index, steps) => [
                  <div className="method-step" key={step.label}><b>{step.label}</b><span>{step.detail}</span></div>,
                  ...(index < steps.length - 1 ? [<span className="method-arrow" key={`${step.label}-arrow`} aria-hidden="true">→</span>] : []),
                ])}
              </div>
            </section>

            <section className="about-section">
              <h3>How to read the atlas</h3>
              <ul className="about-legend">
                <li><i className="gas" />Circle · gas phase</li><li><i className="droplet" />Diamond · droplet phase</li><li><i className="solid" />Square · solid phase</li><li><i className="hollow" />Hollow · at least one coordinate assumed</li>
                <li><i style={{ color: '#ff5a1f' }} />Orange · burned</li><li><i style={{ color: '#ffc542' }} />Yellow · self-extinguished</li><li><i style={{ color: '#3fa7ff' }} />Blue · no ignition</li><li><i style={{ color: '#5b6478' }} />Gray · outcome unknown</li>
              </ul>
              <div className="about-region-key"><span><i />Dashed lavender region · planned lunar habitat envelope</span><span><i className="solid-band" />Orange band · measured solid-test O₂ range at assumed cabin pressure</span><span>White-outlined diamonds · habitat references</span></div>
            </section>

            <section className="about-section">
              <h3>Limitations</h3>
              <ul className="about-limitations">
                <li>No partial-gravity data in PSI.</li>
                <li>Solid-test pressures are not recorded; cabin pressure is assumed where shown.</li>
                <li>Burner-stream oxygen is distinct from ambient O₂.</li>
                <li>Outcome shares are descriptive, not risk probabilities.</li>
                <li>SI briefings are decision support, not certification.</li>
              </ul>
            </section>

            <section className="about-section">
              <h3>Data &amp; credits</h3>
              <div className="about-data-actions"><button type="button" onClick={openHowToCite}>Open Data tab · How to cite →</button></div>
              <ul className="about-doi-list" aria-label="Harvested PSI investigation DOIs">{investigations.filter((item) => item.doi).map((item) => <li key={item.id}><a href={`https://doi.org/${item.doi}`} target="_blank" rel="noreferrer">{item.acronym ?? item.id} · {item.doi}</a></li>)}</ul>
              <p className="about-credit-line">Libraries: React · Vite · Plotly.js · Motion · pandas · openpyxl</p>
              <p className="about-credit-line">SI tools used: Gemini, Groq (runtime)</p>
              <p className="about-credit-line">Team {TEAM_NAME} · {TEAM_MEMBERS.join(', ')}</p>
              <p className="about-credit-line">{EVENT_LINE}</p>
            </section>

            <section className="about-section">
              <h3>Earth applications · context, not equivalence</h3>
              <div className="earth-applications">
                <div className="earth-row"><b>Suppression · FLEX</b><span>Suppressant studies inform questions relevant to fine-water-mist and gaseous suppression tools.</span><a href="https://spinoff.nasa.gov/node/11065" target="_blank" rel="noreferrer">NASA Spinoff ↗</a></div>
                <div className="earth-row"><b>Detection · SAME / SAME-R</b><span>Space smoke and aerosol measurements sit alongside terrestrial smoke and fire detection.</span><a href="https://spinoff.nasa.gov/node/9407" target="_blank" rel="noreferrer">NASA Spinoff ↗</a></div>
                <div className="earth-row"><b>Protection</b><span>Space-derived breathing systems and protective materials have informed firefighter air tanks and gear.</span><span><a href="https://spinoff.nasa.gov/node/9582" target="_blank" rel="noreferrer">Air tanks ↗</a> · <a href="https://spinoff.nasa.gov/node/9918" target="_blank" rel="noreferrer">Fire attire ↗</a></span></div>
              </div>
              <p className="earth-analogue">Oxygen-enriched hospital rooms are an Earth analogue for the habitat-atmosphere question; this dataset contains no hospital-room measurements.</p>
            </section>
          </div>
          <button className="run-button" type="button" onClick={() => setAboutOpen(false)}>Back to atlas <span>→</span></button>
        </section>
      </div>}
      {receiptTest && <SourceRowModal test={receiptTest} onClose={() => setReceiptTest(null)} />}
    </motion.main>
  )
}

export default App
