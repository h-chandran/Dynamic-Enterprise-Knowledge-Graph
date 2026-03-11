import type {
  InsightCard,
  InsightConfidenceLevel,
  InsightEntityReference,
  InsightFact,
  InsightRecommendation,
  InsightsDashboardResponse,
  InsightSeverity,
  StaffingHypothesis,
} from "@shared-types";
import { getNeo4jSession } from "../../infrastructure/database/neo4j.js";

type RawMetricRow = Record<string, unknown>;

interface RepeatedBlockerRow {
  focusType: "person" | "team" | "system";
  entityId: string;
  entityLabel: string;
  secondaryLabel: string;
  blockerCount: number;
  blockedWorkCount: number;
  sampleBlockers: string[];
  score: number;
}

interface SkillGapRow {
  skillId: string;
  skillLabel: string;
  category: string;
  providerCount: number;
  teamCoverageCount: number;
  projectCount: number;
  blockerCount: number;
  score: number;
}

interface OverloadRow {
  personId: string;
  personLabel: string;
  title: string;
  projectCount: number;
  taskCount: number;
  blockerCount: number;
  soleOwnershipCount: number;
  teamName: string;
  score: number;
}

export class InsightServiceUnavailableError extends Error {
  constructor(message = "Insight data is currently unavailable.") {
    super(message);
    this.name = "InsightServiceUnavailableError";
  }
}

export class InsightNotFoundError extends Error {
  constructor(insightId: string) {
    super(`Insight "${insightId}" was not found.`);
    this.name = "InsightNotFoundError";
  }
}

export class InsightService {
  async getDashboard(limit: number): Promise<InsightsDashboardResponse> {
    const generatedAt = new Date().toISOString();

    try {
      const [repeatedBlockers, skillGaps, overloads] = await Promise.all([
        getRepeatedBlockerRows(limit),
        getSkillGapRows(limit),
        getOverloadRows(limit),
      ]);

      const cards = [
        ...repeatedBlockers.map(buildRepeatedBlockerCard),
        ...skillGaps.map(buildSkillGapCard),
        ...overloads.map(buildOverloadCard),
      ]
        .sort((left, right) => right.score - left.score)
        .slice(0, Math.max(limit, 3));

      return {
        generatedAt,
        cards,
        staffingHypotheses: buildStaffingHypotheses(cards, limit),
        methodology: {
          factsLabel: "confirmed_graph_evidence",
          recommendationsLabel: "inferred_hypotheses",
          uncertaintyPrinciple:
            "Confirmed facts come directly from graph counts and relationships. Recommendations remain inferred hypotheses and should be validated with managers, teams, or operating context before action.",
        },
      };
    } catch (error) {
      throw new InsightServiceUnavailableError(error instanceof Error ? error.message : undefined);
    }
  }

  async getInsight(insightId: string, limit: number): Promise<InsightCard | StaffingHypothesis> {
    const dashboard = await this.getDashboard(limit);
    const insight =
      dashboard.cards.find((card) => card.id === insightId) ??
      dashboard.staffingHypotheses.find((hypothesis) => hypothesis.id === insightId);

    if (!insight) {
      throw new InsightNotFoundError(insightId);
    }

    return insight;
  }
}

export const insightService = new InsightService();

