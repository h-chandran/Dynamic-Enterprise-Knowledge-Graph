import type { RelationshipType } from "@shared-types";
import type { MaterializedFact } from "./current-state-materializer.js";

type ConflictStatus = "open" | "review_required";
type ConflictSeverity = "low" | "medium" | "high";
type ClaimSource = "current" | "candidate";
type ContradictionKind = "exclusive_scope_conflict";
type ConflictAwareRelationshipType = Extract<RelationshipType, "WORKS_ON" | "OWNS" | "BLOCKED_BY" | "HAS_SKILL">;

export interface FactClaimSnapshot {
  factKey: string;
  relationshipType: ConflictAwareRelationshipType;
  source: ClaimSource;
  fromNodeId: string;
  toNodeId: string;
  confidence: number;
  active: boolean;
  validFrom: string;
  validTo: string | null;
  lastSeenAt: string;
  sourceEventIds: string[];
  supportingChunkIds: string[];
  metadata: Record<string, unknown>;
}

export interface ConflictRule {
  id: string;
  relationshipType: ConflictAwareRelationshipType;
  description: string;
  scopeKey(fact: MaterializedFact): string | undefined;
  isConflict(left: MaterializedFact, right: MaterializedFact): boolean;
}

export interface ConflictHandlingPolicy {
  confidencePenaltyPerCompetingClaim: number;
  maxConfidencePenalty: number;
}

export interface FactConflictRecord {
  conflictId: string;
  ruleId: string;
  contradictionKind: ContradictionKind;
  status: ConflictStatus;
  severity: ConflictSeverity;
  relationshipType: ConflictAwareRelationshipType;
  scopeKey: string;
  detectedAt: string;
  confidencePenaltyApplied: number;
  currentFactKeys: string[];
  candidateFactKeys: string[];
  competingClaims: FactClaimSnapshot[];
  ui: {
    title: string;
    summary: string;
    currentClaimsCount: number;
    candidateClaimsCount: number;
  };
}

export interface ConflictHandlingResult {
  factsToUpsert: MaterializedFact[];
  currentFactUpdates: MaterializedFact[];
  conflictingCandidateFacts: MaterializedFact[];
  conflicts: FactConflictRecord[];
  reviewQueue: FactConflictRecord[];
}

const defaultPolicy: ConflictHandlingPolicy = {
  confidencePenaltyPerCompetingClaim: 0.1,
  maxConfidencePenalty: 0.35,
};

export const defaultConflictRules: ConflictRule[] = [
  {
    id: "owns_single_owner_per_target",
    relationshipType: "OWNS",
    description: "A given target should not have multiple active owners without review.",
    scopeKey(fact) {
      return fact.relationshipType === "OWNS" && fact.active ? `OWNS:target:${fact.toNodeId}` : undefined;
    },
    isConflict(left, right) {
      return left.relationshipType === "OWNS" && right.relationshipType === "OWNS" && left.toNodeId === right.toNodeId && left.fromNodeId !== right.fromNodeId;
    },
  },
];

