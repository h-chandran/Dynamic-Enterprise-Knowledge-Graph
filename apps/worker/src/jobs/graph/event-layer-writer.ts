import type { Confidence, Provenance, UpdateEventNodeProperties } from "@shared-types";
import type { CanonicalEntityRecord, GraphWriteResolutionResult, ResolvedRelationshipWrite, ResolvedUpdateEventWrite } from "./entity-resolution.js";

export interface GraphWriteSession {
  run(cypher: string, params?: Record<string, unknown>): Promise<unknown>;
}

export interface EventLayerWriteInput {
  extraction: import("@shared-types").TranscriptExtractionOutput;
  resolution: GraphWriteResolutionResult;
  canonicalEntities?: CanonicalEntityRecord[];
  meetingId?: string;
  now?: () => string;
}

export interface UpdateEventNodeWriteModel {
  id: string;
  properties: UpdateEventNodeProperties;
  provenance: Provenance;
  confidence: Confidence;
  createdAt: string;
  updatedAt: string;
}

export interface EventSupportLink {
  chunkId: string;
  evidenceSpanIds: string[];
}

export interface EventAssertionLink {
  targetNodeId: string;
  assertionKind: "entity" | "relationship_endpoint";
  targetType: "entity" | "relationship";
  relationshipId?: string;
  relationshipType?: string;
  endpointRole?: "from" | "to";
  counterpartNodeId?: string;
  metadata: Record<string, unknown>;
}

export interface EventLayerWriteSummary {
  eventsWritten: number;
  supportLinksWritten: number;
  entityAssertionLinksWritten: number;
  relationshipAssertionLinksWritten: number;
  skippedBlockedEvents: number;
}

const mergeUpdateEventCypher = `
  MERGE (event:UpdateEvent {id: $id})
  ON CREATE SET event.createdAt = $createdAt
  SET event.updatedAt = $updatedAt,
      event.displayLabel = 'UpdateEvent',
      event.nodeLabel = 'UpdateEvent'
  SET event += $properties
  RETURN event.id AS id
`;

const mergeSupportLinkCypher = `
  MATCH (chunk:TranscriptChunk {id: $chunkId})
  MATCH (event:UpdateEvent {id: $eventId})
  MERGE (chunk)-[support:SUPPORTS]->(event)
  ON CREATE SET support.createdAt = $createdAt
  SET support.updatedAt = $updatedAt,
      support.supportType = 'update_event_evidence',
      support.eventId = $eventId,
      support.chunkId = $chunkId,
      support.evidenceSpanIdsJson = $evidenceSpanIdsJson
  RETURN chunk.id AS chunkId
`;

const mergeAssertionLinkCypher = `
  MATCH (event:UpdateEvent {id: $eventId})
  MATCH (target {id: $targetNodeId})
  MERGE (event)-[assertion:ASSERTED {assertionKey: $assertionKey}]->(target)
  ON CREATE SET assertion.createdAt = $createdAt
  SET assertion.updatedAt = $updatedAt,
      assertion.targetType = $targetType,
      assertion.assertionKind = $assertionKind,
      assertion.relationshipId = $relationshipId,
      assertion.relationshipType = $relationshipType,
      assertion.endpointRole = $endpointRole,
      assertion.counterpartNodeId = $counterpartNodeId,
      assertion.metadataJson = $metadataJson
  RETURN target.id AS targetId
`;

export async function writeResolvedUpdateEvents(session: GraphWriteSession, input: EventLayerWriteInput): Promise<EventLayerWriteSummary> {
  const now = input.now ?? (() => new Date().toISOString());
  const evidenceSpanIndex = new Map(input.extraction.evidenceSpans.map((span) => [span.spanId, span]));
  let eventsWritten = 0;
  let supportLinksWritten = 0;
  let entityAssertionLinksWritten = 0;
  let relationshipAssertionLinksWritten = 0;

  for (const resolvedEvent of input.resolution.updateEventsReady) {
    const eventNode = buildUpdateEventNodeWriteModel({
      resolvedEvent,
      extraction: input.extraction,
      resolution: input.resolution,
      canonicalEntities: input.canonicalEntities ?? [],
      meetingId: input.meetingId,
      now: now(),
    });

    await createOrMergeUpdateEventNode(session, eventNode);
    eventsWritten += 1;

    const supportLinks = buildEventSupportLinks(resolvedEvent, evidenceSpanIndex);
    for (const supportLink of supportLinks) {
      await createOrMergeEventSupportLink(session, {
        eventId: resolvedEvent.updateEvent.eventId,
        supportLink,
        timestamp: eventNode.updatedAt,
      });
      supportLinksWritten += 1;
    }

    const assertionLinks = buildEventAssertionLinks({
      resolvedEvent,
      relationshipsReady: input.resolution.relationshipsReady,
    });

    for (const assertionLink of assertionLinks) {
      await createOrMergeEventAssertionLink(session, {
        eventId: resolvedEvent.updateEvent.eventId,
        assertionLink,
        timestamp: eventNode.updatedAt,
      });
      if (assertionLink.assertionKind === "entity") {
        entityAssertionLinksWritten += 1;
      } else {
        relationshipAssertionLinksWritten += 1;
      }
    }
  }

  return {
    eventsWritten,
    supportLinksWritten,
    entityAssertionLinksWritten,
    relationshipAssertionLinksWritten,
    skippedBlockedEvents: input.resolution.blockedUpdateEvents.length,
  };
}

