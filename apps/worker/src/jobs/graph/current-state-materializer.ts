import type { RelationshipType, TranscriptExtractionOutput } from "@shared-types";
import type {
  CanonicalEntityRecord,
  GraphWriteResolutionResult,
  ResolvedRelationshipWrite,
  ResolvedUpdateEventWrite,
} from "./entity-resolution.js";
import {
  buildEventAssertionLinks,
  buildEventSupportLinks,
  buildUpdateEventNodeWriteModel,
  type EventAssertionLink,
  type EventSupportLink,
  type GraphWriteSession,
  type UpdateEventNodeWriteModel,
} from "./event-layer-writer.js";

type MaterializableRelationshipType = Extract<RelationshipType, "WORKS_ON" | "OWNS" | "BLOCKED_BY" | "HAS_SKILL">;
type FactCategory = "operational" | "structural";

export interface EventLayerRecord {
  eventNode: UpdateEventNodeWriteModel;
  assertionLinks: EventAssertionLink[];
  supportLinks: EventSupportLink[];
}

export interface FactObservation {
  relationshipType: MaterializableRelationshipType;
  category: FactCategory;
  fromNodeId: string;
  toNodeId: string;
  observedAt: string;
  confidence: number;
  sourceEventId: string;
  sourceEventType: string;
  sourceAssertionKey: string;
  temporary: boolean;
  metadata: Record<string, unknown>;
}

export interface MaterializedFact {
  factId: string;
  factKey: string;
  relationshipType: MaterializableRelationshipType;
  category: FactCategory;
  fromNodeId: string;
  toNodeId: string;
  confidence: number;
  validFrom: string;
  validTo: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  active: boolean;
  temporary: boolean;
  sourceEventIds: string[];
  sourceAssertionKeys: string[];
  supportingChunkIds: string[];
  observationCount: number;
  appliedRuleId: string;
  metadata: Record<string, unknown>;
}

export interface MaterializationRuleContext {
  asOf: string;
}

export interface MaterializationRule {
  id: string;
  relationshipType: MaterializableRelationshipType;
  category: FactCategory;
  minConfidence: number;
  minObservations: number;
  decayAfterMs?: number;
  deriveObservations(record: EventLayerRecord, context: MaterializationRuleContext): FactObservation[];
}

export interface MaterializationPolicy {
  globalMinConfidence: number;
  structuralConfidenceBias: number;
}

export interface MaterializationResult {
  facts: MaterializedFact[];
  activeFacts: MaterializedFact[];
  expiredFacts: MaterializedFact[];
  skippedObservations: FactObservation[];
}

const dayMs = 24 * 60 * 60 * 1000;

const defaultPolicy: MaterializationPolicy = {
  globalMinConfidence: 0.6,
  structuralConfidenceBias: 0.05,
};