export function reconcileCandidateFactsWithCurrentState(input: {
  currentFacts: MaterializedFact[];
  candidateFacts: MaterializedFact[];
  asOf?: string;
  rules?: ConflictRule[];
  policy?: Partial<ConflictHandlingPolicy>;
}): ConflictHandlingResult {
  const asOf = input.asOf ?? new Date().toISOString();
  const rules = input.rules ?? defaultConflictRules;
  const policy = { ...defaultPolicy, ...input.policy };

  const currentByKey = new Map(input.currentFacts.map((fact) => [fact.factKey, fact]));
  const exactMatches = new Set<string>();
  const mergedFacts: MaterializedFact[] = [];

  for (const candidateFact of input.candidateFacts) {
    const currentFact = currentByKey.get(candidateFact.factKey);
    if (!currentFact) {
      continue;
    }

    mergedFacts.push(mergeReinforcingFacts(currentFact, candidateFact));
    exactMatches.add(candidateFact.factKey);
  }

  const nonMatchingCandidates = input.candidateFacts.filter((fact) => !exactMatches.has(fact.factKey));
  const conflictBundles = detectConflicts({
    currentFacts: input.currentFacts,
    candidateFacts: nonMatchingCandidates,
    rules,
    asOf,
    policy,
  });

  const conflictingCandidateKeys = new Set(
    conflictBundles.flatMap((bundle) => bundle.candidateFacts.map((fact) => fact.factKey))
  );
  const conflictedCurrentKeys = new Set(
    conflictBundles.flatMap((bundle) => bundle.currentFacts.map((fact) => fact.factKey))
  );

  const uncontestedCandidates = nonMatchingCandidates.filter((fact) => !conflictingCandidateKeys.has(fact.factKey));
  const currentFactUpdates = input.currentFacts
    .filter((fact) => conflictedCurrentKeys.has(fact.factKey))
    .map((fact) => {
      const bundle = conflictBundles.find((item) => item.currentFacts.some((currentFact) => currentFact.factKey === fact.factKey));
      return bundle ? applyConflictPenalty(fact, bundle.penalty, bundle.conflictId, "current") : fact;
    });

  const conflictingCandidateFacts = nonMatchingCandidates
    .filter((fact) => conflictingCandidateKeys.has(fact.factKey))
    .map((fact) => {
      const bundle = conflictBundles.find((item) => item.candidateFacts.some((candidateFact) => candidateFact.factKey === fact.factKey));
      return bundle ? applyConflictPenalty(fact, bundle.penalty, bundle.conflictId, "candidate") : fact;
    });

  const factsToUpsert = [...mergedFacts, ...uncontestedCandidates].sort((left, right) => left.factKey.localeCompare(right.factKey));
  const conflicts = conflictBundles.map((bundle) => bundle.record);

  return {
    factsToUpsert,
    currentFactUpdates,
    conflictingCandidateFacts,
    conflicts,
    reviewQueue: conflicts,
  };
}

function detectConflicts(input: {
  currentFacts: MaterializedFact[];
  candidateFacts: MaterializedFact[];
  rules: ConflictRule[];
  asOf: string;
  policy: ConflictHandlingPolicy;
}): Array<{
  conflictId: string;
  penalty: number;
  currentFacts: MaterializedFact[];
  candidateFacts: MaterializedFact[];
  record: FactConflictRecord;
}> {
  const bundles: Array<{
    conflictId: string;
    penalty: number;
    currentFacts: MaterializedFact[];
    candidateFacts: MaterializedFact[];
    record: FactConflictRecord;
  }> = [];

  for (const rule of input.rules) {
    const groups = new Map<string, { currentFacts: MaterializedFact[]; candidateFacts: MaterializedFact[] }>();

    for (const currentFact of input.currentFacts) {
      const scope = rule.scopeKey(currentFact);
      if (!scope) {
        continue;
      }
      const group = groups.get(scope) ?? { currentFacts: [], candidateFacts: [] };
      group.currentFacts.push(currentFact);
      groups.set(scope, group);
    }

    for (const candidateFact of input.candidateFacts) {
      const scope = rule.scopeKey(candidateFact);
      if (!scope) {
        continue;
      }
      const group = groups.get(scope) ?? { currentFacts: [], candidateFacts: [] };
      group.candidateFacts.push(candidateFact);
      groups.set(scope, group);
    }

    for (const [scopeKey, group] of groups.entries()) {
      if (group.currentFacts.length === 0 || group.candidateFacts.length === 0) {
        continue;
      }

      const conflictingCurrentFacts = group.currentFacts.filter((currentFact) =>
        group.candidateFacts.some((candidateFact) => rule.isConflict(currentFact, candidateFact))
      );
      const conflictingCandidateFacts = group.candidateFacts.filter((candidateFact) =>
        group.currentFacts.some((currentFact) => rule.isConflict(currentFact, candidateFact))
      );

      if (conflictingCurrentFacts.length === 0 || conflictingCandidateFacts.length === 0) {
        continue;
      }

      const competingClaimsCount = conflictingCurrentFacts.length + conflictingCandidateFacts.length;
      const penalty = Math.min(input.policy.maxConfidencePenalty, (competingClaimsCount - 1) * input.policy.confidencePenaltyPerCompetingClaim);
      const conflictId = `conflict:${rule.id}:${scopeKey}`;
      const record = buildConflictRecord({
        conflictId,
        rule,
        scopeKey,
        currentFacts: conflictingCurrentFacts,
        candidateFacts: conflictingCandidateFacts,
        detectedAt: input.asOf,
        penalty,
      });

      bundles.push({
        conflictId,
        penalty,
        currentFacts: conflictingCurrentFacts,
        candidateFacts: conflictingCandidateFacts,
        record,
      });
    }
  }

  return bundles.sort((left, right) => left.record.conflictId.localeCompare(right.record.conflictId));
}