async function getRepeatedBlockerRows(limit: number): Promise<RepeatedBlockerRow[]> {
  const rows = await runInsightQuery(
    `
      CALL {
        MATCH (person:Person)-[:WORKS_ON|OWNS]->(task:Task)-[:BLOCKED_BY]->(blocker:Blocker)
        WITH person,
             count(DISTINCT blocker) AS blockerCount,
             count(DISTINCT task) AS blockedWorkCount,
             collect(DISTINCT coalesce(blocker.title, blocker.id))[0..3] AS sampleBlockers
        WHERE blockerCount >= 2
        RETURN 'person' AS focusType,
               person.id AS entityId,
               coalesce(person.fullName, person.id) AS entityLabel,
               coalesce(person.title, '') AS secondaryLabel,
               blockerCount,
               blockedWorkCount,
               sampleBlockers
        UNION
        MATCH (team:Team)<-[:MEMBER_OF]-(member:Person)-[:WORKS_ON|OWNS]->(task:Task)-[:BLOCKED_BY]->(blocker:Blocker)
        WITH team,
             count(DISTINCT blocker) AS blockerCount,
             count(DISTINCT task) AS blockedWorkCount,
             collect(DISTINCT coalesce(blocker.title, blocker.id))[0..3] AS sampleBlockers
        WHERE blockerCount >= 2
        RETURN 'team' AS focusType,
               team.id AS entityId,
               coalesce(team.name, team.id) AS entityLabel,
               coalesce(team.department, '') AS secondaryLabel,
               blockerCount,
               blockedWorkCount,
               sampleBlockers
        UNION
        MATCH (project:Project)
        OPTIONAL MATCH (task:Task)-[:PART_OF]->(project)
        OPTIONAL MATCH (task)-[:BLOCKED_BY]->(taskBlocker:Blocker)
        OPTIONAL MATCH (project)-[:BLOCKED_BY]->(projectBlocker:Blocker)
        WITH project,
             count(DISTINCT taskBlocker) + count(DISTINCT projectBlocker) AS blockerCount,
             count(DISTINCT task) AS blockedWorkCount,
             [title IN (collect(DISTINCT coalesce(taskBlocker.title, taskBlocker.id)) + collect(DISTINCT coalesce(projectBlocker.title, projectBlocker.id))) WHERE title IS NOT NULL][0..3] AS sampleBlockers
        WHERE blockerCount >= 2
        RETURN 'system' AS focusType,
               project.id AS entityId,
               coalesce(project.name, project.id) AS entityLabel,
               coalesce(project.status, '') AS secondaryLabel,
               blockerCount,
               blockedWorkCount,
               sampleBlockers
      }
      WITH focusType,
           entityId,
           entityLabel,
           secondaryLabel,
           blockerCount,
           blockedWorkCount,
           sampleBlockers,
           round((blockerCount * 24 + blockedWorkCount * 8) * 100) / 100 AS score
      RETURN focusType,
             entityId,
             entityLabel,
             secondaryLabel,
             blockerCount,
             blockedWorkCount,
             sampleBlockers,
             score
      ORDER BY score DESC, blockerCount DESC, blockedWorkCount DESC
      LIMIT $limit
    `,
    { limit }
  );

  return rows.map((row) => ({
    focusType: asFocusType(row.focusType),
    entityId: asString(row.entityId),
    entityLabel: asString(row.entityLabel, "Unknown"),
    secondaryLabel: asString(row.secondaryLabel),
    blockerCount: asNumber(row.blockerCount),
    blockedWorkCount: asNumber(row.blockedWorkCount),
    sampleBlockers: asStringArray(row.sampleBlockers),
    score: asNumber(row.score),
  }));
}

async function getSkillGapRows(limit: number): Promise<SkillGapRow[]> {
  const rows = await runInsightQuery(
    `
      MATCH (skill:Skill)
      OPTIONAL MATCH (person:Person)-[:HAS_SKILL]->(skill)
      OPTIONAL MATCH (person)-[:WORKS_ON|OWNS]->(project:Project)
      OPTIONAL MATCH (person)-[:WORKS_ON|OWNS]->(task:Task)
      OPTIONAL MATCH (task)-[:BLOCKED_BY]->(blocker:Blocker)
      OPTIONAL MATCH (team:Team)-[:HAS_SKILL]->(skill)
      WITH skill,
           count(DISTINCT person) AS providerCount,
           count(DISTINCT team) AS teamCoverageCount,
           count(DISTINCT project) AS projectCount,
           count(DISTINCT blocker) AS blockerCount
      WITH skill,
           providerCount,
           teamCoverageCount,
           projectCount,
           blockerCount,
           round((((projectCount * 2.0) + (blockerCount * 3.0) + 1) / CASE WHEN providerCount = 0 THEN 1 ELSE providerCount END) * 100) / 100 AS score
      WHERE projectCount > 0
      RETURN skill.id AS skillId,
             coalesce(skill.name, skill.id) AS skillLabel,
             coalesce(skill.category, '') AS category,
             providerCount,
             teamCoverageCount,
             projectCount,
             blockerCount,
             score
      ORDER BY score DESC, blockerCount DESC, projectCount DESC
      LIMIT $limit
    `,
    { limit }
  );

  return rows.map((row) => ({
    skillId: asString(row.skillId),
    skillLabel: asString(row.skillLabel, "Unknown skill"),
    category: asString(row.category),
    providerCount: asNumber(row.providerCount),
    teamCoverageCount: asNumber(row.teamCoverageCount),
    projectCount: asNumber(row.projectCount),
    blockerCount: asNumber(row.blockerCount),
    score: asNumber(row.score),
  }));
}

