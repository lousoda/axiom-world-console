import type { FlowMode, StopStatusCode } from "../types"

export const FLOW_DELAY_MS: Record<FlowMode, number> = {
  LIVE: 900,
  PAUSE: 0,
  ACCELERATE: 300,
}

export const MAX_BACKOFF_MS = 5000
export const BACKOFF_STEP_MS = 700
export const EXPLAIN_PULL_EVERY = 3

const STOP_STATUSES: StopStatusCode[] = [401, 402, 409]

export function flowDelayFor(mode: FlowMode): number {
  return FLOW_DELAY_MS[mode]
}

export function shouldStopFlowForStatus(status: number): status is StopStatusCode {
  return STOP_STATUSES.includes(status as StopStatusCode)
}

export function computeBackoff(previousMs: number, status: number): number {
  if (status === 429) {
    return Math.min(previousMs + BACKOFF_STEP_MS, MAX_BACKOFF_MS)
  }
  if (previousMs <= 0) {
    return 0
  }
  return Math.max(0, previousMs - BACKOFF_STEP_MS)
}
