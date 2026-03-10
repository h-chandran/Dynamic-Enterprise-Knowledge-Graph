import assert from "node:assert/strict";
import test from "node:test";
import type { TranscriptExtractionOutput } from "@shared-types";
import { resolveTranscriptEntitiesForGraphWrite, type CanonicalEntityRecord } from "./entity-resolution.js";

function buildExtraction(overrides?: Partial<TranscriptExtractionOutput>): TranscriptExtractionOutput {
  return {
    extractionRunId: "extract_run_01",
    transcriptId: "transcript_01",
    extractedAt: "2026-03-10T12:00:00.000Z",
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

const canonicalEntities: CanonicalEntityRecord[] = [
  {
    nodeId: "person_ada",
    nodeType: "Person",
    canonicalName: "Ada Lovelace",
    knownCanonicalNames: ["Augusta Ada Lovelace"],
    employeeId: "E-1024",
  },
  {
    nodeId: "project_graph",
    nodeType: "Project",
    canonicalName: "Enterprise Knowledge Graph",
    aliases: ["EKG", "Knowledge Graph"],
  },
  {
    nodeId: "skill_ts",
    nodeType: "Skill",
    canonicalName: "TypeScript",
    aliases: ["TS"],
  },
  {
    nodeId: "team_platform",
    nodeType: "Team",
    canonicalName: "Platform Engineering",
    aliases: ["Platform Eng"],
  },
  {
    nodeId: "project_graph_variant",
    nodeType: "Project",
    canonicalName: "Enterprise Graph Platform",
    aliases: ["Graph Platform"],
  },
];

test("matches people exactly by employee ID", () => {
  const extraction = buildExtraction({
    entities: [
      {
        entityId: "ent_person_ada",
        nodeType: "Person",
        label: "Ada L.",
        aliases: [],
        properties: {
          fullName: "Ada Lovelace",
          employeeId: "e 1024",
        },
        resolution: {
          action: "create",
          normalizedKey: "person:ada lovelace",
          candidateNodeIds: [],
        },
        confidence: 0.9,
        evidenceSpanIds: ["span_1"],
      },
    ],
  });

  const result = resolveTranscriptEntitiesForGraphWrite({
    extraction,
    canonicalEntities,
  });

  assert.equal(result.entityDecisions[0]?.disposition, "merge_existing");
  assert.equal(result.entityDecisions[0]?.method, "exact_employee_id");
  assert.equal(result.entityIdMap.ent_person_ada, "person_ada");
});

test("matches projects through alias lookup", () => {
  const extraction = buildExtraction({
    entities: [
      {
        entityId: "ent_project_ekg",
        nodeType: "Project",
        label: "EKG",
        aliases: [],
        properties: {
          name: "EKG",
          status: "active",
        },
        resolution: {
          action: "create",
          normalizedKey: "project:ekg",
          candidateNodeIds: [],
        },
        confidence: 0.84,
        evidenceSpanIds: ["span_2"],
      },
    ],
  });

  const result = resolveTranscriptEntitiesForGraphWrite({
    extraction,
    canonicalEntities,
  });

  assert.equal(result.entityDecisions[0]?.disposition, "merge_existing");
  assert.equal(result.entityDecisions[0]?.method, "alias");
  assert.equal(result.entityIdMap.ent_project_ekg, "project_graph");
});

test("uses fuzzy matching only when it is confidently better than alternatives", () => {
  const extraction = buildExtraction({
    entities: [
      {
        entityId: "ent_skill_typescript",
        nodeType: "Skill",
        label: "Type Script",
        aliases: [],
        properties: {
          name: "Type Script",
        },
        resolution: {
          action: "create",
          normalizedKey: "skill:type script",
          candidateNodeIds: [],
        },
        confidence: 0.73,
        evidenceSpanIds: ["span_3"],
      },
    ],
  });

  const result = resolveTranscriptEntitiesForGraphWrite({
    extraction,
    canonicalEntities,
    policy: {
      autoMatchMinConfidence: 0.8,
      reviewMinConfidence: 0.7,
    },
  });

  assert.equal(result.entityDecisions[0]?.disposition, "merge_existing");
  assert.equal(result.entityDecisions[0]?.method, "fuzzy");
  assert.equal(result.entityIdMap.ent_skill_typescript, "skill_ts");
});

test("flags ambiguity instead of silently merging low-confidence fuzzy candidates", () => {
  const extraction = buildExtraction({
    entities: [
      {
        entityId: "ent_project_graph",
        nodeType: "Project",
        label: "Enterprise Graph",
        aliases: [],
        properties: {
          name: "Enterprise Graph",
        },
        resolution: {
          action: "create",
          normalizedKey: "project:enterprise graph",
          candidateNodeIds: [],
        },
        confidence: 0.7,
        evidenceSpanIds: ["span_4"],
      },
    ],
  });

  const result = resolveTranscriptEntitiesForGraphWrite({
    extraction,
    canonicalEntities,
    policy: {
      autoMatchMinConfidence: 0.95,
      reviewMinConfidence: 0.7,
      ambiguityDelta: 0.08,
    },
  });

  assert.equal(result.entityDecisions[0]?.disposition, "defer");
  assert.equal(result.entityIdMap.ent_project_graph, undefined);
  assert.match(result.entityDecisions[0]?.flags.join(",") ?? "", /ambiguous_match/);
});

test("creates auditable graph-write mappings for relationships and blocks unresolved event entities", () => {
  const extraction = buildExtraction({
    entities: [
      {
        entityId: "ent_person_ada",
        nodeType: "Person",
        label: "Ada Lovelace",
        aliases: [],
        properties: {
          fullName: "Ada Lovelace",
          employeeId: "E-1024",
        },
        resolution: {
          action: "create",
          normalizedKey: "person:ada lovelace",
          candidateNodeIds: [],
        },
        confidence: 0.93,
        evidenceSpanIds: ["span_5"],
      },
      {
        entityId: "ent_project_ekg",
        nodeType: "Project",
        label: "Knowledge Graph",
        aliases: [],
        properties: {
          name: "Knowledge Graph",
          status: "active",
        },
        resolution: {
          action: "create",
          normalizedKey: "project:knowledge graph",
          candidateNodeIds: [],
        },
        confidence: 0.88,
        evidenceSpanIds: ["span_6"],
      },
    ],
    relationships: [
      {
        relationshipId: "rel_1",
        type: "WORKS_ON",
        fromEntityId: "ent_person_ada",
        toEntityId: "ent_project_ekg",
        metadata: {},
        confidence: 0.91,
        evidenceSpanIds: ["span_7"],
      },
    ],
    updateEvents: [
      {
        eventId: "evt_1",
        type: "TASK_COMPLETED",
        occurredAt: "2026-03-10T12:01:00.000Z",
        actorEntityId: "ent_person_ada",
        summary: "Ada completed the graph migration task.",
        taskEntityId: "ent_task_graph_migration",
        confidence: 0.9,
        evidenceSpanIds: ["span_8"],
      },
    ],
  });

  const result = resolveTranscriptEntitiesForGraphWrite({
    extraction,
    canonicalEntities,
  });

  assert.equal(result.relationshipsReady.length, 1);
  assert.equal(result.relationshipsReady[0]?.fromNodeId, "person_ada");
  assert.equal(result.relationshipsReady[0]?.toNodeId, "project_graph");
  assert.equal(result.blockedUpdateEvents.length, 1);
  assert.deepEqual(result.blockedUpdateEvents[0]?.missingEntityIds, ["ent_task_graph_migration"]);
  assert.ok(result.entityDecisions[0]?.auditId);
});