export const defaultMaterializationRules: MaterializationRule[] = [
  {
    id: "operational_works_on_from_task_events",
    relationshipType: "WORKS_ON",
    category: "operational",
    minConfidence: 0.62,
    minObservations: 1,
    decayAfterMs: 21 * dayMs,
    deriveObservations(record) {
      if (record.eventNode.properties.eventType !== "TASK_PROGRESS_REPORTED" && record.eventNode.properties.eventType !== "TASK_COMPLETED") {
        return [];
      }

      const taskNodeId = asSingleNodeId(record, "taskNodeId");
      if (!taskNodeId) {
        return [];
      }

      return [
        createObservation(record, {
          relationshipType: "WORKS_ON",
          category: "operational",
          fromNodeId: record.eventNode.properties.actorId,
          toNodeId: taskNodeId,
          sourceAssertionKey: `event:${record.eventNode.id}:taskNodeId`,
          temporary: true,
          metadata: {
            inferredFrom: record.eventNode.properties.eventType,
          },
        }),
      ];
    },
  },
  {
    id: "operational_blocked_by_from_blocker_events",
    relationshipType: "BLOCKED_BY",
    category: "operational",
    minConfidence: 0.68,
    minObservations: 1,
    decayAfterMs: 14 * dayMs,
    deriveObservations(record) {
      if (record.eventNode.properties.eventType !== "BLOCKER_REPORTED") {
        return [];
      }

      const blockerNodeId = asSingleNodeId(record, "blockerNodeId");
      const affectedTaskIds = asManyNodeIds(record, "affectedTaskNodeIds");
      if (!blockerNodeId || affectedTaskIds.length === 0) {
        return [];
      }

      return affectedTaskIds.map((taskNodeId) =>
        createObservation(record, {
          relationshipType: "BLOCKED_BY",
          category: "operational",
          fromNodeId: taskNodeId,
          toNodeId: blockerNodeId,
          sourceAssertionKey: `event:${record.eventNode.id}:blocker:${taskNodeId}:${blockerNodeId}`,
          temporary: true,
          metadata: {
            inferredFrom: record.eventNode.properties.eventType,
          },
        })
      );
    },
  },
  {
    id: "structural_owns_from_relationship_assertions",
    relationshipType: "OWNS",
    category: "structural",
    minConfidence: 0.84,
    minObservations: 2,
    deriveObservations(record) {
      return deriveRelationshipAssertionObservations(record, "OWNS", "structural");
    },
  },
  {
    id: "structural_has_skill_from_relationship_assertions",
    relationshipType: "HAS_SKILL",
    category: "structural",
    minConfidence: 0.88,
    minObservations: 2,
    decayAfterMs: 180 * dayMs,
    deriveObservations(record) {
      return deriveRelationshipAssertionObservations(record, "HAS_SKILL", "structural");
    },
  },
  {
    id: "operational_works_on_from_relationship_assertions",
    relationshipType: "WORKS_ON",
    category: "operational",
    minConfidence: 0.66,
    minObservations: 1,
    decayAfterMs: 30 * dayMs,
    deriveObservations(record) {
      return deriveRelationshipAssertionObservations(record, "WORKS_ON", "operational", true);
    },
  },
  {
    id: "operational_blocked_by_from_relationship_assertions",
    relationshipType: "BLOCKED_BY",
    category: "operational",
    minConfidence: 0.72,
    minObservations: 1,
    decayAfterMs: 14 * dayMs,
    deriveObservations(record) {
      return deriveRelationshipAssertionObservations(record, "BLOCKED_BY", "operational", true);
    },
  },
];

export function materializeCurrentFactsFromEventLayer(input: {
  eventLayerRecords: EventLayerRecord[];
  asOf?: string;
  rules?: MaterializationRule[];
  policy?: Partial<MaterializationPolicy>;
}): MaterializationResult {
  const policy = { ...defaultPolicy, ...input.policy };
  const asOf = input.asOf ?? new Date().toISOString();
  const rules = input.rules ?? defaultMaterializationRules;
  const skippedObservations: FactObservation[] = [];
  const grouped = new Map<string, { rule: MaterializationRule; observations: FactObservation[] }>();

  for (const rule of rules) {
    for (const record of input.eventLayerRecords) {
      const observations = rule.deriveObservations(record, { asOf });
      for (const observation of observations) {
        const threshold = effectiveThreshold(rule, policy);
        if (observation.confidence < threshold) {
          skippedObservations.push(observation);
          continue;
        }

        const key = `${rule.id}:${observation.relationshipType}:${observation.fromNodeId}:${observation.toNodeId}`;
        const existing = grouped.get(key);
        if (existing) {
          existing.observations.push(observation);
          continue;
        }
        grouped.set(key, { rule, observations: [observation] });
      }
    }
  }

  const facts: MaterializedFact[] = [];
  for (const [groupKey, group] of grouped.entries()) {
    if (group.observations.length < group.rule.minObservations) {
      skippedObservations.push(...group.observations);
      continue;
    }
    facts.push(buildMaterializedFact(groupKey, group.rule, group.observations, asOf, policy));
  }

  facts.sort((left, right) => left.factKey.localeCompare(right.factKey));

  return {
    facts,
    activeFacts: facts.filter((fact) => fact.active),
    expiredFacts: facts.filter((fact) => !fact.active),
    skippedObservations,
  };
}

