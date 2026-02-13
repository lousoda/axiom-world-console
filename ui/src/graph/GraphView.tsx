import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from "react"
import { Network, type Edge, type Node, type Options } from "vis-network"
import "vis-network/styles/vis-network.css"
import type { StateFieldGraph } from "../model/stateFieldMapper"

type GraphFx = {
  ca: number
  grain: number
  vignette: number
  blur: number
  bloom: number
  sideAlpha: number
  sideShift: number
}

type GraphActivity = {
  agents: number
  queued: number
  pressure: number
  flowMode: "LIVE" | "PAUSE" | "ACCELERATE"
  running: boolean
  cycle: number
}

type GraphViewProps = {
  graph: StateFieldGraph
  fx?: GraphFx
  activity?: GraphActivity
  safeMode?: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function hashString(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

type MotionNode = {
  id: string
  baseX: number
  baseY: number
  amp: number
  phase: number
  speed: number
}

const TWO_PI = Math.PI * 2

const graphOptions: Options = {
  layout: {
    randomSeed: 17,
    improvedLayout: true,
  },
  nodes: {
    shape: "dot",
    borderWidth: 0,
    labelHighlightBold: false,
    font: {
      size: 1,
      color: "rgba(0,0,0,0)",
      face: "Space Grotesk",
    },
    shadow: false,
  },
  edges: {
    width: 0.08,
    smooth: {
      enabled: true,
      type: "continuous",
      roundness: 0.1,
    },
    selectionWidth: 0,
    hoverWidth: 0,
  },
  interaction: {
    hover: false,
    selectConnectedEdges: false,
    selectable: false,
    dragNodes: false,
    dragView: true,
    zoomView: true,
    multiselect: false,
  },
  physics: {
    enabled: false,
  },
}

function toVisNodes(nodes: StateFieldGraph["nodes"]): Node[] {
  return nodes.map((node) => {
    const isAnchor = node.kind === "anchor"
    const size = isAnchor ? 0.58 : clamp((node.size ?? 0.8) * 0.94, 0.36, 1.46)
    return {
      id: node.id,
      label: "",
      shape: "dot",
      borderWidth: 0,
      size,
      x: node.x,
      y: node.y,
      fixed: node.fixed ? { x: true, y: true } : false,
      physics: false,
      color: isAnchor
        ? {
            background: "rgba(200, 214, 236, 0.36)",
            border: "rgba(200, 214, 236, 0.36)",
            highlight: {
              background: "rgba(216, 228, 246, 0.5)",
              border: "rgba(216, 228, 246, 0.5)",
            },
          }
        : node.color,
    } as Node
  })
}

function toVisEdges(edges: StateFieldGraph["edges"]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    from: edge.from,
    to: edge.to,
    width:
      edge.kind === "sample"
        ? 0.009 + clamp(edge.value, 0, 1) * 0.01
        : 0.016 + clamp(edge.value, 0, 6) * 0.002,
    color: {
      color: edge.color.color,
      highlight: edge.color.highlight,
      opacity:
        edge.kind === "sample"
          ? clamp(edge.color.opacity * 0.14, 0.015, 0.065)
          : clamp(edge.color.opacity * 0.12, 0.02, 0.055),
      inherit: false,
    },
  }))
}

