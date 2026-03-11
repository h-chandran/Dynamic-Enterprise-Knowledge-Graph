import { MarkerType, Position, type Edge, type Node } from "reactflow";
import type {
  NodeType,
  VisualizationEdge,
  VisualizationNode,
  VisualizationSubgraphResponse,
} from "@shared-types";
import { ENTITY_STYLES, ENTITY_TYPE_LABELS, ENTITY_TYPE_ORDER } from "./constants";

const COLUMN_WIDTH = 240;
const ROW_HEIGHT = 120;

export interface GraphNodeData {
  label: string;
  secondaryLabel?: string;
  type: NodeType;
  entityLabel: string;
  isFocus: boolean;
}

export interface GraphEdgeData {
  label: string;
  type: VisualizationEdge["type"];
}

export interface GraphElements {
  nodes: Node<GraphNodeData>[];
  edges: Edge<GraphEdgeData>[];
}

export function mapSubgraphToGraphElements(subgraph: VisualizationSubgraphResponse): GraphElements {
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
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        draggable: false,
        selectable: true,
        style: {
          width: 192,
          borderRadius: 18,
          border: `2px solid ${style.border}`,
          background: style.background,
          color: style.text,
          boxShadow: isFocus ? `0 0 0 4px ${style.accent}55` : "0 18px 40px rgba(15, 23, 42, 0.08)",
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
    label: edge.label,
    labelStyle: {
      fontSize: 11,
      fontWeight: 600,
      fill: "#475569",
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 18,
      height: 18,
      color: "#64748b",
    },
    style: {
      stroke: edge.type === "BLOCKED_BY" ? "#f97316" : "#64748b",
      strokeWidth: edge.type === "OWNS" ? 2.4 : 1.8,
    },
    data: {
      label: edge.label,
      type: edge.type,
    },
  })) satisfies Edge<GraphEdgeData>[];

  return { nodes, edges };
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
