import { useEffect, useRef } from "react"
import { Network, type Edge, type Node, type Options } from "vis-network"
import "vis-network/styles/vis-network.css"
import type { StateFieldGraph } from "../model/stateFieldMapper"
import {
  createStateMassRenderer,
  type StateMassCtxRenderer,
} from "./NodeRenderer"

type GraphViewProps = {
  graph: StateFieldGraph
}

const graphOptions: Options = {
  layout: {
    randomSeed: 17,
    improvedLayout: true,
  },
  nodes: {
    shape: "custom",
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
    width: 0.7,
    smooth: {
      enabled: true,
      type: "continuous",
      roundness: 0.35,
    },
    selectionWidth: 0,
    hoverWidth: 0,
  },
  interaction: {
    hover: false,
    selectConnectedEdges: false,
    selectable: false,
    dragNodes: false,
    multiselect: false,
  },
  physics: {
    enabled: true,
    barnesHut: {
      gravitationalConstant: -2200,
      springConstant: 0.024,
      springLength: 150,
      damping: 0.48,
      avoidOverlap: 0.28,
    },
    stabilization: {
      enabled: false,
    },
  },
}

type VisCustomNode = Node & {
  shape: "custom"
  ctxRenderer: StateMassCtxRenderer
}

function toVisNodes(nodes: StateFieldGraph["nodes"]): Node[] {
  return nodes.map((node) => ({
    id: node.id,
    value: node.value,
    label: "",
    shape: "custom",
    borderWidth: 0,
    ctxRenderer: createStateMassRenderer({
      id: node.id,
      value: node.value,
      color: {
        background: node.color.background,
        border: node.color.border,
      },
    }),
    color: node.color,
  }) as VisCustomNode)
}

function toVisEdges(edges: StateFieldGraph["edges"]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    from: edge.from,
    to: edge.to,
    value: edge.value,
    color: edge.color,
  }))
}

export function GraphView({ graph }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const networkRef = useRef<Network | null>(null)

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

    const intervalId = window.setInterval(() => {
      networkRef.current?.redraw()
    }, 140)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    if (!networkRef.current) {
      return
    }
    networkRef.current.setData({
      nodes: toVisNodes(graph.nodes),
      edges: toVisEdges(graph.edges),
    })
  }, [graph])

  return <div className="graph-canvas" ref={containerRef} />
}
