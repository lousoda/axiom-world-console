import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react"
import "./App.css"
import {
  fetchExplainRecent,
  fetchLogs,
  fetchMetrics,
  fetchWorld,
  loadScenario,
  type ScenarioKey,
  probeMetrics,
} from "./api/client"
import { executeFlowCycle } from "./flow/flowController"
import { GraphView } from "./graph/GraphView"
import {
  EXPLAIN_PULL_EVERY,
  flowDelayFor,
  shouldStopFlowForStatus,
} from "./flow/flowPolicy"
import {
  evidenceTagsForText,
  extractEvidenceFlags,
  type AutonomyEvidenceCounters,
} from "./model/evidence"
import { buildStateFieldGraph } from "./model/stateFieldMapper"
import type {
  ExplainRecentSnapshot,
  FlowMode,
  MetricsSnapshot,
  WorldSnapshot,
} from "./types"

const DEFAULT_BASE_URL = "http://127.0.0.1:8001"
const STORAGE_BASE_URL = "world_console_base_url"
const STORAGE_GATE_KEY = "world_console_gate_key"
const STORAGE_SCENARIO = "world_console_scenario"
const STORAGE_SAFE_MODE = "world_console_safe_mode"
const OBSERVED_CODES = [200, 401, 402, 409, 429, 502] as const
const TRACE_LIMIT = 40
const EXPLAIN_LIMIT = 80
const FLOW_LIMIT_AGENTS = 50
const SCENE_REFRESH_LOGS_LIMIT = 28
const SCENE_REFRESH_EXPLAIN_LIMIT = 60
const SCENARIO_OPTIONS: Array<{ key: ScenarioKey; label: string }> = [
  { key: "autonomy_proof", label: "Autonomy Proof" },
  { key: "autonomy_breathing", label: "Autonomy Breathing" },
  { key: "basic_auto", label: "Basic Auto" },
]

type ObservedCode = (typeof OBSERVED_CODES)[number]
type ConsoleTab = "WORLD" | "TRACE" | "EXPLAIN" | "HOW_IT_WORKS"

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function loadStorageValue(key: string, fallback: string): string {
  if (typeof window === "undefined") {
    return fallback
  }
  return window.localStorage.getItem(key) ?? fallback
}

