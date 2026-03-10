import assert from "node:assert/strict";
import test from "node:test";
import type { MaterializedFact } from "./current-state-materializer.js";
import { reconcileCandidateFactsWithCurrentState } from "./fact-conflict-handler.js";

function buildFact(input: Partial<MaterializedFact> & Pick<MaterializedFact, "factKey" | "relationshipType" | "fromNodeId" | "toNodeId">): MaterializedFact {
  return {
    factId: `fact:${input.factKey}`,
    factKey: input.factKey,
    relationshipType: input.relationshipType,
    category: input.category ?? (input.relationshipType === "OWNS" || input.relationshipType === "HAS_SKILL" ? "structural" : "operational"),
    fromNodeId: input.fromNodeId,
    toNodeId: input.toNodeId,
    confidence: input.confidence ?? 0.9,
    validFrom: input.validFrom ?? "2026-03-10T10:00:00.000Z",
    validTo: input.validTo ?? null,
    firstSeenAt: input.firstSeenAt ?? "2026-03-10T10:00:00.000Z",
    lastSeenAt: input.lastSeenAt ?? "2026-03-10T10:00:00.000Z",
    active: input.active ?? true,
    temporary: input.temporary ?? false,
    sourceEventIds: input.sourceEventIds ?? ["evt_1"],
    sourceAssertionKeys: input.sourceAssertionKeys ?? ["assertion_1"],
    supportingChunkIds: input.supportingChunkIds ?? ["chunk_1"],
    observationCount: input.observationCount ?? 1,
    appliedRuleId: input.appliedRuleId ?? "rule_1",
    metadata: input.metadata ?? {},
  };
}

test("keeps uncontested candidate facts writeable", () => {
  const result = reconcileCandidateFactsWithCurrentState({
    currentFacts: [],
    candidateFacts: [
      buildFact({
        factKey: "WORKS_ON:person_ada:task_graph",
        relationshipType: "WORKS_ON",
        fromNodeId: "person_ada",
        toNodeId: "task_graph",
        confidence: 0.82,
      }),
    ],
    asOf: "2026-03-12T00:00:00.000Z",
  });

  assert.equal(result.factsToUpsert.length, 1);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.conflictingCandidateFacts.length, 0);
});

test("merges reinforcing claims with the same fact key instead of treating them as contradictions", () => {
  const result = reconcileCandidateFactsWithCurrentState({
    currentFacts: [
      buildFact({
        factKey: "WORKS_ON:person_ada:task_graph",
        relationshipType: "WORKS_ON",
        fromNodeId: "person_ada",
        toNodeId: "task_graph",
        confidence: 0.78,
        observationCount: 2,
        sourceEventIds: ["evt_old"],
      }),
    ],
    candidateFacts: [
      buildFact({
        factKey: "WORKS_ON:person_ada:task_graph",
        relationshipType: "WORKS_ON",
        fromNodeId: "person_ada",
        toNodeId: "task_graph",
        confidence: 0.83,
        observationCount: 1,
        sourceEventIds: ["evt_new"],
      }),
    ],
  });

  assert.equal(result.conflicts.length, 0);
  assert.equal(result.factsToUpsert.length, 1);
  assert.ok((result.factsToUpsert[0]?.confidence ?? 0) > 0.83);
  assert.deepEqual(result.factsToUpsert[0]?.sourceEventIds, ["evt_old", "evt_new"]);
});

test("marks contradictory OWNS claims explicitly and does not silently overwrite current state", () => {
  const currentFact = buildFact({
    factKey: "OWNS:person_ada:project_graph",
    relationshipType: "OWNS",
    fromNodeId: "person_ada",
    toNodeId: "project_graph",
    confidence: 0.93,
    sourceEventIds: ["evt_current"],
  });
  const candidateFact = buildFact({
    factKey: "OWNS:person_grace:project_graph",
    relationshipType: "OWNS",
    fromNodeId: "person_grace",
    toNodeId: "project_graph",
    confidence: 0.89,
    sourceEventIds: ["evt_candidate"],
  });

  const result = reconcileCandidateFactsWithCurrentState({
    currentFacts: [currentFact],
    candidateFacts: [candidateFact],
    asOf: "2026-03-12T00:00:00.000Z",
  });

  assert.equal(result.factsToUpsert.length, 0);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.reviewQueue.length, 1);
  assert.equal(result.conflicts[0]?.status, "review_required");
  assert.equal(result.conflicts[0]?.currentFactKeys[0], currentFact.factKey);
  assert.equal(result.conflicts[0]?.candidateFactKeys[0], candidateFact.factKey);
  assert.equal(result.conflictingCandidateFacts.length, 1);
  assert.equal(result.currentFactUpdates.length, 1);
  assert.ok((result.conflictingCandidateFacts[0]?.confidence ?? 1) < candidateFact.confidence);
  assert.ok((result.currentFactUpdates[0]?.confidence ?? 1) < currentFact.confidence);
  assert.equal(result.conflictingCandidateFacts[0]?.metadata.conflictStatus, "review_required");
});

test("captures multiple competing claims with provenance for admin review", () => {
  const result = reconcileCandidateFactsWithCurrentState({
    currentFacts: [
      buildFact({
        factKey: "OWNS:person_ada:project_graph",
        relationshipType: "OWNS",
        fromNodeId: "person_ada",
        toNodeId: "project_graph",
        confidence: 0.93,
        sourceEventIds: ["evt_current"],
        supportingChunkIds: ["chunk_current"],
      }),
    ],
    candidateFacts: [
      buildFact({
        factKey: "OWNS:person_grace:project_graph",
        relationshipType: "OWNS",
        fromNodeId: "person_grace",
        toNodeId: "project_graph",
        confidence: 0.89,
        sourceEventIds: ["evt_candidate_1"],
        supportingChunkIds: ["chunk_candidate_1"],
      }),
      buildFact({
        factKey: "OWNS:person_lin:project_graph",
        relationshipType: "OWNS",
        fromNodeId: "person_lin",
        toNodeId: "project_graph",
        confidence: 0.87,
        sourceEventIds: ["evt_candidate_2"],
        supportingChunkIds: ["chunk_candidate_2"],
      }),
    ],
    asOf: "2026-03-12T00:00:00.000Z",
  });

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0]?.severity, "medium");
  assert.equal(result.conflicts[0]?.competingClaims.length, 3);
  assert.equal(result.conflicts[0]?.ui.currentClaimsCount, 1);
  assert.equal(result.conflicts[0]?.ui.candidateClaimsCount, 2);
  assert.deepEqual(
    result.conflicts[0]?.competingClaims.map((claim) => claim.source),
    ["current", "candidate", "candidate"]
  );
  assert.ok(result.conflicts[0]?.competingClaims.every((claim) => claim.sourceEventIds.length > 0));
});
