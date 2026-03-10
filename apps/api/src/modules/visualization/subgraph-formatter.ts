import { isInt } from "neo4j-driver";
import type {
  Confidence,
  DailyUpdateEventType,
  NodeType,
  Provenance,
  RelationshipType,
  VisualizationConfidenceSummary,
  VisualizationEdge,
  VisualizationEdgeMetadata,
  VisualizationNode,
  VisualizationNodeMetadata,
  VisualizationRecentUpdateSummary,
  VisualizationSubgraphKind,
  VisualizationSubgraphResponse,
} from "@shared-types";

export interface RawSubgraphNode {
  id: string;
  type: NodeType;
  displayLabel?: string;
  properties: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface RawSubgraphEdge {
  id: string;
  type: RelationshipType;
  source: string;
  target: string;
  properties: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface RawRecentUpdate {
  eventId: string;
  eventType: DailyUpdateEventType;
  summary: string;
  occurredAt: string;
  actorId: string;
  connectedNodeIds: string[];
  confidenceJson?: string;
  provenanceJson?: string;
}

export function formatVisualizationSubgraph(input: {
  kind: VisualizationSubgraphKind;
  nodes: RawSubgraphNode[];
  edges: RawSubgraphEdge[];
  recentUpdates: RawRecentUpdate[];
  generatedAt?: string;
  focusNodeId?: string;
  depth?: number;
  recentWindowDays?: number;
}): VisualizationSubgraphResponse {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const recentWindowDays = input.recentWindowDays ?? 14;
  const recentWindowStart = new Date(Date.parse(generatedAt) - recentWindowDays * 24 * 60 * 60 * 1000).toISOString();
  const normalizedNodes = input.nodes.map(normalizeNode);
  const normalizedEdges = input.edges.map(normalizeEdge);
  const recentUpdates = input.recentUpdates.map(normalizeRecentUpdate);
  const incomingCounts = new Map<string, number>();
  const outgoingCounts = new Map<string, number>();
  const updateIdsByNode = new Map<string, string[]>();

  for (const edge of normalizedEdges) {
    outgoingCounts.set(edge.source, (outgoingCounts.get(edge.source) ?? 0) + 1);
    incomingCounts.set(edge.target, (incomingCounts.get(edge.target) ?? 0) + 1);
  }

  for (const update of recentUpdates) {
    for (const nodeId of update.connectedNodeIds) {
      const ids = updateIdsByNode.get(nodeId) ?? [];
      ids.push(update.eventId);
      updateIdsByNode.set(nodeId, ids);
    }
  }

  const nodes: VisualizationNode[] = normalizedNodes.map((node) => ({
    id: node.id,
    type: node.type,
    label: buildNodeLabel(node.type, node.properties, node.displayLabel),
    secondaryLabel: buildNodeSecondaryLabel(node.type, node.properties),
    group: node.type,
  }));

  const edges: VisualizationEdge[] = normalizedEdges.map((edge) => ({
    id: edge.id,
    type: edge.type,
    source: edge.source,
    target: edge.target,
    label: edge.type,
    directed: true,
  }));

  const nodeMetadata = Object.fromEntries(
    normalizedNodes.map((node) => {
      const incomingEdges = incomingCounts.get(node.id) ?? 0;
      const outgoingEdges = outgoingCounts.get(node.id) ?? 0;
      const recentUpdateIds = updateIdsByNode.get(node.id) ?? [];
      const metadata: VisualizationNodeMetadata = {
        nodeId: node.id,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
        degree: incomingEdges + outgoingEdges,
        incomingEdges,
        outgoingEdges,
        recentUpdateCount: recentUpdateIds.length,
        recentUpdateIds,
        status: readStringProperty(node.properties, "status"),
        severity: readStringProperty(node.properties, "severity"),
        category: readStringProperty(node.properties, "category"),
        provenance: parseJsonObject<Provenance>(node.properties.provenanceJson),
        confidence: parseJsonObject<Confidence>(node.properties.confidenceJson),
        rawProperties: stripJsonFields(node.properties),
      };

      return [node.id, metadata];
    })
  );

  const edgeMetadata = Object.fromEntries(
    normalizedEdges.map((edge) => {
      const confidence = parseEdgeConfidence(edge.properties);
      const metadata: VisualizationEdgeMetadata = {
        edgeId: edge.id,
        createdAt: edge.createdAt,
        updatedAt: edge.updatedAt,
        active: readBooleanProperty(edge.properties, "active"),
        temporary: readBooleanProperty(edge.properties, "temporary"),
        category: readStringProperty(edge.properties, "category"),
        observationCount: readNumberProperty(edge.properties, "observationCount"),
        validFrom: readNullableStringProperty(edge.properties, "validFrom"),
        validTo: readNullableStringProperty(edge.properties, "validTo"),
        sourceEventIds: parseJsonArray(edge.properties.sourceEventIdsJson),
        supportingChunkIds: parseJsonArray(edge.properties.supportingChunkIdsJson),
        provenance: parseJsonObject<Provenance>(edge.properties.provenanceJson),
        confidence,
        rawProperties: stripJsonFields(edge.properties),
      };

      return [edge.id, metadata];
    })
  );

  const timestamps = {
    generatedAt,
    recentWindowStart,
    newestNodeUpdateAt: newestIsoTimestamp(normalizedNodes.map((node) => node.updatedAt)),
    newestEdgeUpdateAt: newestIsoTimestamp(normalizedEdges.map((edge) => edge.updatedAt)),
    newestActivityAt: newestIsoTimestamp([
      ...normalizedNodes.map((node) => node.updatedAt),
      ...normalizedEdges.map((edge) => edge.updatedAt),
      ...recentUpdates.map((update) => update.occurredAt),
    ]),
  };

  return {
    kind: input.kind,
    focusNodeId: input.focusNodeId,
    depth: input.depth,
    nodes,
    edges,
    nodeMetadata,
    edgeMetadata,
    timestamps,
    confidence: {
      nodes: summarizeConfidence(Object.values(nodeMetadata).map((metadata) => metadata.confidence)),
      edges: summarizeConfidence(Object.values(edgeMetadata).map((metadata) => metadata.confidence)),
      updates: summarizeConfidence(recentUpdates.map((update) => update.confidence)),
    },
    recentUpdateSummaries: recentUpdates,
  };
}

function normalizeNode(node: RawSubgraphNode): RawSubgraphNode {
  return {
    ...node,
    properties: normalizeValue(node.properties),
  };
}

function normalizeEdge(edge: RawSubgraphEdge): RawSubgraphEdge {
  return {
    ...edge,
    properties: normalizeValue(edge.properties),
  };
}

function normalizeRecentUpdate(update: RawRecentUpdate): VisualizationRecentUpdateSummary {
  return {
    eventId: update.eventId,
    eventType: update.eventType,
    summary: update.summary,
    occurredAt: update.occurredAt,
    actorId: update.actorId,
    connectedNodeIds: normalizeValue(update.connectedNodeIds),
    confidence: parseJsonObject<Confidence>(update.confidenceJson),
    provenance: parseJsonObject<Provenance>(update.provenanceJson),
  };
}

function normalizeValue<T>(value: T): T {
  if (isInt(value)) {
    return value.toNumber() as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, normalizeValue(entryValue)])
    ) as T;
  }

  return value;
}

