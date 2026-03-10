import { createHash, randomUUID } from "node:crypto";
import type {
  EntityNodeType,
  ExtractedEntity,
  ExtractedRelationship,
  ExtractedUpdateEvent,
  TranscriptExtractionOutput,
} from "@shared-types";

type ResolutionMethod = "exact_employee_id" | "exact_canonical_name" | "alias" | "fuzzy" | "create_new";
type ResolutionDisposition = "merge_existing" | "create_new" | "defer";
type ResolutionFlag =
  | "ambiguous_match"
  | "low_confidence_match"
  | "multiple_exact_candidates"
  | "multiple_fuzzy_candidates"
  | "potential_duplicate"
  | "no_candidate_found";

export interface CanonicalEntityRecord {
  nodeId: string;
  nodeType: EntityNodeType;
  canonicalName: string;
  knownCanonicalNames?: string[];
  aliases?: string[];
  employeeId?: string;
  properties?: Record<string, unknown>;
}

export interface GraphEntityResolutionPolicy {
  autoMatchMinConfidence: number;
  reviewMinConfidence: number;
  ambiguityDelta: number;
  maxCandidates: number;
}

export interface ResolutionSourceRef {
  extractionRunId: string;
  transcriptId: string;
  extractedAt: string;
  extractor: TranscriptExtractionOutput["extractor"];
  sourceEntityId: string;
  evidenceSpanIds: string[];
}

export interface ResolutionCandidateScore {
  nodeId: string;
  nodeType: EntityNodeType;
  canonicalName: string;
  method: Exclude<ResolutionMethod, "create_new">;
  score: number;
  matchedOn: string;
}

export interface ResolvedEntityDecision {
  auditId: string;
  source: ResolutionSourceRef;
  extractedEntity: ExtractedEntity;
  disposition: ResolutionDisposition;
  method: ResolutionMethod;
  confidence: number;
  flags: ResolutionFlag[];
  matchedNodeId?: string;
  outputNodeId?: string;
  normalizedKey: string;
  rationale: string;
  candidates: ResolutionCandidateScore[];
}

export interface ResolvedRelationshipWrite {
  relationship: ExtractedRelationship;
  fromNodeId: string;
  toNodeId: string;
  auditEntityDecisionIds: string[];
}

export interface BlockedRelationshipWrite {
  relationship: ExtractedRelationship;
  missingEntityIds: string[];
}

export interface ResolvedUpdateEventWrite {
  updateEvent: ExtractedUpdateEvent;
  actorNodeId: string;
  linkedNodeIds: Record<string, string | string[]>;
  auditEntityDecisionIds: string[];
}

export interface BlockedUpdateEventWrite {
  updateEvent: ExtractedUpdateEvent;
  missingEntityIds: string[];
}

export interface GraphWriteResolutionResult {
  entityDecisions: ResolvedEntityDecision[];
  relationshipsReady: ResolvedRelationshipWrite[];
  blockedRelationships: BlockedRelationshipWrite[];
  updateEventsReady: ResolvedUpdateEventWrite[];
  blockedUpdateEvents: BlockedUpdateEventWrite[];
  entityIdMap: Record<string, string>;
}

const defaultPolicy: GraphEntityResolutionPolicy = {
  autoMatchMinConfidence: 0.92,
  reviewMinConfidence: 0.75,
  ambiguityDelta: 0.03,
  maxCandidates: 5,
};

