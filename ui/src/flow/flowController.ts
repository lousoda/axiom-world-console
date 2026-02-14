import {
  autoPulse,
  fetchExplainRecent,
  fetchLogs,
  fetchMetrics,
  fetchWorld,
} from "../api/client"
import { computeBackoff, shouldStopFlowForStatus } from "./flowPolicy"
import type {
  ExplainRecentSnapshot,
  MetricsSnapshot,
  WorldSnapshot,
} from "../types"

export type FlowCycleInput = {
  baseUrl: string
  gateKey: string
  cycleIndex: number
  backoffMs: number
  logsEvery: number
  explainEvery: number
  logsLimit: number
  explainLimit: number
  limitAgents: number
}

export type FlowCycleOutput = {
  stopFlow: boolean
  stopStatus: number | null
  backoffMs: number
  message: string
  latestStatus: number | null
  statusTrail: number[]
  world: WorldSnapshot | null
  metrics: MetricsSnapshot | null
  logs: unknown[] | null
  explain: ExplainRecentSnapshot | null
}

function updateBackoffWithStatus(previous: number, status: number): number {
  return computeBackoff(previous, status)
}

function isThrottledStatus(status: number): boolean {
  return status === 429
}

export async function executeFlowCycle(
  input: FlowCycleInput,
): Promise<FlowCycleOutput> {
  let backoffMs = input.backoffMs
  const statusTrail: number[] = []

  const auto = await autoPulse(input.baseUrl, input.gateKey, input.limitAgents)
  statusTrail.push(auto.status)
  backoffMs = updateBackoffWithStatus(backoffMs, auto.status)

  if (isThrottledStatus(auto.status)) {
    return {
      stopFlow: false,
      stopStatus: null,
      backoffMs,
      message: "Flow throttled (429) during pulse. Retrying with backoff.",
      latestStatus: auto.status,
      statusTrail,
      world: null,
      metrics: null,
      logs: null,
      explain: null,
    }
  }

  if (shouldStopFlowForStatus(auto.status)) {
    return {
      stopFlow: true,
      stopStatus: auto.status,
      backoffMs,
      message: `Flow stopped by status ${auto.status} during pulse.`,
      latestStatus: auto.status,
      statusTrail,
      world: null,
      metrics: null,
      logs: null,
      explain: null,
    }
  }

  const worldRes = await fetchWorld(input.baseUrl, input.gateKey)
  statusTrail.push(worldRes.status)
  backoffMs = updateBackoffWithStatus(backoffMs, worldRes.status)

  if (isThrottledStatus(worldRes.status)) {
    return {
      stopFlow: false,
      stopStatus: null,
      backoffMs,
      message: "Flow throttled (429) during world pull. Retrying with backoff.",
      latestStatus: worldRes.status,
      statusTrail,
      world: null,
      metrics: null,
      logs: null,
      explain: null,
    }
  }
  if (shouldStopFlowForStatus(worldRes.status)) {
    return {
      stopFlow: true,
      stopStatus: worldRes.status,
      backoffMs,
      message: `Flow stopped by status ${worldRes.status} during world pull.`,
      latestStatus: worldRes.status,
      statusTrail,
      world: null,
      metrics: null,
      logs: null,
      explain: null,
    }
  }

  const metricsRes = await fetchMetrics(input.baseUrl, input.gateKey)
  statusTrail.push(metricsRes.status)
  backoffMs = updateBackoffWithStatus(backoffMs, metricsRes.status)

  if (isThrottledStatus(metricsRes.status)) {
    return {
      stopFlow: false,
      stopStatus: null,
      backoffMs,
      message: "Flow throttled (429) during metrics pull. Retrying with backoff.",
      latestStatus: metricsRes.status,
      statusTrail,
      world: worldRes.data,
      metrics: null,
      logs: null,
      explain: null,
    }
  }
  if (shouldStopFlowForStatus(metricsRes.status)) {
    return {
      stopFlow: true,
      stopStatus: metricsRes.status,
      backoffMs,
      message: `Flow stopped by status ${metricsRes.status} during metrics pull.`,
      latestStatus: metricsRes.status,
      statusTrail,
      world: worldRes.data,
      metrics: null,
      logs: null,
      explain: null,
    }
  }

  let logs: unknown[] | null = null
  let latestStatus = metricsRes.status
  if (input.cycleIndex % input.logsEvery === 0) {
    const logsRes = await fetchLogs(input.baseUrl, input.gateKey, input.logsLimit)
    statusTrail.push(logsRes.status)
    backoffMs = updateBackoffWithStatus(backoffMs, logsRes.status)
    latestStatus = logsRes.status

    if (isThrottledStatus(logsRes.status)) {
      return {
        stopFlow: false,
        stopStatus: null,
        backoffMs,
        message: "Flow throttled (429) during trace pull. Retrying with backoff.",
        latestStatus: logsRes.status,
        statusTrail,
        world: worldRes.data,
        metrics: metricsRes.data,
        logs: null,
        explain: null,
      }
    }
    if (shouldStopFlowForStatus(logsRes.status)) {
      return {
        stopFlow: true,
        stopStatus: logsRes.status,
        backoffMs,
        message: `Flow stopped by status ${logsRes.status} during trace pull.`,
        latestStatus: logsRes.status,
        statusTrail,
        world: worldRes.data,
        metrics: metricsRes.data,
        logs: null,
        explain: null,
      }
    }
    logs = logsRes.data
  }

  let explain: ExplainRecentSnapshot | null = null
  if (input.cycleIndex % input.explainEvery === 0) {
    const explainRes = await fetchExplainRecent(
      input.baseUrl,
      input.gateKey,
      input.explainLimit,
    )
    statusTrail.push(explainRes.status)
    backoffMs = updateBackoffWithStatus(backoffMs, explainRes.status)
    latestStatus = explainRes.status

    if (isThrottledStatus(explainRes.status)) {
      return {
        stopFlow: false,
        stopStatus: null,
        backoffMs,
        message: "Flow throttled (429) during explain pull. Retrying with backoff.",
        latestStatus: explainRes.status,
        statusTrail,
        world: worldRes.data,
        metrics: metricsRes.data,
        logs,
        explain: null,
      }
    }
    if (shouldStopFlowForStatus(explainRes.status)) {
      return {
        stopFlow: true,
        stopStatus: explainRes.status,
        backoffMs,
        message: `Flow stopped by status ${explainRes.status} during explain pull.`,
        latestStatus: explainRes.status,
        statusTrail,
        world: worldRes.data,
        metrics: metricsRes.data,
        logs,
        explain: null,
      }
    }
    explain = explainRes.data
  }

  return {
    stopFlow: false,
    stopStatus: null,
    backoffMs,
    message: `Flow cycle ${input.cycleIndex} completed.`,
    latestStatus,
    statusTrail,
    world: worldRes.data,
    metrics: metricsRes.data,
    logs,
    explain,
  }
}
