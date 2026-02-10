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

export async function executeFlowCycle(
  input: FlowCycleInput,
): Promise<FlowCycleOutput> {
  let backoffMs = input.backoffMs
  const statusTrail: number[] = []

  const auto = await autoPulse(input.baseUrl, input.gateKey, input.limitAgents)
  statusTrail.push(auto.status)
  backoffMs = updateBackoffWithStatus(backoffMs, auto.status)

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

  const logsRes = await fetchLogs(input.baseUrl, input.gateKey, input.logsLimit)
  statusTrail.push(logsRes.status)
  backoffMs = updateBackoffWithStatus(backoffMs, logsRes.status)
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

  let explain: ExplainRecentSnapshot | null = null
  let latestStatus = logsRes.status
  if (input.cycleIndex % input.explainEvery === 0) {
    const explainRes = await fetchExplainRecent(
      input.baseUrl,
      input.gateKey,
      input.explainLimit,
    )
    statusTrail.push(explainRes.status)
    backoffMs = updateBackoffWithStatus(backoffMs, explainRes.status)
    latestStatus = explainRes.status
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
        logs: logsRes.data,
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
    logs: logsRes.data,
    explain,
  }
}