function buildConflictRecord(input: {
  conflictId: string;
  rule: ConflictRule;
  scopeKey: string;
  currentFacts: MaterializedFact[];
  candidateFacts: MaterializedFact[];
  detectedAt: string;
  penalty: number;
}): FactConflictRecord {
  const competingClaims = [
    ...input.currentFacts.map((fact) => toClaimSnapshot(fact, "current")),
    ...input.candidateFacts.map((fact) => toClaimSnapshot(fact, "candidate")),
  ];

  return {
    conflictId: input.conflictId,
    ruleId: input.rule.id,
    contradictionKind: "exclusive_scope_conflict",
    status: "review_required",
    severity: severityForClaims(competingClaims.length),
    relationshipType: input.rule.relationshipType,
    scopeKey: input.scopeKey,
    detectedAt: input.detectedAt,
    confidencePenaltyApplied: input.penalty,
    currentFactKeys: input.currentFacts.map((fact) => fact.factKey),
    candidateFactKeys: input.candidateFacts.map((fact) => fact.factKey),
    competingClaims,
    ui: {
      title: `${input.rule.relationshipType} contradiction`,
      summary: `${input.candidateFacts.length} new claim(s) disagree with ${input.currentFacts.length} current claim(s) for ${input.scopeKey}.`,
      currentClaimsCount: input.currentFacts.length,
      candidateClaimsCount: input.candidateFacts.length,
    },
  };
}

function mergeReinforcingFacts(currentFact: MaterializedFact, candidateFact: MaterializedFact): MaterializedFact {
  return {
    ...candidateFact,
    confidence: Number(Math.min(1, Math.max(currentFact.confidence, candidateFact.confidence) + 0.03).toFixed(4)),
    validFrom: currentFact.validFrom < candidateFact.validFrom ? currentFact.validFrom : candidateFact.validFrom,
    validTo: laterInstant(currentFact.validTo, candidateFact.validTo),
    firstSeenAt: currentFact.firstSeenAt < candidateFact.firstSeenAt ? currentFact.firstSeenAt : candidateFact.firstSeenAt,
    lastSeenAt: currentFact.lastSeenAt > candidateFact.lastSeenAt ? currentFact.lastSeenAt : candidateFact.lastSeenAt,
    active: currentFact.active || candidateFact.active,
    temporary: currentFact.temporary || candidateFact.temporary,
    sourceEventIds: unique([...currentFact.sourceEventIds, ...candidateFact.sourceEventIds]),
    sourceAssertionKeys: unique([...currentFact.sourceAssertionKeys, ...candidateFact.sourceAssertionKeys]),
    supportingChunkIds: unique([...currentFact.supportingChunkIds, ...candidateFact.supportingChunkIds]),
    observationCount: currentFact.observationCount + candidateFact.observationCount,
    metadata: {
      ...currentFact.metadata,
      ...candidateFact.metadata,
      mergedFromFactKeys: unique([currentFact.factKey, candidateFact.factKey]),
      reinforcementCount: currentFact.observationCount + candidateFact.observationCount,
    },
  };
}

function applyConflictPenalty(
  fact: MaterializedFact,
  penalty: number,
  conflictId: string,
  source: ClaimSource
): MaterializedFact {
  return {
    ...fact,
    confidence: Number(Math.max(0, fact.confidence - penalty).toFixed(4)),
    metadata: {
      ...fact.metadata,
      conflictStatus: "review_required",
      contradictionOpen: true,
      contradictionConflictId: conflictId,
      contradictionClaimSource: source,
      contradictionPenaltyApplied: penalty,
    },
  };
}

function toClaimSnapshot(fact: MaterializedFact, source: ClaimSource): FactClaimSnapshot {
  return {
    factKey: fact.factKey,
    relationshipType: fact.relationshipType,
    source,
    fromNodeId: fact.fromNodeId,
    toNodeId: fact.toNodeId,
    confidence: fact.confidence,
    active: fact.active,
    validFrom: fact.validFrom,
    validTo: fact.validTo,
    lastSeenAt: fact.lastSeenAt,
    sourceEventIds: [...fact.sourceEventIds],
    supportingChunkIds: [...fact.supportingChunkIds],
    metadata: { ...fact.metadata },
  };
}

function severityForClaims(claimCount: number): ConflictSeverity {
  if (claimCount >= 4) {
    return "high";
  }
  if (claimCount >= 3) {
    return "medium";
  }
  return "low";
}

function laterInstant(left: string | null, right: string | null): string | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return left > right ? left : right;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
