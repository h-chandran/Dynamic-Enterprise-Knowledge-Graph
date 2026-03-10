import type {
  AnalyticsDashboardResponse,
  AnalyticsMetricBreakdownItem,
  AnalyticsMetricCard,
  AnalyticsMetricKey,
  AnalyticsMetricResponse,
  AnalyticsOverlayEdge,
  AnalyticsOverlayNode,
  NodeType,
  RelationshipType,
} from "@shared-types";
import { ANALYTICS_METRIC_KEYS } from "@shared-types";
import { getNeo4jSession } from "../../infrastructure/database/neo4j.js";

type RawMetricRow = Record<string, unknown>;

interface MetricQueryResult {
  card: AnalyticsMetricCard;
  overlay: {
    nodes: AnalyticsOverlayNode[];
    edges: AnalyticsOverlayEdge[];
  };
  breakdown: AnalyticsMetricBreakdownItem[];
  methodology: AnalyticsMetricResponse["methodology"];
}

export class AnalyticsServiceUnavailableError extends Error {
  constructor(message = "Analytics data is currently unavailable.") {
    super(message);
    this.name = "AnalyticsServiceUnavailableError";
  }
}

export class AnalyticsUnknownMetricError extends Error {
  constructor(metricKey: string) {
    super(`Analytics metric "${metricKey}" is not supported.`);
    this.name = "AnalyticsUnknownMetricError";
  }
}

export class AnalyticsService {
  async getDashboard(limit: number): Promise<AnalyticsDashboardResponse> {
    const generatedAt = new Date().toISOString();
    const entries = await Promise.all(
      ANALYTICS_METRIC_KEYS.map(async (metricKey) => [metricKey, await this.getMetric(metricKey, limit, generatedAt)] as const)
    );

    return {
      generatedAt,
      metrics: Object.fromEntries(entries) as AnalyticsDashboardResponse["metrics"],
    };
  }

  async getMetric(metricKey: AnalyticsMetricKey, limit: number, generatedAt = new Date().toISOString()): Promise<AnalyticsMetricResponse> {
    const resolver = metricResolvers[metricKey];
    if (!resolver) {
      throw new AnalyticsUnknownMetricError(metricKey);
    }

    try {
      const result = await resolver(limit);
      return {
        metric: metricKey,
        generatedAt,
        card: result.card,
        overlay: result.overlay,
        breakdown: result.breakdown,
        methodology: result.methodology,
      };
    } catch (error) {
      if (error instanceof AnalyticsUnknownMetricError) {
        throw error;
      }

      throw new AnalyticsServiceUnavailableError(error instanceof Error ? error.message : undefined);
    }
  }
}

export const analyticsService = new AnalyticsService();

