import { MarkerType, Position, type Edge, type Node } from "reactflow";
import type {
  NodeType,
  VisualizationEdge,
  VisualizationEdgeMetadata,
  VisualizationNode,
  VisualizationNodeMetadata,
  VisualizationSubgraphResponse,
} from "@shared-types";
import {
  ENTITY_STYLES,
  ENTITY_TYPE_LABELS,
  ENTITY_TYPE_ORDER,
  RELATIONSHIP_TYPE_LABELS,
} from "./constants";

const COLUMN_WIDTH = 240;
const ROW_HEIGHT = 120;

export interface GraphNodeData {
  label: string;
  secondaryLabel?: string;
  type: NodeType;
  entityLabel: string;
  isFocus: boolean;
  freshness: "recent" | "stale";
}

export interface GraphEdgeData {
  label: string;
  type: VisualizationEdge["type"];
  freshness: "recent" | "stale";
}

export interface GraphElements {
  nodes: Node<GraphNodeData>[];
  edges: Edge<GraphEdgeData>[];
}

export interface GraphTemporalContext {
  highlightedNodeIds?: Set<string>;
  highlightedEdgeIds?: Set<string>;
}

export function mapSubgraphToGraphElements(
  subgraph: VisualizationSubgraphResponse,
  temporalContext?: GraphTemporalContext
): GraphElements {
  const nodesByType = groupNodesByType(subgraph.nodes);
  const typeOrder = [
    ...ENTITY_TYPE_ORDER,
    ...Array.from(nodesByType.keys()).filter((nodeType) => !ENTITY_TYPE_ORDER.includes(nodeType)),
  ];

  const nodes = typeOrder.flatMap((nodeType, columnIndex) => {
    const typeNodes = nodesByType.get(nodeType) ?? [];

    return typeNodes.map((node, rowIndex) => {
      const style = ENTITY_STYLES[node.type];
      const isFocus = subgraph.focusNodeId === node.id;
      const metadata = subgraph.nodeMetadata[node.id];
      const freshness = getFreshness(metadata, subgraph.timestamps.recentWindowStart);
      const isHighlighted = temporalContext?.highlightedNodeIds?.has(node.id) ?? false;

      return {
        id: node.id,
        position: {
          x: columnIndex * COLUMN_WIDTH,
          y: rowIndex * ROW_HEIGHT,
        },
        data: {
          label: node.label,
          secondaryLabel: node.secondaryLabel,
          type: node.type,
          entityLabel: ENTITY_TYPE_LABELS[node.type],
          isFocus,
          freshness,
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        draggable: false,
        selectable: true,
        style: {
          width: 192,
          borderRadius: 18,
          border: `${freshness === "recent" ? 2.5 : 2}px ${freshness === "stale" ? "dashed" : "solid"} ${style.border}`,
          background: style.background,
          color: style.text,
          opacity: freshness === "recent" ? 1 : 0.72,
          boxShadow: isFocus
            ? `0 0 0 4px ${style.accent}55`
            : isHighlighted
              ? `0 0 0 3px ${style.accent}66, 0 18px 40px rgba(15, 23, 42, 0.1)`
            : freshness === "recent"
              ? "0 18px 40px rgba(15, 23, 42, 0.08)"
              : "0 10px 26px rgba(15, 23, 42, 0.06)",
          padding: "14px 16px",
          fontSize: 14,
          fontWeight: 600,
        },
        zIndex: isFocus ? 2 : 1,
      } satisfies Node<GraphNodeData>;
    });
  });

  const edges = subgraph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    animated: edge.type === "BLOCKED_BY",
    label: RELATIONSHIP_TYPE_LABELS[edge.type],
    labelStyle: {
      fontSize: 11,
      fontWeight: 600,
      fill: "#475569",
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 18,
      height: 18,
      color: getEdgeStroke(edge, subgraph.edgeMetadata[edge.id], subgraph.timestamps.recentWindowStart),
    },
    style: {
      stroke: getEdgeStroke(edge, subgraph.edgeMetadata[edge.id], subgraph.timestamps.recentWindowStart),
      strokeWidth:
        (temporalContext?.highlightedEdgeIds?.has(edge.id) ?? false)
          ? 3.2
          : edge.type === "OWNS"
            ? 2.4
            : 1.8,
      strokeDasharray: isRecentEdge(subgraph.edgeMetadata[edge.id], subgraph.timestamps.recentWindowStart) ? undefined : "6 4",
      opacity: (temporalContext?.highlightedEdgeIds?.has(edge.id) ?? false)
        ? 1
        : isRecentEdge(subgraph.edgeMetadata[edge.id], subgraph.timestamps.recentWindowStart)
          ? 0.95
          : 0.5,
    },
    data: {
      label: RELATIONSHIP_TYPE_LABELS[edge.type],
      type: edge.type,
      freshness: isRecentEdge(subgraph.edgeMetadata[edge.id], subgraph.timestamps.recentWindowStart)
        ? "recent"
        : "stale",
    },
  })) satisfies Edge<GraphEdgeData>[];

  return { nodes, edges };
}

function getFreshness(
  metadata: VisualizationNodeMetadata | undefined,
  recentWindowStart: string
): "recent" | "stale" {
  if (!metadata) {
    return "stale";
  }

  if (metadata.recentUpdateCount > 0) {
    return "recent";
  }

  if (metadata.updatedAt && metadata.updatedAt >= recentWindowStart) {
    return "recent";
  }

  return "stale";
}

function isRecentEdge(
  metadata: VisualizationEdgeMetadata | undefined,
  recentWindowStart: string
): boolean {
  return Boolean(metadata?.updatedAt && metadata.updatedAt >= recentWindowStart);
}

function getEdgeStroke(
  edge: VisualizationEdge,
  metadata: VisualizationEdgeMetadata | undefined,
  recentWindowStart: string
): string {
  if (edge.type === "BLOCKED_BY") {
    return isRecentEdge(metadata, recentWindowStart) ? "#f97316" : "#fdba74";
  }

  return isRecentEdge(metadata, recentWindowStart) ? "#475569" : "#94a3b8";
}

function groupNodesByType(nodes: VisualizationNode[]): Map<NodeType, VisualizationNode[]> {
  const grouped = new Map<NodeType, VisualizationNode[]>();

  nodes.forEach((node) => {
    const collection = grouped.get(node.type) ?? [];
    collection.push(node);
    grouped.set(node.type, collection);
  });

  grouped.forEach((typeNodes) => {
    typeNodes.sort((left, right) => left.label.localeCompare(right.label));
  });

  return grouped;
}