async function getOverloadRows(limit: number): Promise<OverloadRow[]> {
  const rows = await runInsightQuery(
    `
      MATCH (person:Person)
      OPTIONAL MATCH (person)-[:WORKS_ON|OWNS]->(project:Project)
      OPTIONAL MATCH (person)-[:WORKS_ON|OWNS]->(task:Task)
      OPTIONAL MATCH (task)-[:BLOCKED_BY]->(blocker:Blocker)
      OPTIONAL MATCH (person)-[:MEMBER_OF]->(team:Team)
      WITH person,
           team,
           count(DISTINCT project) AS projectCount,
           count(DISTINCT task) AS taskCount,
           count(DISTINCT blocker) AS blockerCount
      OPTIONAL MATCH (person)-[:OWNS]->(ownedTask:Task)
      WHERE size([(otherOwner:Person)-[:OWNS]->(ownedTask) WHERE otherOwner.id <> person.id | otherOwner]) = 0
      WITH person,
           team,
           projectCount,
           taskCount,
           blockerCount,
           count(DISTINCT ownedTask) AS soleOwnershipCount
      WITH person,
           team,
           projectCount,
           taskCount,
           blockerCount,
           soleOwnershipCount,
           round((projectCount * 18 + taskCount * 7 + blockerCount * 14 + soleOwnershipCount * 15) * 100) / 100 AS score
      WHERE projectCount > 0 OR taskCount > 1 OR blockerCount > 0
      RETURN person.id AS personId,
             coalesce(person.fullName, person.id) AS personLabel,
             coalesce(person.title, '') AS title,
             projectCount,
             taskCount,
             blockerCount,
             soleOwnershipCount,
             coalesce(team.name, '') AS teamName,
             score
      ORDER BY score DESC, blockerCount DESC, taskCount DESC
      LIMIT $limit
    `,
    { limit }
  );

  return rows.map((row) => ({
    personId: asString(row.personId),
    personLabel: asString(row.personLabel, "Unknown person"),
    title: asString(row.title),
    projectCount: asNumber(row.projectCount),
    taskCount: asNumber(row.taskCount),
    blockerCount: asNumber(row.blockerCount),
    soleOwnershipCount: asNumber(row.soleOwnershipCount),
    teamName: asString(row.teamName),
    score: asNumber(row.score),
  }));
}

