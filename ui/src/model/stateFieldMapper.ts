import type { MetricsSnapshot, WorldSnapshot } from "../types"

export type StateFieldNode = {
  id: string
  kind: "anchor" | "sample"
  value: number
  size?: number
  x?: number
  y?: number
  fixed?: boolean
  anchorId?: string
  cloudAngle?: number
  cloudRadius?: number
  cloudJitter?: number
  driftPhase?: number
  driftSpeed?: number
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
  kind: "macro" | "sample"
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

const TWO_PI = Math.PI * 2

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function pseudo(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return value - Math.floor(value)
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

  const capPerTick = Math.max(1, metricOr(1, input.metrics?.workshop_capacity_per_tick))
  const capLeft = clamp(
    metricOr(capPerTick, input.metrics?.workshop_capacity_left),
    0,
    capPerTick,
  )
  const pressure = clamp((capPerTick - capLeft) / capPerTick, 0, 1)

  const coreMass = 24 + agents * 4 + Math.min(logs / 10, 24)
  const inertiaMass = 14 + Math.min(tick / 12, 20)
  const pressureMass = 14 + pressure * 26
  const latencyMass = 12 + Math.min(queued * 4, 22)
  const traceMass = 12 + Math.min((input.traceCount + input.explainCount) / 6, 20)

  const nodes: StateFieldNode[] = [
    {
      id: "state_core",
      kind: "anchor",
      value: coreMass,
      x: 0,
      y: 0,
      fixed: true,
      color: {
        background: "rgba(84, 115, 168, 0.28)",
        border: "rgba(186, 202, 234, 0.9)",
        highlight: {
          background: "rgba(84, 115, 168, 0.34)",
          border: "rgba(214, 224, 242, 1)",
        },
      },
    },
    {
      id: "state_inertia",
      kind: "anchor",
      value: inertiaMass,
      x: 118,
      y: -86,
      fixed: true,
      color: {
        background: "rgba(120, 126, 184, 0.2)",
        border: "rgba(180, 188, 234, 0.78)",
        highlight: {
          background: "rgba(120, 126, 184, 0.26)",
          border: "rgba(198, 208, 244, 0.92)",
        },
      },
    },
    {
      id: "state_pressure",
      kind: "anchor",
      value: pressureMass,
      x: 136,
      y: 88,
      fixed: true,
      color: {
        background: "rgba(118, 146, 194, 0.2)",
        border: "rgba(176, 206, 238, 0.76)",
        highlight: {
          background: "rgba(118, 146, 194, 0.26)",
          border: "rgba(196, 220, 244, 0.9)",
        },
      },
    },
    {
      id: "state_latency",
      kind: "anchor",
      value: latencyMass,
      x: -148,
      y: 86,
      fixed: true,
      color: {
        background: "rgba(152, 132, 112, 0.2)",
        border: "rgba(212, 192, 170, 0.74)",
        highlight: {
          background: "rgba(152, 132, 112, 0.26)",
          border: "rgba(228, 206, 182, 0.88)",
        },
      },
    },
    {
      id: "state_trace",
      kind: "anchor",
      value: traceMass,
      x: -126,
      y: -102,
      fixed: true,
      color: {
        background: "rgba(126, 132, 146, 0.2)",
        border: "rgba(194, 204, 220, 0.76)",
        highlight: {
          background: "rgba(126, 132, 146, 0.26)",
          border: "rgba(210, 218, 232, 0.9)",
        },
      },
    },
  ]

  const edges: StateFieldEdge[] = [
    {
      id: "e_core_inertia",
      kind: "macro",
      from: "state_core",
      to: "state_inertia",
      value: 2 + clamp(tick / 48, 0, 3),
      color: {
        color: "rgba(138, 154, 196, 0.44)",
        highlight: "rgba(168, 182, 220, 0.58)",
        opacity: 0.48,
      },
    },
    {
      id: "e_core_pressure",
      kind: "macro",
      from: "state_core",
      to: "state_pressure",
      value: 2 + pressure * 4,
      color: {
        color: "rgba(132, 168, 214, 0.4)",
        highlight: "rgba(162, 198, 236, 0.55)",
        opacity: 0.44,
      },
    },
    {
      id: "e_core_latency",
      kind: "macro",
      from: "state_core",
      to: "state_latency",
      value: 2 + clamp(queued / 4, 0, 4),
      color: {
        color: "rgba(176, 162, 142, 0.36)",
        highlight: "rgba(202, 186, 166, 0.5)",
        opacity: 0.42,
      },
    },
    {
      id: "e_core_trace",
      kind: "macro",
      from: "state_core",
      to: "state_trace",
      value: 2 + clamp((input.traceCount + input.explainCount) / 34, 0, 4),
      color: {
        color: "rgba(160, 168, 184, 0.34)",
        highlight: "rgba(186, 194, 210, 0.46)",
        opacity: 0.4,
      },
    },
  ]

  const anchorCenters = new Map(
    nodes.map((node) => [
      node.id,
      {
        x: node.x ?? 0,
        y: node.y ?? 0,
      },
    ]),
  )

  const sampleNodes: StateFieldNode[] = []
  let sampleIndex = 0
  let edgeIndex = 0

  const pushSampleNode = (inputNode: {
    x: number
    y: number
    size: number
    anchorId: string
    background: string
    border: string
  }): string => {
    const id = `sample_${sampleIndex}`
    sampleIndex += 1
    sampleNodes.push({
      id,
      kind: "sample",
      value: 0.18,
      size: inputNode.size,
      x: inputNode.x,
      y: inputNode.y,
      fixed: true,
      anchorId: inputNode.anchorId,
      cloudAngle: 0,
      cloudRadius: 0,
      cloudJitter: 0,
      driftPhase: pseudo(4300 + sampleIndex * 2.13) * TWO_PI,
      driftSpeed: 0.18 + pseudo(4400 + sampleIndex * 2.27) * 0.24,
      color: {
        background: inputNode.background,
        border: inputNode.border,
        highlight: {
          background: inputNode.background,
          border: inputNode.border,
        },
      },
    })
    return id
  }

  const coreCenter = anchorCenters.get("state_core") ?? { x: 0, y: 0 }
  const sphereRadius = 236 + agents * 8 + pressure * 36 + Math.min(logs / 24, 38)
  const primaryDustCount = clamp(
    Math.round(640 + agents * 72 + Math.min(logs, 900) * 0.25),
    640,
    1180,
  )

  const coolPockets = [
    { background: "rgba(176, 198, 230, 0.34)", border: "rgba(224, 236, 252, 0.8)" },
    { background: "rgba(166, 214, 220, 0.32)", border: "rgba(210, 240, 244, 0.76)" },
    { background: "rgba(194, 186, 214, 0.3)", border: "rgba(232, 224, 248, 0.72)" },
    { background: "rgba(204, 190, 168, 0.3)", border: "rgba(238, 220, 196, 0.72)" },
    { background: "rgba(176, 170, 184, 0.3)", border: "rgba(220, 214, 228, 0.7)" },
  ]

  const edgeColor = {
    color: "rgba(150, 164, 196, 0.2)",
    highlight: "rgba(180, 194, 222, 0.28)",
    opacity: 0.34,
  }

  const chainEdgeColor = {
    color: "rgba(142, 156, 190, 0.24)",
    highlight: "rgba(172, 188, 216, 0.3)",
    opacity: 0.36,
  }

  const connectChain = (ids: string[], stride: number) => {
    for (let i = stride; i < ids.length; i += 1) {
      edges.push({
        id: `e_sample_${edgeIndex++}`,
        kind: "sample",
        from: ids[i - stride],
        to: ids[i],
        value: 0.3,
        color: chainEdgeColor,
      })
    }
  }

  // Dense center haze.
  for (let i = 0; i < primaryDustCount; i += 1) {
    const a = pseudo(100 + i * 1.13)
    const b = pseudo(200 + i * 1.79)
    const c = pseudo(300 + i * 2.27)
    const d = pseudo(400 + i * 2.91)
    const angle = a * TWO_PI
    const radius = Math.pow(b, 1.86) * sphereRadius * 0.88
    const x = coreCenter.x + Math.cos(angle) * radius + (c - 0.5) * (10 + radius * 0.08)
    const y = coreCenter.y + Math.sin(angle) * radius + (d - 0.5) * (10 + radius * 0.08)
    const size = clamp(0.44 + (1 - radius / (sphereRadius * 0.88)) * 0.78 + c * 0.26, 0.42, 1.58)
    const color = coolPockets[Math.floor(pseudo(500 + i * 3.17) * coolPockets.length)]
    const sampleId = pushSampleNode({
      x,
      y,
      size,
      anchorId: "state_core",
      background: color.background,
      border: color.border,
    })

    if (i > 0 && i % 5 === 0) {
      edges.push({
        id: `e_sample_${edgeIndex++}`,
        kind: "sample",
        from: `sample_${sampleIndex - 2}`,
        to: sampleId,
        value: 0.28,
        color: edgeColor,
      })
    }
  }

  // Inner constellation clusters.
  const innerClusterCount = clamp(
    11 + agents + Math.floor(input.traceCount / 14),
    11,
    20,
  )
  for (let cluster = 0; cluster < innerClusterCount; cluster += 1) {
    const pocketColor =
      coolPockets[Math.floor(pseudo(900 + cluster * 7.13) * coolPockets.length)]
    const centerAngle = pseudo(1000 + cluster * 2.11) * TWO_PI
    const centerRadius = (0.16 + pseudo(1100 + cluster * 2.53) * 0.56) * sphereRadius
    const centerX =
      coreCenter.x +
      Math.cos(centerAngle) * centerRadius +
      (pseudo(1200 + cluster * 3.17) - 0.5) * 16
    const centerY =
      coreCenter.y +
      Math.sin(centerAngle) * centerRadius +
      (pseudo(1300 + cluster * 3.61) - 0.5) * 16
    const spread = 14 + pseudo(1400 + cluster * 2.91) * 26
    const clusterPoints = 16 + Math.floor(pseudo(1500 + cluster * 3.13) * 20)
    const clusterIds: string[] = []

    for (let i = 0; i < clusterPoints; i += 1) {
      const a = pseudo(1600 + cluster * 23 + i * 1.31)
      const b = pseudo(1700 + cluster * 29 + i * 1.79)
      const c = pseudo(1800 + cluster * 31 + i * 2.17)
      const angle = a * TWO_PI
      const radius = Math.pow(b, 1.52) * spread
      const x = centerX + Math.cos(angle) * radius + (c - 0.5) * (3 + radius * 0.08)
      const y = centerY + Math.sin(angle) * radius + (pseudo(1900 + cluster * 37 + i * 1.63) - 0.5) * (3 + radius * 0.08)
      const sampleId = pushSampleNode({
        x,
        y,
        size: clamp(0.42 + (1 - radius / spread) * 0.62 + c * 0.16, 0.4, 1.22),
        anchorId: "state_core",
        background: pocketColor.background,
        border: pocketColor.border,
      })
      clusterIds.push(sampleId)
    }

    connectChain(clusterIds, 1)
    connectChain(clusterIds, 3)
  }

  // Outer halo made from broken arcs.
  const arcBands = 8
  for (let band = 0; band < arcBands; band += 1) {
    const start = pseudo(2100 + band * 4.19) * TWO_PI
    const span = 0.32 + pseudo(2200 + band * 3.77) * 0.92
    const points = 24 + Math.floor(pseudo(2300 + band * 2.91) * 16)
    const bandRadius = sphereRadius * (0.94 + pseudo(2400 + band * 2.33) * 0.22)
    let prevId = ""

    for (let i = 0; i < points; i += 1) {
      const t = points <= 1 ? 0 : i / (points - 1)
      const angle = start + t * span + (pseudo(2500 + band * 23 + i * 1.37) - 0.5) * 0.04
      const radius = bandRadius + (pseudo(2600 + band * 19 + i * 1.71) - 0.5) * 16
      const x = Math.cos(angle) * radius
      const y = Math.sin(angle) * radius
      const sampleId = pushSampleNode({
        x,
        y,
        size: clamp(0.44 + pseudo(2700 + band * 29 + i * 1.13) * 0.34, 0.42, 0.86),
        anchorId: "state_trace",
        background: "rgba(160, 178, 210, 0.3)",
        border: "rgba(206, 220, 244, 0.68)",
      })

      if (prevId) {
        edges.push({
          id: `e_sample_${edgeIndex++}`,
          kind: "sample",
          from: prevId,
          to: sampleId,
          value: 0.24,
          color: {
            color: "rgba(142, 158, 188, 0.22)",
            highlight: "rgba(168, 184, 214, 0.3)",
            opacity: 0.3,
          },
        })
      }
      prevId = sampleId
    }
  }

  // Small peripheral islands around the halo.
  const islandCount = 12
  for (let island = 0; island < islandCount; island += 1) {
    const angle = pseudo(3000 + island * 2.89) * TWO_PI
    const radius = sphereRadius * (0.9 + pseudo(3100 + island * 2.31) * 0.28)
    const centerX = Math.cos(angle) * radius
    const centerY = Math.sin(angle) * radius
    const spread = 6 + pseudo(3200 + island * 1.97) * 11
    const points = 8 + Math.floor(pseudo(3300 + island * 2.17) * 7)
    const ids: string[] = []

    for (let i = 0; i < points; i += 1) {
      const a = pseudo(3400 + island * 17 + i * 1.41)
      const b = pseudo(3500 + island * 13 + i * 1.69)
      const pointRadius = Math.pow(b, 1.37) * spread
      const x = centerX + Math.cos(a * TWO_PI) * pointRadius
      const y = centerY + Math.sin(a * TWO_PI) * pointRadius
      ids.push(
        pushSampleNode({
          x,
          y,
          size: clamp(0.4 + pseudo(3600 + island * 19 + i * 1.51) * 0.36, 0.38, 0.76),
          anchorId: "state_trace",
          background: "rgba(168, 182, 212, 0.28)",
          border: "rgba(210, 222, 244, 0.64)",
        }),
      )
    }
    connectChain(ids, 1)
  }

  return { nodes: [...nodes, ...sampleNodes], edges }
}