const metricResolvers: Record<AnalyticsMetricKey, (limit: number) => Promise<MetricQueryResult>> = {
  blocker_centrality: async (limit) => {
    const rows = await runMetricQuery(
      `
        MATCH (blocker:Blocker)
        OPTIONAL MATCH (task:Task)-[blockedByTask:BLOCKED_BY]->(blocker)
        OPTIONAL MATCH (project:Project)-[blockedByProject:BLOCKED_BY]->(blocker)
        OPTIONAL MATCH (person:Person)-[:WORKS_ON|OWNS]->(task)
        WITH blocker,
             count(DISTINCT task) AS blockedTaskCount,
             count(DISTINCT project) AS blockedProjectCount,
             count(DISTINCT person) AS affectedPeopleCount,
             avg(coalesce(blockedByTask.confidence, blockedByProject.confidence, 0.7)) AS avgEdgeConfidence
        WITH blocker,
             blockedTaskCount,
             blockedProjectCount,
             affectedPeopleCount,
             round((blockedTaskCount * 18 + blockedProjectCount * 28 + affectedPeopleCount * 12 + coalesce(avgEdgeConfidence, 0.7) * 10) * 100) / 100 AS score
        RETURN blocker.id AS id,
               blocker.title AS label,
               blocker.status AS status,
               blocker.severity AS blockerSeverity,
               blockedTaskCount,
               blockedProjectCount,
               affectedPeopleCount,
               score
        ORDER BY score DESC, blockedTaskCount DESC, blockedProjectCount DESC
        LIMIT $limit
      `,
      { limit }
    );

    const topScore = asNumber(rows[0]?.score) ?? 0;
    return {
      card: buildCard("blocker_centrality", "Blocker Centrality", topScore, "Highest blocker impact score across blocked tasks, projects, and contributors."),
      overlay: {
        nodes: rows.map((row) =>
          buildNodeOverlay({
            id: asString(row.id),
            nodeType: "Blocker",
            label: asString(row.label, "Unnamed blocker"),
            score: asNumber(row.score),
            metadata: {
              status: row.status,
              severity: row.blockerSeverity,
              blockedTaskCount: row.blockedTaskCount,
              blockedProjectCount: row.blockedProjectCount,
              affectedPeopleCount: row.affectedPeopleCount,
            },
          })
        ),
        edges: [],
      },
      breakdown: rows.map((row) => ({
        label: asString(row.label, "Unnamed blocker"),
        value: asNumber(row.score),
        unit: "score",
        metadata: {
          blockedTaskCount: row.blockedTaskCount,
          blockedProjectCount: row.blockedProjectCount,
          affectedPeopleCount: row.affectedPeopleCount,
        },
      })),
      methodology: {
        description: "Scores blockers by how many tasks, projects, and contributors they touch. This is descriptive analytics only and excludes hiring recommendations.",
        excludesRecommendations: true,
      },
    };
  },

  dependency_concentration: async (limit) => {
    const rows = await runMetricQuery(
      `
        MATCH (project:Project)
        OPTIONAL MATCH (task:Task)-[:PART_OF]->(project)
        OPTIONAL MATCH (task)-[:BLOCKED_BY]->(blocker:Blocker)
        OPTIONAL MATCH (person:Person)-[:WORKS_ON|OWNS]->(project)
        WITH project,
             count(DISTINCT task) AS taskCount,
             count(DISTINCT blocker) AS blockerCount,
             count(DISTINCT person) AS contributorCount
        WITH project,
             taskCount,
             blockerCount,
             contributorCount,
             round((((taskCount + blockerCount * 2) * 10.0) / CASE WHEN contributorCount = 0 THEN 1 ELSE contributorCount END) * 100) / 100 AS score
        RETURN project.id AS id,
               project.name AS label,
               project.status AS status,
               taskCount,
               blockerCount,
               contributorCount,
               score
        ORDER BY score DESC, blockerCount DESC, taskCount DESC
        LIMIT $limit
      `,
      { limit }
    );

    const avgScore = average(rows.map((row) => asNumber(row.score)));
    return {
      card: buildCard("dependency_concentration", "Dependency Concentration", avgScore, "Average dependency concentration across projects relative to active contributors."),
      overlay: {
        nodes: rows.map((row) =>
          buildNodeOverlay({
            id: asString(row.id),
            nodeType: "Project",
            label: asString(row.label, "Unnamed project"),
            score: asNumber(row.score),
            metadata: {
              status: row.status,
              taskCount: row.taskCount,
              blockerCount: row.blockerCount,
              contributorCount: row.contributorCount,
            },
          })
        ),
        edges: [],
      },
      breakdown: rows.map((row) => ({
        label: asString(row.label, "Unnamed project"),
        value: asNumber(row.score),
        unit: "score",
        metadata: {
          taskCount: row.taskCount,
          blockerCount: row.blockerCount,
          contributorCount: row.contributorCount,
        },
      })),
      methodology: {
        description: "Scores projects higher when task and blocker dependencies are concentrated among fewer contributors. This is descriptive analytics only and excludes hiring recommendations.",
        excludesRecommendations: true,
      },
    };
  },

  project_load_per_person: async (limit) => {
    const rows = await runMetricQuery(
      `
        MATCH (person:Person)
        OPTIONAL MATCH (person)-[:WORKS_ON|OWNS]->(project:Project)
        OPTIONAL MATCH (person)-[:WORKS_ON|OWNS]->(task:Task)
        OPTIONAL MATCH (task)-[:BLOCKED_BY]->(blocker:Blocker)
        WITH person,
             count(DISTINCT project) AS projectCount,
             count(DISTINCT task) AS taskCount,
             count(DISTINCT blocker) AS blockerCount
        WITH person,
             projectCount,
             taskCount,
             blockerCount,
             round((projectCount * 20 + taskCount * 9 + blockerCount * 14) * 100) / 100 AS score
        RETURN person.id AS id,
               person.fullName AS label,
               person.title AS title,
               projectCount,
               taskCount,
               blockerCount,
               score
        ORDER BY score DESC, blockerCount DESC, taskCount DESC
        LIMIT $limit
      `,
      { limit }
    );

    const maxScore = asNumber(rows[0]?.score) ?? 0;
    return {
      card: buildCard("project_load_per_person", "Project Load Per Person", maxScore, "Highest weighted contributor load across projects, tasks, and blocker exposure."),
      overlay: {
        nodes: rows.map((row) =>
          buildNodeOverlay({
            id: asString(row.id),
            nodeType: "Person",
            label: asString(row.label, "Unnamed person"),
            score: asNumber(row.score),
            metadata: {
              title: row.title,
              projectCount: row.projectCount,
              taskCount: row.taskCount,
              blockerCount: row.blockerCount,
            },
          })
        ),
        edges: [],
      },
      breakdown: rows.map((row) => ({
        label: asString(row.label, "Unnamed person"),
        value: asNumber(row.score),
        unit: "score",
        metadata: {
          projectCount: row.projectCount,
          taskCount: row.taskCount,
          blockerCount: row.blockerCount,
        },
      })),
      methodology: {
        description: "Weights each person's active projects, tasks, and blocker exposure into a single load score. This is descriptive analytics only and excludes hiring recommendations.",
        excludesRecommendations: true,
      },
    };
  },

  single_point_of_failure: async (limit) => {
    const rows = await runMetricQuery(
      `
        MATCH (person:Person)
        OPTIONAL MATCH (person)-[:OWNS]->(project:Project)
        WHERE size([(other:Person)-[:OWNS]->(project) WHERE other.id <> person.id | other]) = 0
        WITH person, count(DISTINCT project) AS soleProjectCount
        OPTIONAL MATCH (person)-[:OWNS]->(task:Task)
        WHERE size([(otherTaskOwner:Person)-[:OWNS]->(task) WHERE otherTaskOwner.id <> person.id | otherTaskOwner]) = 0
        WITH person, soleProjectCount, count(DISTINCT task) AS soleTaskCount
        OPTIONAL MATCH (person)-[:HAS_SKILL]->(skill:Skill)
        WHERE size([(otherSkilled:Person)-[:HAS_SKILL]->(skill) WHERE otherSkilled.id <> person.id | otherSkilled]) = 0
        WITH person, soleProjectCount, soleTaskCount, count(DISTINCT skill) AS rareSkillCount
        WITH person,
             soleProjectCount,
             soleTaskCount,
             rareSkillCount,
             round((soleProjectCount * 30 + soleTaskCount * 14 + rareSkillCount * 22) * 100) / 100 AS score
        RETURN person.id AS id,
               person.fullName AS label,
               person.title AS title,
               soleProjectCount,
               soleTaskCount,
               rareSkillCount,
               score
        ORDER BY score DESC, rareSkillCount DESC, soleProjectCount DESC
        LIMIT $limit
      `,
      { limit }
    );

    const avgTopScore = average(rows.slice(0, 3).map((row) => asNumber(row.score)));
    return {
      card: buildCard("single_point_of_failure", "Single Point Of Failure", avgTopScore, "Average score across the most concentrated ownership and rare-skill exposures."),
      overlay: {
        nodes: rows.map((row) =>
          buildNodeOverlay({
            id: asString(row.id),
            nodeType: "Person",
            label: asString(row.label, "Unnamed person"),
            score: asNumber(row.score),
            metadata: {
              title: row.title,
              soleProjectCount: row.soleProjectCount,
              soleTaskCount: row.soleTaskCount,
              rareSkillCount: row.rareSkillCount,
            },
          })
        ),
        edges: [],
      },
      breakdown: rows.map((row) => ({
        label: asString(row.label, "Unnamed person"),
        value: asNumber(row.score),
        unit: "score",
        metadata: {
          soleProjectCount: row.soleProjectCount,
          soleTaskCount: row.soleTaskCount,
          rareSkillCount: row.rareSkillCount,
        },
      })),
      methodology: {
        description: "Scores people higher when they are sole owners of work or the only holder of specific skills. This is descriptive analytics only and excludes hiring recommendations.",
        excludesRecommendations: true,
      },
    };
  },

  skill_scarcity: async (limit) => {
    const rows = await runMetricQuery(
      `
        MATCH (skill:Skill)
        OPTIONAL MATCH (person:Person)-[:HAS_SKILL]->(skill)
        OPTIONAL MATCH (person)-[:WORKS_ON|OWNS]->(project:Project)
        WITH skill,
             count(DISTINCT person) AS providerCount,
             count(DISTINCT project) AS activeProjectCount
        WITH skill,
             providerCount,
             activeProjectCount,
             round(((activeProjectCount + 1.0) / CASE WHEN providerCount = 0 THEN 1 ELSE providerCount END) * 10000) / 100 AS score
        RETURN skill.id AS id,
               skill.name AS label,
               skill.category AS category,
               providerCount,
               activeProjectCount,
               score
        ORDER BY score DESC, activeProjectCount DESC, providerCount ASC
        LIMIT $limit
      `,
      { limit }
    );

    const maxScore = asNumber(rows[0]?.score) ?? 0;
    return {
      card: buildCard("skill_scarcity", "Skill Scarcity", maxScore, "Highest current skill scarcity based on provider count versus active project usage."),
      overlay: {
        nodes: rows.map((row) =>
          buildNodeOverlay({
            id: asString(row.id),
            nodeType: "Skill",
            label: asString(row.label, "Unnamed skill"),
            score: asNumber(row.score),
            metadata: {
              category: row.category,
              providerCount: row.providerCount,
              activeProjectCount: row.activeProjectCount,
            },
          })
        ),
        edges: [],
      },
      breakdown: rows.map((row) => ({
        label: asString(row.label, "Unnamed skill"),
        value: asNumber(row.score),
        unit: "score",
        metadata: {
          providerCount: row.providerCount,
          activeProjectCount: row.activeProjectCount,
        },
      })),
      methodology: {
        description: "Scores skills higher when fewer people provide them relative to the number of active projects those providers support. This is descriptive analytics only and excludes hiring recommendations.",
        excludesRecommendations: true,
      },
    };
  },

  team_isolation: async (limit) => {
    const rows = await runMetricQuery(
      `
        MATCH (team:Team)
        OPTIONAL MATCH (member:Person)-[:MEMBER_OF]->(team)
        OPTIONAL MATCH (team)-[:WORKS_ON|OWNS]->(project:Project)
        OPTIONAL MATCH (external:Person)-[:WORKS_ON|OWNS]->(project)
        WHERE NOT (external)-[:MEMBER_OF]->(team)
        WITH team,
             count(DISTINCT member) AS memberCount,
             count(DISTINCT project) AS projectCount,
             count(DISTINCT external) AS externalCollaboratorCount
        WITH team,
             memberCount,
             projectCount,
             externalCollaboratorCount,
             round((CASE
               WHEN projectCount = 0 AND memberCount = 0 THEN 0
               ELSE ((projectCount + memberCount) * 12.0) / CASE WHEN externalCollaboratorCount = 0 THEN 1 ELSE externalCollaboratorCount END
             END) * 100) / 100 AS score
        RETURN team.id AS id,
               team.name AS label,
               team.department AS department,
               memberCount,
               projectCount,
               externalCollaboratorCount,
               score
        ORDER BY score DESC, projectCount DESC, memberCount DESC
        LIMIT $limit
      `,
      { limit }
    );

    const avgScore = average(rows.map((row) => asNumber(row.score)));
    return {
      card: buildCard("team_isolation", "Team Isolation", avgScore, "Average isolation risk based on internal footprint versus external collaboration."),
      overlay: {
        nodes: rows.map((row) =>
          buildNodeOverlay({
            id: asString(row.id),
            nodeType: "Team",
            label: asString(row.label, "Unnamed team"),
            score: asNumber(row.score),
            metadata: {
              department: row.department,
              memberCount: row.memberCount,
              projectCount: row.projectCount,
              externalCollaboratorCount: row.externalCollaboratorCount,
            },
          })
        ),
        edges: [],
      },
      breakdown: rows.map((row) => ({
        label: asString(row.label, "Unnamed team"),
        value: asNumber(row.score),
        unit: "score",
        metadata: {
          memberCount: row.memberCount,
          projectCount: row.projectCount,
          externalCollaboratorCount: row.externalCollaboratorCount,
        },
      })),
      methodology: {
        description: "Scores teams higher when their internal footprint is large relative to cross-team collaboration on shared work. This is descriptive analytics only and excludes hiring recommendations.",
        excludesRecommendations: true,
      },
    };
  },
};

async function runMetricQuery(query: string, params: Record<string, unknown>): Promise<RawMetricRow[]> {
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

function buildCard(key: AnalyticsMetricKey, title: string, value: number, summary: string): AnalyticsMetricCard {
  return {
    key,
    title,
    value: round(value),
    unit: "score",
    displayValue: round(value).toFixed(2),
    severity: scoreSeverity(value),
    summary,
  };
}

function buildNodeOverlay(input: {
  id: string;
  nodeType: NodeType;
  label: string;
  score: number;
  metadata: Record<string, unknown>;
}): AnalyticsOverlayNode {
  return {
    entityType: "node",
    id: input.id,
    nodeType: input.nodeType,
    label: input.label,
    score: round(input.score),
    severity: scoreSeverity(input.score),
    metadata: input.metadata,
  };
}

function scoreSeverity(score: number): AnalyticsMetricCard["severity"] {
  if (score >= 75) {
    return "critical";
  }

  if (score >= 45) {
    return "high";
  }

  if (score >= 20) {
    return "medium";
  }

  return "low";
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return round(values.reduce((total, value) => total + value, 0) / values.length);
}

function round(value: number): number {
  return Number((Number.isFinite(value) ? value : 0).toFixed(2));
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