export function buildEventLayerRecordsFromResolvedOutputs(input: {
  extraction: TranscriptExtractionOutput;
  resolution: GraphWriteResolutionResult;
  canonicalEntities?: CanonicalEntityRecord[];
  meetingId?: string;
  now?: () => string;
}): EventLayerRecord[] {
  const now = input.now ?? (() => new Date().toISOString());
  const evidenceSpanIndex = new Map(input.extraction.evidenceSpans.map((span) => [span.spanId, span]));

  return input.resolution.updateEventsReady.map((resolvedEvent) => ({
    eventNode: buildUpdateEventNodeWriteModel({
      resolvedEvent,
      extraction: input.extraction,
      resolution: input.resolution,
      canonicalEntities: input.canonicalEntities ?? [],
      meetingId: input.meetingId,
      now: now(),
    }),
    assertionLinks: buildEventAssertionLinks({
      resolvedEvent,
      relationshipsReady: input.resolution.relationshipsReady,
    }),
    supportLinks: buildEventSupportLinks(resolvedEvent, evidenceSpanIndex),
  }));
}

export async function writeMaterializedFacts(session: GraphWriteSession, facts: MaterializedFact[], materializedAt: string): Promise<void> {
  for (const fact of facts) {
    await createOrMergeMaterializedFact(session, fact, materializedAt);
  }
}

export async function createOrMergeMaterializedFact(
  session: GraphWriteSession,
  fact: MaterializedFact,
  materializedAt: string
): Promise<void> {
  const cypher = `
    MATCH (source {id: $fromNodeId})
    MATCH (target {id: $toNodeId})
    MERGE (source)-[fact:${fact.relationshipType} {factKey: $factKey}]->(target)
    ON CREATE SET fact.createdAt = $materializedAt
    SET fact.updatedAt = $materializedAt,
        fact.materializedBy = 'event_layer_materializer',
        fact.materializedAt = $materializedAt,
        fact.category = $category,
        fact.confidence = $confidence,
        fact.validFrom = $validFrom,
        fact.validTo = $validTo,
        fact.firstSeenAt = $firstSeenAt,
        fact.lastSeenAt = $lastSeenAt,
        fact.active = $active,
        fact.temporary = $temporary,
        fact.observationCount = $observationCount,
        fact.appliedRuleId = $appliedRuleId,
        fact.sourceEventIdsJson = $sourceEventIdsJson,
        fact.sourceAssertionKeysJson = $sourceAssertionKeysJson,
        fact.supportingChunkIdsJson = $supportingChunkIdsJson,
        fact.metadataJson = $metadataJson
    RETURN fact.factKey AS factKey
  `;

  await session.run(cypher, {
    factKey: fact.factKey,
    fromNodeId: fact.fromNodeId,
    toNodeId: fact.toNodeId,
    category: fact.category,
    confidence: fact.confidence,
    validFrom: fact.validFrom,
    validTo: fact.validTo,
    firstSeenAt: fact.firstSeenAt,
    lastSeenAt: fact.lastSeenAt,
    active: fact.active,
    temporary: fact.temporary,
    observationCount: fact.observationCount,
    appliedRuleId: fact.appliedRuleId,
    sourceEventIdsJson: JSON.stringify(fact.sourceEventIds),
    sourceAssertionKeysJson: JSON.stringify(fact.sourceAssertionKeys),
    supportingChunkIdsJson: JSON.stringify(fact.supportingChunkIds),
    metadataJson: JSON.stringify(fact.metadata),
    materializedAt,
  });
}

