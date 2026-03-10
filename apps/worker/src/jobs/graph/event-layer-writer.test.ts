import assert from "node:assert/strict";
import test from "node:test";
import type { TranscriptExtractionOutput } from "@shared-types";
import type { CanonicalEntityRecord, GraphWriteResolutionResult, ResolvedRelationshipWrite, ResolvedUpdateEventWrite } from "./entity-resolution.js";
import {
  buildEventAssertionLinks,
  buildEventSupportLinks,
  buildUpdateEventNodeWriteModel,
  writeResolvedUpdateEvents,
  type GraphWriteSession,
} from "./event-layer-writer.js";

function buildExtraction(overrides?: Partial<TranscriptExtractionOutput>): TranscriptExtractionOutput {
  return {
    extractionRunId: "extract_run_01",
    transcriptId: "transcript_01",
    extractedAt: "2026-03-10T13:00:00.000Z",
    extractor: {
      provider: "placeholder",
      model: "heuristic-v1",
      promptVersion: "phase5-v1",
    },
    entities: [],
    relationships: [],
    updateEvents: [],
    confidenceNotes: [],
    evidenceSpans: [],
    ...overrides,
  };
}

function buildResolvedEvent(): ResolvedUpdateEventWrite {
  return {
    updateEvent: {
      eventId: "evt_1",
      type: "TASK_COMPLETED",
      occurredAt: "2026-03-10T12:59:00.000Z",
      actorEntityId: "ent_person_ada",
      summary: "Ada completed the graph migration task.",
      taskEntityId: "ent_task_graph",
      confidence: 0.91,
      evidenceSpanIds: ["span_1", "span_2"],
    },
    actorNodeId: "person_ada",
    linkedNodeIds: {
      taskNodeId: "task_graph",
    },
    auditEntityDecisionIds: ["audit_actor", "audit_task"],
  };
}

function buildRelationshipWrite(): ResolvedRelationshipWrite {
  return {
    relationship: {
      relationshipId: "rel_1",
      type: "WORKS_ON",
      fromEntityId: "ent_person_ada",
      toEntityId: "ent_task_graph",
      metadata: {},
      confidence: 0.8,
      evidenceSpanIds: ["span_2"],
    },
    fromNodeId: "person_ada",
    toNodeId: "task_graph",
    auditEntityDecisionIds: ["audit_actor", "audit_task"],
  };
}

function buildResolution(overrides?: Partial<GraphWriteResolutionResult>): GraphWriteResolutionResult {
  const resolvedEvent = buildResolvedEvent();
  return {
    entityDecisions: [
      {
        auditId: "audit_actor",
        source: {
          extractionRunId: "extract_run_01",
          transcriptId: "transcript_01",
          extractedAt: "2026-03-10T13:00:00.000Z",
          extractor: {
            provider: "placeholder",
            model: "heuristic-v1",
            promptVersion: "phase5-v1",
          },
          sourceEntityId: "ent_person_ada",
          evidenceSpanIds: ["span_1"],
        },
        extractedEntity: {
          entityId: "ent_person_ada",
          nodeType: "Person",
          label: "Ada Lovelace",
          aliases: [],
          properties: {
            fullName: "Ada Lovelace",
            employeeId: "E-1024",
          },
          resolution: {
            action: "match_existing",
            normalizedKey: "person:ada lovelace",
            candidateNodeIds: ["person_ada"],
            chosenNodeId: "person_ada",
          },
          confidence: 0.97,
          evidenceSpanIds: ["span_1"],
        },
        disposition: "merge_existing",
        method: "exact_employee_id",
        confidence: 1,
        flags: [],
        matchedNodeId: "person_ada",
        outputNodeId: "person_ada",
        normalizedKey: "person:ada lovelace",
        rationale: "matched",
        candidates: [],
      },
    ],
    relationshipsReady: [buildRelationshipWrite()],
    blockedRelationships: [],
    updateEventsReady: [resolvedEvent],
    blockedUpdateEvents: [
      {
        updateEvent: {
          eventId: "evt_blocked",
          type: "TASK_COMPLETED",
          occurredAt: "2026-03-10T12:58:00.000Z",
          actorEntityId: "ent_person_ada",
          summary: "Blocked event",
          taskEntityId: "ent_missing_task",
          confidence: 0.45,
          evidenceSpanIds: ["span_3"],
        },
        missingEntityIds: ["ent_missing_task"],
      },
    ],
    entityIdMap: {
      ent_person_ada: "person_ada",
      ent_task_graph: "task_graph",
    },
    ...overrides,
  };
}

