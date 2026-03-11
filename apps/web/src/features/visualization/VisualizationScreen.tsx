"use client";

import { startTransition, useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import "reactflow/dist/style.css";
import type { VisualizationSubgraphResponse } from "@shared-types";
import { fetchCompanyOverviewSubgraph } from "./api";
import { GraphCanvas } from "./GraphCanvas";
import { GraphControls } from "./GraphControls";
import { buildDefaultGraphFilterState, filterSubgraph, type GraphFilterState } from "./graph-filters";

interface VisualizationScreenProps {
  appName: string;
}

export function VisualizationScreen({ appName }: VisualizationScreenProps) {
  const [subgraph, setSubgraph] = useState<VisualizationSubgraphResponse | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState<GraphFilterState | null>(null);
  const [resetVersion, setResetVersion] = useState(0);
  const [isPending, startUiTransition] = useTransition();

  useEffect(() => {
    const abortController = new AbortController();

    setIsLoading(true);
    setError(undefined);

    fetchCompanyOverviewSubgraph(abortController.signal)
      .then((response) => {
        setSubgraph(response);
        setSelectedNodeId(response.focusNodeId ?? response.nodes[0]?.id);
        setFilters(buildDefaultGraphFilterState(response));
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

    return () => {
      abortController.abort();
    };
  }, []);

  const deferredFilters = useDeferredValue(filters);

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

  useEffect(() => {
    if (!filteredSubgraph) {
      return;
    }

    if (selectedNodeId && filteredSubgraph.nodes.some((node) => node.id === selectedNodeId)) {
      return;
    }

    setSelectedNodeId(filteredSubgraph.focusNodeId ?? filteredSubgraph.nodes[0]?.id);
  }, [filteredSubgraph, selectedNodeId]);

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
          {filteredSubgraph ? (
            <GraphCanvas
              subgraph={filteredSubgraph}
              selectedNodeId={selectedNodeId}
              onNodeSelect={setSelectedNodeId}
              resetVersion={resetVersion}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}