function sanitizeGateKey(rawKey: string): string {
  return rawKey
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .replace(/^['"`]+|['"`]+$/g, "")
}

function persistStorageValue(key: string, value: string) {
  if (typeof window === "undefined") {
    return
  }
  window.localStorage.setItem(key, value)
}

function isObservedCode(status: number): status is ObservedCode {
  return OBSERVED_CODES.includes(status as ObservedCode)
}

function bodyPreview(rawText: string): string {
  if (!rawText || rawText.length === 0) {
    return "No response body."
  }
  return rawText
}

function summarizeKey(value: string): string {
  if (value.length === 0) {
    return "empty"
  }
  if (value.length <= 10) {
    return `${value.length} chars`
  }
  return `${value.slice(0, 6)}...${value.slice(-4)} (${value.length})`
}

function formatUnknown(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function extractTickLabel(text: string): string | null {
  const match = text.match(/\btick\s+(\d+)/i)
  if (!match || !match[1]) {
    return null
  }
  return `tick ${match[1]}`
}

function App() {
  const [baseUrl, setBaseUrl] = useState<string>(() =>
    loadStorageValue(STORAGE_BASE_URL, DEFAULT_BASE_URL),
  )
  const [gateKey, setGateKey] = useState<string>(() =>
    sanitizeGateKey(loadStorageValue(STORAGE_GATE_KEY, "")),
  )
  const [scenarioKey, setScenarioKey] = useState<ScenarioKey>(() => {
    const saved = loadStorageValue(STORAGE_SCENARIO, "autonomy_proof")
    return (
      saved === "basic_auto" ||
      saved === "autonomy_proof" ||
      saved === "autonomy_breathing"
    )
      ? saved
      : "autonomy_proof"
  })

  const [isTesting, setIsTesting] = useState<boolean>(false)
  const [isScenarioLoading, setIsScenarioLoading] = useState<boolean>(false)
  const [isFlowRunning, setIsFlowRunning] = useState<boolean>(false)
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(false)

  const [flowMode, setFlowMode] = useState<FlowMode>("PAUSE")
  const [safeMode, setSafeMode] = useState<boolean>(() => {
    const saved = loadStorageValue(STORAGE_SAFE_MODE, "0")
    return saved === "1"
  })
  const [flowCycles, setFlowCycles] = useState<number>(0)
  const [flowBackoffMs, setFlowBackoffMs] = useState<number>(0)
  const [activeTab, setActiveTab] = useState<ConsoleTab>("WORLD")
  const [flowNote, setFlowNote] = useState<string>(
    "FLOW paused. Select LIVE or ACCELERATE to begin.",
  )

  const [lastStatus, setLastStatus] = useState<number | null>(null)
  const [lastMessage, setLastMessage] = useState<string>("No probe yet.")
  const [statusHits, setStatusHits] = useState<Record<ObservedCode, number>>({
    200: 0,
    401: 0,
    402: 0,
    409: 0,
    429: 0,
    502: 0,
  })

  const [worldSnapshot, setWorldSnapshot] = useState<WorldSnapshot | null>(null)
  const [metricsSnapshot, setMetricsSnapshot] = useState<MetricsSnapshot | null>(
    null,
  )
  const [traceSnapshot, setTraceSnapshot] = useState<unknown[]>([])
  const [explainSnapshot, setExplainSnapshot] = useState<ExplainRecentSnapshot | null>(
    null,
  )
  const [autonomyEvidence, setAutonomyEvidence] = useState<AutonomyEvidenceCounters>(
    {
      capacityDenial: 0,
      cooldownPenalty: 0,
      adaptationWanderOnce: 0,
    },
  )
  const [eventPulse, setEventPulse] = useState<
    "none" | "denial" | "cooldown" | "adaptation"
  >("none")

  const flowTokenRef = useRef(0)
  const keyFileInputRef = useRef<HTMLInputElement | null>(null)
  const seenExplainEvidenceRef = useRef<Set<string>>(new Set())
  const pulseTimeoutRef = useRef<number | null>(null)

  const recordStatus = useCallback((status: number, message: string) => {
    setLastStatus(status)
    setLastMessage(message)
    if (isObservedCode(status)) {
      setStatusHits((current) => ({
        ...current,
        [status]: current[status] + 1,
      }))
    }
  }, [])

  const canTest = baseUrl.trim().length > 0 && !isTesting
  const canLoadScenario =
    baseUrl.trim().length > 0 &&
    gateKey.trim().length > 0 &&
    !isScenarioLoading &&
    !isFlowRunning

  const refreshSnapshotsAfterSceneLoad = useCallback(async () => {
    try {
      const [worldRes, metricsRes, logsRes, explainRes] = await Promise.all([
        fetchWorld(baseUrl, gateKey),
        fetchMetrics(baseUrl, gateKey),
        fetchLogs(baseUrl, gateKey, SCENE_REFRESH_LOGS_LIMIT),
        fetchExplainRecent(baseUrl, gateKey, SCENE_REFRESH_EXPLAIN_LIMIT),
      ])

      if (worldRes.data) {
        setWorldSnapshot(worldRes.data)
      }
      if (metricsRes.data) {
        setMetricsSnapshot(metricsRes.data)
      }
      if (Array.isArray(logsRes.data)) {
        setTraceSnapshot(logsRes.data)
      }
      if (explainRes.data) {
        setExplainSnapshot(explainRes.data)
      }

      const responses = [worldRes, metricsRes, logsRes, explainRes]
      const stopStatus = responses.find((r) =>
        shouldStopFlowForStatus(r.status),
      )?.status

      if (stopStatus !== undefined) {
        recordStatus(stopStatus, "Scene loaded, but snapshot pull hit a gated status.")
        return { stopStatus, refreshError: false }
      }

      const nonOk = responses.find((r) => r.status !== 200)
      if (nonOk) {
        const nonOkMessage =
          nonOk.status >= 500
            ? `Upstream unavailable (status ${nonOk.status}) while refreshing snapshots.`
            : bodyPreview(nonOk.rawText)
        recordStatus(nonOk.status, nonOkMessage)
        return { stopStatus: null, refreshError: false }
      }

      recordStatus(200, "Scene loaded and snapshots refreshed.")
      return { stopStatus: null, refreshError: false }
    } catch (error) {
      setLastStatus(null)
      setLastMessage(
        error instanceof Error
          ? `Snapshot refresh failed: ${error.message}`
          : "Snapshot refresh failed.",
      )
      return { stopStatus: null, refreshError: true }
    }
  }, [baseUrl, gateKey, recordStatus])

  const keySummary = useMemo(() => summarizeKey(gateKey), [gateKey])

  const statusSummary = useMemo(() => {
    if (lastStatus === null) {
      return "Status: idle"
    }
    return `Status: ${lastStatus}`
  }, [lastStatus])

  async function handleProbeClick() {
    if (!canTest) {
      return
    }

    setIsTesting(true)
    setLastMessage("Probing metrics...")

    try {
      const result = await probeMetrics(baseUrl, gateKey)
      if (result.data) {
        setMetricsSnapshot(result.data)
      }

      const message =
        result.status === 200
          ? "Metrics link verified."
          : result.status >= 500
            ? `Upstream unavailable (status ${result.status}). Verify local API server and endpoint.`
            : bodyPreview(result.rawText)
      recordStatus(result.status, message)
    } catch (error) {
      setLastStatus(null)
      setLastMessage(
        error instanceof Error ? error.message : "Probe failed.",
      )
    } finally {
      setIsTesting(false)
    }
  }

  async function handleLoadScenario() {
    if (!canLoadScenario) {
      return
    }

    setIsScenarioLoading(true)
    try {
      const result = await loadScenario(baseUrl, gateKey, scenarioKey)
      const message =
        result.status === 200
          ? `Scene loaded: ${scenarioKey}.`
          : bodyPreview(result.rawText)
      recordStatus(result.status, message)

      if (result.status === 200) {
        seenExplainEvidenceRef.current.clear()
        setAutonomyEvidence({
          capacityDenial: 0,
          cooldownPenalty: 0,
          adaptationWanderOnce: 0,
        })
        setExplainSnapshot(null)
        setActiveTab("WORLD")
        const refresh = await refreshSnapshotsAfterSceneLoad()

        if (refresh.stopStatus === 401) {
          setFlowNote("Scene loaded. 401 during snapshot refresh: update X-World-Gate.")
          setFlowMode("PAUSE")
        } else if (refresh.stopStatus === 402 || refresh.stopStatus === 409) {
          setFlowNote(
            `Scene loaded. Snapshot refresh paused on status ${refresh.stopStatus}.`,
          )
          setFlowMode("PAUSE")
        } else if (refresh.refreshError) {
          setFlowNote(`Scene "${scenarioKey}" loaded. Snapshot refresh failed; FLOW is still available.`)
        } else {
          setFlowNote(`Scene "${scenarioKey}" loaded. Observation refreshed.`)
        }
      } else if (result.status === 401) {
        setFlowNote("401: X-World-Gate mismatch. Load key file and retry.")
      }
      if (shouldStopFlowForStatus(result.status)) {
        setFlowMode("PAUSE")
      }
    } catch (error) {
      setLastStatus(null)
      setLastMessage(
        error instanceof Error ? error.message : "Scene load failed.",
      )
    } finally {
      setIsScenarioLoading(false)
    }
  }

  function handleImportKeyClick() {
    keyFileInputRef.current?.click()
  }

  async function handleKeyFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const raw = await file.text()
      const nextValue = sanitizeGateKey(raw)
      setGateKey(nextValue)
      persistStorageValue(STORAGE_GATE_KEY, nextValue)
      setLastStatus(nextValue.length > 0 ? 200 : null)
      setLastMessage(
        nextValue.length > 0
          ? `X-World-Gate loaded (${nextValue.length} chars).`
          : "Selected file does not contain a valid key.",
      )
    } catch (error) {
      setLastStatus(null)
      setLastMessage(
        error instanceof Error
          ? `Failed to read key file: ${error.message}`
          : "Failed to read key file.",
      )
    } finally {
      event.target.value = ""
    }
  }

  useEffect(() => {
    if (flowMode === "PAUSE") {
      setIsFlowRunning(false)
      setFlowBackoffMs(0)
      return
    }
    if (baseUrl.trim().length === 0 || gateKey.trim().length === 0) {
      setFlowMode("PAUSE")
      setFlowNote("FLOW paused: Base URL or X-World-Gate is missing.")
      return
    }

    flowTokenRef.current += 1
    const token = flowTokenRef.current
    let cancelled = false
    let timeoutId: number | null = null
    let localBackoffMs = flowBackoffMs
    let cycleIndex = 0

    const runCycle = async () => {
      if (cancelled || token !== flowTokenRef.current) {
        return
      }

      setIsFlowRunning(true)
      cycleIndex += 1

      try {
        const cycle = await executeFlowCycle({
          baseUrl,
          gateKey,
          cycleIndex,
          backoffMs: localBackoffMs,
          explainEvery: EXPLAIN_PULL_EVERY,
          logsLimit: TRACE_LIMIT,
          explainLimit: EXPLAIN_LIMIT,
          limitAgents: FLOW_LIMIT_AGENTS,
        })

        localBackoffMs = cycle.backoffMs
        setFlowBackoffMs(cycle.backoffMs)

        for (const status of cycle.statusTrail) {
          recordStatus(status, cycle.message)
        }

        const upstreamErrorStatus = cycle.statusTrail.find((status) => status >= 500)
        if (upstreamErrorStatus !== undefined) {
          setFlowMode("PAUSE")
          setFlowNote(
            `FLOW paused on ${upstreamErrorStatus}: upstream unavailable. Verify API server and endpoint.`,
          )
          recordStatus(
            upstreamErrorStatus,
            `Upstream unavailable (status ${upstreamErrorStatus}).`,
          )
          return
        }

        if (cycle.world) {
          setWorldSnapshot(cycle.world)
        }
        if (cycle.metrics) {
          setMetricsSnapshot(cycle.metrics)
        }
        if (cycle.logs) {
          setTraceSnapshot(cycle.logs)
        }
        if (cycle.explain) {
          setExplainSnapshot(cycle.explain)
        }

        setFlowCycles((value) => value + 1)
        const baseFlowNote =
          cycle.backoffMs > 0
            ? `${cycle.message} Backoff ${cycle.backoffMs}ms.`
            : cycle.message
        const activeAgents = cycle.world?.agents?.length ?? 0
        setFlowNote(
          activeAgents === 0
            ? `${baseFlowNote} No agents active: choose a scenario and load scene.`
            : baseFlowNote,
        )

      if (cycle.stopFlow) {
        if (cycle.stopStatus === 401) {
          setFlowNote(
            "FLOW paused on 401. Update X-World-Gate (Load Key File) and retry.",
          )
        }
        setFlowMode("PAUSE")
        return
      }
      } catch (error) {
        setFlowMode("PAUSE")
        setFlowNote(
          `FLOW paused due to runtime error: ${
            error instanceof Error ? error.message : "unknown"
          }`,
        )
      } finally {
        setIsFlowRunning(false)
      }

      if (cancelled || token !== flowTokenRef.current) {
        return
      }

      const delay = flowDelayFor(flowMode) + localBackoffMs
      timeoutId = window.setTimeout(runCycle, delay)
    }

    void runCycle()

    return () => {
      cancelled = true
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [baseUrl, flowMode, gateKey, flowBackoffMs, recordStatus])

  useEffect(() => {
    const lines = explainSnapshot?.lines
    if (!lines || lines.length === 0) {
      return
    }
    let deltaCapacityDenial = 0
    let deltaCooldownPenalty = 0
    let deltaAdaptationWanderOnce = 0
    for (const line of lines) {
      if (seenExplainEvidenceRef.current.has(line)) {
        continue
      }
      seenExplainEvidenceRef.current.add(line)
      const flags = extractEvidenceFlags(line)
      deltaCapacityDenial += flags.capacityDenial
      deltaCooldownPenalty += flags.cooldownPenalty
      deltaAdaptationWanderOnce += flags.adaptationWanderOnce
    }
    if (
      deltaCapacityDenial === 0 &&
      deltaCooldownPenalty === 0 &&
      deltaAdaptationWanderOnce === 0
    ) {
      return
    }
    setAutonomyEvidence((prev) => ({
      capacityDenial: prev.capacityDenial + deltaCapacityDenial,
      cooldownPenalty: prev.cooldownPenalty + deltaCooldownPenalty,
      adaptationWanderOnce:
        prev.adaptationWanderOnce + deltaAdaptationWanderOnce,
    }))

    let nextPulse: "none" | "denial" | "cooldown" | "adaptation" = "none"
    if (deltaCapacityDenial > 0) {
      nextPulse = "denial"
    } else if (deltaCooldownPenalty > 0) {
      nextPulse = "cooldown"
    } else if (deltaAdaptationWanderOnce > 0) {
      nextPulse = "adaptation"
    }

    if (nextPulse !== "none") {
      setEventPulse(nextPulse)
      if (pulseTimeoutRef.current !== null) {
        window.clearTimeout(pulseTimeoutRef.current)
      }
      pulseTimeoutRef.current = window.setTimeout(() => {
        setEventPulse("none")
        pulseTimeoutRef.current = null
      }, 640)
    }
  }, [explainSnapshot])

  useEffect(() => {
    return () => {
      if (pulseTimeoutRef.current !== null) {
        window.clearTimeout(pulseTimeoutRef.current)
      }
    }
  }, [])

  const agentsObserved = worldSnapshot?.agents?.length ?? 0
  const locationsObserved = worldSnapshot?.locations?.length ?? 0
  const capacityLeftObserved = metricsSnapshot?.workshop_capacity_left ?? null
  const deferredTraceLines = traceSnapshot.length
  const explainLines = explainSnapshot?.lines?.length ?? 0
  const worldSnapshotText = worldSnapshot
    ? formatUnknown(worldSnapshot)
    : "No world snapshot available yet."
  const metricsSnapshotText = metricsSnapshot
    ? formatUnknown(metricsSnapshot)
    : "No constraints snapshot available yet."
  const stateFieldGraph = useMemo(
    () =>
      buildStateFieldGraph({
        world: worldSnapshot,
        metrics: metricsSnapshot,
        traceCount: deferredTraceLines,
        explainCount: explainLines,
      }),
    [deferredTraceLines, explainLines, metricsSnapshot, worldSnapshot],
  )
  const graphNodeCount = stateFieldGraph.nodes.length
  const graphEdgeCount = stateFieldGraph.edges.length
  const pressureRatio = useMemo(() => {
    const perTick = Math.max(1, metricsSnapshot?.workshop_capacity_per_tick ?? 1)
    const left = clamp(metricsSnapshot?.workshop_capacity_left ?? perTick, 0, perTick)
    return clamp((perTick - left) / perTick, 0, 1)
  }, [metricsSnapshot])
  const flowIntensity = useMemo(() => {
    if (flowMode === "ACCELERATE") {
      return 1
    }
    if (flowMode === "LIVE") {
      return 0.72
    }
    return 0.34
  }, [flowMode])
  const graphFx = useMemo(
    () => ({
      ca: 0.058 + pressureRatio * 0.1 + (isFlowRunning ? 0.018 : 0.006),
      grain: 0.09 + pressureRatio * 0.075 + flowIntensity * 0.034,
      vignette: 0.57 + (1 - flowIntensity) * 0.08,
      blur: 0,
      bloom: 0.24 + pressureRatio * 0.27 + flowIntensity * 0.16,
      sideAlpha: 0.065 + pressureRatio * 0.15 + flowIntensity * 0.05,
      sideShift: 0,
    }),
    [flowIntensity, isFlowRunning, pressureRatio],
  )
  const graphActivity = useMemo(
    () => ({
      agents: agentsObserved,
      queued: worldSnapshot?.queued_actions ?? 0,
      pressure: pressureRatio,
      flowMode,
      running: isFlowRunning,
      cycle: flowCycles,
    }),
    [agentsObserved, flowCycles, flowMode, isFlowRunning, pressureRatio, worldSnapshot],
  )
  const latestEvidencePreview = useMemo(() => {
    if (!explainSnapshot?.lines || explainSnapshot.lines.length === 0) {
      return [] as Array<{ text: string; tags: string[] }>
    }
    const preview: Array<{ text: string; tags: string[] }> = []
    for (let idx = explainSnapshot.lines.length - 1; idx >= 0; idx -= 1) {
      const text = explainSnapshot.lines[idx]
      const tags = evidenceTagsForText(text)
      if (tags.length === 0) {
        continue
      }
      preview.push({ text, tags })
      if (preview.length >= 3) {
        break
      }
    }
    return preview
  }, [explainSnapshot])
  const monadGateSignals = useMemo(
    () => ({
      unauthorized: statusHits[401],
      paymentRequired: statusHits[402],
      replayBlocked: statusHits[409],
      accepted: statusHits[200],
    }),
    [statusHits],
  )

  return (
    <main className="console-root">
      <div className="console-layout">
        <aside className="console-side">
          <section className="connection-card">
            <label htmlFor="base-url">API Endpoint</label>
            <input
              id="base-url"
              value={baseUrl}
              onChange={(event) => {
                const nextValue = event.target.value
                setBaseUrl(nextValue)
                persistStorageValue(STORAGE_BASE_URL, nextValue)
              }}
              placeholder="https://world-model-agent-api.fly.dev"
              autoComplete="off"
            />

            <label htmlFor="world-gate-key">X-World-Gate</label>
            <input
              id="world-gate-key"
              value={gateKey}
              onChange={(event) => {
                const nextValue = sanitizeGateKey(event.target.value)
                setGateKey(nextValue)
                persistStorageValue(STORAGE_GATE_KEY, nextValue)
              }}
              placeholder="Paste current WORLD_GATE_KEY"
              autoComplete="off"
            />
            <p className="field-meta">
              Key length (normalized): {gateKey.length}
            </p>
            <p className="field-meta">Key fingerprint: {keySummary}</p>

            <label>Scenario</label>
            <div className="scenario-row">
              {SCENARIO_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  className={scenarioKey === option.key ? "scenario-active" : ""}
                  onClick={() => {
                    setScenarioKey(option.key)
                    persistStorageValue(STORAGE_SCENARIO, option.key)
                  }}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>

            <input
              className="file-input-hidden"
              type="file"
              ref={keyFileInputRef}
              onChange={handleKeyFileSelected}
              accept=".txt,text/plain"
            />

            <div className="action-row">
              <button onClick={handleProbeClick} disabled={!canTest}>
                {isTesting ? "Validating..." : "Validate Link"}
              </button>
              <button onClick={handleImportKeyClick}>Load Key File</button>
              <button
                className="button-primary"
                onClick={handleLoadScenario}
                disabled={!canLoadScenario}
              >
                {isScenarioLoading ? "Loading Scene..." : "Load Scene"}
              </button>
            </div>
          </section>

          <section className="flow-card">
            <h2>FLOW</h2>
            <div className="flow-row">
              <button
                className={flowMode === "LIVE" ? "flow-active" : ""}
                onClick={() => setFlowMode("LIVE")}
              >
                LIVE
              </button>
              <button
                className={flowMode === "PAUSE" ? "flow-active" : ""}
                onClick={() => setFlowMode("PAUSE")}
              >
                PAUSE
              </button>
              <button
                className={flowMode === "ACCELERATE" ? "flow-active" : ""}
                onClick={() => setFlowMode("ACCELERATE")}
              >
                ACCELERATE
              </button>
            </div>
            <div className="flow-safe-row">
              <button
                className={`flow-safe-btn ${safeMode ? "flow-safe-active" : ""}`}
                onClick={() => {
                  const next = !safeMode
                  setSafeMode(next)
                  persistStorageValue(STORAGE_SAFE_MODE, next ? "1" : "0")
                }}
                type="button"
              >
                Safe Mode: {safeMode ? "ON" : "OFF"}
              </button>
            </div>
            <p className="flow-meta">
              Mode {flowMode} | Loop {isFlowRunning ? "on" : "off"} | Cycles{" "}
              {flowCycles}
            </p>
            <p className="flow-meta">Retry delay {flowBackoffMs}ms</p>
            <p className="flow-note">{flowNote}</p>
          </section>

          <section className="status-card">
            <h2>Status Badges</h2>
            <div className="status-strip">
              {OBSERVED_CODES.map((code) => (
                <span
                  key={code}
                  className={`status-badge ${
                    lastStatus === code ? "status-badge-active" : ""
                  }`}
                >
                  {code}: {statusHits[code]}
                </span>
              ))}
            </div>
            <p className="status-summary">{statusSummary}</p>
            <pre className="status-message">{lastMessage}</pre>
          </section>

          <section className="evidence-card">
            <h2>Autonomy Evidence</h2>
            <div className="evidence-strip">
              <span className="evidence-pill">
                Capacity denial: {autonomyEvidence.capacityDenial}
              </span>
              <span className="evidence-pill">
                Cooldown penalty: {autonomyEvidence.cooldownPenalty}
              </span>
              <span className="evidence-pill">
                Adaptation (wander once): {autonomyEvidence.adaptationWanderOnce}
              </span>
            </div>
            <p className="evidence-note">Derived from EXPLAIN forensic trace.</p>
          </section>

          <section className="telemetry-card">
            <h2>System Snapshot</h2>
            <p>Agents observed: {agentsObserved}</p>
            <p>Trace lines: {deferredTraceLines}</p>
            <p>Explain lines: {explainLines}</p>
            <p>
              Capacity left:{" "}
              {metricsSnapshot ? metricsSnapshot.workshop_capacity_left : "n/a"}
            </p>
          </section>
        </aside>

        <section className="console-main">
          <section className="tab-card">
            <div className="tab-row">
              <div className="tab-row-left">
                <button
                  className={`tab-btn ${activeTab === "WORLD" ? "tab-active" : ""}`}
                  onClick={() => setActiveTab("WORLD")}
                >
                  WORLD
                </button>
                <button
                  className={`tab-btn ${activeTab === "TRACE" ? "tab-active" : ""}`}
                  onClick={() => setActiveTab("TRACE")}
                >
                  TRACE
                </button>
                <button
                  className={`tab-btn ${activeTab === "EXPLAIN" ? "tab-active" : ""}`}
                  onClick={() => setActiveTab("EXPLAIN")}
                >
                  EXPLAIN
                </button>
                <button
                  className={`tab-btn ${
                    activeTab === "HOW_IT_WORKS" ? "tab-active" : ""
                  }`}
                  onClick={() => setActiveTab("HOW_IT_WORKS")}
                >
                  HOW IT WORKS
                </button>
              </div>
              {activeTab === "WORLD" ? (
                <div className="tab-row-right">
                  <span className="hud-pill">Agents {agentsObserved}</span>
                  <span className="hud-pill">Locations {locationsObserved}</span>
                  <span className="hud-pill">
                    Capacity {capacityLeftObserved ?? "n/a"}
                  </span>
                  <span className="hud-pill">{graphNodeCount} Nodes</span>
                  <span className="hud-pill">{graphEdgeCount} Links</span>
                </div>
              ) : null}
            </div>

            {activeTab === "WORLD" ? (
              <div className="tab-panel tab-panel-world">
                <div className="world-stage">
                  {agentsObserved === 0 ? (
                    <div className="world-alert">
                      No agents active. Choose scenario and press Load Scene.
                    </div>
                  ) : null}
                  <div
                    className={`world-pulse ${
                      eventPulse !== "none" ? `pulse-${eventPulse}` : ""
                    }`}
                  />
                  <GraphView
                    graph={stateFieldGraph}
                    fx={graphFx}
                    activity={graphActivity}
                    safeMode={safeMode}
                  />

                  <button
                    className="inspector-toggle"
                    onClick={() => setIsInspectorOpen((value) => !value)}
                  >
                    {isInspectorOpen ? "Hide Inspector" : "Open Inspector"}
                  </button>

                  <aside
                    className={`inspector-drawer ${
                      isInspectorOpen ? "inspector-open" : "inspector-closed"
                    }`}
                  >
                    <div className="inspector-head">
                      <h3>Inspector</h3>
                      <button
                        className="inspector-close"
                        onClick={() => setIsInspectorOpen(false)}
                      >
                        Close
                      </button>
                    </div>

                    <div className="panel-grid panel-grid-drawer">
                      <article className="panel-block">
                        <h3>World Snapshot</h3>
                        <pre>{worldSnapshotText}</pre>
                      </article>
                      <article className="panel-block">
                        <h3>Constraints Snapshot</h3>
                        <pre>{metricsSnapshotText}</pre>
                      </article>
                    </div>
                  </aside>

                  <div className="world-caption">
                    State field derived from agents, locations, and constraints.
                  </div>
                </div>
              </div>
            ) : null}

            {activeTab === "TRACE" ? (
              <div className="tab-panel">
                <div className="forensic-head">
                  <h3>TRACE</h3>
                  <p>Deferred event stream, newest first.</p>
                </div>
                {latestEvidencePreview.length > 0 ? (
                  <section className="evidence-peek">
                    <h4>Latest Evidence</h4>
                    <ul className="evidence-peek-list">
                      {latestEvidencePreview.map((entry, index) => (
                        <li key={`${entry.text}-${index}`} className="evidence-peek-item">
                          <div className="evidence-tags">
                            {entry.tags.map((tag) => (
                              <span
                                key={`${tag}-${index}`}
                                className={`evidence-tag evidence-tag-${tag.toLowerCase()}`}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                          <pre>{entry.text}</pre>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {traceSnapshot.length === 0 ? (
                  <p className="empty-panel">No trace lines yet.</p>
                ) : (
                  <ul className="trace-list">
                    {traceSnapshot
                      .slice()
                      .reverse()
                      .map((entry, index) => {
                        const entryText = typeof entry === "string" ? entry : formatUnknown(entry)
                        const tags = evidenceTagsForText(entryText)
                        const tickLabel = extractTickLabel(entryText)
                        return (
                          <li key={index} className="trace-item forensic-item">
                            <div className="forensic-meta">
                              <span className="forensic-tick">
                                {tickLabel ?? "event"}
                              </span>
                              {tags.length > 0 ? (
                                <div className="evidence-tags">
                                  {tags.map((tag) => (
                                    <span
                                      key={tag}
                                      className={`evidence-tag evidence-tag-${tag.toLowerCase()}`}
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                            <pre>{entryText}</pre>
                          </li>
                        )
                      })}
                  </ul>
                )}
              </div>
            ) : null}

            {activeTab === "EXPLAIN" ? (
              <div className="tab-panel">
                <div className="forensic-head">
                  <h3>EXPLAIN</h3>
                  <p>Forensic reasoning trail after each world step.</p>
                </div>
                {latestEvidencePreview.length > 0 ? (
                  <section className="evidence-peek">
                    <h4>Latest Evidence</h4>
                    <ul className="evidence-peek-list">
                      {latestEvidencePreview.map((entry, index) => (
                        <li key={`${entry.text}-${index}`} className="evidence-peek-item">
                          <div className="evidence-tags">
                            {entry.tags.map((tag) => (
                              <span
                                key={`${tag}-${index}`}
                                className={`evidence-tag evidence-tag-${tag.toLowerCase()}`}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                          <div className="explain-line">{entry.text}</div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {!explainSnapshot || explainSnapshot.lines.length === 0 ? (
                  <p className="empty-panel">No explain lines yet.</p>
                ) : (
                  <ul className="explain-list">
                    {explainSnapshot.lines
                      .slice()
                      .reverse()
                      .map((line, index) => {
                        const tags = evidenceTagsForText(line)
                        const tickLabel = extractTickLabel(line)
                        return (
                          <li key={index} className="forensic-item">
                            <div className="forensic-meta">
                              <span className="forensic-tick">
                                {tickLabel ?? "event"}
                              </span>
                              {tags.map((tag) => (
                                <span
                                  key={tag}
                                  className={`evidence-tag evidence-tag-${tag.toLowerCase()}`}
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                            <div className="explain-line">{line}</div>
                          </li>
                        )
                      })}
                  </ul>
                )}
              </div>
            ) : null}

            {activeTab === "HOW_IT_WORKS" ? (
              <div className="tab-panel">
                <h3>HOW IT WORKS</h3>
                <p className="how-sequence">
                  State -&gt; Policy -&gt; Constraint -&gt; Adaptation -&gt; Proof
                </p>
                <div className="how-grid">
                  <article className="how-card">
                    <h4>Observation Loop</h4>
                    <p>
                      Each cycle reads the full world snapshot.
                    </p>
                    <p>
                      State, position, balance, capacity, cooldown.
                    </p>
                    <p>
                      No partial context. No hidden signals.
                    </p>
                    <p className="how-metric">
                      Proof Signal:{" "}
                      Cycle <strong>{flowCycles}</strong> · Capacity Left{" "}
                      <strong>{capacityLeftObserved ?? "n/a"}</strong>
                      {" · "}Agent State <strong>{agentsObserved}</strong>
                    </p>
                  </article>

                  <article className="how-card">
                    <h4>Policy Engine</h4>
                    <p>
                      Goal and state are evaluated per agent.
                    </p>
                    <p>
                      Action is selected from a bounded rule set.
                    </p>
                    <p>
                      Deterministic mapping: state to action.
                    </p>
                    <p className="how-metric">
                      Proof Signal:{" "}
                      Goal Checks <strong>{agentsObserved}</strong> · Position Signals{" "}
                      <strong>{locationsObserved}</strong> · Trace Lines{" "}
                      <strong>{deferredTraceLines}</strong>
                    </p>
                  </article>

                  <article className="how-card">
                    <h4>Constraint Pressure</h4>
                    <p>
                      Capacity limits and cooldowns introduce pressure.
                    </p>
                    <p>
                      Denied actions trigger controlled divergence.
                    </p>
                    <p>
                      Every deviation is logged and explainable.
                    </p>
                    <p className="how-metric">
                      Proof Signal:{" "}
                      Denials <strong>{autonomyEvidence.capacityDenial}</strong> ·
                      Cooldowns <strong>{autonomyEvidence.cooldownPenalty}</strong> ·
                      Capacity Left <strong>{capacityLeftObserved ?? "n/a"}</strong>
                    </p>
                  </article>

                  <article className="how-card">
                    <h4>Adaptive Autonomy</h4>
                    <p>
                      Repeated denial triggers temporary goal override.
                    </p>
                    <p>
                      Adaptive window expires and goal is restored.
                    </p>
                    <p>
                      Behavior emerges from rule execution, not scripts.
                    </p>
                    <p className="how-metric">
                      Proof Signal:{" "}
                      Adaptation <strong>{autonomyEvidence.adaptationWanderOnce}</strong> ·
                      Cooldown <strong>{autonomyEvidence.cooldownPenalty}</strong> ·
                      Explain Lines <strong>{explainLines}</strong>
                    </p>
                  </article>

                  <article className="how-card">
                    <h4>Monad Entry Gate</h4>
                    <p>
                      Access requires a verified Monad mainnet transaction.
                    </p>
                    <p>
                      Receipt, value, chainId, and treasury are validated.
                    </p>
                    <p>
                      Reused transactions are rejected (409).
                    </p>
                    <p className="how-metric">
                      Proof Signal:{" "}
                      401 <strong>{monadGateSignals.unauthorized}</strong> · 402{" "}
                      <strong>{monadGateSignals.paymentRequired}</strong> · 200{" "}
                      <strong>{monadGateSignals.accepted}</strong> · 409{" "}
                      <strong>{monadGateSignals.replayBlocked}</strong>
                    </p>
                  </article>

                  <article className="how-card">
                    <h4>Determinism Proof</h4>
                    <p>
                      Identical inputs produce identical outcomes.
                    </p>
                    <p>
                      Replay yields matching traces and signatures.
                    </p>
                    <p>
                      The system is auditable, not probabilistic.
                    </p>
                    <p className="how-metric">
                      Proof Signal: Artifact output MATCH/MISMATCH via{" "}
                      <code>scripts/determinism_proof.sh</code>
                    </p>
                  </article>
                </div>
              </div>
            ) : null}
          </section>
        </section>
      </div>
    </main>
  )
}

export default App