test("buildUpdateEventNodeWriteModel stores provenance, confidence, meeting, employee, and model metadata", () => {
  const extraction = buildExtraction({
    evidenceSpans: [
      {
        spanId: "span_1",
        transcriptId: "transcript_01",
        chunkId: "chunk_001",
        startChar: 0,
        endChar: 40,
        quote: "Ada completed the graph task.",
        sourceSystem: "zoom",
        sourceRecordId: "meeting_01",
        ingestionJobId: "ingest_01",
      },
      {
        spanId: "span_2",
        transcriptId: "transcript_01",
        chunkId: "chunk_002",
        startChar: 0,
        endChar: 50,
        quote: "The task is fully completed now.",
        sourceSystem: "zoom",
      },
    ],
  });
  const resolution = buildResolution();
  const canonicalEntities: CanonicalEntityRecord[] = [
    {
      nodeId: "person_ada",
      nodeType: "Person",
      canonicalName: "Ada Lovelace",
      employeeId: "E-1024",
    },
  ];

  const model = buildUpdateEventNodeWriteModel({
    resolvedEvent: resolution.updateEventsReady[0]!,
    extraction,
    resolution,
    canonicalEntities,
    meetingId: "meeting_01",
    now: "2026-03-10T13:05:00.000Z",
  });

  assert.equal(model.properties.meetingId, "meeting_01");
  assert.equal(model.properties.employeeId, "E-1024");
  assert.equal(model.properties.modelVersion, "phase5-v1");
  assert.deepEqual(model.properties.supportingChunkIds, ["chunk_001", "chunk_002"]);
  assert.equal(model.provenance.traceId, "extract_run_01");
  assert.equal(model.provenance.sourceSystem, "zoom");
  assert.equal(model.confidence.score, 0.91);
});

test("buildEventSupportLinks deduplicates transcript chunk links by chunk id", () => {
  const supportLinks = buildEventSupportLinks(
    buildResolvedEvent(),
    new Map([
      [
        "span_1",
        {
          spanId: "span_1",
          transcriptId: "transcript_01",
          chunkId: "chunk_001",
          startChar: 0,
          endChar: 10,
          quote: "one",
          sourceSystem: "zoom",
        },
      ],
      [
        "span_2",
        {
          spanId: "span_2",
          transcriptId: "transcript_01",
          chunkId: "chunk_001",
          startChar: 11,
          endChar: 20,
          quote: "two",
          sourceSystem: "zoom",
        },
      ],
    ])
  );

  assert.equal(supportLinks.length, 1);
  assert.equal(supportLinks[0]?.chunkId, "chunk_001");
  assert.deepEqual(supportLinks[0]?.evidenceSpanIds, ["span_1", "span_2"]);
});

test("buildEventAssertionLinks includes direct entity assertions and overlapping relationship assertions", () => {
  const assertionLinks = buildEventAssertionLinks({
    resolvedEvent: buildResolvedEvent(),
    relationshipsReady: [buildRelationshipWrite()],
  });

  assert.equal(assertionLinks.filter((link) => link.assertionKind === "entity").length, 1);
  assert.equal(assertionLinks.filter((link) => link.assertionKind === "relationship_endpoint").length, 2);
  assert.ok(assertionLinks.some((link) => link.targetNodeId === "task_graph"));
  assert.ok(assertionLinks.some((link) => link.relationshipId === "rel_1" && link.endpointRole === "from"));
});

test("writeResolvedUpdateEvents emits idempotent MERGE writes for event nodes, support links, and assertions", async () => {
  const calls: Array<{ cypher: string; params: Record<string, unknown> | undefined }> = [];
  const session: GraphWriteSession = {
    async run(cypher, params) {
      calls.push({ cypher, params });
      return {};
    },
  };

  const extraction = buildExtraction({
    evidenceSpans: [
      {
        spanId: "span_1",
        transcriptId: "transcript_01",
        chunkId: "chunk_001",
        startChar: 0,
        endChar: 40,
        quote: "Ada completed the graph task.",
        sourceSystem: "zoom",
      },
      {
        spanId: "span_2",
        transcriptId: "transcript_01",
        chunkId: "chunk_002",
        startChar: 0,
        endChar: 50,
        quote: "The task is fully completed now.",
        sourceSystem: "zoom",
      },
    ],
  });
  const resolution = buildResolution();

  const summary = await writeResolvedUpdateEvents(session, {
    extraction,
    resolution,
    canonicalEntities: [
      {
        nodeId: "person_ada",
        nodeType: "Person",
        canonicalName: "Ada Lovelace",
        employeeId: "E-1024",
      },
    ],
    meetingId: "meeting_01",
    now: () => "2026-03-10T13:05:00.000Z",
  });

  assert.equal(summary.eventsWritten, 1);
  assert.equal(summary.supportLinksWritten, 2);
  assert.equal(summary.entityAssertionLinksWritten, 1);
  assert.equal(summary.relationshipAssertionLinksWritten, 2);
  assert.equal(summary.skippedBlockedEvents, 1);
  assert.equal(calls.length, 6);
  assert.ok(calls.every((call) => call.cypher.includes("MERGE")));
  assert.ok(calls.some((call) => call.cypher.includes("MERGE (event:UpdateEvent")));
  assert.ok(calls.some((call) => call.cypher.includes("MERGE (chunk)-[support:SUPPORTS]->(event)")));
  assert.ok(calls.some((call) => call.cypher.includes("MERGE (event)-[assertion:ASSERTED")));
  assert.equal(
    (calls.find((call) => call.cypher.includes("MERGE (event:UpdateEvent"))?.params?.properties as Record<string, unknown>).meetingId,
    "meeting_01"
  );
});
