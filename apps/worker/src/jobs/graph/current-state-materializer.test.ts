import assert from "node:assert/strict";
import test from "node:test";
import type { Confidence, Provenance } from "@shared-types";
import {
  createOrMergeMaterializedFact,
  materializeCurrentFactsFromEventLayer,
  type EventLayerRecord,
  type MaterializedFact,
} from "./current-state-materializer.js";
import type { GraphWriteSession, UpdateEventNodeWriteModel } from "./event-layer-writer.js";

function buildConfidence(score: number): Confidence {
  return {
    score,
    evaluatedAt: "2026-03-10T12:00:00.000Z",
    method: "hybrid",
  };
}

function buildProvenance(): Provenance {
  return {
    sourceSystem: "zoom",
    assertedBy: "placeholder:heuristic-v1",
    assertedAt: "2026-03-10T12:00:00.000Z",
  };
}

function buildEventNode(input: {
  id: string;
  eventType: UpdateEventNodeWriteModel["properties"]["eventType"];
  occurredAt: string;
  actorId: string;
  summary: string;
  supportingChunkIds?: string[];
  extraProperties?: Record<string, unknown>;
  confidence: number;
}): UpdateEventNodeWriteModel {
  return {
    id: input.id,
    properties: {
      eventType: input.eventType,
      occurredAt: input.occurredAt,
      actorId: input.actorId,
      summary: input.summary,
      supportingChunkIds: input.supportingChunkIds ?? [],
      ...input.extraProperties,
    },
    provenance: buildProvenance(),
    confidence: buildConfidence(input.confidence),
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
  };
}

function buildEventLayerRecord(input: {
  eventNode: UpdateEventNodeWriteModel;
  assertionLinks?: EventLayerRecord["assertionLinks"];
  supportLinks?: EventLayerRecord["supportLinks"];
}): EventLayerRecord {
  return {
    eventNode: input.eventNode,
    assertionLinks: input.assertionLinks ?? [],
    supportLinks: input.supportLinks ?? [],
  };
}

test("materializes operational WORKS_ON facts from task events with validity windows", () => {
  const result = materializeCurrentFactsFromEventLayer({
    asOf: "2026-03-12T00:00:00.000Z",
    eventLayerRecords: [
      buildEventLayerRecord({
        eventNode: buildEventNode({
          id: "evt_progress_1",
          eventType: "TASK_PROGRESS_REPORTED",
          occurredAt: "2026-03-10T09:00:00.000Z",
          actorId: "person_ada",
          summary: "Ada is still working on the graph task.",
          supportingChunkIds: ["chunk_1"],
          extraProperties: {
            taskNodeId: "task_graph",
          },
          confidence: 0.82,
        }),
      }),
    ],
  });

  assert.equal(result.activeFacts.length, 1);
  assert.equal(result.activeFacts[0]?.relationshipType, "WORKS_ON");
  assert.equal(result.activeFacts[0]?.fromNodeId, "person_ada");
  assert.equal(result.activeFacts[0]?.toNodeId, "task_graph");
  assert.equal(result.activeFacts[0]?.validFrom, "2026-03-10T09:00:00.000Z");
  assert.equal(result.activeFacts[0]?.validTo, "2026-03-31T09:00:00.000Z");
});

test("expires stale temporary BLOCKED_BY facts without deleting underlying history", () => {
  const result = materializeCurrentFactsFromEventLayer({
    asOf: "2026-04-01T00:00:00.000Z",
    eventLayerRecords: [
      buildEventLayerRecord({
        eventNode: buildEventNode({
          id: "evt_blocker_1",
          eventType: "BLOCKER_REPORTED",
          occurredAt: "2026-03-10T10:00:00.000Z",
          actorId: "person_ada",
          summary: "Security review is blocking launch.",
          supportingChunkIds: ["chunk_2"],
          extraProperties: {
            blockerNodeId: "blocker_security_review",
            affectedTaskNodeIds: ["task_launch"],
          },
          confidence: 0.88,
        }),
      }),
    ],
  });

  assert.equal(result.expiredFacts.length, 1);
  assert.equal(result.expiredFacts[0]?.relationshipType, "BLOCKED_BY");
  assert.equal(result.expiredFacts[0]?.active, false);
  assert.equal(result.expiredFacts[0]?.validTo, "2026-03-24T10:00:00.000Z");
});