function buildMaterializedFact(
  groupKey: string,
  rule: MaterializationRule,
  observations: FactObservation[],
  asOf: string,
  policy: MaterializationPolicy
): MaterializedFact {
  const sorted = [...observations].sort((left, right) => left.observedAt.localeCompare(right.observedAt));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const confidence = aggregateConfidence(sorted, rule, policy);
  const validTo = computeValidTo(last.observedAt, rule.decayAfterMs);
  const active = validTo === null ? true : asOf <= validTo;

  return {
    factId: `fact:${groupKey}`,
    factKey: `${first.relationshipType}:${first.fromNodeId}:${first.toNodeId}`,
    relationshipType: first.relationshipType,
    category: first.category,
    fromNodeId: first.fromNodeId,
    toNodeId: first.toNodeId,
    confidence,
    validFrom: first.observedAt,
    validTo,
    firstSeenAt: first.observedAt,
    lastSeenAt: last.observedAt,
    active,
    temporary: sorted.some((observation) => observation.temporary),
    sourceEventIds: unique(sorted.map((observation) => observation.sourceEventId)),
    sourceAssertionKeys: unique(sorted.map((observation) => observation.sourceAssertionKey)),
    supportingChunkIds: unique(
      sorted.flatMap((observation) =>
        Array.isArray(observation.metadata.supportingChunkIds)
          ? observation.metadata.supportingChunkIds.filter((value): value is string => typeof value === "string")
          : []
      )
    ),
    observationCount: sorted.length,
    appliedRuleId: rule.id,
    metadata: {
      category: first.category,
      decayAfterMs: rule.decayAfterMs ?? null,
      sources: sorted.map((observation) => ({
        eventId: observation.sourceEventId,
        eventType: observation.sourceEventType,
      })),
    },
  };
}

function createObservation(
  record: EventLayerRecord,
  input: Omit<FactObservation, "observedAt" | "confidence" | "sourceEventId" | "sourceEventType" | "metadata">
    & { metadata?: Record<string, unknown> }
): FactObservation {
  return {
    ...input,
    observedAt: record.eventNode.properties.occurredAt,
    confidence: record.eventNode.confidence.score,
    sourceEventId: record.eventNode.id,
    sourceEventType: record.eventNode.properties.eventType,
    metadata: {
      ...(input.metadata ?? {}),
      supportingChunkIds: record.eventNode.properties.supportingChunkIds ?? [],
    },
  };
}

function deriveRelationshipAssertionObservations(
  record: EventLayerRecord,
  relationshipType: MaterializableRelationshipType,
  category: FactCategory,
  temporary = false
): FactObservation[] {
  return record.assertionLinks
    .filter(
      (assertion) =>
        assertion.assertionKind === "relationship_endpoint" &&
        assertion.relationshipType === relationshipType &&
        assertion.endpointRole === "from" &&
        assertion.counterpartNodeId
    )
    .map((assertion) =>
      createObservation(record, {
        relationshipType,
        category,
        fromNodeId: assertion.targetNodeId,
        toNodeId: assertion.counterpartNodeId as string,
        sourceAssertionKey: `${record.eventNode.id}:${assertion.relationshipId}:${assertion.endpointRole}`,
        temporary,
        metadata: {
          relationshipId: assertion.relationshipId,
          relationshipType: assertion.relationshipType,
        },
      })
    );
}

function effectiveThreshold(rule: MaterializationRule, policy: MaterializationPolicy): number {
  const structuralBias = rule.category === "structural" ? policy.structuralConfidenceBias : 0;
  return Math.max(policy.globalMinConfidence, Math.min(1, rule.minConfidence + structuralBias));
}

function aggregateConfidence(
  observations: FactObservation[],
  rule: MaterializationRule,
  policy: MaterializationPolicy
): number {
  const strongest = Math.max(...observations.map((observation) => observation.confidence));
  const repeatBoost = Math.min(0.12, (observations.length - 1) * 0.03);
  const structuralBias = rule.category === "structural" ? policy.structuralConfidenceBias : 0;
  return Number(Math.min(1, strongest + repeatBoost - structuralBias).toFixed(4));
}

function computeValidTo(lastSeenAt: string, decayAfterMs: number | undefined): string | null {
  if (!decayAfterMs) {
    return null;
  }

  const millis = Date.parse(lastSeenAt);
  if (!Number.isFinite(millis)) {
    return null;
  }

  return new Date(millis + decayAfterMs).toISOString();
}

function asSingleNodeId(record: EventLayerRecord, key: string): string | undefined {
  const value = record.eventNode.properties[key as keyof typeof record.eventNode.properties];
  return typeof value === "string" ? value : undefined;
}

function asManyNodeIds(record: EventLayerRecord, key: string): string[] {
  const value = record.eventNode.properties[key as keyof typeof record.eventNode.properties];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
