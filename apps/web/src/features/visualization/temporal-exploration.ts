import type { VisualizationSubgraphResponse } from "@shared-types";

export interface TemporalControlsState {
  selectedIndex: number;
  windowHours: number;
  isReplayActive: boolean;
}

export interface TemporalDerivedState {
  timelinePoints: string[];
  selectedAt: string;
  windowStart: string;
  highlightedNodeIds: Set<string>;
  highlightedEdgeIds: Set<string>;
  activeUpdateIds: Set<string>;
  activeUpdateCount: number;
  visibleSubgraph: VisualizationSubgraphResponse;
}

const DEFAULT_WINDOW_HOURS = 48;

export function buildInitialTemporalState(subgraph: VisualizationSubgraphResponse): TemporalControlsState {
  const timelinePoints = buildTimelinePoints(subgraph);

  return {
    selectedIndex: Math.max(timelinePoints.length - 1, 0),
    windowHours: DEFAULT_WINDOW_HOURS,
    isReplayActive: false,
  };
}

export function buildTimelinePoints(subgraph: VisualizationSubgraphResponse): string[] {
  const candidates = [
    subgraph.timestamps.recentWindowStart,
    subgraph.timestamps.newestNodeUpdateAt,
    subgraph.timestamps.newestEdgeUpdateAt,
    subgraph.timestamps.newestActivityAt,
    subgraph.timestamps.generatedAt,
    ...subgraph.recentUpdateSummaries.map((update) => update.occurredAt),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  return Array.from(new Set(candidates)).sort((left, right) => left.localeCompare(right));
}

export function clampTemporalState(
  state: TemporalControlsState,
  subgraph: VisualizationSubgraphResponse
): TemporalControlsState {
  const timelinePoints = buildTimelinePoints(subgraph);

  return {
    ...state,
    selectedIndex: Math.min(state.selectedIndex, Math.max(timelinePoints.length - 1, 0)),
  };
}

export function deriveTemporalSubgraph(
  subgraph: VisualizationSubgraphResponse,
  state: TemporalControlsState
): TemporalDerivedState {
  const timelinePoints = buildTimelinePoints(subgraph);
  const selectedAt = timelinePoints[state.selectedIndex] ?? subgraph.timestamps.generatedAt;
  const earliestWindowStart = Date.parse(subgraph.timestamps.recentWindowStart);
  const computedWindowStart = Date.parse(selectedAt) - state.windowHours * 60 * 60 * 1000;
  const windowStart = new Date(Math.max(earliestWindowStart, computedWindowStart)).toISOString();

  const visibleNodes = subgraph.nodes.filter((node) => {
    const metadata = subgraph.nodeMetadata[node.id];
    return !metadata?.createdAt || metadata.createdAt <= selectedAt;
  });
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));

  const visibleEdges = subgraph.edges.filter((edge) => {
    const metadata = subgraph.edgeMetadata[edge.id];

    if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) {
      return false;
    }

    return !metadata?.createdAt || metadata.createdAt <= selectedAt;
  });
  const visibleEdgeIds = new Set(visibleEdges.map((edge) => edge.id));

  const activeUpdates = subgraph.recentUpdateSummaries.filter(
    (update) =>
      update.occurredAt >= windowStart &&
      update.occurredAt <= selectedAt &&
      update.connectedNodeIds.some((nodeId) => visibleNodeIds.has(nodeId))
  );
  const activeUpdateIds = new Set(activeUpdates.map((update) => update.eventId));

  const highlightedNodeIds = new Set(
    visibleNodes
      .filter((node) => {
        const metadata = subgraph.nodeMetadata[node.id];

        if (metadata?.createdAt && metadata.createdAt >= windowStart && metadata.createdAt <= selectedAt) {
          return true;
        }

        if (metadata?.updatedAt && metadata.updatedAt >= windowStart && metadata.updatedAt <= selectedAt) {
          return true;
        }

        return metadata?.recentUpdateIds.some((updateId) => activeUpdateIds.has(updateId)) ?? false;
      })
      .map((node) => node.id)
  );

  const highlightedEdgeIds = new Set(
    visibleEdges
      .filter((edge) => {
        const metadata = subgraph.edgeMetadata[edge.id];

        if (metadata?.createdAt && metadata.createdAt >= windowStart && metadata.createdAt <= selectedAt) {
          return true;
        }

        if (metadata?.updatedAt && metadata.updatedAt >= windowStart && metadata.updatedAt <= selectedAt) {
          return true;
        }

        return metadata?.sourceEventIds?.some((eventId) => activeUpdateIds.has(eventId)) ?? false;
      })
      .map((edge) => edge.id)
  );

  return {
    timelinePoints,
    selectedAt,
    windowStart,
    highlightedNodeIds,
    highlightedEdgeIds,
    activeUpdateIds,
    activeUpdateCount: activeUpdates.length,
    visibleSubgraph: {
      ...subgraph,
      nodes: visibleNodes,
      edges: visibleEdges,
      nodeMetadata: Object.fromEntries(
        Object.entries(subgraph.nodeMetadata).filter(([nodeId]) => visibleNodeIds.has(nodeId))
      ),
      edgeMetadata: Object.fromEntries(
        Object.entries(subgraph.edgeMetadata).filter(([edgeId]) => visibleEdgeIds.has(edgeId))
      ),
      recentUpdateSummaries: activeUpdates,
      focusNodeId:
        subgraph.focusNodeId && visibleNodeIds.has(subgraph.focusNodeId) ? subgraph.focusNodeId : undefined,
    },
  };
}