export function resolveTranscriptEntitiesForGraphWrite(input: {
  extraction: TranscriptExtractionOutput;
  canonicalEntities: CanonicalEntityRecord[];
  policy?: Partial<GraphEntityResolutionPolicy>;
}): GraphWriteResolutionResult {
  const policy = { ...defaultPolicy, ...input.policy };
  const entityDecisions = input.extraction.entities.map((entity) => resolveEntity(entity, input.extraction, input.canonicalEntities, policy));

  const entityIdMap = Object.fromEntries(
    entityDecisions
      .filter((decision) => decision.disposition !== "defer" && decision.outputNodeId)
      .map((decision) => [decision.source.sourceEntityId, decision.outputNodeId as string])
  );

  const auditDecisionIdBySourceEntityId = Object.fromEntries(
    entityDecisions.map((decision) => [decision.source.sourceEntityId, decision.auditId])
  );

  const relationshipsReady: ResolvedRelationshipWrite[] = [];
  const blockedRelationships: BlockedRelationshipWrite[] = [];

  for (const relationship of input.extraction.relationships) {
    const fromNodeId = entityIdMap[relationship.fromEntityId];
    const toNodeId = entityIdMap[relationship.toEntityId];

    if (fromNodeId && toNodeId) {
      relationshipsReady.push({
        relationship,
        fromNodeId,
        toNodeId,
        auditEntityDecisionIds: compactAuditIds([
          auditDecisionIdBySourceEntityId[relationship.fromEntityId],
          auditDecisionIdBySourceEntityId[relationship.toEntityId],
        ]),
      });
      continue;
    }

    blockedRelationships.push({
      relationship,
      missingEntityIds: [relationship.fromEntityId, relationship.toEntityId].filter((entityId) => !entityIdMap[entityId]),
    });
  }

  const updateEventsReady: ResolvedUpdateEventWrite[] = [];
  const blockedUpdateEvents: BlockedUpdateEventWrite[] = [];

  for (const updateEvent of input.extraction.updateEvents) {
    const eventResolution = remapUpdateEvent(updateEvent, entityIdMap, auditDecisionIdBySourceEntityId);
    if (eventResolution.blocked) {
      blockedUpdateEvents.push({
        updateEvent,
        missingEntityIds: eventResolution.missingEntityIds,
      });
      continue;
    }

    updateEventsReady.push({
      updateEvent,
      actorNodeId: eventResolution.actorNodeId,
      linkedNodeIds: eventResolution.linkedNodeIds,
      auditEntityDecisionIds: eventResolution.auditEntityDecisionIds,
    });
  }

  return {
    entityDecisions,
    relationshipsReady,
    blockedRelationships,
    updateEventsReady,
    blockedUpdateEvents,
    entityIdMap,
  };
}

function resolveEntity(
  entity: ExtractedEntity,
  extraction: TranscriptExtractionOutput,
  canonicalEntities: CanonicalEntityRecord[],
  policy: GraphEntityResolutionPolicy
): ResolvedEntityDecision {
  const source: ResolutionSourceRef = {
    extractionRunId: extraction.extractionRunId,
    transcriptId: extraction.transcriptId,
    extractedAt: extraction.extractedAt,
    extractor: extraction.extractor,
    sourceEntityId: entity.entityId,
    evidenceSpanIds: entity.evidenceSpanIds,
  };
  const normalizedKey = buildNormalizedKey(entity);
  const relevantCandidates = canonicalEntities.filter((candidate) => candidate.nodeType === entity.nodeType);

  const exactEmployeeMatches = entity.nodeType === "Person" ? matchByEmployeeId(entity, relevantCandidates) : [];
  if (exactEmployeeMatches.length === 1) {
    return buildMatchedDecision(entity, source, normalizedKey, exactEmployeeMatches, "exact_employee_id", 1, []);
  }
  if (exactEmployeeMatches.length > 1) {
    return buildDeferredDecision(entity, source, normalizedKey, exactEmployeeMatches, "exact_employee_id", 1, [
      "ambiguous_match",
      "multiple_exact_candidates",
    ], "Multiple person records matched the same employee ID.");
  }

  const canonicalMatches = matchByCanonicalName(entity, relevantCandidates);
  if (canonicalMatches.length === 1) {
    return buildMatchedDecision(entity, source, normalizedKey, canonicalMatches, "exact_canonical_name", 0.99, []);
  }
  if (canonicalMatches.length > 1) {
    return buildDeferredDecision(entity, source, normalizedKey, canonicalMatches, "exact_canonical_name", 0.99, [
      "ambiguous_match",
      "multiple_exact_candidates",
    ], "Multiple canonical records share the same exact name.");
  }

  const aliasMatches = supportsAliasMatching(entity.nodeType) ? matchByAlias(entity, relevantCandidates) : [];
  if (aliasMatches.length === 1) {
    return buildMatchedDecision(entity, source, normalizedKey, aliasMatches, "alias", 0.96, []);
  }
  if (aliasMatches.length > 1) {
    return buildDeferredDecision(entity, source, normalizedKey, aliasMatches, "alias", 0.96, [
      "ambiguous_match",
      "multiple_exact_candidates",
    ], "Alias matched more than one canonical record.");
  }

  const fuzzyCandidates = scoreFuzzyCandidates(entity, relevantCandidates, policy.maxCandidates);
  const bestCandidate = fuzzyCandidates[0];
  const secondCandidate = fuzzyCandidates[1];
  const ambiguityFlags: ResolutionFlag[] = [];

  if (bestCandidate && secondCandidate && bestCandidate.score - secondCandidate.score < policy.ambiguityDelta) {
    ambiguityFlags.push("ambiguous_match", "multiple_fuzzy_candidates");
  }

  if (!bestCandidate) {
    return buildCreateDecision(entity, source, normalizedKey, []);
  }

  if (bestCandidate.score >= policy.autoMatchMinConfidence && ambiguityFlags.length === 0) {
    return buildMatchedDecision(entity, source, normalizedKey, fuzzyCandidates, "fuzzy", bestCandidate.score, []);
  }

  if (bestCandidate.score >= policy.reviewMinConfidence || ambiguityFlags.length > 0) {
    return buildDeferredDecision(
      entity,
      source,
      normalizedKey,
      fuzzyCandidates,
      "fuzzy",
      bestCandidate.score,
      mergeFlags(["low_confidence_match", "potential_duplicate"], ambiguityFlags),
      "Candidate similarity was not strong enough for an automatic merge."
    );
  }

  return buildDeferredDecision(
    entity,
    source,
    normalizedKey,
    fuzzyCandidates,
    "fuzzy",
    bestCandidate.score,
    ["low_confidence_match", "potential_duplicate"],
    "Low-confidence candidate found; explicit review is required before merge or create."
  );
}