function buildNodeLabel(type: NodeType, properties: Record<string, unknown>, displayLabel?: string): string {
  const labelCandidates: Partial<Record<NodeType, string | undefined>> = {
    Person: readStringProperty(properties, "fullName"),
    Team: readStringProperty(properties, "name"),
    Project: readStringProperty(properties, "name"),
    Task: readStringProperty(properties, "title"),
    Blocker: readStringProperty(properties, "title"),
    Skill: readStringProperty(properties, "name"),
    Meeting: readStringProperty(properties, "title"),
    TranscriptChunk: readStringProperty(properties, "transcriptId"),
    UpdateEvent: readStringProperty(properties, "summary"),
  };

  return labelCandidates[type] ?? displayLabel ?? type;
}

function buildNodeSecondaryLabel(type: NodeType, properties: Record<string, unknown>): string | undefined {
  const secondaryLabelCandidates: Partial<Record<NodeType, string | undefined>> = {
    Person: readStringProperty(properties, "title"),
    Team: readStringProperty(properties, "department"),
    Project: readStringProperty(properties, "status"),
    Task: readStringProperty(properties, "status"),
    Blocker: readStringProperty(properties, "severity"),
    Skill: readStringProperty(properties, "category"),
    Meeting: readStringProperty(properties, "startedAt"),
    TranscriptChunk: readStringProperty(properties, "speakerId"),
    UpdateEvent: readStringProperty(properties, "eventType"),
  };

  return secondaryLabelCandidates[type];
}

function parseEdgeConfidence(properties: Record<string, unknown>): Confidence | undefined {
  const embeddedConfidence = parseJsonObject<Confidence>(properties.confidenceJson);
  if (embeddedConfidence) {
    return embeddedConfidence;
  }

  const score = readNumberProperty(properties, "confidence");
  if (score === undefined) {
    return undefined;
  }

  return {
    score,
    method: "rule",
    evaluatedAt: readStringProperty(properties, "materializedAt") ?? new Date().toISOString(),
    rationale: readStringProperty(properties, "appliedRuleId"),
  };
}

function summarizeConfidence(values: Array<Confidence | undefined>): VisualizationConfidenceSummary {
  const scores = values
    .map((value) => value?.score)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (scores.length === 0) {
    return {
      average: null,
      minimum: null,
      maximum: null,
      samples: 0,
    };
  }

  const sum = scores.reduce((total, score) => total + score, 0);

  return {
    average: Number((sum / scores.length).toFixed(4)),
    minimum: Math.min(...scores),
    maximum: Math.max(...scores),
    samples: scores.length,
  };
}

function newestIsoTimestamp(values: Array<string | undefined>): string | null {
  const timestamps = values.filter((value): value is string => typeof value === "string" && value.length > 0);
  if (timestamps.length === 0) {
    return null;
  }

  return timestamps.reduce((latest, current) => (current > latest ? current : latest));
}

function parseJsonObject<T>(value: unknown): T | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function parseJsonArray(value: unknown): string[] | undefined {
  const parsed = parseJsonObject<unknown>(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : undefined;
}

function stripJsonFields(properties: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(properties).filter(([key]) => !key.endsWith("Json")));
}

function readStringProperty(properties: Record<string, unknown>, key: string): string | undefined {
  return typeof properties[key] === "string" ? (properties[key] as string) : undefined;
}

function readNullableStringProperty(properties: Record<string, unknown>, key: string): string | null | undefined {
  const value = properties[key];
  if (value === null) {
    return null;
  }

  return typeof value === "string" ? value : undefined;
}

function readBooleanProperty(properties: Record<string, unknown>, key: string): boolean | undefined {
  return typeof properties[key] === "boolean" ? (properties[key] as boolean) : undefined;
}

function readNumberProperty(properties: Record<string, unknown>, key: string): number | undefined {
  return typeof properties[key] === "number" ? (properties[key] as number) : undefined;
}