function buildRepeatedBlockerCard(row: RepeatedBlockerRow): InsightCard {
  const focus = buildFocusReference(row.focusType, row.entityId, row.entityLabel);
  const sampleBlockers = row.sampleBlockers.length > 0 ? row.sampleBlockers.join(", ") : "No blocker labels captured";

  return {
    id: `repeated_blockers:${row.focusType}:${row.entityId}`,
    category: "repeated_blockers",
    title: `${titleForFocusType(row.focusType)} blocker cluster around ${row.entityLabel}`,
    summary: `${row.entityLabel} is repeatedly adjacent to blockers in the current graph snapshot.`,
    severity: scoreSeverity(row.score),
    score: round(row.score),
    focus,
    confirmedFacts: [
      buildFact(
        "Repeated blockers",
        `${row.entityLabel} is connected to ${row.blockerCount} distinct blockers.`,
        row.blockerCount,
        "count",
        [focus]
      ),
      buildFact(
        "Blocked work",
        `${row.blockedWorkCount} work items in this area are currently represented as blocked.`,
        row.blockedWorkCount,
        "count",
        [focus]
      ),
      buildFact(
        "Blocker examples",
        `Observed blocker examples: ${sampleBlockers}.`,
        sampleBlockers,
        "text",
        [focus]
      ),
    ],
    inferredRecommendations: [
      buildRecommendation({
        statement: `Treat this blocker pattern as a coordination risk worth triaging with the owning ${row.focusType === "person" ? "manager" : row.focusType}.`,
        confidence: row.blockerCount >= 4 ? "high" : "medium",
        rationale: "Repeated blocker adjacency usually means local dependency friction, but the graph alone cannot confirm the root cause.",
        uncertaintyNote: "The graph shows repeated blocker relationships, not whether the same operational cause is recurring.",
        suggestedActions: [
          "Review whether the blocker themes share the same upstream dependency.",
          "Confirm whether recent incidents are transient or structural before staffing changes.",
        ],
        entities: [focus],
      }),
    ],
  };
}

function buildSkillGapCard(row: SkillGapRow): InsightCard {
  const focus = buildFocusReference("skill", row.skillId, row.skillLabel);

  return {
    id: `skill_gap:skill:${row.skillId}`,
    category: "skill_gap",
    title: `Likely capacity gap in ${row.skillLabel}`,
    summary: `${row.skillLabel} appears thin relative to the projects and blockers touching its current providers.`,
    severity: scoreSeverity(row.score),
    score: round(row.score),
    focus,
    confirmedFacts: [
      buildFact(
        "Known providers",
        `${row.providerCount} people currently hold ${row.skillLabel} in the graph.`,
        row.providerCount,
        "count",
        [focus]
      ),
      buildFact(
        "Project footprint",
        `${row.skillLabel} providers are connected to ${row.projectCount} active project relationships.`,
        row.projectCount,
        "count",
        [focus]
      ),
      buildFact(
        "Blocker exposure",
        `${row.blockerCount} blockers touch work connected to current ${row.skillLabel} providers.`,
        row.blockerCount,
        "count",
        [focus]
      ),
    ],
    inferredRecommendations: [
      buildRecommendation({
        statement: `Consider this a likely skill gap hypothesis rather than a confirmed shortage in ${row.skillLabel}.`,
        confidence: row.providerCount <= 1 || row.blockerCount >= 3 ? "high" : "medium",
        rationale: "Low provider counts plus multi-project or blocker exposure often indicate brittle capability coverage.",
        uncertaintyNote: "The graph can show who is tagged with a skill, but not hidden expertise, contractor support, or near-term roadmap shifts.",
        suggestedActions: [
          "Validate whether additional team members can cover this skill with light cross-training.",
          "If roadmap pressure remains high, test a targeted hiring hypothesis before opening a requisition.",
        ],
        entities: [focus],
      }),
    ],
  };
}

function buildOverloadCard(row: OverloadRow): InsightCard {
  const focus = buildFocusReference("person", row.personId, row.personLabel);

  return {
    id: `overload_risk:person:${row.personId}`,
    category: "overload_risk",
    title: `Potential overload around ${row.personLabel}`,
    summary: `${row.personLabel} shows concentrated work ownership and blocker exposure in the current graph.`,
    severity: scoreSeverity(row.score),
    score: round(row.score),
    focus,
    confirmedFacts: [
      buildFact(
        "Project load",
        `${row.personLabel} is connected to ${row.projectCount} projects and ${row.taskCount} tasks.`,
        `${row.projectCount} projects / ${row.taskCount} tasks`,
        "text",
        [focus]
      ),
      buildFact(
        "Blocker exposure",
        `${row.personLabel} is adjacent to ${row.blockerCount} blockers through owned or active work.`,
        row.blockerCount,
        "count",
        [focus]
      ),
      buildFact(
        "Sole ownership",
        `${row.soleOwnershipCount} tasks appear to be solely owned by ${row.personLabel}.`,
        row.soleOwnershipCount,
        "count",
        [focus]
      ),
    ],
    inferredRecommendations: [
      buildRecommendation({
        statement: `Treat ${row.personLabel}'s load as a staffing signal to validate, not as proof of burnout or underperformance.`,
        confidence: row.blockerCount >= 3 || row.soleOwnershipCount >= 2 ? "high" : "medium",
        rationale: "High task volume plus blocker exposure and sole ownership usually indicates concentration risk.",
        uncertaintyNote: "The graph does not capture personal capacity, time allocation quality, or work that has already been deprioritized offline.",
        suggestedActions: [
          "Review whether work can be redistributed inside the team before adding headcount.",
          "Confirm whether sole-owned tasks need backups or documentation support.",
        ],
        entities: [focus],
      }),
    ],
  };
}