function buildMatchedDecision(
  entity: ExtractedEntity,
  source: ResolutionSourceRef,
  normalizedKey: string,
  candidates: ResolutionCandidateScore[],
  method: Exclude<ResolutionMethod, "create_new">,
  confidence: number,
  flags: ResolutionFlag[]
): ResolvedEntityDecision {
  const winner = candidates[0];
  return {
    auditId: `audit_res_${randomUUID()}`,
    source,
    extractedEntity: entity,
    disposition: "merge_existing",
    method,
    confidence,
    flags,
    matchedNodeId: winner?.nodeId,
    outputNodeId: winner?.nodeId,
    normalizedKey,
    rationale: buildRationale(method, winner?.canonicalName, confidence, "Automatic merge approved."),
    candidates,
  };
}

function buildDeferredDecision(
  entity: ExtractedEntity,
  source: ResolutionSourceRef,
  normalizedKey: string,
  candidates: ResolutionCandidateScore[],
  method: Exclude<ResolutionMethod, "create_new">,
  confidence: number,
  flags: ResolutionFlag[],
  rationale: string
): ResolvedEntityDecision {
  return {
    auditId: `audit_res_${randomUUID()}`,
    source,
    extractedEntity: entity,
    disposition: "defer",
    method,
    confidence,
    flags,
    normalizedKey,
    rationale,
    candidates,
  };
}

function buildCreateDecision(
  entity: ExtractedEntity,
  source: ResolutionSourceRef,
  normalizedKey: string,
  candidates: ResolutionCandidateScore[]
): ResolvedEntityDecision {
  return {
    auditId: `audit_res_${randomUUID()}`,
    source,
    extractedEntity: entity,
    disposition: "create_new",
    method: "create_new",
    confidence: 1,
    flags: ["no_candidate_found"],
    outputNodeId: buildProposedNodeId(entity.nodeType, normalizedKey),
    normalizedKey,
    rationale: "No existing canonical entity met exact, alias, or fuzzy matching thresholds.",
    candidates,
  };
}

function matchByEmployeeId(entity: ExtractedEntity, candidates: CanonicalEntityRecord[]): ResolutionCandidateScore[] {
  if (entity.nodeType !== "Person") {
    return [];
  }

  const employeeId = normalizeEmployeeId(entity.properties.employeeId);
  if (!employeeId) {
    return [];
  }

  return candidates
    .filter((candidate) => normalizeEmployeeId(candidate.employeeId) === employeeId)
    .map((candidate) => ({
      nodeId: candidate.nodeId,
      nodeType: candidate.nodeType,
      canonicalName: candidate.canonicalName,
      method: "exact_employee_id",
      score: 1,
      matchedOn: `employeeId:${employeeId}`,
    }));
}

function matchByCanonicalName(entity: ExtractedEntity, candidates: CanonicalEntityRecord[]): ResolutionCandidateScore[] {
  const sourceNames = new Set(candidateStringsForEntity(entity).map(normalizeText));
  return candidates
    .flatMap((candidate) => {
      const canonicalNames = [candidate.canonicalName, ...(candidate.knownCanonicalNames ?? [])];
      const matchedName = canonicalNames.find((name) => sourceNames.has(normalizeText(name)));
      if (!matchedName) {
        return [];
      }

      return [
        {
          nodeId: candidate.nodeId,
          nodeType: candidate.nodeType,
          canonicalName: candidate.canonicalName,
          method: "exact_canonical_name" as const,
          score: 0.99,
          matchedOn: matchedName,
        },
      ];
    });
}