export function buildUpdateEventNodeWriteModel(input: {
  resolvedEvent: ResolvedUpdateEventWrite;
  extraction: import("@shared-types").TranscriptExtractionOutput;
  resolution: GraphWriteResolutionResult;
  canonicalEntities: CanonicalEntityRecord[];
  meetingId?: string;
  now: string;
}): UpdateEventNodeWriteModel {
  const actorEmployeeId = resolveActorEmployeeId(input.resolvedEvent, input.resolution, input.canonicalEntities);
  const supportingChunkIds = buildEventSupportChunkIds(input.resolvedEvent, input.extraction);
  const provenance = buildEventProvenance(input.resolvedEvent, input.extraction, input.meetingId);
  const confidence = buildEventConfidence(input.resolvedEvent, input.extraction, input.now);

  return {
    id: input.resolvedEvent.updateEvent.eventId,
    properties: {
      eventType: input.resolvedEvent.updateEvent.type,
      occurredAt: input.resolvedEvent.updateEvent.occurredAt,
      actorId: input.resolvedEvent.actorNodeId,
      summary: input.resolvedEvent.updateEvent.summary,
      meetingId: input.meetingId,
      employeeId: actorEmployeeId,
      extractionRunId: input.extraction.extractionRunId,
      transcriptId: input.extraction.transcriptId,
      extractedAt: input.extraction.extractedAt,
      modelProvider: input.extraction.extractor.provider,
      modelName: input.extraction.extractor.model,
      modelVersion: input.extraction.extractor.promptVersion,
      evidenceSpanIds: [...input.resolvedEvent.updateEvent.evidenceSpanIds],
      supportingChunkIds,
    },
    provenance,
    confidence,
    createdAt: input.resolvedEvent.updateEvent.occurredAt,
    updatedAt: input.now,
  };
}

export function buildEventSupportLinks(
  resolvedEvent: ResolvedUpdateEventWrite,
  evidenceSpanIndex: Map<string, import("@shared-types").EvidenceSpan>
): EventSupportLink[] {
  const supports = new Map<string, Set<string>>();

  for (const evidenceSpanId of resolvedEvent.updateEvent.evidenceSpanIds) {
    const span = evidenceSpanIndex.get(evidenceSpanId);
    if (!span) {
      continue;
    }
    const ids = supports.get(span.chunkId) ?? new Set<string>();
    ids.add(span.spanId);
    supports.set(span.chunkId, ids);
  }

  return [...supports.entries()].map(([chunkId, spanIds]) => ({
    chunkId,
    evidenceSpanIds: [...spanIds],
  }));
}

export function buildEventAssertionLinks(input: {
  resolvedEvent: ResolvedUpdateEventWrite;
  relationshipsReady: ResolvedRelationshipWrite[];
}): EventAssertionLink[] {
  const links = new Map<string, EventAssertionLink>();

  const push = (key: string, link: EventAssertionLink) => {
    links.set(key, link);
  };

  for (const targetNodeId of getEntityAssertionTargets(input.resolvedEvent)) {
    push(`entity:${targetNodeId}`, {
      targetNodeId,
      assertionKind: "entity",
      targetType: "entity",
      metadata: {
        eventType: input.resolvedEvent.updateEvent.type,
        source: "resolved_update_event",
      },
    });
  }

  const eventSpanIds = new Set(input.resolvedEvent.updateEvent.evidenceSpanIds);
  for (const relationshipWrite of input.relationshipsReady) {
    const overlaps = relationshipWrite.relationship.evidenceSpanIds.some((spanId) => eventSpanIds.has(spanId));
    if (!overlaps) {
      continue;
    }

    push(`relationship:${relationshipWrite.relationship.relationshipId}:from`, {
      targetNodeId: relationshipWrite.fromNodeId,
      assertionKind: "relationship_endpoint",
      targetType: "relationship",
      relationshipId: relationshipWrite.relationship.relationshipId,
      relationshipType: relationshipWrite.relationship.type,
      endpointRole: "from",
      counterpartNodeId: relationshipWrite.toNodeId,
      metadata: {
        relationshipId: relationshipWrite.relationship.relationshipId,
        relationshipType: relationshipWrite.relationship.type,
        endpointRole: "from",
      },
    });

    push(`relationship:${relationshipWrite.relationship.relationshipId}:to`, {
      targetNodeId: relationshipWrite.toNodeId,
      assertionKind: "relationship_endpoint",
      targetType: "relationship",
      relationshipId: relationshipWrite.relationship.relationshipId,
      relationshipType: relationshipWrite.relationship.type,
      endpointRole: "to",
      counterpartNodeId: relationshipWrite.fromNodeId,
      metadata: {
        relationshipId: relationshipWrite.relationship.relationshipId,
        relationshipType: relationshipWrite.relationship.type,
        endpointRole: "to",
      },
    });
  }

  return [...links.values()];
}

