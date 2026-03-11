"use client";

import { useMemo, type Dispatch, type SetStateAction } from "react";
import ReactFlow, { Background, Panel, type NodeMouseHandler } from "reactflow";
import type { VisualizationSubgraphResponse } from "@shared-types";
import { mapSubgraphToGraphElements } from "./graph-adapter";
import { ENTITY_STYLES, ENTITY_TYPE_LABELS, ENTITY_TYPE_ORDER } from "./constants";
import type { SelectedGraphNode } from "./NodeDetailsPanel";

interface GraphCanvasProps {
  subgraph: VisualizationSubgraphResponse;
  selectedNodeId?: string;
  onNodeSelect: Dispatch<SetStateAction<string | undefined>>;
}

export function GraphCanvas({ subgraph, selectedNodeId, onNodeSelect }: GraphCanvasProps) {
  const { nodes, edges } = useMemo(() => mapSubgraphToGraphElements(subgraph), [subgraph]);

  const selectedNode = useMemo<SelectedGraphNode | undefined>(() => {
    if (!selectedNodeId) {
      return undefined;
    }

    const node = subgraph.nodes.find((candidate) => candidate.id === selectedNodeId);

    if (!node) {
      return undefined;
    }

    return {
      node,
      metadata: subgraph.nodeMetadata[node.id],
    };
  }, [selectedNodeId, subgraph]);

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
        <NodeSummaryPanel selectedNode={selectedNode} />
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
    </div>
  );
}

function NodeSummaryPanel({ selectedNode }: { selectedNode?: SelectedGraphNode }) {
  if (!selectedNode) {
    return (
      <div className="details-card details-card-empty">
        <h2>Node Details</h2>
        <p>Click a node in the graph to inspect its metadata and recent activity.</p>
      </div>
    );
  }

  const { node, metadata } = selectedNode;

  return (
    <div className="details-card">
      <div className="details-badge">{ENTITY_TYPE_LABELS[node.type]}</div>
      <h2>{node.label}</h2>
      {node.secondaryLabel ? <p className="details-secondary">{node.secondaryLabel}</p> : null}
      <dl className="details-list">
        <div>
          <dt>Node ID</dt>
          <dd>{node.id}</dd>
        </div>
        <div>
          <dt>Degree</dt>
          <dd>{metadata?.degree ?? 0}</dd>
        </div>
        <div>
          <dt>Incoming</dt>
          <dd>{metadata?.incomingEdges ?? 0}</dd>
        </div>
        <div>
          <dt>Outgoing</dt>
          <dd>{metadata?.outgoingEdges ?? 0}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{metadata?.status ?? "N/A"}</dd>
        </div>
        <div>
          <dt>Recent updates</dt>
          <dd>{metadata?.recentUpdateCount ?? 0}</dd>
        </div>
      </dl>
    </div>
  );
}