function matchByAlias(entity: ExtractedEntity, candidates: CanonicalEntityRecord[]): ResolutionCandidateScore[] {
  const sourceNames = new Set(candidateStringsForEntity(entity).map(normalizeText));
  return candidates
    .flatMap((candidate) => {
      const alias = (candidate.aliases ?? []).find((value) => sourceNames.has(normalizeText(value)));
      if (!alias) {
        return [];
      }

      return [
        {
          nodeId: candidate.nodeId,
          nodeType: candidate.nodeType,
          canonicalName: candidate.canonicalName,
          method: "alias" as const,
          score: 0.96,
          matchedOn: alias,
        },
      ];
    });
}

function scoreFuzzyCandidates(
  entity: ExtractedEntity,
  candidates: CanonicalEntityRecord[],
  maxCandidates: number
): ResolutionCandidateScore[] {
  const sourceNames = candidateStringsForEntity(entity);
  const scoredCandidates: ResolutionCandidateScore[] = [];

  for (const candidate of candidates) {
      const targetNames = [candidate.canonicalName, ...(candidate.knownCanonicalNames ?? []), ...(candidate.aliases ?? [])];
      const scored = bestNameSimilarity(sourceNames, targetNames);
      if (!scored) {
        continue;
      }

      scoredCandidates.push({
        nodeId: candidate.nodeId,
        nodeType: candidate.nodeType,
        canonicalName: candidate.canonicalName,
        method: "fuzzy",
        score: scored.score,
        matchedOn: `${scored.left} ~ ${scored.right}`,
      });
  }

  return scoredCandidates.sort((left, right) => right.score - left.score).slice(0, maxCandidates);
}

function remapUpdateEvent(
  updateEvent: ExtractedUpdateEvent,
  entityIdMap: Record<string, string>,
  auditDecisionIdBySourceEntityId: Record<string, string>
):
  | {
      blocked: false;
      actorNodeId: string;
      linkedNodeIds: Record<string, string | string[]>;
      auditEntityDecisionIds: string[];
    }
  | {
      blocked: true;
      missingEntityIds: string[];
    } {
  const missing = new Set<string>();
  const auditIds = new Set<string>();
  const actorNodeId = entityIdMap[updateEvent.actorEntityId];

  if (!actorNodeId) {
    missing.add(updateEvent.actorEntityId);
  } else {
    addAuditId(auditIds, auditDecisionIdBySourceEntityId[updateEvent.actorEntityId]);
  }

  const linkedNodeIds: Record<string, string | string[]> = {};

  const mapSingle = (key: string, sourceEntityId: string | undefined) => {
    if (!sourceEntityId) {
      return;
    }
    const mappedId = entityIdMap[sourceEntityId];
    if (!mappedId) {
      missing.add(sourceEntityId);
      return;
    }
    linkedNodeIds[key] = mappedId;
    addAuditId(auditIds, auditDecisionIdBySourceEntityId[sourceEntityId]);
  };

  const mapArray = (key: string, sourceEntityIds: string[] | undefined) => {
    if (!sourceEntityIds) {
      return;
    }
    const mappedIds: string[] = [];
    for (const sourceEntityId of sourceEntityIds) {
      const mappedId = entityIdMap[sourceEntityId];
      if (!mappedId) {
        missing.add(sourceEntityId);
        continue;
      }
      mappedIds.push(mappedId);
      addAuditId(auditIds, auditDecisionIdBySourceEntityId[sourceEntityId]);
    }
    linkedNodeIds[key] = mappedIds;
  };

  switch (updateEvent.type) {
    case "TASK_PROGRESS_REPORTED":
    case "TASK_COMPLETED":
      mapSingle("taskNodeId", updateEvent.taskEntityId);
      break;
    case "BLOCKER_REPORTED":
      mapSingle("blockerNodeId", updateEvent.blockerEntityId);
      mapArray("affectedTaskNodeIds", updateEvent.affectedTaskEntityIds);
      break;
    case "BLOCKER_RESOLVED":
      mapSingle("blockerNodeId", updateEvent.blockerEntityId);
      break;
    case "MEETING_NOTED":
      mapSingle("meetingNodeId", updateEvent.meetingEntityId);
      break;
    case "DAILY_SUMMARY_RECORDED":
      break;
  }

  if (missing.size > 0 || !actorNodeId) {
    return {
      blocked: true,
      missingEntityIds: [...missing],
    };
  }

  return {
    blocked: false,
    actorNodeId,
    linkedNodeIds,
    auditEntityDecisionIds: [...auditIds],
  };
}

