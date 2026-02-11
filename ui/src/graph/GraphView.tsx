import { useEffect, useRef } from "react"
import { Network, type Edge, type Node, type Options } from "vis-network"
import "vis-network/styles/vis-network.css"
import type { StateFieldGraph } from "../model/stateFieldMapper"

type GraphViewProps = {
  graph: StateFieldGraph
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

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
        ? 0.012 + clamp(edge.value, 0, 1) * 0.012
        : 0.03 + clamp(edge.value, 0, 6) * 0.004,
    color: {
      color: edge.color.color,
      highlight: edge.color.highlight,
      opacity:
        edge.kind === "sample"
          ? clamp(edge.color.opacity * 0.18, 0.03, 0.1)
          : clamp(edge.color.opacity * 0.2, 0.06, 0.16),
      inherit: false,
    },
  }))
}

export function GraphView({ graph }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const networkRef = useRef<Network | null>(null)
  const fittedRef = useRef(false)
  const userAdjustedViewRef = useRef(false)

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
    const tick = () => {
      const network = networkRef.current
      if (network) {
        network.redraw()
      }
      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)

    return () => {
      window.cancelAnimationFrame(rafId)
    }
  }, [])

  useEffect(() => {
    if (!networkRef.current) {
      return
    }
    const network = networkRef.current

    network.setData({
      nodes: toVisNodes(graph.nodes),
      edges: toVisEdges(graph.edges),
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
  }, [graph])

  return <div className="graph-canvas" ref={containerRef} />
}
