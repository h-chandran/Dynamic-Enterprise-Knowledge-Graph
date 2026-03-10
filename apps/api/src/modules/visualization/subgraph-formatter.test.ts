import assert from "node:assert/strict";
import test from "node:test";
import { formatVisualizationSubgraph } from "./subgraph-formatter.js";

test("formats frontend-ready subgraph payloads with derived metadata and confidence summaries", () => {
  const result = formatVisualizationSubgraph({
    kind: "project",
    focusNodeId: "project_alpha",
    nodes: [
      {
        id: "project_alpha",
        type: "Project",
        properties: {
          name: "Alpha",
          status: "active",
          confidenceJson: JSON.stringify({
            score: 0.91,
            method: "hybrid",
            evaluatedAt: "2026-03-10T12:00:00.000Z",
          }),
        },
        createdAt: "2026-03-01T12:00:00.000Z",
        updatedAt: "2026-03-10T12:00:00.000Z",
      },
      {
        id: "task_launch",
        type: "Task",
        properties: {
          title: "Launch prep",
          status: "blocked",
        },
        createdAt: "2026-03-02T12:00:00.000Z",
        updatedAt: "2026-03-10T10:00:00.000Z",
      },
    ],
    edges: [
      {
        id: "WORKS_ON:person_ada:task_launch",
        type: "WORKS_ON",
        source: "project_alpha",
        target: "task_launch",
        properties: {
          confidence: 0.82,
          active: true,
          observationCount: 2,
          materializedAt: "2026-03-10T12:00:00.000Z",
          sourceEventIdsJson: JSON.stringify(["evt_1"]),
        },
        createdAt: "2026-03-05T12:00:00.000Z",
        updatedAt: "2026-03-10T12:00:00.000Z",
      },
    ],
    recentUpdates: [
      {
        eventId: "evt_1",
        eventType: "TASK_PROGRESS_REPORTED",
        summary: "Launch prep is blocked on approvals.",
        occurredAt: "2026-03-10T11:00:00.000Z",
        actorId: "person_ada",
        connectedNodeIds: ["project_alpha", "task_launch"],
        confidenceJson: JSON.stringify({
          score: 0.77,
          method: "hybrid",
          evaluatedAt: "2026-03-10T11:30:00.000Z",
        }),
      },
    ],
    generatedAt: "2026-03-10T12:00:00.000Z",
  });

  assert.equal(result.nodes[0]?.label, "Alpha");
  assert.equal(result.nodeMetadata.project_alpha?.degree, 1);
  assert.equal(result.nodeMetadata.task_launch?.recentUpdateCount, 1);
  assert.equal(result.edgeMetadata["WORKS_ON:person_ada:task_launch"]?.active, true);
  assert.deepEqual(result.edgeMetadata["WORKS_ON:person_ada:task_launch"]?.sourceEventIds, ["evt_1"]);
  assert.equal(result.confidence.nodes.average, 0.91);
  assert.equal(result.confidence.edges.average, 0.82);
  assert.equal(result.confidence.updates.average, 0.77);
  assert.equal(result.timestamps.newestActivityAt, "2026-03-10T12:00:00.000Z");
});

test("keeps raw properties clean by stripping serialized json helper fields", () => {
  const result = formatVisualizationSubgraph({
    kind: "blocker_focus",
    nodes: [
      {
        id: "blocker_security",
        type: "Blocker",
        properties: {
          title: "Security review",
          severity: "high",
          provenanceJson: JSON.stringify({
            sourceSystem: "zoom",
            assertedBy: "tester",
            assertedAt: "2026-03-10T12:00:00.000Z",
          }),
        },
      },
    ],
    edges: [],
    recentUpdates: [],
    generatedAt: "2026-03-10T12:00:00.000Z",
  });

  assert.deepEqual(result.nodeMetadata.blocker_security?.rawProperties, {
    title: "Security review",
    severity: "high",
  });
  assert.equal(result.nodeMetadata.blocker_security?.provenance?.sourceSystem, "zoom");
});
