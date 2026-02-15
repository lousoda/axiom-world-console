import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react"
import "./App.css"
import {
  fetchAuthSession,
  fetchExplainRecent,
  fetchLogs,
  fetchMetrics,
  fetchWorld,
  loginWithSessionPassword,
  loadScenario,
  logoutSession,
  type ScenarioKey,
  probeMetrics,
} from "./api/client"
import { executeFlowCycle } from "./flow/flowController"
import {
  EXPLAIN_PULL_EVERY,
  TRACE_PULL_EVERY,
  flowDelayFor,
  shouldStopFlowForStatus,
} from "./flow/flowPolicy"
import {
  extractBreathingEvidenceFlags,
  evidenceTagsForText,
  extractProofEvidenceFlags,
  type AutonomyEvidenceCounters,
  type EvidenceTag,
  zeroAutonomyEvidence,
} from "./model/evidence"
import {
  buildStateFieldGraph,
  type StateFieldGraph,
} from "./model/stateFieldMapper"
import type {
  ExplainRecentSnapshot,
  FlowMode,
  MetricsSnapshot,
  WorldSnapshot,
} from "./types"

declare const __APP_BUILD_SHA__: string
declare const __APP_BUILD_TIME__: string

const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:8001"
const STORAGE_BASE_URL = "world_console_base_url"
const STORAGE_GATE_KEY = "world_console_gate_key"
const STORAGE_SCENARIO = "world_console_scenario"
const STORAGE_SAFE_MODE = "world_console_safe_mode"
const STORAGE_GRAPH_MODE = "world_console_graph_mode"
const STORAGE_GRAPH_FOCUS = "world_console_graph_focus"
const REPO_URL = "https://github.com/lousoda/axiom-world-console"
const LIVE_UI_URL = "https://world-model-agent-ui.fly.dev"
const LIVE_API_URL = "https://world-model-agent-ui.fly.dev/api"
const RUNBOOK_URL = `${REPO_URL}/blob/main/docs/UI_PUBLIC_DEPLOY_RUNBOOK.md`
const OBSERVED_CODES = [200, 401, 402, 409, 429, 502] as const
const FORENSIC_TAG_FILTERS = ["ALL", "DENIAL", "COOLDOWN", "ADAPTATION"] as const
const FORENSIC_ROW_LIMITS = [20, 40, 80] as const
const TRACE_LIMIT = 40
const EXPLAIN_LIMIT = 80
const FLOW_LIMIT_AGENTS = 50
const SCENE_REFRESH_LOGS_LIMIT = 28
const SCENE_REFRESH_EXPLAIN_LIMIT = 60
const SCENARIO_OPTIONS: Array<{ key: ScenarioKey; label: string }> = [
  { key: "autonomy_proof", label: "Proof" },
  { key: "autonomy_breathing", label: "Breathing" },
  { key: "basic_auto", label: "Basic" },
]

type ObservedCode = (typeof OBSERVED_CODES)[number]
type ForensicTagFilter = (typeof FORENSIC_TAG_FILTERS)[number]
type GraphDensityMode = "BALANCED" | "PERFORMANCE"
type GraphFocusGroup = "ALL" | "AGENTS" | "PRESSURE" | "QUEUE" | "TRACE"
type ConsoleTab = "WORLD" | "TRACE" | "EXPLAIN" | "JUDGE_LAYER" | "HOW_IT_WORKS"

type JudgeCheck = {
  id: string
  label: string
  pass: boolean
  hint: string
}

const GRAPH_FOCUS_OPTIONS: Array<{ key: GraphFocusGroup; label: string }> = [
  { key: "ALL", label: "All" },
  { key: "AGENTS", label: "Agents" },
  { key: "PRESSURE", label: "Pressure" },
  { key: "QUEUE", label: "Queue" },
  { key: "TRACE", label: "Trace" },
]

const WORLD_GRAPH_LEGEND: Array<{
  key: Exclude<GraphFocusGroup, "ALL">
  label: string
  note: string
}> = [
  { key: "AGENTS", label: "Agent Core", note: "core + inertia state" },
  { key: "PRESSURE", label: "Constraint Pressure", note: "capacity pressure cluster" },
  { key: "QUEUE", label: "Action Queue", note: "latency and queue dynamics" },
  { key: "TRACE", label: "Forensic Trace", note: "log + explain evidence cluster" },
]

const GraphView = lazy(async () => {
  const module = await import("./graph/GraphView")
  return { default: module.GraphView }
})

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function detectDefaultBaseUrl(): string {
  if (typeof window === "undefined") {
    return DEFAULT_LOCAL_BASE_URL
  }
  const host = window.location.hostname
  if (host === "localhost" || host === "127.0.0.1") {
    return DEFAULT_LOCAL_BASE_URL
  }
  return "/api"
}

function loadStorageValue(key: string, fallback: string): string {
  if (typeof window === "undefined") {
    return fallback
  }
  return window.localStorage.getItem(key) ?? fallback
}