function buildStaffingHypotheses(cards: InsightCard[], limit: number): StaffingHypothesis[] {
  const hypotheses: StaffingHypothesis[] = [];

  const topSkillGaps = cards.filter((card) => card.category === "skill_gap").slice(0, 2);
  for (const card of topSkillGaps) {
    hypotheses.push({
      id: `staffing_hypothesis:hire:${card.focus.entityId}`,
      category: "staffing_hypothesis",
      type: "hire",
      title: `Hiring hypothesis for ${card.focus.entityLabel}`,
      summary: `If delivery pressure persists, additional ${card.focus.entityLabel} capacity may reduce concentrated blocker risk.`,
      confidence: recommendationConfidence(card),
      severity: card.severity,
      target: card.focus,
      basedOnInsightIds: [card.id],
      confirmedFacts: card.confirmedFacts,
      inferredRecommendation: buildRecommendation({
        statement: `A targeted hire or dedicated contractor for ${card.focus.entityLabel} is a plausible hypothesis to test.`,
        confidence: recommendationConfidence(card),
        rationale: "This is based on skill coverage concentration and blocker adjacency, not on confirmed hiring need.",
        uncertaintyNote: "Cross-training, roadmap changes, or latent team expertise may solve the same issue with lower cost.",
        suggestedActions: [
          "Check whether the gap survives after validating hidden skill coverage.",
          "Open hiring only if delivery risk remains after redistribution or cross-training.",
        ],
        entities: [card.focus],
      }),
    });
  }

  const topOverload = cards.find((card) => card.category === "overload_risk");
  if (topOverload) {
    hypotheses.push({
      id: `staffing_hypothesis:rebalance:${topOverload.focus.entityId}`,
      category: "staffing_hypothesis",
      type: "rebalance",
      title: `Rebalance hypothesis for ${topOverload.focus.entityLabel}`,
      summary: `Work rebalancing may lower concentration risk around ${topOverload.focus.entityLabel}.`,
      confidence: recommendationConfidence(topOverload),
      severity: topOverload.severity,
      target: topOverload.focus,
      basedOnInsightIds: [topOverload.id],
      confirmedFacts: topOverload.confirmedFacts,
      inferredRecommendation: buildRecommendation({
        statement: `Shift ownership or staffing around ${topOverload.focus.entityLabel} before assuming more headcount is required.`,
        confidence: recommendationConfidence(topOverload),
        rationale: "Concentrated ownership is often relieved by rebalance or backup coverage before hiring.",
        uncertaintyNote: "The graph cannot tell whether these tasks are equally heavy or already near completion.",
        suggestedActions: [
          "Assign backup owners to sole-owned work.",
          "Reduce concurrent work-in-progress before proposing a net-new role.",
        ],
        entities: [topOverload.focus],
      }),
    });
  }

  const topRepeatedSystem = cards.find(
    (card) => card.category === "repeated_blockers" && card.focus.focusType === "system"
  );
  if (topRepeatedSystem) {
    hypotheses.push({
      id: `staffing_hypothesis:backup_owner:${topRepeatedSystem.focus.entityId}`,
      category: "staffing_hypothesis",
      type: "backup_owner",
      title: `Backup ownership hypothesis for ${topRepeatedSystem.focus.entityLabel}`,
      summary: `Repeated blocker patterns suggest ${topRepeatedSystem.focus.entityLabel} may need broader supporting ownership.`,
      confidence: recommendationConfidence(topRepeatedSystem),
      severity: topRepeatedSystem.severity,
      target: topRepeatedSystem.focus,
      basedOnInsightIds: [topRepeatedSystem.id],
      confirmedFacts: topRepeatedSystem.confirmedFacts,
      inferredRecommendation: buildRecommendation({
        statement: `Consider adding backup ownership or an embedded partner around ${topRepeatedSystem.focus.entityLabel}.`,
        confidence: recommendationConfidence(topRepeatedSystem),
        rationale: "System-level blocker clustering often improves when ownership is less concentrated.",
        uncertaintyNote: "The graph here uses project nodes as a proxy for systems, so the operational boundary may be broader or narrower in reality.",
        suggestedActions: [
          "Validate that the project is the correct proxy for the affected system.",
          "Test whether shared on-call, platform support, or joint ownership resolves the blocker pattern.",
        ],
        entities: [topRepeatedSystem.focus],
      }),
    });
  }

  return hypotheses.slice(0, limit);
}

