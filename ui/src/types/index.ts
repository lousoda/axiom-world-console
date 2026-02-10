export type FlowMode = "LIVE" | "PAUSE" | "ACCELERATE"

export type StopStatusCode = 401 | 402 | 409

export type ApiCallResult<T> = {
  status: number
  data: T | null
  rawText: string
}

export type MetricsSnapshot = {
  tick: number
  agents: number
  queued_actions: number
  logs: number
  locations: number
  workshop_capacity_per_tick: number
  workshop_capacity_left: number
}

export type WorldSnapshot = {
  tick: number
  locations: string[]
  agents: unknown[]
  queued_actions: number
  logs: number
  economy: Record<string, unknown>
  entry: Record<string, unknown>
}

export type ExplainRecentSnapshot = {
  ok: boolean
  limit: number
  lines: string[]
}

export type AutoTickResponse = {
  ok: boolean
  auto: unknown
  tick: unknown
}