export async function createOrMergeUpdateEventNode(session: GraphWriteSession, input: UpdateEventNodeWriteModel): Promise<void> {
  await session.run(mergeUpdateEventCypher, {
    id: input.id,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    properties: {
      ...input.properties,
      provenanceJson: JSON.stringify(input.provenance),
      confidenceJson: JSON.stringify(input.confidence),
    },
  });
}

export async function createOrMergeEventSupportLink(
  session: GraphWriteSession,
  input: {
    eventId: string;
    supportLink: EventSupportLink;
    timestamp: string;
  }
): Promise<void> {
  await session.run(mergeSupportLinkCypher, {
    chunkId: input.supportLink.chunkId,
    eventId: input.eventId,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    evidenceSpanIdsJson: JSON.stringify(input.supportLink.evidenceSpanIds),
  });
}

export async function createOrMergeEventAssertionLink(
  session: GraphWriteSession,
  input: {
    eventId: string;
    assertionLink: EventAssertionLink;
    timestamp: string;
  }
): Promise<void> {
  await session.run(mergeAssertionLinkCypher, {
    eventId: input.eventId,
    targetNodeId: input.assertionLink.targetNodeId,
    targetType: input.assertionLink.targetType,
    assertionKind: input.assertionLink.assertionKind,
    assertionKey: buildAssertionKey(input.eventId, input.assertionLink),
    relationshipId: input.assertionLink.relationshipId ?? null,
    relationshipType: input.assertionLink.relationshipType ?? null,
    endpointRole: input.assertionLink.endpointRole ?? null,
    counterpartNodeId: input.assertionLink.counterpartNodeId ?? null,
    metadataJson: JSON.stringify(input.assertionLink.metadata),
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  });
}

function buildEventSupportChunkIds(
  resolvedEvent: ResolvedUpdateEventWrite,
  extraction: import("@shared-types").TranscriptExtractionOutput
): string[] {
  const evidenceSpanIndex = new Map(extraction.evidenceSpans.map((span) => [span.spanId, span]));
  return buildEventSupportLinks(resolvedEvent, evidenceSpanIndex).map((link) => link.chunkId);
}

function buildEventProvenance(
  resolvedEvent: ResolvedUpdateEventWrite,
  extraction: import("@shared-types").TranscriptExtractionOutput,
  meetingId?: string
): Provenance {
  const evidenceSpans = extraction.evidenceSpans.filter((span) => resolvedEvent.updateEvent.evidenceSpanIds.includes(span.spanId));
  const primarySpan = evidenceSpans[0];
  return {
    sourceSystem: primarySpan?.sourceSystem ?? "meeting_transcript",
    sourceRecordId: primarySpan?.sourceRecordId ?? meetingId,
    ingestionJobId: primarySpan?.ingestionJobId,
    assertedBy: `${extraction.extractor.provider}:${extraction.extractor.model}`,
    assertedAt: extraction.extractedAt,
    traceId: extraction.extractionRunId,
    evidence: evidenceSpans.map((span) => span.quote),
  };
}

function buildEventConfidence(
  resolvedEvent: ResolvedUpdateEventWrite,
  extraction: import("@shared-types").TranscriptExtractionOutput,
  evaluatedAt: string
): Confidence {
  return {
    score: resolvedEvent.updateEvent.confidence,
    model: extraction.extractor.model,
    method: "hybrid",
    rationale: `Resolved update event from extraction run ${extraction.extractionRunId}.`,
    evaluatedAt,
  };
}

function resolveActorEmployeeId(
  resolvedEvent: ResolvedUpdateEventWrite,
  resolution: GraphWriteResolutionResult,
  canonicalEntities: CanonicalEntityRecord[]
): string | undefined {
  const canonicalActor = canonicalEntities.find((candidate) => candidate.nodeId === resolvedEvent.actorNodeId);
  if (canonicalActor?.nodeType === "Person" && canonicalActor.employeeId) {
    return canonicalActor.employeeId;
  }

  const actorDecision = resolution.entityDecisions.find((decision) => decision.outputNodeId === resolvedEvent.actorNodeId);
  if (actorDecision?.extractedEntity.nodeType === "Person") {
    return actorDecision.extractedEntity.properties.employeeId;
  }

  return undefined;
}

function getEntityAssertionTargets(resolvedEvent: ResolvedUpdateEventWrite): string[] {
  const targets = new Set<string>();
  for (const value of Object.values(resolvedEvent.linkedNodeIds)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        targets.add(item);
      }
      continue;
    }
    targets.add(value);
  }
  return [...targets];
}

function buildAssertionKey(eventId: string, assertionLink: EventAssertionLink): string {
  return [
    eventId,
    assertionLink.assertionKind,
    assertionLink.targetNodeId,
    assertionLink.relationshipId ?? "entity",
    assertionLink.endpointRole ?? "na",
  ].join(":");
}