async function runInsightQuery(query: string, params: Record<string, unknown>): Promise<RawMetricRow[]> {
  const session = getNeo4jSession("READ");

  try {
    const result = await session.run(query, params);
    return result.records.map((record) => Object.fromEntries(record.keys.map((key) => [key, normalizeValue(record.get(key))])));
  } finally {
    await session.close();
  }
}

function normalizeValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item)) as T;
  }

  const candidate = value as unknown;
  if (
    candidate &&
    typeof candidate === "object" &&
    "toNumber" in (candidate as Record<string, unknown>) &&
    typeof (candidate as { toNumber?: unknown }).toNumber === "function"
  ) {
    return (candidate as { toNumber: () => number }).toNumber() as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => [key, normalizeValue(entryValue)])) as T;
  }

  return value;
}

function buildFocusReference(focusType: InsightEntityReference["focusType"], entityId: string, entityLabel: string): InsightEntityReference {
  if (focusType === "system") {
    return {
      entityId,
      entityLabel,
      entityType: "System",
      focusType,
      sourceNodeType: "Project",
    };
  }

  if (focusType === "skill") {
    return {
      entityId,
      entityLabel,
      entityType: "Skill",
      focusType,
    };
  }

  return {
    entityId,
    entityLabel,
    entityType: capitalize(focusType) as InsightEntityReference["entityType"],
    focusType,
  };
}

function buildFact(
  label: string,
  statement: string,
  value: InsightFact["value"],
  unit: NonNullable<InsightFact["unit"]>,
  entities: InsightEntityReference[]
): InsightFact {
  return {
    status: "confirmed",
    label,
    statement,
    value,
    unit,
    entities,
  };
}

function buildRecommendation(input: Omit<InsightRecommendation, "status">): InsightRecommendation {
  return {
    status: "inferred",
    ...input,
  };
}

function recommendationConfidence(card: InsightCard): InsightConfidenceLevel {
  if (card.score >= 80) {
    return "high";
  }

  if (card.score >= 40) {
    return "medium";
  }

  return "low";
}

function titleForFocusType(focusType: RepeatedBlockerRow["focusType"]): string {
  if (focusType === "system") {
    return "System-proxy";
  }

  return capitalize(focusType);
}

function scoreSeverity(score: number): InsightSeverity {
  if (score >= 90) {
    return "critical";
  }

  if (score >= 60) {
    return "high";
  }

  if (score >= 30) {
    return "medium";
  }

  return "low";
}

function round(value: number): number {
  return Number((Number.isFinite(value) ? value : 0).toFixed(2));
}

function capitalize(value: string): string {
  return value.length > 0 ? `${value.slice(0, 1).toUpperCase()}${value.slice(1)}` : value;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asFocusType(value: unknown): RepeatedBlockerRow["focusType"] {
  return value === "team" || value === "system" ? value : "person";
}