function candidateStringsForEntity(entity: ExtractedEntity): string[] {
  const values = new Set<string>([entity.label, ...entity.aliases]);

  switch (entity.nodeType) {
    case "Person":
      values.add(entity.properties.fullName);
      break;
    case "Team":
    case "Project":
    case "Skill":
      values.add(entity.properties.name);
      break;
    case "Task":
    case "Blocker":
    case "Meeting":
      values.add(entity.properties.title);
      break;
  }

  return [...values].filter(isNonEmptyText);
}

function bestNameSimilarity(leftValues: string[], rightValues: string[]): { left: string; right: string; score: number } | undefined {
  let best: { left: string; right: string; score: number } | undefined;

  for (const left of leftValues) {
    for (const right of rightValues) {
      const score = similarityScore(left, right);
      if (!best || score > best.score) {
        best = { left, right, score };
      }
    }
  }

  return best;
}

function similarityScore(left: string, right: string): number {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  const collapsedLeft = collapseNormalizedText(normalizedLeft);
  const collapsedRight = collapseNormalizedText(normalizedRight);

  if (normalizedLeft.length === 0 || normalizedRight.length === 0) {
    return 0;
  }

  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  if (collapsedLeft === collapsedRight) {
    return 0.98;
  }

  const editDistanceScore = 1 - levenshteinDistance(normalizedLeft, normalizedRight) / Math.max(normalizedLeft.length, normalizedRight.length);
  const tokenScore = diceCoefficient(tokenize(normalizedLeft), tokenize(normalizedRight));
  const phraseScore = diceCoefficient(buildBigrams(normalizedLeft), buildBigrams(normalizedRight));

  return Number(((editDistanceScore * 0.45) + (tokenScore * 0.35) + (phraseScore * 0.2)).toFixed(4));
}

function levenshteinDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let row = 0; row < rows; row += 1) {
    matrix[row]![0] = row;
  }

  for (let col = 0; col < cols; col += 1) {
    matrix[0]![col] = col;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      matrix[row]![col] = Math.min(
        matrix[row - 1]![col]! + 1,
        matrix[row]![col - 1]! + 1,
        matrix[row - 1]![col - 1]! + cost
      );
    }
  }

  return matrix[left.length]![right.length]!;
}

function diceCoefficient(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const rightCounts = new Map<string, number>();
  for (const item of right) {
    rightCounts.set(item, (rightCounts.get(item) ?? 0) + 1);
  }

  let matches = 0;
  for (const item of left) {
    const count = rightCounts.get(item) ?? 0;
    if (count > 0) {
      matches += 1;
      rightCounts.set(item, count - 1);
    }
  }

  return (2 * matches) / (left.length + right.length);
}

function tokenize(value: string): string[] {
  return value.split(" ").filter(isNonEmptyText);
}

function buildBigrams(value: string): string[] {
  if (value.length < 2) {
    return [value];
  }

  const bigrams: string[] = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    bigrams.push(value.slice(index, index + 2));
  }
  return bigrams;
}

function buildNormalizedKey(entity: ExtractedEntity): string {
  const primaryValue = candidateStringsForEntity(entity)[0] ?? entity.entityId;
  return `${entity.nodeType.toLowerCase()}:${normalizeText(primaryValue)}`;
}

function buildProposedNodeId(nodeType: EntityNodeType, normalizedKey: string): string {
  const suffix = createHash("sha1").update(normalizedKey).digest("hex").slice(0, 8);
  const slug = normalizedKey
    .replace(/^[^:]+:/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return `${nodeType.toLowerCase()}_${slug || "node"}_${suffix}`;
}

function supportsAliasMatching(nodeType: EntityNodeType): boolean {
  return nodeType === "Project" || nodeType === "Team" || nodeType === "Skill";
}

function normalizeText(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ");
}

function collapseNormalizedText(value: string): string {
  return value.replace(/\s+/g, "");
}

function normalizeEmployeeId(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized.length > 0 ? normalized : undefined;
}

function buildRationale(
  method: Exclude<ResolutionMethod, "create_new">,
  canonicalName: string | undefined,
  confidence: number,
  decision: string
): string {
  const target = canonicalName ? ` against "${canonicalName}"` : "";
  return `${method} matched${target} with confidence ${confidence.toFixed(2)}. ${decision}`;
}

function addAuditId(target: Set<string>, value: string | undefined) {
  if (value) {
    target.add(value);
  }
}

function compactAuditIds(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function mergeFlags(base: ResolutionFlag[], extra: ResolutionFlag[]): ResolutionFlag[] {
  return [...new Set([...base, ...extra])];
}

function isNonEmptyText(value: string): boolean {
  return value.trim().length > 0;
}
