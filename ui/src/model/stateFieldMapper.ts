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

function scaledCount(
  value: number,
  density: number,
  min: number,
  max: number,
): number {
  return clamp(Math.round(value * density), min, max)
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
  const visualDensity = clamp(0.68 + pressure * 0.12, 0.66, 0.84)

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
        background: "rgba(106, 88, 184, 0.3)",
        border: "rgba(206, 194, 255, 0.92)",
        highlight: {
          background: "rgba(106, 88, 184, 0.36)",
          border: "rgba(220, 210, 255, 1)",
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
        background: "rgba(136, 112, 198, 0.22)",
        border: "rgba(198, 188, 244, 0.8)",
        highlight: {
          background: "rgba(136, 112, 198, 0.28)",
          border: "rgba(214, 206, 250, 0.94)",
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
        background: "rgba(122, 154, 214, 0.2)",
        border: "rgba(186, 212, 248, 0.78)",
        highlight: {
          background: "rgba(122, 154, 214, 0.27)",
          border: "rgba(202, 224, 252, 0.9)",
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
        background: "rgba(176, 136, 194, 0.2)",
        border: "rgba(230, 198, 238, 0.76)",
        highlight: {
          background: "rgba(176, 136, 194, 0.27)",
          border: "rgba(238, 210, 246, 0.9)",
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
        background: "rgba(146, 138, 174, 0.2)",
        border: "rgba(206, 198, 234, 0.78)",
        highlight: {
          background: "rgba(146, 138, 174, 0.27)",
          border: "rgba(220, 212, 244, 0.9)",
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
        color: "rgba(152, 138, 210, 0.42)",
        highlight: "rgba(186, 172, 236, 0.56)",
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
        color: "rgba(136, 174, 224, 0.38)",
        highlight: "rgba(168, 204, 242, 0.54)",
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
        color: "rgba(182, 154, 198, 0.34)",
        highlight: "rgba(214, 184, 226, 0.48)",
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
        color: "rgba(166, 160, 196, 0.34)",
        highlight: "rgba(194, 188, 226, 0.46)",
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
  const edgeKeepThreshold = clamp(0.64 - visualDensity * 0.2, 0.42, 0.5)

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
  const primaryDustCount = scaledCount(
    clamp(Math.round(760 + agents * 80 + Math.min(logs, 1100) * 0.28), 760, 1360),
    visualDensity,
    580,
    1220,
  )

  const coolPockets = [
    { background: "rgba(206, 190, 255, 0.34)", border: "rgba(238, 228, 255, 0.84)" },
    { background: "rgba(184, 172, 248, 0.34)", border: "rgba(226, 214, 255, 0.8)" },
    { background: "rgba(170, 186, 244, 0.33)", border: "rgba(212, 222, 252, 0.78)" },
    { background: "rgba(156, 170, 226, 0.32)", border: "rgba(200, 212, 242, 0.74)" },
    { background: "rgba(174, 156, 214, 0.3)", border: "rgba(214, 198, 236, 0.72)" },
  ]

  const edgeColor = {
    color: "rgba(164, 154, 214, 0.2)",
    highlight: "rgba(192, 182, 236, 0.28)",
    opacity: 0.34,
  }

  const chainEdgeColor = {
    color: "rgba(154, 146, 204, 0.24)",
    highlight: "rgba(182, 174, 226, 0.3)",
    opacity: 0.36,
  }

  const connectChain = (ids: string[], stride: number) => {
    for (let i = stride; i < ids.length; i += 1) {
      const keep = pseudo(3800 + i * 1.71 + stride * 11) > edgeKeepThreshold
      if (!keep) {
        continue
      }
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

  // Dense interior haze.
  for (let i = 0; i < primaryDustCount; i += 1) {
    const a = pseudo(100 + i * 1.13)
    const b = pseudo(200 + i * 1.79)
    const c = pseudo(300 + i * 2.27)
    const d = pseudo(400 + i * 2.91)
    const angle = a * TWO_PI
    const radius = Math.pow(b, 1.34) * sphereRadius * 0.9
    const x = coreCenter.x + Math.cos(angle) * radius + (c - 0.5) * (10 + radius * 0.08)
    const y = coreCenter.y + Math.sin(angle) * radius + (d - 0.5) * (10 + radius * 0.08)
    const size = clamp(0.46 + (1 - radius / (sphereRadius * 0.9)) * 0.8 + c * 0.26, 0.42, 1.58)
    const color = coolPockets[Math.floor(pseudo(500 + i * 3.17) * coolPockets.length)]
    const sampleId = pushSampleNode({
      x,
      y,
      size,
      anchorId: "state_core",
      background: color.background,
      border: color.border,
    })

    if (i > 0 && i % 10 === 0 && radius < sphereRadius * 0.54) {
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

  // Extra interior micro-haze for volumetric feel.
  const interiorHazeCount = scaledCount(280, visualDensity, 190, 300)
  for (let i = 0; i < interiorHazeCount; i += 1) {
    const a = pseudo(700 + i * 1.17)
    const b = pseudo(740 + i * 1.73)
    const c = pseudo(780 + i * 1.49)
    const angle = a * TWO_PI
    const radius = Math.pow(b, 1.38) * sphereRadius * 0.72
    const x = coreCenter.x + Math.cos(angle) * radius + (c - 0.5) * 9
    const y = coreCenter.y + Math.sin(angle) * radius + (pseudo(820 + i * 1.61) - 0.5) * 9
    const pocketColor = coolPockets[Math.floor(pseudo(860 + i * 2.31) * coolPockets.length)]
    pushSampleNode({
      x,
      y,
      size: clamp(0.42 + pseudo(900 + i * 2.03) * 0.56, 0.4, 1.02),
      anchorId: "state_core",
      background: pocketColor.background,
      border: pocketColor.border,
    })
  }

  // Mid-shell haze to populate the sphere beyond center.
  const midShellCount = scaledCount(260, visualDensity, 180, 280)
  for (let i = 0; i < midShellCount; i += 1) {
    const a = pseudo(920 + i * 1.27)
    const b = pseudo(960 + i * 1.71)
    const c = pseudo(1000 + i * 1.59)
    const angle = a * TWO_PI
    const radiusNorm = 0.48 + Math.pow(b, 0.74) * 0.44
    const radius = radiusNorm * sphereRadius
    const x = coreCenter.x + Math.cos(angle) * radius + (c - 0.5) * 8
    const y = coreCenter.y + Math.sin(angle) * radius + (pseudo(1040 + i * 1.83) - 0.5) * 8
    const pocketColor = coolPockets[Math.floor(pseudo(1080 + i * 2.21) * coolPockets.length)]
    pushSampleNode({
      x,
      y,
      size: clamp(0.38 + pseudo(1120 + i * 1.97) * 0.46, 0.36, 0.9),
      anchorId: "state_trace",
      background: pocketColor.background,
      border: pocketColor.border,
    })
  }

  // Moon-like albedo patches inside the sphere.
  const albedoPatchCount = scaledCount(9, visualDensity, 6, 9)
  for (let patch = 0; patch < albedoPatchCount; patch += 1) {
    const patchAngle = pseudo(3880 + patch * 2.37) * TWO_PI
    const patchRadius = Math.pow(pseudo(3920 + patch * 2.17), 0.95) * sphereRadius * 0.9
    const patchX = coreCenter.x + Math.cos(patchAngle) * patchRadius
    const patchY = coreCenter.y + Math.sin(patchAngle) * patchRadius
    const spread = 18 + pseudo(3960 + patch * 2.63) * 44
    const points = scaledCount(
      96 + Math.floor(pseudo(4000 + patch * 2.81) * 120),
      visualDensity,
      70,
      170,
    )
    const palette = coolPockets[patch % coolPockets.length]
    const patchIds: string[] = []

    for (let i = 0; i < points; i += 1) {
      const a = pseudo(4040 + patch * 19 + i * 1.31)
      const b = pseudo(4080 + patch * 23 + i * 1.63)
      const c = pseudo(4120 + patch * 17 + i * 1.43)
      const angle = a * TWO_PI
      const radius = Math.pow(b, 1.58) * spread
      patchIds.push(
        pushSampleNode({
          x: patchX + Math.cos(angle) * radius + (c - 0.5) * 3.5,
          y: patchY + Math.sin(angle) * radius + (pseudo(4160 + patch * 29 + i * 1.71) - 0.5) * 3.5,
          size: clamp(0.42 + (1 - radius / spread) * 0.74 + c * 0.2, 0.4, 1.26),
          anchorId: "state_core",
          background: palette.background,
          border: palette.border,
        }),
      )
    }

    connectChain(patchIds, 2)
    connectChain(patchIds, 5)
  }

  // Inner constellation clusters.
  const innerClusterCount = scaledCount(
    clamp(13 + agents + Math.floor(input.traceCount / 12), 13, 24),
    visualDensity,
    11,
    22,
  )
  let previousClusterBridgeId = ""
  for (let cluster = 0; cluster < innerClusterCount; cluster += 1) {
    const pocketColor =
      coolPockets[Math.floor(pseudo(900 + cluster * 7.13) * coolPockets.length)]
    const centerAngle = pseudo(1000 + cluster * 2.11) * TWO_PI
    const centerRadius = (0.08 + pseudo(1100 + cluster * 2.53) * 0.8) * sphereRadius
    const centerX =
      coreCenter.x +
      Math.cos(centerAngle) * centerRadius +
      (pseudo(1200 + cluster * 3.17) - 0.5) * 16
    const centerY =
      coreCenter.y +
      Math.sin(centerAngle) * centerRadius +
      (pseudo(1300 + cluster * 3.61) - 0.5) * 16
    const spread = 18 + pseudo(1400 + cluster * 2.91) * 24
    const coreSpread = 6 + pseudo(1450 + cluster * 2.49) * 10
    const corePoints = scaledCount(
      18 + Math.floor(pseudo(1470 + cluster * 2.27) * 16),
      visualDensity,
      14,
      28,
    )
    const clusterPoints = scaledCount(
      28 + Math.floor(pseudo(1500 + cluster * 3.13) * 18),
      visualDensity,
      20,
      36,
    )
    const clusterIds: string[] = []
    const coreIds: string[] = []

    // Dense kernel: gives each state mass visible volume.
    for (let i = 0; i < corePoints; i += 1) {
      const a = pseudo(1520 + cluster * 41 + i * 1.19)
      const b = pseudo(1540 + cluster * 37 + i * 1.43)
      const c = pseudo(1560 + cluster * 29 + i * 1.61)
      const angle = a * TWO_PI
      const radius = Math.pow(b, 1.9) * coreSpread
      const x = centerX + Math.cos(angle) * radius + (c - 0.5) * (1.5 + radius * 0.06)
      const y =
        centerY +
        Math.sin(angle) * radius +
        (pseudo(1580 + cluster * 31 + i * 1.73) - 0.5) * (1.5 + radius * 0.06)

      coreIds.push(
        pushSampleNode({
          x,
          y,
          size: clamp(0.58 + (1 - radius / coreSpread) * 0.78 + c * 0.18, 0.55, 1.58),
          anchorId: "state_core",
          background: "rgba(224, 212, 255, 0.42)",
          border: "rgba(244, 238, 255, 0.9)",
        }),
      )
    }

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

    connectChain(coreIds, 1)
    connectChain(coreIds, 2)
    connectChain(clusterIds, 1)
    connectChain(clusterIds, 2)

    if (coreIds[0] && clusterIds[0]) {
      edges.push({
        id: `e_sample_${edgeIndex++}`,
        kind: "sample",
        from: coreIds[0],
        to: clusterIds[0],
        value: 0.24,
        color: {
          color: "rgba(174, 166, 220, 0.22)",
          highlight: "rgba(196, 188, 236, 0.28)",
          opacity: 0.32,
        },
      })
    }

    if (previousClusterBridgeId && coreIds[0]) {
      edges.push({
        id: `e_sample_${edgeIndex++}`,
        kind: "sample",
        from: previousClusterBridgeId,
        to: coreIds[0],
        value: 0.22,
        color: {
          color: "rgba(164, 156, 210, 0.2)",
          highlight: "rgba(188, 180, 230, 0.28)",
          opacity: 0.28,
        },
      })
    }
    if (coreIds[0]) {
      previousClusterBridgeId = coreIds[0]
    }
  }

  // Outer halo made from broken arcs.
  const arcBands = scaledCount(8, visualDensity, 6, 8)
  for (let band = 0; band < arcBands; band += 1) {
    const start = pseudo(2100 + band * 4.19) * TWO_PI
    const span = 0.32 + pseudo(2200 + band * 3.77) * 0.92
    const points = scaledCount(
      24 + Math.floor(pseudo(2300 + band * 2.91) * 16),
      visualDensity,
      18,
      32,
    )
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
        border: "rgba(214, 208, 248, 0.68)",
      })

      if (prevId) {
        edges.push({
          id: `e_sample_${edgeIndex++}`,
          kind: "sample",
          from: prevId,
          to: sampleId,
          value: 0.24,
          color: {
            color: "rgba(154, 148, 198, 0.22)",
            highlight: "rgba(178, 170, 220, 0.3)",
            opacity: 0.3,
          },
        })
      }
      prevId = sampleId
    }
  }

  // Contour clumps: visible dense pockets on the sphere boundary.
  const contourClumpCount = scaledCount(14, visualDensity, 10, 13)
  for (let clump = 0; clump < contourClumpCount; clump += 1) {
    const angle = pseudo(4700 + clump * 2.49) * TWO_PI
    const radius = sphereRadius * (0.9 + pseudo(4740 + clump * 2.17) * 0.16)
    const centerX = coreCenter.x + Math.cos(angle) * radius
    const centerY = coreCenter.y + Math.sin(angle) * radius
    const spread = 8 + pseudo(4780 + clump * 2.73) * 13
    const points = scaledCount(
      18 + Math.floor(pseudo(4820 + clump * 2.31) * 22),
      visualDensity,
      14,
      28,
    )
    const ids: string[] = []
    const pocketColor = coolPockets[clump % coolPockets.length]

    for (let i = 0; i < points; i += 1) {
      const a = pseudo(4860 + clump * 31 + i * 1.29)
      const b = pseudo(4900 + clump * 29 + i * 1.47)
      const c = pseudo(4940 + clump * 37 + i * 1.63)
      const localRadius = Math.pow(b, 1.34) * spread
      ids.push(
        pushSampleNode({
          x: centerX + Math.cos(a * TWO_PI) * localRadius + (c - 0.5) * 2.4,
          y: centerY + Math.sin(a * TWO_PI) * localRadius + (pseudo(4980 + clump * 19 + i * 1.77) - 0.5) * 2.4,
          size: clamp(0.42 + (1 - localRadius / spread) * 0.52 + c * 0.14, 0.4, 1.08),
          anchorId: "state_trace",
          background: pocketColor.background,
          border: pocketColor.border,
        }),
      )
    }

    connectChain(ids, 1)
    connectChain(ids, 2)
  }

  // Small peripheral islands around the halo.
  const islandCount = scaledCount(12, visualDensity, 9, 12)
  for (let island = 0; island < islandCount; island += 1) {
    const angle = pseudo(3000 + island * 2.89) * TWO_PI
    const radius = sphereRadius * (0.9 + pseudo(3100 + island * 2.31) * 0.28)
    const centerX = Math.cos(angle) * radius
    const centerY = Math.sin(angle) * radius
    const spread = 6 + pseudo(3200 + island * 1.97) * 11
    const points = scaledCount(
      8 + Math.floor(pseudo(3300 + island * 2.17) * 7),
      visualDensity,
      7,
      13,
    )
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
          border: "rgba(216, 210, 246, 0.64)",
        }),
      )
    }
    connectChain(ids, 1)
  }

  const allNodes = [...nodes, ...sampleNodes]
  const MAX_TOTAL_NODES = 4200
  const MAX_TOTAL_EDGES = 3600

  if (allNodes.length <= MAX_TOTAL_NODES && edges.length <= MAX_TOTAL_EDGES) {
    return { nodes: allNodes, edges }
  }

  const trimmedNodes = allNodes.slice(0, MAX_TOTAL_NODES)
  const nodeIds = new Set(trimmedNodes.map((node) => node.id))
  const trimmedEdges = edges
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
    .slice(0, MAX_TOTAL_EDGES)

  return { nodes: trimmedNodes, edges: trimmedEdges }
}
