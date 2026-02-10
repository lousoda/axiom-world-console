import type { MetricsSnapshot, WorldSnapshot } from "../types"

export type StateFieldNode = {
  id: string
  value: number
  color: {
    background: string
    border: string
    highlight: {
      background: string
      border: string
    }
  }
}

export type StateFieldEdge = {
  id: string
  from: string
  to: string
  value: number
  color: {
    color: string
    highlight: string
    opacity: number
  }
}

export type StateFieldGraph = {
  nodes: StateFieldNode[]
  edges: StateFieldEdge[]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function metricOr(defaultValue: number, value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return defaultValue
  }
  return value
}

export function buildStateFieldGraph(input: {
  world: WorldSnapshot | null
  metrics: MetricsSnapshot | null
  traceCount: number
  explainCount: number
}): StateFieldGraph {
  const tick = metricOr(0, input.world?.tick)
  const agents = Array.isArray(input.world?.agents) ? input.world.agents.length : 0
  const queued = metricOr(0, input.world?.queued_actions)
  const logs = metricOr(0, input.world?.logs)

  const capPerTick = Math.max(
    1,
    metricOr(1, input.metrics?.workshop_capacity_per_tick),
  )
  const capLeft = clamp(metricOr(capPerTick, input.metrics?.workshop_capacity_left), 0, capPerTick)
  const pressure = clamp((capPerTick - capLeft) / capPerTick, 0, 1)

  const coreMass = 20 + agents * 4 + Math.min(logs / 12, 20)
  const inertiaMass = 16 + Math.min(tick / 10, 24)
  const pressureMass = 16 + pressure * 32
  const latencyMass = 14 + Math.min(queued * 5, 24)
  const traceMass = 14 + Math.min((input.traceCount + input.explainCount) / 7, 22)

  const nodes: StateFieldNode[] = [
    {
      id: "state_core",
      value: coreMass,
      color: {
        background: "rgba(68, 168, 255, 0.36)",
        border: "rgba(132, 210, 255, 0.85)",
        highlight: {
          background: "rgba(68, 168, 255, 0.42)",
          border: "rgba(132, 210, 255, 1)",
        },
      },
    },
    {
      id: "state_inertia",
      value: inertiaMass,
      color: {
        background: "rgba(110, 137, 255, 0.25)",
        border: "rgba(157, 177, 255, 0.72)",
        highlight: {
          background: "rgba(110, 137, 255, 0.3)",
          border: "rgba(157, 177, 255, 0.9)",
        },
      },
    },
    {
      id: "state_pressure",
      value: pressureMass,
      color: {
        background: "rgba(77, 198, 177, 0.22)",
        border: "rgba(133, 223, 206, 0.72)",
        highlight: {
          background: "rgba(77, 198, 177, 0.3)",
          border: "rgba(133, 223, 206, 0.9)",
        },
      },
    },
    {
      id: "state_latency",
      value: latencyMass,
      color: {
        background: "rgba(213, 159, 88, 0.22)",
        border: "rgba(224, 188, 138, 0.7)",
        highlight: {
          background: "rgba(213, 159, 88, 0.3)",
          border: "rgba(224, 188, 138, 0.9)",
        },
      },
    },
    {
      id: "state_trace",
      value: traceMass,
      color: {
        background: "rgba(145, 151, 168, 0.22)",
        border: "rgba(193, 200, 216, 0.66)",
        highlight: {
          background: "rgba(145, 151, 168, 0.3)",
          border: "rgba(193, 200, 216, 0.86)",
        },
      },
    },
  ]

  const edges: StateFieldEdge[] = [
    {
      id: "e_core_inertia",
      from: "state_core",
      to: "state_inertia",
      value: 2 + clamp(tick / 40, 0, 3),
      color: {
        color: "rgba(130, 160, 220, 0.35)",
        highlight: "rgba(130, 160, 220, 0.55)",
        opacity: 0.6,
      },
    },
    {
      id: "e_core_pressure",
      from: "state_core",
      to: "state_pressure",
      value: 2 + pressure * 4,
      color: {
        color: "rgba(116, 194, 183, 0.35)",
        highlight: "rgba(116, 194, 183, 0.55)",
        opacity: 0.6,
      },
    },
    {
      id: "e_core_latency",
      from: "state_core",
      to: "state_latency",
      value: 2 + clamp(queued / 4, 0, 4),
      color: {
        color: "rgba(196, 164, 122, 0.32)",
        highlight: "rgba(196, 164, 122, 0.5)",
        opacity: 0.56,
      },
    },
    {
      id: "e_core_trace",
      from: "state_core",
      to: "state_trace",
      value: 2 + clamp((input.traceCount + input.explainCount) / 30, 0, 4),
      color: {
        color: "rgba(170, 176, 194, 0.3)",
        highlight: "rgba(170, 176, 194, 0.45)",
        opacity: 0.52,
      },
    },
  ]

  return { nodes, edges }
}
