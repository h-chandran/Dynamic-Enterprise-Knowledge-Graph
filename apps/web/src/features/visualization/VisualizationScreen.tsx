"use client";

import { useEffect, useMemo, useState } from "react";
import "reactflow/dist/style.css";
import type { VisualizationSubgraphResponse } from "@shared-types";
import { fetchCompanyOverviewSubgraph } from "./api";
import { GraphCanvas } from "./GraphCanvas";

interface VisualizationScreenProps {
  appName: string;
}

export function VisualizationScreen({ appName }: VisualizationScreenProps) {
  const [subgraph, setSubgraph] = useState<VisualizationSubgraphResponse | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const abortController = new AbortController();

    setIsLoading(true);
    setError(undefined);

    fetchCompanyOverviewSubgraph(abortController.signal)
      .then((response) => {
        setSubgraph(response);
        setSelectedNodeId(response.focusNodeId ?? response.nodes[0]?.id);
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
        <GraphCanvas
          subgraph={subgraph}
          selectedNodeId={selectedNodeId}
          onNodeSelect={setSelectedNodeId}
        />
      ) : null}
    </section>
  );
}