test("keeps structural facts more conservative by requiring repeated stronger evidence", () => {
  const oneObservation = materializeCurrentFactsFromEventLayer({
    asOf: "2026-03-12T00:00:00.000Z",
    eventLayerRecords: [
      buildEventLayerRecord({
        eventNode: buildEventNode({
          id: "evt_skill_1",
          eventType: "DAILY_SUMMARY_RECORDED",
          occurredAt: "2026-03-10T08:00:00.000Z",
          actorId: "person_ada",
          summary: "Ada handled the TypeScript review.",
          supportingChunkIds: ["chunk_3"],
          confidence: 0.94,
        }),
        assertionLinks: [
          {
            targetNodeId: "person_ada",
            assertionKind: "relationship_endpoint",
            targetType: "relationship",
            relationshipId: "rel_skill_1",
            relationshipType: "HAS_SKILL",
            endpointRole: "from",
            counterpartNodeId: "skill_typescript",
            metadata: {},
          },
        ],
      }),
    ],
  });

  assert.equal(oneObservation.activeFacts.length, 0);

  const twoObservations = materializeCurrentFactsFromEventLayer({
    asOf: "2026-03-12T00:00:00.000Z",
    eventLayerRecords: [
      buildEventLayerRecord({
        eventNode: buildEventNode({
          id: "evt_skill_1",
          eventType: "DAILY_SUMMARY_RECORDED",
          occurredAt: "2026-03-10T08:00:00.000Z",
          actorId: "person_ada",
          summary: "Ada handled the TypeScript review.",
          supportingChunkIds: ["chunk_3"],
          confidence: 0.94,
        }),
        assertionLinks: [
          {
            targetNodeId: "person_ada",
            assertionKind: "relationship_endpoint",
            targetType: "relationship",
            relationshipId: "rel_skill_1",
            relationshipType: "HAS_SKILL",
            endpointRole: "from",
            counterpartNodeId: "skill_typescript",
            metadata: {},
          },
        ],
      }),
      buildEventLayerRecord({
        eventNode: buildEventNode({
          id: "evt_skill_2",
          eventType: "DAILY_SUMMARY_RECORDED",
          occurredAt: "2026-03-11T08:00:00.000Z",
          actorId: "person_ada",
          summary: "Ada mentored someone on TypeScript.",
          supportingChunkIds: ["chunk_4"],
          confidence: 0.95,
        }),
        assertionLinks: [
          {
            targetNodeId: "person_ada",
            assertionKind: "relationship_endpoint",
            targetType: "relationship",
            relationshipId: "rel_skill_2",
            relationshipType: "HAS_SKILL",
            endpointRole: "from",
            counterpartNodeId: "skill_typescript",
            metadata: {},
          },
        ],
      }),
    ],
  });

  assert.equal(twoObservations.activeFacts.length, 1);
  assert.equal(twoObservations.activeFacts[0]?.relationshipType, "HAS_SKILL");
  assert.equal(twoObservations.activeFacts[0]?.observationCount, 2);
  assert.ok((twoObservations.activeFacts[0]?.confidence ?? 0) >= 0.9);
});

test("supports stricter global confidence thresholds", () => {
  const result = materializeCurrentFactsFromEventLayer({
    asOf: "2026-03-12T00:00:00.000Z",
    policy: {
      globalMinConfidence: 0.9,
    },
    eventLayerRecords: [
      buildEventLayerRecord({
        eventNode: buildEventNode({
          id: "evt_progress_2",
          eventType: "TASK_PROGRESS_REPORTED",
          occurredAt: "2026-03-10T09:00:00.000Z",
          actorId: "person_ada",
          summary: "Ada is progressing the task.",
          extraProperties: {
            taskNodeId: "task_graph",
          },
          confidence: 0.82,
        }),
      }),
    ],
  });

  assert.equal(result.activeFacts.length, 0);
  assert.equal(result.skippedObservations.length, 1);
});

test("createOrMergeMaterializedFact writes idempotent MERGE relationships with validity metadata", async () => {
  const calls: Array<{ cypher: string; params: Record<string, unknown> | undefined }> = [];
  const session: GraphWriteSession = {
    async run(cypher, params) {
      calls.push({ cypher, params });
      return {};
    },
  };

  const fact: MaterializedFact = {
    factId: "fact:WORKS_ON:person_ada:task_graph",
    factKey: "WORKS_ON:person_ada:task_graph",
    relationshipType: "WORKS_ON",
    category: "operational",
    fromNodeId: "person_ada",
    toNodeId: "task_graph",
    confidence: 0.85,
    validFrom: "2026-03-10T09:00:00.000Z",
    validTo: "2026-03-31T09:00:00.000Z",
    firstSeenAt: "2026-03-10T09:00:00.000Z",
    lastSeenAt: "2026-03-10T09:00:00.000Z",
    active: true,
    temporary: true,
    sourceEventIds: ["evt_progress_1"],
    sourceAssertionKeys: ["event:evt_progress_1:taskNodeId"],
    supportingChunkIds: ["chunk_1"],
    observationCount: 1,
    appliedRuleId: "operational_works_on_from_task_events",
    metadata: {},
  };

  await createOrMergeMaterializedFact(session, fact, "2026-03-12T00:00:00.000Z");

  assert.equal(calls.length, 1);
  assert.match(calls[0]?.cypher ?? "", /MERGE \(source\)-\[fact:WORKS_ON \{factKey: \$factKey\}\]->\(target\)/);
  assert.equal(calls[0]?.params?.factKey, "WORKS_ON:person_ada:task_graph");
  assert.equal(calls[0]?.params?.validTo, "2026-03-31T09:00:00.000Z");
  assert.equal(calls[0]?.params?.active, true);
});
