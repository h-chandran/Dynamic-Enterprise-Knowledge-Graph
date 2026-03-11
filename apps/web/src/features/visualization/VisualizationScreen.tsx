"use client";

import { startTransition, useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import "reactflow/dist/style.css";
import type { InsightsDashboardResponse, VisualizationSubgraphResponse } from "@shared-types";
import { fetchCompanyOverviewSubgraph, fetchInsightsDashboard } from "./api";
import { GraphCanvas } from "./GraphCanvas";
import { GraphControls } from "./GraphControls";
import { InsightCards } from "./InsightCards";
import { buildDefaultGraphFilterState, filterSubgraph, type GraphFilterState } from "./graph-filters";
import { TemporalControls } from "./TemporalControls";
import {
  buildInitialTemporalState,
  clampTemporalState,
  deriveTemporalSubgraph,
  type TemporalControlsState,
} from "./temporal-exploration";

interface VisualizationScreenProps {
  appName: string;
}

export function VisualizationScreen({ appName }: VisualizationScreenProps) {
  const [subgraph, setSubgraph] = useState<VisualizationSubgraphResponse | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [error, setError] = useState<string>();
  const [insightError, setInsightError] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [insights, setInsights] = useState<InsightsDashboardResponse | null>(null);
  const [isInsightsLoading, setIsInsightsLoading] = useState(true);
  const [filters, setFilters] = useState<GraphFilterState | null>(null);
  const [temporalState, setTemporalState] = useState<TemporalControlsState | null>(null);
  const [resetVersion, setResetVersion] = useState(0);
  const [isPending, startUiTransition] = useTransition();

  useEffect(() => {
    const abortController = new AbortController();

    setIsLoading(true);
    setError(undefined);
    setIsInsightsLoading(true);
    setInsightError(undefined);

    fetchCompanyOverviewSubgraph(abortController.signal)
      .then((response) => {
        setSubgraph(response);
        setSelectedNodeId(response.focusNodeId ?? response.nodes[0]?.id);
        setFilters(buildDefaultGraphFilterState(response));
        setTemporalState(buildInitialTemporalState(response));
      })
      .catch((fetchError: unknown) => {
        if (abortController.signal.aborted) {
          return;
        }

        setError(fetchError instanceof Error ? fetchError.message : "Unable to load the graph visualization.");
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      });

    fetchInsightsDashboard(abortController.signal)
      .then((response) => {
        setInsights(response);
      })
      .catch((fetchError: unknown) => {
        if (abortController.signal.aborted) {
          return;
        }

        setInsightError(fetchError instanceof Error ? fetchError.message : "Unable to load the insight layer.");
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setIsInsightsLoading(false);
        }
      });

    return () => {
      abortController.abort();
    };
  }, []);

  const deferredFilters = useDeferredValue(filters);
  const deferredTemporalState = useDeferredValue(temporalState);

  const graphStats = useMemo(() => {
    if (!subgraph) {
      return null;
    }

    return {
      nodes: subgraph.nodes.length,
      edges: subgraph.edges.length,
      lastUpdated: subgraph.timestamps.generatedAt,
    };
  }, [subgraph]);

  const filteredSubgraph = useMemo(() => {
    if (!subgraph || !deferredFilters) {
      return null;
    }

    return filterSubgraph(subgraph, deferredFilters);
  }, [deferredFilters, subgraph]);

  const temporalView = useMemo(() => {
    if (!filteredSubgraph || !deferredTemporalState) {
      return null;
    }

    return deriveTemporalSubgraph(filteredSubgraph, deferredTemporalState);
  }, [deferredTemporalState, filteredSubgraph]);

  useEffect(() => {
    if (!temporalView) {
      return;
    }

    if (selectedNodeId && temporalView.visibleSubgraph.nodes.some((node) => node.id === selectedNodeId)) {
      return;
    }

    setSelectedNodeId(temporalView.visibleSubgraph.focusNodeId ?? temporalView.visibleSubgraph.nodes[0]?.id);
  }, [selectedNodeId, temporalView]);

  useEffect(() => {
    if (!subgraph || !temporalState) {
      return;
    }

    const clampedState = clampTemporalState(temporalState, subgraph);
    if (clampedState.selectedIndex !== temporalState.selectedIndex) {
      setTemporalState(clampedState);
    }
  }, [subgraph, temporalState]);

  useEffect(() => {
    if (!temporalState?.isReplayActive) {
      return;
    }

    const maxIndex = temporalView ? temporalView.timelinePoints.length - 1 : 0;
    if (temporalState.selectedIndex >= maxIndex) {
      setTemporalState((current) => (current ? { ...current, isReplayActive: false } : current));
      return;
    }

    const timer = window.setTimeout(() => {
      setTemporalState((current) =>
        current
          ? {
              ...current,
              selectedIndex: Math.min(current.selectedIndex + 1, maxIndex),
            }
          : current
      );
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [temporalState, temporalView]);

  const availableNodeTypes = useMemo(
    () => (subgraph ? Array.from(new Set(subgraph.nodes.map((node) => node.type))) : []),
    [subgraph]
  );

  const availableEdgeTypes = useMemo(
    () => (subgraph ? Array.from(new Set(subgraph.edges.map((edge) => edge.type))) : []),
    [subgraph]
  );

  const handleResetView = () => {
    if (!subgraph) {
      return;
    }

    startTransition(() => {
      setFilters(buildDefaultGraphFilterState(subgraph));
      setTemporalState(buildInitialTemporalState(subgraph));
      setSelectedNodeId(subgraph.focusNodeId ?? subgraph.nodes[0]?.id);
      setResetVersion((current) => current + 1);
    });
  };

  return (
    <section className="visualization-page">
      <header className="visualization-header">
        <div>
          <p className="eyebrow">Phase 7</p>
          <h1>{appName}</h1>
          <p className="intro">
            Initial interactive visualization for the enterprise knowledge graph, powered by the
            backend subgraph endpoints.
          </p>
        </div>
        {graphStats ? (
          <div className="stats-card">
            <span>{graphStats.nodes} nodes</span>
            <span>{graphStats.edges} edges</span>
            <span>{new Date(graphStats.lastUpdated).toLocaleString()}</span>
          </div>
        ) : null}
      </header>

      {isLoading ? (
        <div className="status-card">
          <h2>Loading graph</h2>
          <p>Fetching the latest company overview subgraph from the API.</p>
        </div>
      ) : null}

      {!isLoading && error ? (
        <div className="status-card status-card-error">
          <h2>Visualization unavailable</h2>
          <p>{error}</p>
        </div>
      ) : null}

      {isInsightsLoading ? (
        <div className="status-card">
          <h2>Loading insight layer</h2>
          <p>Calculating evidence-backed signals and inferred staffing hypotheses.</p>
        </div>
      ) : null}

      {!isInsightsLoading && insightError ? (
        <div className="status-card status-card-error">
          <h2>Insight layer unavailable</h2>
          <p>{insightError}</p>
        </div>
      ) : null}

      {!isInsightsLoading && !insightError && insights ? <InsightCards dashboard={insights} /> : null}

      {!isLoading && !error && subgraph ? (
        <>
          {filters ? (
            <GraphControls
              filters={filters}
              availableNodeTypes={availableNodeTypes}
              availableEdgeTypes={availableEdgeTypes}
              setFilters={(nextValue) => {
                startUiTransition(() => {
                  setFilters((current) => {
                    const baseState = current ?? buildDefaultGraphFilterState(subgraph);
                    return typeof nextValue === "function" ? nextValue(baseState) : nextValue;
                  });
                });
              }}
              onReset={handleResetView}
              isUpdating={isPending}
            />
          ) : null}
          {temporalView ? (
            <TemporalControls
              selectedAt={temporalView.selectedAt}
              windowStart={temporalView.windowStart}
              windowHours={temporalState?.windowHours ?? 48}
              activeUpdateCount={temporalView.activeUpdateCount}
              selectedIndex={temporalState?.selectedIndex ?? 0}
              maxIndex={Math.max(temporalView.timelinePoints.length - 1, 0)}
              isReplayActive={temporalState?.isReplayActive ?? false}
              onTimelineChange={(nextIndex) =>
                setTemporalState((current) =>
                  current
                    ? {
                        ...current,
                        selectedIndex:
                          typeof nextIndex === "function"
                            ? nextIndex(current.selectedIndex)
                            : nextIndex,
                        isReplayActive: false,
                      }
                    : current
                )
              }
              onWindowHoursChange={(nextWindowHours) =>
                setTemporalState((current) =>
                  current
                    ? {
                        ...current,
                        windowHours:
                          typeof nextWindowHours === "function"
                            ? nextWindowHours(current.windowHours)
                            : nextWindowHours,
                      }
                    : current
                )
              }
              onReplayToggle={() =>
                setTemporalState((current) =>
                  current
                    ? {
                        ...current,
                        isReplayActive: !current.isReplayActive,
                        selectedIndex:
                          current.selectedIndex >= Math.max(temporalView.timelinePoints.length - 1, 0)
                            ? 0
                            : current.selectedIndex,
                      }
                    : current
                )
              }
            />
          ) : null}
          {temporalView ? (
            <GraphCanvas
              subgraph={temporalView.visibleSubgraph}
              selectedNodeId={selectedNodeId}
              onNodeSelect={setSelectedNodeId}
              resetVersion={resetVersion}
              temporalContext={{
                highlightedNodeIds: temporalView.highlightedNodeIds,
                highlightedEdgeIds: temporalView.highlightedEdgeIds,
              }}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}