export function GraphView({ graph, fx, activity, safeMode = false }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const overlayRef = useRef<HTMLCanvasElement | null>(null)
  const networkRef = useRef<Network | null>(null)
  const fittedRef = useRef(false)
  const userAdjustedViewRef = useRef(false)
  const motionNodesRef = useRef<MotionNode[]>([])

  const fxStyle = useMemo<CSSProperties>(() => {
    const values = {
      ca: clamp(fx?.ca ?? 0.08, 0.02, 0.28),
      grain: clamp(fx?.grain ?? 0.1, 0.04, 0.3),
      vignette: clamp(fx?.vignette ?? 0.56, 0.4, 0.82),
      blur: clamp(fx?.blur ?? 0, 0, 1.2),
      bloom: clamp(fx?.bloom ?? 0.34, 0.12, 1.1),
      sideAlpha: clamp(fx?.sideAlpha ?? 0.08, 0.02, 0.24),
      sideShift: clamp(fx?.sideShift ?? 0, -5, 5),
    }
    return {
      ["--fx-ca" as string]: values.ca.toFixed(3),
      ["--fx-grain" as string]: values.grain.toFixed(3),
      ["--fx-vignette" as string]: values.vignette.toFixed(3),
      ["--fx-bloom" as string]: values.bloom.toFixed(3),
      ["--fx-side-alpha" as string]: values.sideAlpha.toFixed(3),
      ["--fx-side-shift" as string]: `${values.sideShift.toFixed(2)}%`,
      ["--fx-blur" as string]: `${values.blur.toFixed(2)}px`,
    }
  }, [fx])

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    const network = new Network(
      containerRef.current,
      {
        nodes: [],
        edges: [],
      },
      graphOptions,
    )
    network.on("zoom", () => {
      userAdjustedViewRef.current = true
    })
    network.on("dragStart", () => {
      userAdjustedViewRef.current = true
    })
    networkRef.current = network

    return () => {
      network.destroy()
      networkRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!networkRef.current) {
      return
    }

    let rafId = 0
    let lastUpdate = 0
    let lastRedraw = 0
    let lastOverlay = 0
    let overlayW = 0
    let overlayH = 0
    let overlayDpr = 0

    const ensureOverlaySize = () => {
      const canvas = overlayRef.current
      const host = containerRef.current
      if (!canvas || !host) {
        return null
      }
      const width = Math.max(1, Math.floor(host.clientWidth))
      const height = Math.max(1, Math.floor(host.clientHeight))
      const dpr = window.devicePixelRatio || 1

      if (overlayW !== width || overlayH !== height || overlayDpr !== dpr) {
        overlayW = width
        overlayH = height
        overlayDpr = dpr
        canvas.width = Math.floor(width * dpr)
        canvas.height = Math.floor(height * dpr)
        canvas.style.width = `${width}px`
        canvas.style.height = `${height}px`
      }
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        return null
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      return { ctx, width, height }
    }

    const drawActivityOverlay = (ts: number, network: Network) => {
      const sized = ensureOverlaySize()
      if (!sized) {
        return
      }
      const { ctx, width, height } = sized
      ctx.clearRect(0, 0, width, height)

      const activityState = activity ?? {
        agents: 0,
        queued: 0,
        pressure: 0,
        flowMode: "PAUSE" as const,
        running: false,
        cycle: 0,
      }

      const modeBoost =
        activityState.flowMode === "ACCELERATE"
          ? 1
          : activityState.flowMode === "LIVE"
            ? 0.7
            : 0.32
      const pressure = clamp(activityState.pressure, 0, 1)
      const agents = Math.max(0, activityState.agents | 0)
      const queued = Math.max(0, activityState.queued | 0)
      const runBoost = activityState.running ? 1 : 0.6
      const t = ts * 0.001
      const overlayFactor = safeMode ? 0.56 : 1

      let coreX = width * 0.5
      let coreY = height * 0.52
      try {
        const canvasPos = network.getPositions(["state_core"])?.state_core
        if (canvasPos) {
          const domPos = network.canvasToDOM(canvasPos)
          if (Number.isFinite(domPos.x) && Number.isFinite(domPos.y)) {
            coreX = domPos.x
            coreY = domPos.y
          }
        }
      } catch {
        // Use viewport center fallback if position conversion fails.
      }

      const haloRadius = 44 + agents * 5 + pressure * 22
      const haloPulse = 0.22 + pressure * 0.3 + modeBoost * 0.22
      ctx.strokeStyle = `rgba(238,232,255,${(0.08 + haloPulse * 0.2).toFixed(3)})`
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(coreX, coreY, haloRadius + Math.sin(t * 0.9) * 3, 0, TWO_PI)
      ctx.stroke()

      const ringCount = Math.min(
        16,
        Math.max(3, Math.round((agents * 2 + 3) * overlayFactor)),
      )
      for (let i = 0; i < ringCount; i += 1) {
        const phase = i * 0.73 + activityState.cycle * 0.11
        const angle = t * (0.36 + modeBoost * 0.42) + phase
        const radial =
          haloRadius + 10 + Math.sin(t * 0.82 + phase * 1.9) * (5 + pressure * 4)
        const x = coreX + Math.cos(angle) * radial
        const y = coreY + Math.sin(angle) * radial
        const alpha = 0.14 + pressure * 0.18 + (i % 3) * 0.02

        ctx.fillStyle = `rgba(225,218,255,${alpha.toFixed(3)})`
        ctx.beginPath()
        ctx.arc(x, y, 0.9 + modeBoost * 0.7, 0, TWO_PI)
        ctx.fill()
      }

      const sparkCount = Math.min(
        72,
        Math.max(12, Math.round((agents * 10 + queued * 5) * overlayFactor)),
      )
      for (let i = 0; i < sparkCount; i += 1) {
        const seed = i * 0.618 + activityState.cycle * 0.057
        const angle = t * (0.2 + modeBoost * 0.24) + seed * TWO_PI
        const shell = haloRadius * (0.72 + ((i % 11) / 11) * 1.06)
        const jitter = Math.sin(t * (0.9 + (i % 7) * 0.08) + seed * 2.7) * 6
        const x = coreX + Math.cos(angle) * (shell + jitter)
        const y = coreY + Math.sin(angle) * (shell + jitter * 0.7)
        const alpha = 0.05 + pressure * 0.16 + runBoost * 0.05

        ctx.fillStyle = `rgba(205,196,236,${alpha.toFixed(3)})`
        ctx.beginPath()
        ctx.arc(x, y, 0.38 + (i % 5) * 0.12, 0, TWO_PI)
        ctx.fill()
      }

      const anchorPool = motionNodesRef.current
      const anchorCount = Math.min(
        16,
        Math.max(6, Math.round((agents * 4 + queued) * overlayFactor)),
      )
      if (anchorPool.length > 0) {
        const stride = Math.max(1, Math.floor(anchorPool.length / anchorCount))
        const anchorIds: string[] = []
        for (let i = 0; i < anchorPool.length && anchorIds.length < anchorCount; i += stride) {
          anchorIds.push(anchorPool[i].id)
        }
        const positions = network.getPositions(anchorIds)
        anchorIds.forEach((id, index) => {
          const pos = positions[id]
          if (!pos) {
            return
          }
          const dom = network.canvasToDOM(pos)
          if (!Number.isFinite(dom.x) || !Number.isFinite(dom.y)) {
            return
          }
          if (dom.x < -24 || dom.x > width + 24 || dom.y < -24 || dom.y > height + 24) {
            return
          }

          const basePhase = index * 0.71 + activityState.cycle * 0.09
          const localSpeed = 0.62 + modeBoost * 0.46 + (index % 5) * 0.05
          const orbit = 0.8 + pressure * 1.9 + (index % 3) * 0.34
          const px = dom.x + Math.cos(t * localSpeed + basePhase) * orbit
          const py = dom.y + Math.sin(t * localSpeed * 0.92 + basePhase) * orbit
          const alpha = 0.1 + pressure * 0.22 + runBoost * 0.05 + (index % 4) * 0.015

          ctx.fillStyle = `rgba(234,229,255,${alpha.toFixed(3)})`
          ctx.beginPath()
          ctx.arc(px, py, 0.75 + (index % 4) * 0.12, 0, TWO_PI)
          ctx.fill()
        })
      }

      if (queued > 0) {
        const pulseRings = Math.min(4, queued + 1)
        for (let i = 0; i < pulseRings; i += 1) {
          const phase = t * (0.75 + i * 0.18) + i * 0.92
          const radius = haloRadius + 10 + i * 6 + Math.sin(phase) * 2.2
          const alpha = 0.06 + pressure * 0.12 + i * 0.016
          ctx.strokeStyle = `rgba(228,220,255,${alpha.toFixed(3)})`
          ctx.lineWidth = 0.8
          ctx.beginPath()
          ctx.arc(coreX, coreY, radius, 0, TWO_PI)
          ctx.stroke()
        }
      }

      const pressureLocatorX = 26
      const pressureLocatorY = 26
      const tempoLocatorX = 56
      const tempoLocatorY = 26

      const tempo =
        activityState.flowMode === "ACCELERATE"
          ? 1
          : activityState.flowMode === "LIVE"
            ? 0.68
            : 0.28

      ctx.save()
      ctx.globalCompositeOperation = "screen"
      ctx.lineWidth = 0.9

      ctx.strokeStyle = `rgba(224,218,255,${(0.2 + pressure * 0.45).toFixed(3)})`
      ctx.beginPath()
      ctx.arc(pressureLocatorX, pressureLocatorY, 4.8 + pressure * 2.8, 0, TWO_PI)
      ctx.stroke()
      ctx.strokeStyle = "rgba(214,208,242,0.22)"
      ctx.beginPath()
      ctx.arc(pressureLocatorX, pressureLocatorY, 8.4, 0, TWO_PI)
      ctx.stroke()

      const tempoPulse = 4.5 + Math.sin(t * (0.7 + tempo * 0.85)) * (0.7 + tempo * 1.1)
      ctx.strokeStyle = `rgba(226,220,255,${(0.18 + tempo * 0.44).toFixed(3)})`
      ctx.beginPath()
      ctx.arc(tempoLocatorX, tempoLocatorY, tempoPulse, 0, TWO_PI)
      ctx.stroke()
      ctx.strokeStyle = "rgba(214,208,242,0.2)"
      ctx.beginPath()
      ctx.arc(tempoLocatorX, tempoLocatorY, 8.2, 0, TWO_PI)
      ctx.stroke()
      ctx.restore()
    }

    const tick = (ts: number) => {
      const network = networkRef.current
      if (network) {
        const nodeUpdateMs = safeMode ? 92 : 58
        const redrawMs = safeMode ? 56 : 34
        const overlayMs = safeMode ? 52 : 16
        if (ts - lastUpdate >= nodeUpdateMs) {
          const nodesData = (
            (network as unknown as {
              body?: { data?: { nodes?: { update: (items: Node[]) => void } } }
            }).body?.data?.nodes
          )
          if (nodesData && motionNodesRef.current.length > 0) {
            const updates: Node[] = motionNodesRef.current.map((node) => ({
              id: node.id,
              x: node.baseX + Math.sin(ts * node.speed + node.phase) * node.amp,
              y:
                node.baseY +
                Math.cos(ts * node.speed * 0.88 + node.phase) * node.amp * 0.82,
            }))
            nodesData.update(updates)
          }
          lastUpdate = ts
        }
        if (ts - lastRedraw >= redrawMs) {
          network.redraw()
          lastRedraw = ts
        }
        if (ts - lastOverlay >= overlayMs) {
          drawActivityOverlay(ts, network)
          lastOverlay = ts
        }
      }
      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)

    return () => {
      window.cancelAnimationFrame(rafId)
    }
  }, [activity, safeMode])

  useEffect(() => {
    if (!networkRef.current) {
      return
    }
    const network = networkRef.current

    network.setData({
      nodes: toVisNodes(graph.nodes),
      edges: toVisEdges(graph.edges),
    })

    const sampleNodes = graph.nodes.filter((node) => node.kind === "sample")
    const motionStride = safeMode ? 8 : 5
    motionNodesRef.current = sampleNodes
      .filter((_, index) => index % motionStride === 0)
      .map((node) => {
        const seed = hashString(node.id)
        const amp = 0.18 + ((seed % 100) / 100) * 0.42
        const phase = ((seed % 720) / 720) * Math.PI * 2
        const speed = 0.00026 + ((seed % 53) / 53) * 0.00028
        return {
          id: node.id,
          baseX: node.x ?? 0,
          baseY: node.y ?? 0,
          amp,
          phase,
          speed,
        }
      })

    if (!fittedRef.current) {
      network.fit({
        animation: false,
      })
      network.moveTo({
        scale: 1.16,
        animation: false,
      })
      fittedRef.current = true
    }
  }, [graph, safeMode])

  return (
    <div className="graph-canvas" style={fxStyle}>
      <div className="graph-surface" ref={containerRef} />
      <canvas className="graph-overlay" ref={overlayRef} />
    </div>
  )
}
