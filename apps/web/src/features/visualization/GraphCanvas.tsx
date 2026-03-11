"use client";

import { useMemo, type Dispatch, type SetStateAction } from "react";
import ReactFlow, { Background, Panel, type NodeMouseHandler } from "reactflow";
import type { VisualizationSubgraphResponse } from "@shared-types";
import { mapSubgraphToGraphElements, type GraphTemporalContext } from "./graph-adapter";
import { ENTITY_STYLES, ENTITY_TYPE_LABELS, ENTITY_TYPE_ORDER } from "./constants";
import { NodeDetailsPanel } from "./NodeDetailsPanel";

interface GraphCanvasProps {
  subgraph: VisualizationSubgraphResponse;
  selectedNodeId?: string;
  onNodeSelect: Dispatch<SetStateAction<string | undefined>>;
  resetVersion: number;
  temporalContext?: GraphTemporalContext;
}

export function GraphCanvas({
  subgraph,
  selectedNodeId,
  onNodeSelect,
  resetVersion,
  temporalContext,
}: GraphCanvasProps) {
  const { nodes, edges } = useMemo(
    () => mapSubgraphToGraphElements(subgraph, temporalContext),
    [subgraph, temporalContext]
  );

  const visibleNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        selected: node.id === selectedNodeId,
      })),
    [nodes, selectedNodeId]
  );

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    onNodeSelect(node.id);
  };

  return (
    <div className="visualization-frame">
      <div className="visualization-canvas">
        <ReactFlow
          key={`graph-view-${resetVersion}`}
          nodes={visibleNodes}
          edges={edges}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          fitView
          fitViewOptions={{ padding: 0.18 }}
          minZoom={0.35}
          maxZoom={1.75}
          onNodeClick={handleNodeClick}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#cbd5e1" gap={28} size={1.2} />
          <Panel position="top-left">
            <GraphLegend />
          </Panel>
        </ReactFlow>
      </div>
      <aside className="visualization-sidebar">
        <NodeDetailsPanel
          subgraph={subgraph}
          selectedNodeId={selectedNodeId}
          onNodeSelect={onNodeSelect}
        />
      </aside>
    </div>
  );
}

function GraphLegend() {
  return (
    <div className="legend-card">
      <h2>Entity Types</h2>
      <div className="legend-items">
        {ENTITY_TYPE_ORDER.map((nodeType) => {
          const style = ENTITY_STYLES[nodeType];

          return (
            <div key={nodeType} className="legend-item">
              <span
                className="legend-swatch"
                style={{
                  background: style.background,
                  borderColor: style.border,
                }}
              />
              <span>{ENTITY_TYPE_LABELS[nodeType]}</span>
            </div>
          );
        })}
      </div>
      <div className="legend-divider" />
      <div className="legend-recency">
        <div className="legend-item">
          <span className="legend-line legend-line-recent" />
          <span>Recent activity</span>
        </div>
        <div className="legend-item">
          <span className="legend-line legend-line-stale" />
          <span>Stale activity</span>
        </div>
      </div>
    </div>
  );
}