function loadSessionValue(key: string, fallback: string): string {
  if (typeof window === "undefined") {
    return fallback
  }
  return window.sessionStorage.getItem(key) ?? fallback
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

function persistSessionValue(key: string, value: string) {
  if (typeof window === "undefined") {
    return
  }
  window.sessionStorage.setItem(key, value)
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

function formatBuildTime(rawIso: string): string {
  if (!rawIso || rawIso.trim().length === 0) {
    return "unknown"
  }
  const parsed = Date.parse(rawIso)
  if (Number.isNaN(parsed)) {
    return rawIso
  }
  return new Date(parsed).toISOString().replace("T", " ").replace("Z", " UTC")
}

function summarizeKey(value: string): string {
  if (value.length === 0) {
    return "empty"
  }
  return `${value.length} chars (session)`
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

type ForensicDisplayRow = {
  text: string
  tickLabel: string | null
  tags: EvidenceTag[]
  repeatCount: number
}

function normalizeForensicSignature(text: string): string {
  return text
    .toLowerCase()
    .replace(/\btick\s+\d+\b/g, "tick #")
    .replace(/0x[a-f0-9]{8,}/gi, "0x#")
    .replace(
      /\b(balance|until|left|capacity_left|queued_at_tick|agent_id|amount|applied_actions)\s*[:=]\s*-?\d+(\.\d+)?\b/g,
      "$1=#",
    )
    .replace(/\b\d+(\.\d+)?\b/g, "#")
    .replace(/\s+/g, " ")
    .trim()
}

function collapseForensicRows(lines: string[]): ForensicDisplayRow[] {
  const rows: Array<ForensicDisplayRow & { signature: string }> = []
  for (const text of lines) {
    const signature = normalizeForensicSignature(text)
    const last = rows[rows.length - 1]
    const tags = evidenceTagsForText(text)
    if (last && last.signature === signature) {
      last.repeatCount += 1
      for (const tag of tags) {
        if (!last.tags.includes(tag)) {
          last.tags.push(tag)
        }
      }
      continue
    }
    rows.push({
      signature,
      text,
      tickLabel: extractTickLabel(text),
      tags: [...tags],
      repeatCount: 1,
    })
  }
  return rows.map((row) => ({
    text: row.text,
    tickLabel: row.tickLabel,
    tags: row.tags,
    repeatCount: row.repeatCount,
  }))
}

function trimGraphForPerformance(
  graph: StateFieldGraph,
  mode: GraphDensityMode,
): StateFieldGraph {
  if (mode !== "PERFORMANCE") {
    return graph
  }

  const sampleNodes = graph.nodes.filter((node) => node.kind === "sample")
  if (sampleNodes.length < 3000 && graph.edges.length < 3400) {
    return graph
  }

  const anchors = graph.nodes.filter((node) => node.kind === "anchor")
  const stride =
    sampleNodes.length > 6200 ? 4 : sampleNodes.length > 4600 ? 3 : 2
  const sampleBudget = sampleNodes.length > 6200 ? 1600 : 2200

  const trimmedSamples: StateFieldGraph["nodes"] = []
  for (
    let index = 0;
    index < sampleNodes.length && trimmedSamples.length < sampleBudget;
    index += stride
  ) {
    trimmedSamples.push(sampleNodes[index])
  }

  const keptNodeIds = new Set<string>([
    ...anchors.map((node) => node.id),
    ...trimmedSamples.map((node) => node.id),
  ])

  const maxEdges = graph.edges.length > 4400 ? 2200 : 2800
  const trimmedEdges: StateFieldGraph["edges"] = []
  for (const edge of graph.edges) {
    if (!keptNodeIds.has(edge.from) || !keptNodeIds.has(edge.to)) {
      continue
    }
    trimmedEdges.push(edge)
    if (trimmedEdges.length >= maxEdges) {
      break
    }
  }

  return {
    nodes: [...anchors, ...trimmedSamples],
    edges: trimmedEdges,
  }
}

function App() {
  const [baseUrl, setBaseUrl] = useState<string>(() =>
    loadStorageValue(STORAGE_BASE_URL, detectDefaultBaseUrl()),
  )
  const [gateKey, setGateKey] = useState<string>(() =>
    sanitizeGateKey(loadSessionValue(STORAGE_GATE_KEY, "")),
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
  const [isGateKeyVisible, setIsGateKeyVisible] = useState<boolean>(false)
  const [isSessionAuthBusy, setIsSessionAuthBusy] = useState<boolean>(false)
  const [sessionAuthEnabled, setSessionAuthEnabled] = useState<boolean>(false)
  const [sessionAuthenticated, setSessionAuthenticated] = useState<boolean>(false)
  const [sessionPassword, setSessionPassword] = useState<string>("")

  const [flowMode, setFlowMode] = useState<FlowMode>("PAUSE")
  const [safeMode, setSafeMode] = useState<boolean>(() => {
    const saved = loadStorageValue(STORAGE_SAFE_MODE, "1")
    return saved === "1"
  })
  const [graphDensityMode, setGraphDensityMode] = useState<GraphDensityMode>(() => {
    const saved = loadStorageValue(STORAGE_GRAPH_MODE, "BALANCED")
    return saved === "PERFORMANCE" ? "PERFORMANCE" : "BALANCED"
  })
  const [graphFocusGroup, setGraphFocusGroup] = useState<GraphFocusGroup>(() => {
    const saved = loadStorageValue(STORAGE_GRAPH_FOCUS, "ALL")
    if (
      saved === "AGENTS" ||
      saved === "PRESSURE" ||
      saved === "QUEUE" ||
      saved === "TRACE"
    ) {
      return saved
    }
    return "ALL"
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
  const [traceSearchTerm, setTraceSearchTerm] = useState<string>("")
  const [traceTagFilter, setTraceTagFilter] = useState<ForensicTagFilter>("ALL")
  const [traceRowLimit, setTraceRowLimit] = useState<number>(TRACE_LIMIT)
  const [explainSearchTerm, setExplainSearchTerm] = useState<string>("")
  const [explainTagFilter, setExplainTagFilter] = useState<ForensicTagFilter>("ALL")
  const [explainRowLimit, setExplainRowLimit] = useState<number>(EXPLAIN_LIMIT)
  const [autonomyEvidence, setAutonomyEvidence] = useState<AutonomyEvidenceCounters>(
    () => zeroAutonomyEvidence(),
  )
  const [eventPulse, setEventPulse] = useState<
    "none" | "denial" | "cooldown" | "adaptation"
  >("none")

  const flowTokenRef = useRef(0)
  const flowBackoffRef = useRef(0)
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
  const hasAuthCredential =
    gateKey.trim().length > 0 || sessionAuthenticated
  const canLoadScenario =
    baseUrl.trim().length > 0 &&
    hasAuthCredential &&
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

  const flowCadenceLabel = useMemo(() => {
    if (flowMode === "PAUSE") {
      return "hold"
    }
    if (flowMode === "ACCELERATE") {
      return "fast"
    }
    return "steady"
  }, [flowMode])

  const flowTempoLabel = useMemo(() => {
    if (flowMode === "ACCELERATE") {
      return `tempo ${flowDelayFor("ACCELERATE")}ms`
    }
    if (flowMode === "LIVE") {
      return `tempo ${flowDelayFor("LIVE")}ms`
    }
    return "tempo hold"
  }, [flowMode])

  const flowRetryLabel =
    flowBackoffMs > 0 ? `retry ${flowBackoffMs}ms` : "retry clear"

  const refreshSessionAuth = useCallback(async () => {
    if (baseUrl.trim().length === 0) {
      setSessionAuthEnabled(false)
      setSessionAuthenticated(false)
      return
    }
    try {
      const result = await fetchAuthSession(baseUrl)
      if (result.status === 200 && result.data) {
        setSessionAuthEnabled(Boolean(result.data.cookie_auth_enabled))
        setSessionAuthenticated(Boolean(result.data.authenticated))
        return
      }
      if (result.status === 404) {
        setSessionAuthEnabled(false)
        setSessionAuthenticated(false)
        return
      }
      if (result.status === 401) {
        setSessionAuthEnabled(true)
        setSessionAuthenticated(false)
        return
      }
      setSessionAuthEnabled(false)
      setSessionAuthenticated(false)
    } catch {
      setSessionAuthEnabled(false)
      setSessionAuthenticated(false)
    }
  }, [baseUrl])

  useEffect(() => {
    void refreshSessionAuth()
  }, [refreshSessionAuth])

  async function handleSessionLogin() {
    if (isSessionAuthBusy || baseUrl.trim().length === 0) {
      return
    }
    const trimmedPassword = sessionPassword.trim()
    if (trimmedPassword.length === 0) {
      setLastStatus(null)
      setLastMessage("Session password is empty.")
      return
    }

    setIsSessionAuthBusy(true)
    try {
      const result = await loginWithSessionPassword(baseUrl, trimmedPassword)
      const message =
        result.status === 200
          ? "Session authenticated."
          : bodyPreview(result.rawText)
      recordStatus(result.status, message)
      if (result.status === 200) {
        setSessionPassword("")
      }
      await refreshSessionAuth()
    } catch (error) {
      setLastStatus(null)
      setLastMessage(
        error instanceof Error ? error.message : "Session login failed.",
      )
    } finally {
      setIsSessionAuthBusy(false)
    }
  }

  async function handleSessionLogout() {
    if (isSessionAuthBusy || baseUrl.trim().length === 0) {
      return
    }

    setIsSessionAuthBusy(true)
    try {
      const result = await logoutSession(baseUrl)
      const message =
        result.status === 200
          ? "Session signed out."
          : bodyPreview(result.rawText)
      recordStatus(result.status, message)
      await refreshSessionAuth()
    } catch (error) {
      setLastStatus(null)
      setLastMessage(
        error instanceof Error ? error.message : "Session logout failed.",
      )
    } finally {
      setIsSessionAuthBusy(false)
    }
  }

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
        setAutonomyEvidence(zeroAutonomyEvidence())
        setExplainSnapshot(null)
        setActiveTab("WORLD")
        const refresh = await refreshSnapshotsAfterSceneLoad()

        if (refresh.stopStatus === 401) {
          setFlowNote(
            "Scene loaded. 401 during snapshot refresh: update auth (Gate key or session login).",
          )
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
        setFlowNote("401: credentials mismatch. Load key or sign in and retry.")
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
      persistSessionValue(STORAGE_GATE_KEY, nextValue)
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
      flowBackoffRef.current = 0
      setFlowBackoffMs(0)
      return
    }
    if (baseUrl.trim().length === 0 || !hasAuthCredential) {
      setFlowMode("PAUSE")
      setFlowNote("FLOW paused: Base URL or auth credential is missing.")
      return
    }

    flowTokenRef.current += 1
    const token = flowTokenRef.current
    let cancelled = false
    let timeoutId: number | null = null
    let localBackoffMs = flowBackoffRef.current
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
          logsEvery: TRACE_PULL_EVERY,
          explainEvery: EXPLAIN_PULL_EVERY,
          logsLimit: TRACE_LIMIT,
          explainLimit: EXPLAIN_LIMIT,
          limitAgents: FLOW_LIMIT_AGENTS,
        })

        localBackoffMs = cycle.backoffMs
        flowBackoffRef.current = cycle.backoffMs
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
        const normalizedCycleMessage = cycle.message.startsWith("Flow cycle")
          ? flowMode === "ACCELERATE"
            ? `Fast pass ${cycleIndex} complete.`
            : flowMode === "LIVE"
              ? `Live pass ${cycleIndex} complete.`
              : `Cycle ${cycleIndex} complete.`
          : cycle.message

        const baseFlowNote =
          cycle.backoffMs > 0
            ? `${normalizedCycleMessage} Backoff ${cycle.backoffMs}ms.`
            : normalizedCycleMessage
        const activeAgents = cycle.world?.agents?.length ?? 0
        setFlowNote(
          activeAgents === 0
            ? `${baseFlowNote} No agents active: choose a scenario and load scene.`
            : baseFlowNote,
        )

        if (cycle.stopFlow) {
          if (cycle.stopStatus === 401) {
            setFlowNote(
              "FLOW paused on 401. Update auth (Gate key or session login) and retry.",
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
  }, [baseUrl, flowMode, gateKey, hasAuthCredential, recordStatus])

  useEffect(() => {
    const lines = explainSnapshot?.lines
    if (!lines || lines.length === 0) {
      return
    }
    let deltaCapacityDenial = 0
    let deltaCooldownPenalty = 0
    let deltaAdaptationWanderOnce = 0
    let deltaIdleCycles = 0
    let deltaActiveCycles = 0
    let deltaCapacityHeadroom = 0
    for (const line of lines) {
      if (seenExplainEvidenceRef.current.has(line)) {
        continue
      }
      seenExplainEvidenceRef.current.add(line)
      const proofFlags = extractProofEvidenceFlags(line)
      deltaCapacityDenial += proofFlags.capacityDenial
      deltaCooldownPenalty += proofFlags.cooldownPenalty
      deltaAdaptationWanderOnce += proofFlags.adaptationWanderOnce

      const breathingFlags = extractBreathingEvidenceFlags(line)
      deltaIdleCycles += breathingFlags.idleCycles
      deltaActiveCycles += breathingFlags.activeCycles
      deltaCapacityHeadroom += breathingFlags.capacityHeadroom
    }
    if (
      deltaCapacityDenial === 0 &&
      deltaCooldownPenalty === 0 &&
      deltaAdaptationWanderOnce === 0 &&
      deltaIdleCycles === 0 &&
      deltaActiveCycles === 0 &&
      deltaCapacityHeadroom === 0
    ) {
      return
    }
    setAutonomyEvidence((prev) => ({
      capacityDenial: prev.capacityDenial + deltaCapacityDenial,
      cooldownPenalty: prev.cooldownPenalty + deltaCooldownPenalty,
      adaptationWanderOnce:
        prev.adaptationWanderOnce + deltaAdaptationWanderOnce,
      idleCycles: prev.idleCycles + deltaIdleCycles,
      activeCycles: prev.activeCycles + deltaActiveCycles,
      capacityHeadroom: prev.capacityHeadroom + deltaCapacityHeadroom,
    }))

    let nextPulse: "none" | "denial" | "cooldown" | "adaptation" = "none"
    if (deltaCapacityDenial > 0) {
      nextPulse = "denial"
    } else if (deltaCooldownPenalty > 0) {
      nextPulse = "cooldown"
    } else if (deltaAdaptationWanderOnce > 0) {
      nextPulse = "adaptation"
    } else if (deltaCapacityHeadroom > 0) {
      nextPulse = "adaptation"
    } else if (deltaActiveCycles > 0) {
      nextPulse = "cooldown"
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
  const renderedStateFieldGraph = useMemo(
    () => trimGraphForPerformance(stateFieldGraph, graphDensityMode),
    [graphDensityMode, stateFieldGraph],
  )
  const rawGraphNodeCount = stateFieldGraph.nodes.length
  const rawGraphEdgeCount = stateFieldGraph.edges.length
  const graphNodeCount = renderedStateFieldGraph.nodes.length
  const graphEdgeCount = renderedStateFieldGraph.edges.length
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
      ca: 0.022 + pressureRatio * 0.05 + (isFlowRunning ? 0.008 : 0.003),
      grain: 0.075 + pressureRatio * 0.05 + flowIntensity * 0.02,
      vignette: 0.6 + (1 - flowIntensity) * 0.06,
      blur: 0,
      bloom: 0.14 + pressureRatio * 0.12 + flowIntensity * 0.08,
      sideAlpha: 0.016 + pressureRatio * 0.04 + flowIntensity * 0.015,
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
  const latestSignal = useMemo(() => {
    const newest = latestEvidencePreview[0]
    if (!newest) {
      return {
        label: "none",
        detail: "No tagged evidence yet.",
        tone: "idle" as const,
      }
    }
    const prioritizedTag =
      newest.tags.find((tag) => tag === "DENIAL" || tag === "COOLDOWN" || tag === "ADAPTATION") ??
      newest.tags[0]
    const tickLabel = extractTickLabel(newest.text)
    if (prioritizedTag === "DENIAL") {
      return {
        label: "denial",
        detail: tickLabel ? `${tickLabel} · capacity denial` : "capacity denial observed",
        tone: "denial" as const,
      }
    }
    if (prioritizedTag === "COOLDOWN") {
      return {
        label: "cooldown",
        detail: tickLabel ? `${tickLabel} · cooldown penalty` : "cooldown penalty observed",
        tone: "cooldown" as const,
      }
    }
    return {
      label: "adaptation",
      detail: tickLabel ? `${tickLabel} · adaptive behavior` : "adaptive behavior observed",
      tone: "adaptation" as const,
    }
  }, [latestEvidencePreview])

  const traceRows = useMemo(() => {
    const lines = traceSnapshot
      .slice()
      .reverse()
      .map((entry) => (typeof entry === "string" ? entry : formatUnknown(entry)))
    return collapseForensicRows(lines)
  }, [traceSnapshot])

  const explainRows = useMemo(() => {
    const lines = explainSnapshot?.lines?.slice().reverse() ?? []
    return collapseForensicRows(lines)
  }, [explainSnapshot])
  const filteredTraceRows = useMemo(() => {
    const needle = traceSearchTerm.trim().toLowerCase()
    const tagged =
      traceTagFilter === "ALL"
        ? traceRows
        : traceRows.filter((row) => row.tags.includes(traceTagFilter))
    const searched =
      needle.length === 0
        ? tagged
        : tagged.filter((row) => row.text.toLowerCase().includes(needle))
    return searched.slice(0, traceRowLimit)
  }, [traceRowLimit, traceRows, traceSearchTerm, traceTagFilter])

  const filteredExplainRows = useMemo(() => {
    const needle = explainSearchTerm.trim().toLowerCase()
    const tagged =
      explainTagFilter === "ALL"
        ? explainRows
        : explainRows.filter((row) => row.tags.includes(explainTagFilter))
    const searched =
      needle.length === 0
        ? tagged
        : tagged.filter((row) => row.text.toLowerCase().includes(needle))
    return searched.slice(0, explainRowLimit)
  }, [
    explainRowLimit,
    explainRows,
    explainSearchTerm,
    explainTagFilter,
  ])
  const monadGateSignals = useMemo(
    () => ({
      unauthorized: statusHits[401],
      paymentRequired: statusHits[402],
      replayBlocked: statusHits[409],
      accepted: statusHits[200],
    }),
    [statusHits],
  )
  const evidenceRows = useMemo(
    () =>
      scenarioKey === "autonomy_breathing"
        ? [
            { label: "Idle cycles", value: autonomyEvidence.idleCycles },
            { label: "Active cycles", value: autonomyEvidence.activeCycles },
            {
              label: "Headroom events",
              value: autonomyEvidence.capacityHeadroom,
            },
          ]
        : [
            {
              label: "Capacity denial",
              value: autonomyEvidence.capacityDenial,
            },
            {
              label: "Cooldown penalty",
              value: autonomyEvidence.cooldownPenalty,
            },
            {
              label: "Adaptation (wander once)",
              value: autonomyEvidence.adaptationWanderOnce,
            },
          ],
    [autonomyEvidence, scenarioKey],
  )
  const evidenceNote =
    scenarioKey === "autonomy_breathing"
      ? "Derived from EXPLAIN rhythm: idle vs active cycles and capacity headroom."
      : "Derived from EXPLAIN forensic trace."
  const autonomySignalTotal = useMemo(
    () => evidenceRows.reduce((sum, row) => sum + row.value, 0),
    [evidenceRows],
  )
  const judgeChecks = useMemo<JudgeCheck[]>(
    () => [
      {
        id: "guard",
        label: "API guard observed (401 without key)",
        pass: statusHits[401] > 0,
        hint: "Run Validate without key at least once.",
      },
      {
        id: "authorized",
        label: "Authorized read path works (200 with key/session)",
        pass: statusHits[200] > 0 && (gateKey.trim().length > 0 || sessionAuthenticated),
        hint: "Load key or session-auth, then Validate.",
      },
      {
        id: "scenario",
        label: "Scenario loaded with active agents",
        pass: agentsObserved >= 3,
        hint: "Pick Proof/Breathing and click Load Scene.",
      },
      {
        id: "flow",
        label: "FLOW progressed for at least 10 cycles",
        pass: flowCycles >= 10,
        hint: "Run LIVE for ~20-30 seconds.",
      },
      {
        id: "trace",
        label: "TRACE + EXPLAIN populated",
        pass: deferredTraceLines > 0 && explainLines > 0,
        hint: "Keep FLOW running and open TRACE/EXPLAIN.",
      },
      {
        id: "evidence",
        label: "Autonomy evidence is visible",
        pass: autonomySignalTotal > 0 || latestEvidencePreview.length > 0,
        hint: "Wait for DENIAL/COOLDOWN/ADAPTATION events.",
      },
      {
        id: "stability",
        label: "No upstream 5xx during current run",
        pass: statusHits[502] === 0,
        hint: "If 5xx appears, pause FLOW and re-validate endpoint.",
      },
    ],
    [
      agentsObserved,
      autonomySignalTotal,
      deferredTraceLines,
      explainLines,
      flowCycles,
      gateKey,
      latestEvidencePreview.length,
      sessionAuthenticated,
      statusHits,
    ],
  )
  const judgePassCount = useMemo(
    () => judgeChecks.filter((check) => check.pass).length,
    [judgeChecks],
  )
  const judgeReady = useMemo(
    () => judgeChecks.every((check) => check.pass),
    [judgeChecks],
  )
  const buildStamp = useMemo(() => {
    const shaRaw =
      typeof __APP_BUILD_SHA__ === "string" ? __APP_BUILD_SHA__.trim() : ""
    const timeRaw =
      typeof __APP_BUILD_TIME__ === "string" ? __APP_BUILD_TIME__.trim() : ""
    return {
      sha: shaRaw.length > 0 ? shaRaw : "unknown",
      time: formatBuildTime(timeRaw),
    }
  }, [])

  const judgeExportPayload = useMemo(
    () => ({
      generated_at: new Date().toISOString(),
      scenario: scenarioKey,
      build: {
        git_sha: buildStamp.sha,
        build_time: buildStamp.time,
      },
      links: {
        repository: REPO_URL,
        live_ui: LIVE_UI_URL,
        live_api: LIVE_API_URL,
        runbook: RUNBOOK_URL,
      },
      checks: judgeChecks.map((check) => ({
        id: check.id,
        label: check.label,
        pass: check.pass,
        hint: check.hint,
      })),
      counters: {
        flow_cycles: flowCycles,
        trace_lines: deferredTraceLines,
        explain_lines: explainLines,
        agents_observed: agentsObserved,
        locations_observed: locationsObserved,
        capacity_left: capacityLeftObserved,
      },
      status_hits: statusHits,
      autonomy_evidence: autonomyEvidence,
      notes: {
        flow_note: flowNote,
        last_status: lastStatus,
        last_message: lastMessage,
      },
    }),
    [
      agentsObserved,
      autonomyEvidence,
      buildStamp.sha,
      buildStamp.time,
      capacityLeftObserved,
      deferredTraceLines,
      explainLines,
      flowCycles,
      flowNote,
      judgeChecks,
      lastMessage,
      lastStatus,
      locationsObserved,
      scenarioKey,
      statusHits,
    ],
  )

  const handleExportJudgeEvidence = useCallback(() => {
    if (typeof window === "undefined") {
      return
    }
    const stamp = new Date().toISOString().replace(/[^\dTZ]/g, "-")
    const filename = `judge-evidence-${stamp}.json`
    const blob = new Blob([JSON.stringify(judgeExportPayload, null, 2)], {
      type: "application/json",
    })
    const href = window.URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = href
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(href)
    setLastMessage(`Evidence exported: ${filename}`)
  }, [judgeExportPayload])

  const pressureSignalA =
    scenarioKey === "autonomy_breathing"
      ? { label: "Idle cycles", value: autonomyEvidence.idleCycles }
      : { label: "Denials", value: autonomyEvidence.capacityDenial }

  const pressureSignalB =
    scenarioKey === "autonomy_breathing"
      ? { label: "Headroom", value: autonomyEvidence.capacityHeadroom }
      : { label: "Cooldowns", value: autonomyEvidence.cooldownPenalty }

  const adaptationSignalA =
    scenarioKey === "autonomy_breathing"
      ? { label: "Active cycles", value: autonomyEvidence.activeCycles }
      : { label: "Adaptation", value: autonomyEvidence.adaptationWanderOnce }

  const adaptationSignalB =
    scenarioKey === "autonomy_breathing"
      ? { label: "Headroom", value: autonomyEvidence.capacityHeadroom }
      : { label: "Cooldown", value: autonomyEvidence.cooldownPenalty }

  function handleFlowModeRequest(nextMode: FlowMode) {
    if (nextMode === "PAUSE") {
      setFlowMode("PAUSE")
      return
    }
    if (baseUrl.trim().length === 0) {
      setFlowMode("PAUSE")
      setFlowNote("FLOW paused: API Endpoint is missing.")
      return
    }
    if (!hasAuthCredential) {
      setFlowMode("PAUSE")
      setFlowNote("FLOW paused: provide X-World-Gate or sign in session first.")
      return
    }
    if (agentsObserved === 0) {
      setFlowMode("PAUSE")
      setFlowNote("FLOW paused: no active agents. Select scenario and Load Scene first.")
      return
    }
    if (!safeMode) {
      setSafeMode(true)
      persistStorageValue(STORAGE_SAFE_MODE, "1")
      setFlowNote("Safe Mode auto-enabled for stability.")
    }
    setFlowMode(nextMode)
  }

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
              type={isGateKeyVisible ? "text" : "password"}
              value={gateKey}
              onChange={(event) => {
                const nextValue = sanitizeGateKey(event.target.value)
                setGateKey(nextValue)
                persistSessionValue(STORAGE_GATE_KEY, nextValue)
              }}
              placeholder="Paste current WORLD_GATE_KEY"
              autoComplete="off"
            />
            <div className="gate-key-row">
              <button
                type="button"
                onClick={() => setIsGateKeyVisible((current) => !current)}
              >
                {isGateKeyVisible ? "Hide Key" : "Show Key"}
              </button>
            </div>
            <p className="field-meta">
              Key length (normalized): {gateKey.length}
            </p>
            <p className="field-meta">Key fingerprint: {keySummary}</p>
            <p className="field-meta">
              Session auth:{" "}
              {sessionAuthEnabled
                ? sessionAuthenticated
                  ? "active"
                  : "available"
                : "disabled"}
            </p>

            {sessionAuthEnabled ? (
              <>
                <label htmlFor="session-password">Session Password</label>
                <input
                  id="session-password"
                  type="password"
                  value={sessionPassword}
                  onChange={(event) => setSessionPassword(event.target.value)}
                  placeholder="Sign in once for this browser session"
                  autoComplete="current-password"
                />
                <div className="auth-row">
                  <button
                    onClick={handleSessionLogin}
                    disabled={
                      isSessionAuthBusy || baseUrl.trim().length === 0 || sessionPassword.trim().length === 0
                    }
                  >
                    {isSessionAuthBusy ? "Signing In..." : "Sign In"}
                  </button>
                  <button
                    onClick={handleSessionLogout}
                    disabled={isSessionAuthBusy || !sessionAuthenticated}
                  >
                    Sign Out
                  </button>
                </div>
              </>
            ) : null}

            <label>Scenario</label>
            <div className="scenario-row">
              {SCENARIO_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  title={option.key}
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
                {isTesting ? "Validating..." : "Validate"}
              </button>
              <button onClick={handleImportKeyClick}>Load Key</button>
              <button
                className="button-primary"
                onClick={handleLoadScenario}
                disabled={!canLoadScenario}
              >
                {isScenarioLoading ? "Loading Scene..." : "Load Scene"}
              </button>
            </div>
            <div className="judge-nav-row">
              <button
                type="button"
                className={activeTab === "JUDGE_LAYER" ? "flow-active" : ""}
                onClick={() => setActiveTab("JUDGE_LAYER")}
              >
                Open Judge Layer
              </button>
            </div>
          </section>

          <section className="flow-card">
            <h2>FLOW</h2>
            <div className="flow-row">
              <button
                className={flowMode === "LIVE" ? "flow-active" : ""}
                onClick={() => handleFlowModeRequest("LIVE")}
              >
                LIVE
              </button>
              <button
                className={flowMode === "PAUSE" ? "flow-active" : ""}
                onClick={() => handleFlowModeRequest("PAUSE")}
              >
                PAUSE
              </button>
              <button
                className={flowMode === "ACCELERATE" ? "flow-active" : ""}
                onClick={() => handleFlowModeRequest("ACCELERATE")}
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
            <div className="graph-mode-row">
              <span className="graph-mode-label">Graph Detail</span>
              <div className="graph-mode-actions">
                <button
                  className={graphDensityMode === "BALANCED" ? "flow-active" : ""}
                  onClick={() => {
                    setGraphDensityMode("BALANCED")
                    persistStorageValue(STORAGE_GRAPH_MODE, "BALANCED")
                  }}
                  type="button"
                >
                  Balanced
                </button>
                <button
                  className={graphDensityMode === "PERFORMANCE" ? "flow-active" : ""}
                  onClick={() => {
                    setGraphDensityMode("PERFORMANCE")
                    persistStorageValue(STORAGE_GRAPH_MODE, "PERFORMANCE")
                  }}
                  type="button"
                >
                  Performance
                </button>
              </div>
            </div>
            <div className="graph-focus-row">
              <span className="graph-mode-label">Graph Focus</span>
              <div className="graph-focus-actions">
                {GRAPH_FOCUS_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    className={`graph-focus-btn ${
                      graphFocusGroup === option.key ? "flow-active" : ""
                    }`}
                    onClick={() => {
                      setGraphFocusGroup(option.key)
                      persistStorageValue(STORAGE_GRAPH_FOCUS, option.key)
                    }}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="flow-meta">
              Cadence {flowCadenceLabel} · {flowTempoLabel}
            </p>
            <p className="flow-meta">
              Cycles {flowCycles} · {flowRetryLabel}
            </p>
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
              {evidenceRows.map((row) => (
                <span key={row.label} className="evidence-pill">
                  {row.label}: {row.value}
                </span>
              ))}
            </div>
            <p className="evidence-note">{evidenceNote}</p>
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
                  <span className="hud-pill">
                    {graphDensityMode === "PERFORMANCE"
                      ? `${graphNodeCount}/${rawGraphNodeCount} Nodes`
                      : `${graphNodeCount} Nodes`}
                  </span>
                  <span className="hud-pill">
                    {graphDensityMode === "PERFORMANCE"
                      ? `${graphEdgeCount}/${rawGraphEdgeCount} Links`
                      : `${graphEdgeCount} Links`}
                  </span>
                </div>
              ) : null}
            </div>

            {activeTab === "WORLD" ? (
              <div className="tab-panel tab-panel-world">
                <div className="world-stage">
                  <aside
                    className={`world-legend-panel ${
                      isInspectorOpen ? "world-legend-hidden" : ""
                    }`}
                  >
                    <h4>Graph Legend</h4>
                    <ul className="world-legend-list">
                      {WORLD_GRAPH_LEGEND.map((entry) => (
                        <li key={entry.key}>
                          <span className={`legend-dot legend-${entry.key.toLowerCase()}`} />
                          <div>
                            <strong>{entry.label}</strong>
                            <small>{entry.note}</small>
                          </div>
                        </li>
                      ))}
                    </ul>
                    <p className="world-legend-focus">
                      Focus: <strong>{graphFocusGroup}</strong>
                    </p>
                    <p className={`world-legend-signal signal-${latestSignal.tone}`}>
                      Last signal: {latestSignal.detail}
                    </p>
                  </aside>
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
                  <Suspense
                    fallback={
                      <div className="world-graph-loading">
                        Loading world graph...
                      </div>
                    }
                  >
                    <GraphView
                      graph={renderedStateFieldGraph}
                      fx={graphFx}
                      activity={graphActivity}
                      safeMode={safeMode}
                      focusGroup={graphFocusGroup}
                    />
                  </Suspense>

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
                <div className="forensic-controls">
                  <div className="forensic-search">
                    <input
                      type="text"
                      value={traceSearchTerm}
                      onChange={(event) => setTraceSearchTerm(event.target.value)}
                      placeholder="Search trace lines"
                      autoComplete="off"
                    />
                    <span className="forensic-count">
                      Showing {filteredTraceRows.length}/{traceRows.length}
                    </span>
                  </div>
                  <div className="forensic-filter-row">
                    <div className="forensic-tags">
                      {FORENSIC_TAG_FILTERS.map((tag) => (
                        <button
                          key={tag}
                          className={
                            traceTagFilter === tag ? "forensic-tag-active" : ""
                          }
                          onClick={() => setTraceTagFilter(tag)}
                          type="button"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                    <label className="forensic-limit-label">
                      Rows
                      <select
                        value={traceRowLimit}
                        onChange={(event) =>
                          setTraceRowLimit(Number.parseInt(event.target.value, 10))
                        }
                      >
                        {FORENSIC_ROW_LIMITS.map((limitValue) => (
                          <option key={limitValue} value={limitValue}>
                            {limitValue}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
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
                {traceRows.length === 0 ? (
                  <p className="empty-panel">No trace lines yet.</p>
                ) : filteredTraceRows.length === 0 ? (
                  <p className="empty-panel">No TRACE rows match current filters.</p>
                ) : (
                  <ul className="trace-list">
                    {filteredTraceRows.map((row, index) => (
                      <li key={index} className="trace-item forensic-item">
                        <div className="forensic-meta">
                          <span className="forensic-tick">
                            {row.tickLabel ?? "event"}
                          </span>
                          {row.tags.length > 0 || row.repeatCount > 1 ? (
                            <div className="evidence-tags">
                              {row.tags.map((tag) => (
                                <span
                                  key={tag}
                                  className={`evidence-tag evidence-tag-${tag.toLowerCase()}`}
                                >
                                  {tag}
                                </span>
                              ))}
                              {row.repeatCount > 1 ? (
                                <span className="evidence-repeat">x{row.repeatCount}</span>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        <pre>{row.text}</pre>
                      </li>
                    ))}
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
                <div className="forensic-controls">
                  <div className="forensic-search">
                    <input
                      type="text"
                      value={explainSearchTerm}
                      onChange={(event) => setExplainSearchTerm(event.target.value)}
                      placeholder="Search explain lines"
                      autoComplete="off"
                    />
                    <span className="forensic-count">
                      Showing {filteredExplainRows.length}/{explainRows.length}
                    </span>
                  </div>
                  <div className="forensic-filter-row">
                    <div className="forensic-tags">
                      {FORENSIC_TAG_FILTERS.map((tag) => (
                        <button
                          key={tag}
                          className={
                            explainTagFilter === tag ? "forensic-tag-active" : ""
                          }
                          onClick={() => setExplainTagFilter(tag)}
                          type="button"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                    <label className="forensic-limit-label">
                      Rows
                      <select
                        value={explainRowLimit}
                        onChange={(event) =>
                          setExplainRowLimit(Number.parseInt(event.target.value, 10))
                        }
                      >
                        {FORENSIC_ROW_LIMITS.map((limitValue) => (
                          <option key={limitValue} value={limitValue}>
                            {limitValue}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
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
                {explainRows.length === 0 ? (
                  <p className="empty-panel">No explain lines yet.</p>
                ) : filteredExplainRows.length === 0 ? (
                  <p className="empty-panel">No EXPLAIN rows match current filters.</p>
                ) : (
                  <ul className="explain-list">
                    {filteredExplainRows.map((row, index) => (
                      <li key={index} className="forensic-item">
                        <div className="forensic-meta">
                          <span className="forensic-tick">
                            {row.tickLabel ?? "event"}
                          </span>
                          {row.tags.map((tag) => (
                            <span
                              key={tag}
                              className={`evidence-tag evidence-tag-${tag.toLowerCase()}`}
                            >
                              {tag}
                            </span>
                          ))}
                          {row.repeatCount > 1 ? (
                            <span className="evidence-repeat">x{row.repeatCount}</span>
                          ) : null}
                        </div>
                        <div className="explain-line">{row.text}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            {activeTab === "JUDGE_LAYER" ? (
              <div className="tab-panel">
                <h3>JUDGE LAYER</h3>
                <p className="how-sequence">
                  Bounty-fit evidence pack for a 2-minute judge walkthrough.
                </p>
                <div className={`judge-banner ${judgeReady ? "judge-ready" : "judge-wait"}`}>
                  <strong>{judgeReady ? "READY FOR JUDGING" : "IN PROGRESS"}</strong>
                  <span>
                    Checks passed: {judgePassCount}/{judgeChecks.length}
                  </span>
                </div>
                <div className="judge-tools">
                  <p className="judge-disclaimer">
                    Heuristic mapping based on public rules. This is not an official
                    score calculator.
                  </p>
                  <button
                    type="button"
                    className="judge-export-button"
                    onClick={handleExportJudgeEvidence}
                  >
                    Export Evidence JSON
                  </button>
                </div>

                <div className="judge-grid">
                  <article className="judge-card">
                    <h4>Bounty Score Map</h4>
                    <p>PRD Adherence: <strong>40%</strong></p>
                    <p>Technical Implementation: <strong>30%</strong></p>
                    <p>Monad Integration: <strong>20%</strong></p>
                    <p>Innovation: <strong>10%</strong></p>
                    <p className="how-metric">
                      Source: Moltiverse Rules (updated February 3, 2026).
                    </p>
                  </article>

                  <article className="judge-card">
                    <h4>Live Judge Checks</h4>
                    <ul className="judge-check-list">
                      {judgeChecks.map((check) => (
                        <li key={check.id} className={check.pass ? "judge-check-pass" : "judge-check-wait"}>
                          <div>
                            <span>{check.label}</span>
                            <small>{check.hint}</small>
                          </div>
                          <strong>{check.pass ? "PASS" : "WAIT"}</strong>
                        </li>
                      ))}
                    </ul>
                  </article>

                  <article className="judge-card">
                    <h4>2-Minute Demo Script</h4>
                    <ol className="judge-steps">
                      <li>Validate endpoint with key/session.</li>
                      <li>Load scenario ({scenarioKey}) and start LIVE.</li>
                      <li>Show WORLD evolution for 10+ cycles.</li>
                      <li>Open TRACE + EXPLAIN and point at evidence tags.</li>
                    </ol>
                    <p className="how-metric">
                      Current run: Cycles <strong>{flowCycles}</strong> · Trace{" "}
                      <strong>{deferredTraceLines}</strong> · Explain{" "}
                      <strong>{explainLines}</strong>
                    </p>
                  </article>

                  <article className="judge-card">
                    <h4>Failure Handling</h4>
                    <ul className="judge-fallback-list">
                      <li>
                        <strong>401:</strong> load <code>X-World-Gate</code> or
                        session-auth, then press Validate.
                      </li>
                      <li>
                        <strong>429:</strong> pause LIVE for ~60 seconds, then resume.
                      </li>
                      <li>
                        <strong>5xx:</strong> pause FLOW, re-run Validate, and retry
                        scenario load.
                      </li>
                      <li>
                        <strong>Flow stuck:</strong> click Pause, Load Scene, then
                        start LIVE again.
                      </li>
                    </ul>
                  </article>

                  <article className="judge-card">
                    <h4>Submission Pack</h4>
                    <p>Repository, deployment link, and Monad integration notes should be included.</p>
                    <p>Keep proof artifacts reproducible via:</p>
                    <p className="how-metric">
                      <code>scripts/determinism_proof.sh</code> + <code>scripts/manual_diag.sh</code>
                    </p>
                    <p className="how-metric">
                      Build: <code>{buildStamp.sha}</code> · Generated{" "}
                      <strong>{buildStamp.time}</strong>
                    </p>
                    <p>
                      Deadline reference: <strong>February 15, 2026, 11:59 PM ET</strong>.
                    </p>
                  </article>

                  <article className="judge-card">
                    <h4>Quick Links</h4>
                    <ul className="judge-link-list">
                      <li>
                        <a href={REPO_URL} target="_blank" rel="noreferrer">
                          Repository
                        </a>
                      </li>
                      <li>
                        <a href={LIVE_UI_URL} target="_blank" rel="noreferrer">
                          Live UI
                        </a>
                      </li>
                      <li>
                        <a href={LIVE_API_URL} target="_blank" rel="noreferrer">
                          Live API
                        </a>
                      </li>
                      <li>
                        <a href={RUNBOOK_URL} target="_blank" rel="noreferrer">
                          Deploy Runbook
                        </a>
                      </li>
                    </ul>
                  </article>
                </div>
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
                      Loop Signal:{" "}
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
                      Policy Signal:{" "}
                      Goal Checks <strong>{agentsObserved}</strong> · Position Signals{" "}
                      <strong>{locationsObserved}</strong> · Trace Lines{" "}
                      <strong>{deferredTraceLines}</strong>
                    </p>
                  </article>

                  <article className="how-card">
                    <h4>Constraint Pressure</h4>
                    {scenarioKey === "autonomy_breathing" ? (
                      <>
                        <p>
                          Low pressure keeps workshop headroom available.
                        </p>
                        <p>
                          Actions settle into a stable cadence.
                        </p>
                        <p>
                          Even stable phases stay fully logged.
                        </p>
                      </>
                    ) : (
                      <>
                        <p>
                          Capacity limits and cooldowns introduce pressure.
                        </p>
                        <p>
                          Denied actions trigger controlled divergence.
                        </p>
                        <p>
                          Every deviation is logged and explainable.
                        </p>
                      </>
                    )}
                    <p className="how-metric">
                      Pressure Signal:{" "}
                      {pressureSignalA.label} <strong>{pressureSignalA.value}</strong> ·{" "}
                      {pressureSignalB.label} <strong>{pressureSignalB.value}</strong> ·
                      Capacity Left <strong>{capacityLeftObserved ?? "n/a"}</strong>
                    </p>
                  </article>

                  <article className="how-card">
                    <h4>Adaptive Autonomy</h4>
                    {scenarioKey === "autonomy_breathing" ? (
                      <>
                        <p>
                          Agents keep deterministic flow under light pressure.
                        </p>
                        <p>
                          Idle and active phases alternate without manual control.
                        </p>
                        <p>
                          Behavior emerges from rules, not scripts.
                        </p>
                      </>
                    ) : (
                      <>
                        <p>
                          Repeated denial triggers temporary goal override.
                        </p>
                        <p>
                          Adaptive window expires and goal is restored.
                        </p>
                        <p>
                          Behavior emerges from rule execution, not scripts.
                        </p>
                      </>
                    )}
                    <p className="how-metric">
                      Adaptation Signal:{" "}
                      {adaptationSignalA.label} <strong>{adaptationSignalA.value}</strong> ·{" "}
                      {adaptationSignalB.label} <strong>{adaptationSignalB.value}</strong> ·
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
                      Gate Signal:{" "}
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
                      Replay Signal: Artifact output MATCH/MISMATCH via{" "}
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
