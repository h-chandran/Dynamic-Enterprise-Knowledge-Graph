"use client";

import { useMemo, type Dispatch, type SetStateAction } from "react";
import type {
  NodeType,
  Provenance,
  VisualizationNode,
  VisualizationNodeMetadata,
  VisualizationSubgraphResponse,
} from "@shared-types";
import { ENTITY_STYLES, ENTITY_TYPE_LABELS } from "./constants";

interface NodeDetailsPanelProps {
  subgraph: VisualizationSubgraphResponse;
  selectedNodeId?: string;
  onNodeSelect: Dispatch<SetStateAction<string | undefined>>;
}

interface SelectedGraphNode {
  node: VisualizationNode;
  metadata?: VisualizationNodeMetadata;
}

interface RelatedEntity {
  id: string;
  label: string;
  type: NodeType;
  relationship: string;
  direction: "incoming" | "outgoing";
}

export function NodeDetailsPanel({
  subgraph,
  selectedNodeId,
  onNodeSelect,
}: NodeDetailsPanelProps) {
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

  const relatedEntities = useMemo(() => {
    if (!selectedNode) {
      return [];
    }

    return collectRelatedEntities(subgraph, selectedNode.node.id);
  }, [selectedNode, subgraph]);

  const recentUpdates = useMemo(() => {
    if (!selectedNode) {
      return [];
    }

    return subgraph.recentUpdateSummaries
      .filter((update) => update.connectedNodeIds.includes(selectedNode.node.id))
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, 5);
  }, [selectedNode, subgraph.recentUpdateSummaries]);

  if (!selectedNode) {
    return (
      <div className="details-card details-card-empty">
        <h2>Node Details</h2>
        <p>Click a node in the graph to open its side panel and inspect related entities and updates.</p>
      </div>
    );
  }

  const { node, metadata } = selectedNode;
  const style = ENTITY_STYLES[node.type];
  const keyFacts = buildKeyFacts(node.type, metadata);

  return (
    <div className="details-card details-card-rich">
      <div
        className="details-type-bar"
        style={{
          background: style.accent,
        }}
      />
      <div className="details-header">
        <div className="details-badge" style={{ background: style.background, color: style.text }}>
          {ENTITY_TYPE_LABELS[node.type]}
        </div>
        <h2>{node.label}</h2>
        <p className="details-secondary">
          {node.secondaryLabel ?? `${ENTITY_TYPE_LABELS[node.type]} entity in the company overview graph.`}
        </p>
      </div>

      <section className="details-section">
        <div className="details-section-heading">
          <h3>Canonical View</h3>
          <span>{node.id}</span>
        </div>
        <div className="details-highlight-grid">
          <DetailHighlight label="Canonical name" value={node.label} />
          <DetailHighlight label="Node type" value={node.type} />
          <DetailHighlight label="Status" value={metadata?.status ?? "N/A"} />
          <DetailHighlight label="Recent updates" value={String(metadata?.recentUpdateCount ?? 0)} />
        </div>
      </section>

      <section className="details-section">
        <div className="details-section-heading">
          <h3>{ENTITY_TYPE_LABELS[node.type]} details</h3>
          <span>{keyFacts.length} fields</span>
        </div>
        <dl className="details-kv-grid">
          {keyFacts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="details-section">
        <div className="details-section-heading">
          <h3>Metadata</h3>
          <span>Graph summary</span>
        </div>
        <dl className="details-kv-grid">
          <div>
            <dt>Degree</dt>
            <dd>{metadata?.degree ?? 0}</dd>
          </div>
          <div>
            <dt>Incoming edges</dt>
            <dd>{metadata?.incomingEdges ?? 0}</dd>
          </div>
          <div>
            <dt>Outgoing edges</dt>
            <dd>{metadata?.outgoingEdges ?? 0}</dd>
          </div>
          <div>
            <dt>Severity</dt>
            <dd>{metadata?.severity ?? "N/A"}</dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>{metadata?.category ?? "N/A"}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatDateTime(metadata?.updatedAt)}</dd>
          </div>
        </dl>
      </section>

      <section className="details-section">
        <div className="details-section-heading">
          <h3>Related entities</h3>
          <span>{relatedEntities.length} connected</span>
        </div>
        {relatedEntities.length === 0 ? (
          <p className="details-empty-copy">No related entities are visible in the current subgraph.</p>
        ) : (
          <div className="details-chip-list">
            {relatedEntities.map((entity) => (
              <button
                key={`${entity.relationship}-${entity.id}`}
                type="button"
                className="details-chip"
                onClick={() => onNodeSelect(entity.id)}
              >
                <strong>{entity.label}</strong>
                <span>
                  {entity.direction === "outgoing" ? "Out" : "In"} | {entity.relationship} | {entity.type}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="details-section">
        <div className="details-section-heading">
          <h3>Recent updates</h3>
          <span>{recentUpdates.length} shown</span>
        </div>
        {recentUpdates.length === 0 ? (
          <p className="details-empty-copy">No recent update events are linked to this node.</p>
        ) : (
          <div className="details-updates">
            {recentUpdates.map((update) => (
              <article key={update.eventId} className="details-update-card">
                <div className="details-update-meta">
                  <strong>{humanizeEventType(update.eventType)}</strong>
                  <span>{formatDateTime(update.occurredAt)}</span>
                </div>
                <p>{update.summary}</p>
                <span className="details-update-actor">Actor: {update.actorId}</span>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="details-section">
        <div className="details-section-heading">
          <h3>Confidence and provenance</h3>
          <span>Data quality</span>
        </div>
        <div className="details-highlight-grid">
          <DetailHighlight
            label="Confidence score"
            value={formatConfidence(metadata?.confidence?.score)}
          />
          <DetailHighlight label="Confidence method" value={metadata?.confidence?.method ?? "N/A"} />
          <DetailHighlight
            label="Evaluated"
            value={formatDateTime(metadata?.confidence?.evaluatedAt)}
          />
          <DetailHighlight
            label="Evidence"
            value={formatEvidenceCount(metadata?.provenance)}
          />
        </div>
        <dl className="details-kv-grid details-kv-grid-compact">
          <div>
            <dt>Source system</dt>
            <dd>{metadata?.provenance?.sourceSystem ?? "N/A"}</dd>
          </div>
          <div>
            <dt>Asserted by</dt>
            <dd>{metadata?.provenance?.assertedBy ?? "N/A"}</dd>
          </div>
          <div>
            <dt>Asserted at</dt>
            <dd>{formatDateTime(metadata?.provenance?.assertedAt)}</dd>
          </div>
          <div>
            <dt>Trace ID</dt>
            <dd>{metadata?.provenance?.traceId ?? "N/A"}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

function DetailHighlight({ label, value }: { label: string; value: string }) {
  return (
    <div className="details-highlight">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function buildKeyFacts(nodeType: NodeType, metadata?: VisualizationNodeMetadata) {
  const raw = metadata?.rawProperties ?? {};

  const factSets: Record<NodeType, Array<{ label: string; value: string }>> = {
    Person: [
      { label: "Full name", value: readString(raw.fullName, "N/A") },
      { label: "Title", value: readString(raw.title, "N/A") },
      { label: "Email", value: readString(raw.email, "N/A") },
      { label: "Employee ID", value: readString(raw.employeeId, "N/A") },
      { label: "Timezone", value: readString(raw.timezone, "N/A") },
    ],
    Team: [
      { label: "Team name", value: readString(raw.name, "N/A") },
      { label: "Department", value: readString(raw.department, "N/A") },
      { label: "Status", value: readString(raw.status, "N/A") },
    ],
    Project: [
      { label: "Project name", value: readString(raw.name, "N/A") },
      { label: "Status", value: readString(raw.status, "N/A") },
      { label: "Target date", value: readString(raw.targetDate, "N/A") },
    ],
    Task: [
      { label: "Task title", value: readString(raw.title, "N/A") },
      { label: "Status", value: readString(raw.status, "N/A") },
      { label: "Due date", value: readString(raw.dueDate, "N/A") },
    ],
    Blocker: [
      { label: "Blocker title", value: readString(raw.title, "N/A") },
      { label: "Status", value: readString(raw.status, "N/A") },
      { label: "Severity", value: readString(raw.severity, "N/A") },
    ],
    Skill: [
      { label: "Skill name", value: readString(raw.name, "N/A") },
      { label: "Category", value: readString(raw.category, "N/A") },
    ],
    Meeting: [{ label: "Meeting title", value: readString(raw.title, "N/A") }],
    TranscriptChunk: [{ label: "Transcript ID", value: readString(raw.transcriptId, "N/A") }],
    UpdateEvent: [{ label: "Summary", value: readString(raw.summary, "N/A") }],
  };

  return factSets[nodeType];
}

function collectRelatedEntities(
  subgraph: VisualizationSubgraphResponse,
  selectedNodeId: string
): RelatedEntity[] {
  const nodeIndex = new Map(subgraph.nodes.map((node) => [node.id, node]));

  return subgraph.edges
    .flatMap((edge) => {
      if (edge.source !== selectedNodeId && edge.target !== selectedNodeId) {
        return [];
      }

      const isOutgoing = edge.source === selectedNodeId;
      const relatedNodeId = isOutgoing ? edge.target : edge.source;
      const relatedNode = nodeIndex.get(relatedNodeId);

      if (!relatedNode) {
        return [];
      }

      return [
        {
          id: relatedNode.id,
          label: relatedNode.label,
          type: relatedNode.type,
          relationship: edge.type,
          direction: isOutgoing ? "outgoing" : "incoming",
        } satisfies RelatedEntity,
      ];
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

function humanizeEventType(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDateTime(value?: string): string {
  if (!value) {
    return "N/A";
  }

  return new Date(value).toLocaleString();
}

function formatConfidence(value?: number): string {
  if (typeof value !== "number") {
    return "N/A";
  }

  return `${Math.round(value * 100)}%`;
}

function formatEvidenceCount(provenance?: Provenance): string {
  const count = provenance?.evidence?.length ?? 0;
  return count === 0 ? "No evidence attached" : `${count} evidence item${count === 1 ? "" : "s"}`;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

