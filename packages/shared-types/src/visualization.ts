import type {
  Confidence,
  DailyUpdateEventType,
  GraphDecorators,
  NodeType,
  RelationshipType,
  Provenance,
} from "./ontology.js";

export type VisualizationSubgraphKind =
  | "company_overview"
  | "team"
  | "project"
  | "person_ego_network"
  | "blocker_focus";

export interface VisualizationNode {
  id: string;
  type: NodeType;
  label: string;
  secondaryLabel?: string;
  group: NodeType;
}

export interface VisualizationEdge {
  id: string;
  type: RelationshipType;
  source: string;
  target: string;
  label: string;
  directed: true;
}

export interface VisualizationNodeMetadata extends GraphDecorators {
  nodeId: string;
  createdAt?: string;
  updatedAt?: string;
  degree: number;
  incomingEdges: number;
  outgoingEdges: number;
  recentUpdateCount: number;
  recentUpdateIds: string[];
  status?: string;
  severity?: string;
  category?: string;
  rawProperties: Record<string, unknown>;
}

export interface VisualizationEdgeMetadata extends GraphDecorators {
  edgeId: string;
  createdAt?: string;
  updatedAt?: string;
  active?: boolean;
  temporary?: boolean;
  category?: string;
  observationCount?: number;
  validFrom?: string | null;
  validTo?: string | null;
  sourceEventIds?: string[];
  supportingChunkIds?: string[];
  rawProperties: Record<string, unknown>;
}

export interface VisualizationRecentUpdateSummary {
  eventId: string;
  eventType: DailyUpdateEventType;
  summary: string;
  occurredAt: string;
  actorId: string;
  connectedNodeIds: string[];
  provenance?: Provenance;
  confidence?: Confidence;
}

export interface VisualizationConfidenceSummary {
  average: number | null;
  minimum: number | null;
  maximum: number | null;
  samples: number;
}

export interface VisualizationTimestampSummary {
  generatedAt: string;
  recentWindowStart: string;
  newestNodeUpdateAt: string | null;
  newestEdgeUpdateAt: string | null;
  newestActivityAt: string | null;
}

export interface VisualizationSubgraphResponse {
  kind: VisualizationSubgraphKind;
  focusNodeId?: string;
  depth?: number;
  nodes: VisualizationNode[];
  edges: VisualizationEdge[];
  nodeMetadata: Record<string, VisualizationNodeMetadata>;
  edgeMetadata: Record<string, VisualizationEdgeMetadata>;
  timestamps: VisualizationTimestampSummary;
  confidence: {
    nodes: VisualizationConfidenceSummary;
    edges: VisualizationConfidenceSummary;
    updates: VisualizationConfidenceSummary;
  };
  recentUpdateSummaries: VisualizationRecentUpdateSummary[];
}
