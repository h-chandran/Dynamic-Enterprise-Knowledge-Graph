"use client";

import type { Dispatch, SetStateAction } from "react";
import type { NodeType, RelationshipType } from "@shared-types";
import {
  ENTITY_STYLES,
  ENTITY_TYPE_LABELS,
  ENTITY_TYPE_ORDER,
  RELATIONSHIP_TYPE_LABELS,
  RELATIONSHIP_TYPE_ORDER,
} from "./constants";
import type { GraphFilterState } from "./graph-filters";

interface GraphControlsProps {
  filters: GraphFilterState;
  availableNodeTypes: NodeType[];
  availableEdgeTypes: RelationshipType[];
  setFilters: Dispatch<SetStateAction<GraphFilterState>>;
  onReset: () => void;
  isUpdating: boolean;
}

export function GraphControls({
  filters,
  availableNodeTypes,
  availableEdgeTypes,
  setFilters,
  onReset,
  isUpdating,
}: GraphControlsProps) {
  const orderedNodeTypes = [
    ...ENTITY_TYPE_ORDER.filter((type) => availableNodeTypes.includes(type)),
    ...availableNodeTypes.filter((type) => !ENTITY_TYPE_ORDER.includes(type)),
  ];
  const orderedEdgeTypes = [
    ...RELATIONSHIP_TYPE_ORDER.filter((type) => availableEdgeTypes.includes(type)),
    ...availableEdgeTypes.filter((type) => !RELATIONSHIP_TYPE_ORDER.includes(type)),
  ];

  return (
    <section className="control-card">
      <div className="control-card-header">
        <div>
          <p className="control-eyebrow">Interactive controls</p>
          <h2>Explore the subgraph</h2>
        </div>
        <button type="button" className="reset-button" onClick={onReset}>
          Reset to default view
        </button>
      </div>

      <div className="control-grid">
        <div className="control-group">
          <h3>Node types</h3>
          <div className="control-pills">
            {orderedNodeTypes.map((nodeType) => {
              const isActive = filters.nodeTypes.includes(nodeType);
              const style = ENTITY_STYLES[nodeType];

              return (
                <button
                  key={nodeType}
                  type="button"
                  className={`filter-pill${isActive ? " filter-pill-active" : ""}`}
                  onClick={() =>
                    setFilters((current) => ({
                      ...current,
                      nodeTypes: toggleValue(current.nodeTypes, nodeType),
                    }))
                  }
                  style={
                    isActive
                      ? {
                          background: style.background,
                          borderColor: style.border,
                          color: style.text,
                        }
                      : undefined
                  }
                >
                  {ENTITY_TYPE_LABELS[nodeType]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="control-group">
          <h3>Edge types</h3>
          <div className="control-pills">
            {orderedEdgeTypes.map((edgeType) => {
              const isActive = filters.edgeTypes.includes(edgeType);

              return (
                <button
                  key={edgeType}
                  type="button"
                  className={`filter-pill${isActive ? " filter-pill-active" : ""}`}
                  onClick={() =>
                    setFilters((current) => ({
                      ...current,
                      edgeTypes: toggleValue(current.edgeTypes, edgeType),
                    }))
                  }
                >
                  {RELATIONSHIP_TYPE_LABELS[edgeType]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="control-group">
          <h3>Link groups</h3>
          <div className="control-switches">
            <button
              type="button"
              className={`switch-pill${filters.showBlockers ? " switch-pill-active" : ""}`}
              onClick={() =>
                setFilters((current) => ({
                  ...current,
                  showBlockers: !current.showBlockers,
                }))
              }
            >
              Blockers
            </button>
            <button
              type="button"
              className={`switch-pill${filters.showDependencies ? " switch-pill-active" : ""}`}
              onClick={() =>
                setFilters((current) => ({
                  ...current,
                  showDependencies: !current.showDependencies,
                }))
              }
            >
              Dependencies
            </button>
            <button
              type="button"
              className={`switch-pill${filters.showCollaboration ? " switch-pill-active" : ""}`}
              onClick={() =>
                setFilters((current) => ({
                  ...current,
                  showCollaboration: !current.showCollaboration,
                }))
              }
            >
              Collaboration
            </button>
          </div>
          <p className="control-hint">
            Recent nodes keep a stronger outline. Stale nodes fade and switch to dashed borders.
            {isUpdating ? " Updating graph..." : ""}
          </p>
        </div>
      </div>
    </section>
  );
}

function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((candidate) => candidate !== value) : [...values, value];
}
