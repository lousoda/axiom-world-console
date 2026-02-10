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
  loadScenarioBasicAuto,
  probeMetrics,
} from "./api/client"
import { executeFlowCycle } from "./flow/flowController"
import { GraphView } from "./graph/GraphView"
import {
  EXPLAIN_PULL_EVERY,
  flowDelayFor,
  shouldStopFlowForStatus,
} from "./flow/flowPolicy"
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
const OBSERVED_CODES = [200, 401, 402, 409, 429] as const
const TRACE_LIMIT = 40
const EXPLAIN_LIMIT = 40
const FLOW_LIMIT_AGENTS = 50

type ObservedCode = (typeof OBSERVED_CODES)[number]
type ConsoleTab = "WORLD" | "TRACE" | "EXPLAIN"

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

function App() {
  const [baseUrl, setBaseUrl] = useState<string>(() =>
    loadStorageValue(STORAGE_BASE_URL, DEFAULT_BASE_URL),
  )
  const [gateKey, setGateKey] = useState<string>(() =>
    sanitizeGateKey(loadStorageValue(STORAGE_GATE_KEY, "")),
  )

  const [isTesting, setIsTesting] = useState<boolean>(false)
  const [isScenarioLoading, setIsScenarioLoading] = useState<boolean>(false)
  const [isFlowRunning, setIsFlowRunning] = useState<boolean>(false)

  const [flowMode, setFlowMode] = useState<FlowMode>("PAUSE")
  const [flowCycles, setFlowCycles] = useState<number>(0)
  const [flowBackoffMs, setFlowBackoffMs] = useState<number>(0)
  const [activeTab, setActiveTab] = useState<ConsoleTab>("WORLD")
  const [flowNote, setFlowNote] = useState<string>(
    "FLOW is paused. Select LIVE or ACCELERATE to begin.",
  )

  const [lastStatus, setLastStatus] = useState<number | null>(null)
  const [lastMessage, setLastMessage] = useState<string>(
    "No connection test performed yet.",
  )
  const [statusHits, setStatusHits] = useState<Record<ObservedCode, number>>({
    200: 0,
    401: 0,
    402: 0,
    409: 0,
    429: 0,
  })

  const [worldSnapshot, setWorldSnapshot] = useState<WorldSnapshot | null>(null)
  const [metricsSnapshot, setMetricsSnapshot] = useState<MetricsSnapshot | null>(
    null,
  )
  const [traceSnapshot, setTraceSnapshot] = useState<unknown[]>([])
  const [explainSnapshot, setExplainSnapshot] = useState<ExplainRecentSnapshot | null>(
    null,
  )

  const flowTokenRef = useRef(0)
  const keyFileInputRef = useRef<HTMLInputElement | null>(null)

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

  const keySummary = useMemo(() => summarizeKey(gateKey), [gateKey])

  const statusSummary = useMemo(() => {
    if (lastStatus === null) {
      return "No status"
    }
    return `Last status: ${lastStatus}`
  }, [lastStatus])

  async function handleProbeClick() {
    if (!canTest) {
      return
    }

    setIsTesting(true)
    setLastMessage("Probing /metrics ...")

    try {
      const result = await probeMetrics(baseUrl, gateKey)
      if (result.data) {
        setMetricsSnapshot(result.data)
      }

      const message =
        result.status === 200
          ? "Metrics endpoint reachable."
          : bodyPreview(result.rawText)
      recordStatus(result.status, message)
    } catch (error) {
      setLastStatus(null)
      setLastMessage(
        error instanceof Error ? error.message : "Unknown probe error",
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
      const result = await loadScenarioBasicAuto(baseUrl, gateKey)
      const message =
        result.status === 200
          ? "Scenario loaded for autonomous observation."
          : bodyPreview(result.rawText)
      recordStatus(result.status, message)

      if (result.status === 200) {
        setFlowNote("Scenario loaded. Select LIVE or ACCELERATE to start FLOW.")
      } else if (result.status === 401) {
        setFlowNote(
          "401: X-World-Gate mismatch. Import current_fly_key.txt and retry.",
        )
      }
      if (shouldStopFlowForStatus(result.status)) {
        setFlowMode("PAUSE")
      }
    } catch (error) {
      setLastStatus(null)
      setLastMessage(
        error instanceof Error ? error.message : "Scenario load failed",
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
          ? `X-World-Gate loaded from file (${nextValue.length} chars).`
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
        setFlowNote(
          cycle.backoffMs > 0
            ? `${cycle.message} Backoff ${cycle.backoffMs}ms.`
            : cycle.message,
        )

        if (cycle.stopFlow) {
          if (cycle.stopStatus === 401) {
            setFlowNote(
              "FLOW paused on 401. Update X-World-Gate (Import key file) and retry.",
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

  const agentsObserved = worldSnapshot?.agents?.length ?? 0
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

  return (
    <main className="console-root">
      <header className="console-header">
        <h1>World Console</h1>
        <p>Phase 2: FLOW engine and autonomous observation loop.</p>
      </header>

      <div className="console-layout">
        <aside className="console-side">
          <section className="connection-card">
            <label htmlFor="base-url">Base API URL</label>
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

            <input
              className="file-input-hidden"
              type="file"
              ref={keyFileInputRef}
              onChange={handleKeyFileSelected}
              accept=".txt,text/plain"
            />

            <div className="action-row">
              <button onClick={handleProbeClick} disabled={!canTest}>
                {isTesting ? "Testing..." : "Connect / Test (/metrics)"}
              </button>
              <button onClick={handleImportKeyClick}>Import Key File</button>
              <button onClick={handleLoadScenario} disabled={!canLoadScenario}>
                {isScenarioLoading ? "Loading..." : "Load Scenario"}
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
            <p className="flow-meta">
              Mode: {flowMode} | Running: {isFlowRunning ? "yes" : "no"} | Cycles:{" "}
              {flowCycles}
            </p>
            <p className="flow-meta">Backoff: {flowBackoffMs}ms</p>
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

          <section className="telemetry-card">
            <h2>Observation Snapshot</h2>
            <p>Agents observed: {agentsObserved}</p>
            <p>Deferred Trace entries: {deferredTraceLines}</p>
            <p>Explainability Trace lines: {explainLines}</p>
            <p>
              Capacity left:{" "}
              {metricsSnapshot ? metricsSnapshot.workshop_capacity_left : "n/a"}
            </p>
          </section>
        </aside>

        <section className="console-main">
          <section className="tab-card">
            <div className="tab-row">
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
            </div>

            {activeTab === "WORLD" ? (
              <div className="tab-panel tab-panel-world">
                <GraphView graph={stateFieldGraph} />
                <div className="panel-grid">
                  <article className="panel-block">
                    <h3>World Snapshot</h3>
                    <pre>{worldSnapshotText}</pre>
                  </article>
                  <article className="panel-block">
                    <h3>Constraints Snapshot</h3>
                    <pre>{metricsSnapshotText}</pre>
                  </article>
                </div>
              </div>
            ) : null}

            {activeTab === "TRACE" ? (
              <div className="tab-panel">
                <h3>Deferred Trace</h3>
                {traceSnapshot.length === 0 ? (
                  <p className="empty-panel">No trace events yet.</p>
                ) : (
                  <ul className="trace-list">
                    {traceSnapshot
                      .slice()
                      .reverse()
                      .map((entry, index) => (
                        <li key={index} className="trace-item">
                          <pre>{formatUnknown(entry)}</pre>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            ) : null}

            {activeTab === "EXPLAIN" ? (
              <div className="tab-panel">
                <h3>Explainability Trace</h3>
                {!explainSnapshot || explainSnapshot.lines.length === 0 ? (
                  <p className="empty-panel">No explain lines yet.</p>
                ) : (
                  <ul className="explain-list">
                    {explainSnapshot.lines
                      .slice()
                      .reverse()
                      .map((line, index) => (
                        <li key={index}>{line}</li>
                      ))}
                  </ul>
                )}
              </div>
            ) : null}
          </section>
        </section>
      </div>
    </main>
  )
}

export default App
