import type {
  NodeType,
  RelationshipType,
  VisualizationSubgraphResponse,
} from "@shared-types";
import { EDGE_GROUPS } from "./constants";

export interface GraphFilterState {
  nodeTypes: NodeType[];
  edgeTypes: RelationshipType[];
  showBlockers: boolean;
  showDependencies: boolean;
  showCollaboration: boolean;
}

export function buildDefaultGraphFilterState(
  subgraph: VisualizationSubgraphResponse
): GraphFilterState {
  return {
    nodeTypes: unique(subgraph.nodes.map((node) => node.type)),
    edgeTypes: unique(subgraph.edges.map((edge) => edge.type)),
    showBlockers: true,
    showDependencies: true,
    showCollaboration: true,
  };
}

export function filterSubgraph(
  subgraph: VisualizationSubgraphResponse,
  filters: GraphFilterState
): VisualizationSubgraphResponse {
  const allowedNodeTypes = new Set(filters.nodeTypes);
  const allowedEdgeTypes = new Set(filters.edgeTypes);
  const visibleNodes = subgraph.nodes.filter((node) => allowedNodeTypes.has(node.type));
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));

  const visibleEdges = subgraph.edges.filter((edge) => {
    if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) {
      return false;
    }

    if (!allowedEdgeTypes.has(edge.type)) {
      return false;
    }

    if (!filters.showBlockers && matchesEdgeGroup(EDGE_GROUPS.blockers, edge.type)) {
      return false;
    }

    if (!filters.showDependencies && matchesEdgeGroup(EDGE_GROUPS.dependencies, edge.type)) {
      return false;
    }

    if (!filters.showCollaboration && matchesEdgeGroup(EDGE_GROUPS.collaboration, edge.type)) {
      return false;
    }

    return true;
  });

  const visibleEdgeIds = new Set(visibleEdges.map((edge) => edge.id));

  return {
    ...subgraph,
    nodes: visibleNodes,
    edges: visibleEdges,
    nodeMetadata: Object.fromEntries(
      Object.entries(subgraph.nodeMetadata).filter(([nodeId]) => visibleNodeIds.has(nodeId))
    ),
    edgeMetadata: Object.fromEntries(
      Object.entries(subgraph.edgeMetadata).filter(([edgeId]) => visibleEdgeIds.has(edgeId))
    ),
    recentUpdateSummaries: subgraph.recentUpdateSummaries.filter((update) =>
      update.connectedNodeIds.some((nodeId) => visibleNodeIds.has(nodeId))
    ),
    focusNodeId:
      subgraph.focusNodeId && visibleNodeIds.has(subgraph.focusNodeId)
        ? subgraph.focusNodeId
        : undefined,
  };
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function matchesEdgeGroup(
  group: readonly RelationshipType[],
  edgeType: RelationshipType
): boolean {
  return group.includes(edgeType);
}
