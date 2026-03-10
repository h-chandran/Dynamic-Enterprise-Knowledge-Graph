import type {
  VisualizationSubgraphKind,
  VisualizationSubgraphResponse,
} from "@shared-types";
import { getNeo4jSession } from "../../infrastructure/database/neo4j.js";
import { formatVisualizationSubgraph, type RawRecentUpdate, type RawSubgraphEdge, type RawSubgraphNode } from "./subgraph-formatter.js";

interface SubgraphQueryDefinition {
  kind: VisualizationSubgraphKind;
  cypher: string;
  params?: Record<string, unknown>;
  focusNodeId?: string;
  depth?: number;
}

interface QueryBundleResult {
  nodes: RawSubgraphNode[];
  edges: RawSubgraphEdge[];
}

const subgraphProjection = `
  WITH collectedNodes, collectedRelationships
  RETURN
    [node IN collectedNodes | {
      id: node.id,
      type: head(labels(node)),
      displayLabel: node.displayLabel,
      properties: properties(node),
      createdAt: node.createdAt,
      updatedAt: node.updatedAt
    }] AS nodes,
    [rel IN collectedRelationships | {
      id: coalesce(rel.factKey, rel.assertionKey, rel.eventId, elementId(rel)),
      type: type(rel),
      source: startNode(rel).id,
      target: endNode(rel).id,
      properties: properties(rel),
      createdAt: rel.createdAt,
      updatedAt: rel.updatedAt
    }] AS edges
`;

const teamNodeAndEdgeProjection = `
  WITH team, [path IN collect(DISTINCT p) WHERE path IS NOT NULL] AS paths
  WITH [team] + reduce(allNodes = [], path IN paths | allNodes + nodes(path)) AS nodePool,
       reduce(allRelationships = [], path IN paths | allRelationships + relationships(path)) AS relationshipPool
  UNWIND nodePool AS node
  WITH collect(DISTINCT node) AS collectedNodes, relationshipPool
  UNWIND CASE WHEN size(relationshipPool) = 0 THEN [NULL] ELSE relationshipPool END AS rel
  WITH collectedNodes, [candidate IN collect(DISTINCT rel) WHERE candidate IS NOT NULL] AS collectedRelationships
  ${subgraphProjection}
`;

const projectNodeAndEdgeProjection = `
  WITH project, [path IN collect(DISTINCT p) WHERE path IS NOT NULL] AS paths
  WITH [project] + reduce(allNodes = [], path IN paths | allNodes + nodes(path)) AS nodePool,
       reduce(allRelationships = [], path IN paths | allRelationships + relationships(path)) AS relationshipPool
  UNWIND nodePool AS node
  WITH collect(DISTINCT node) AS collectedNodes, relationshipPool
  UNWIND CASE WHEN size(relationshipPool) = 0 THEN [NULL] ELSE relationshipPool END AS rel
  WITH collectedNodes, [candidate IN collect(DISTINCT rel) WHERE candidate IS NOT NULL] AS collectedRelationships
  ${subgraphProjection}
`;

const personNodeAndEdgeProjection = `
  WITH person, [path IN collect(DISTINCT path) WHERE path IS NOT NULL] AS paths
  WITH [person] + reduce(allNodes = [], currentPath IN paths | allNodes + nodes(currentPath)) AS nodePool,
       reduce(allRelationships = [], currentPath IN paths | allRelationships + relationships(currentPath)) AS relationshipPool
  UNWIND nodePool AS node
  WITH collect(DISTINCT node) AS collectedNodes, relationshipPool
  UNWIND CASE WHEN size(relationshipPool) = 0 THEN [NULL] ELSE relationshipPool END AS rel
  WITH collectedNodes, [candidate IN collect(DISTINCT rel) WHERE candidate IS NOT NULL] AS collectedRelationships
  ${subgraphProjection}
`;

export class VisualizationEntityNotFoundError extends Error {
  constructor(entityType: string, entityId: string) {
    super(`${entityType} with id "${entityId}" was not found.`);
    this.name = "VisualizationEntityNotFoundError";
  }
}

export class VisualizationServiceUnavailableError extends Error {
  constructor(message = "Visualization data is currently unavailable.") {
    super(message);
    this.name = "VisualizationServiceUnavailableError";
  }
}

export class VisualizationService {
  async getCompanyOverviewSubgraph(): Promise<VisualizationSubgraphResponse> {
    return this.runSubgraphQuery({
      kind: "company_overview",
      cypher: `
        CALL {
          MATCH p=(person:Person)-[:MEMBER_OF]->(:Team)
          RETURN p
          UNION
          MATCH p=(:Team)-[:WORKS_ON|OWNS]->(:Project)
          RETURN p
          UNION
          MATCH p=(:Project)-[:PART_OF]->(:Team)
          RETURN p
          UNION
          MATCH p=(:Task)-[:PART_OF]->(:Project)
          RETURN p
          UNION
          MATCH p=(:Task)-[:BLOCKED_BY]->(:Blocker)
          RETURN p
          UNION
          MATCH p=(person:Person)-[:WORKS_ON|OWNS]->(:Task)
          RETURN p
          UNION
          MATCH p=(person:Person)-[:WORKS_ON|OWNS]->(:Project)
          RETURN p
        }
        WITH collect(DISTINCT p) AS paths
        UNWIND paths AS path
        UNWIND nodes(path) AS node
        WITH collect(DISTINCT node) AS collectedNodes, paths
        UNWIND paths AS path
        UNWIND relationships(path) AS rel
        WITH collectedNodes, collect(DISTINCT rel) AS collectedRelationships
        ${subgraphProjection}
      `,
    });
  }

  async getTeamSubgraph(teamId: string): Promise<VisualizationSubgraphResponse> {
    await this.assertNodeExists("Team", teamId);

    return this.runSubgraphQuery({
      kind: "team",
      focusNodeId: teamId,
      cypher: `
        MATCH (team:Team {id: $teamId})
        CALL {
          WITH team
          MATCH p=(person:Person)-[:MEMBER_OF]->(team)
          RETURN p
          UNION
          WITH team
          MATCH p=(team)-[:WORKS_ON|OWNS]->(:Project)
          RETURN p
          UNION
          WITH team
          MATCH p=(:Project)-[:PART_OF]->(team)
          RETURN p
          UNION
          WITH team
          MATCH p=(task:Task)-[:PART_OF]->(:Project)-[:PART_OF]->(team)
          RETURN p
          UNION
          WITH team
          MATCH p=(task:Task)-[:BLOCKED_BY]->(:Blocker)
          WHERE EXISTS {
            MATCH (task)-[:PART_OF]->(:Project)-[:PART_OF]->(team)
          }
          RETURN p
          UNION
          WITH team
          MATCH p=(person:Person)-[:HAS_SKILL]->(:Skill)
          WHERE EXISTS {
            MATCH (person)-[:MEMBER_OF]->(team)
          }
          RETURN p
        }
        ${teamNodeAndEdgeProjection}
      `,
      params: { teamId },
    });
  }

  async getProjectSubgraph(projectId: string): Promise<VisualizationSubgraphResponse> {
    await this.assertNodeExists("Project", projectId);

    return this.runSubgraphQuery({
      kind: "project",
      focusNodeId: projectId,
      cypher: `
        MATCH (project:Project {id: $projectId})
        CALL {
          WITH project
          MATCH p=(project)-[:PART_OF]->(:Team)
          RETURN p
          UNION
          WITH project
          MATCH p=(task:Task)-[:PART_OF]->(project)
          RETURN p
          UNION
          WITH project
          MATCH p=(task:Task)-[:BLOCKED_BY]->(:Blocker)
          WHERE EXISTS {
            MATCH (task)-[:PART_OF]->(project)
          }
          RETURN p
          UNION
          WITH project
          MATCH p=(person:Person)-[:WORKS_ON|OWNS]->(project)
          RETURN p
          UNION
          WITH project
          MATCH p=(person:Person)-[:WORKS_ON|OWNS]->(task:Task)-[:PART_OF]->(project)
          RETURN p
        }
        ${projectNodeAndEdgeProjection}
      `,
      params: { projectId },
    });
  }

  async getPersonEgoNetwork(personId: string, depth: number): Promise<VisualizationSubgraphResponse> {
    await this.assertNodeExists("Person", personId);

    return this.runSubgraphQuery({
      kind: "person_ego_network",
      focusNodeId: personId,
      depth,
      cypher: `
        MATCH (person:Person {id: $personId})
        OPTIONAL MATCH path=(person)-[:MEMBER_OF|WORKS_ON|OWNS|PART_OF|BLOCKED_BY|HAS_SKILL|ASSERTED|SUPPORTS*1..${depth}]-(connected)
        ${personNodeAndEdgeProjection}
      `,
      params: { personId },
    });
  }

  async getBlockerFocusedSubgraph(): Promise<VisualizationSubgraphResponse> {
    return this.runSubgraphQuery({
      kind: "blocker_focus",
      cypher: `
        CALL {
          MATCH p=(task:Task)-[:BLOCKED_BY]->(blocker:Blocker)
          WHERE blocker.status IS NULL OR blocker.status <> 'resolved'
          RETURN p
          UNION
          MATCH p=(project:Project)-[:BLOCKED_BY]->(blocker:Blocker)
          WHERE blocker.status IS NULL OR blocker.status <> 'resolved'
          RETURN p
          UNION
          MATCH p=(task:Task)-[:PART_OF]->(:Project)-[:BLOCKED_BY]->(blocker:Blocker)
          WHERE blocker.status IS NULL OR blocker.status <> 'resolved'
          RETURN p
          UNION
          MATCH p=(person:Person)-[:WORKS_ON|OWNS]->(task:Task)-[:BLOCKED_BY]->(blocker:Blocker)
          WHERE blocker.status IS NULL OR blocker.status <> 'resolved'
          RETURN p
        }
        WITH collect(DISTINCT p) AS paths
        UNWIND paths AS path
        UNWIND nodes(path) AS node
        WITH collect(DISTINCT node) AS collectedNodes, paths
        UNWIND paths AS path
        UNWIND relationships(path) AS rel
        WITH collectedNodes, collect(DISTINCT rel) AS collectedRelationships
        ${subgraphProjection}
      `,
    });
  }

  private async runSubgraphQuery(definition: SubgraphQueryDefinition): Promise<VisualizationSubgraphResponse> {
    const session = getNeo4jSession("READ");

    try {
      const result = await session.run(definition.cypher, definition.params);
      const record = result.records[0];
      const bundle: QueryBundleResult = {
        nodes: (record?.get("nodes") as RawSubgraphNode[] | undefined) ?? [],
        edges: (record?.get("edges") as RawSubgraphEdge[] | undefined) ?? [],
      };
      const recentUpdates = await this.loadRecentUpdates(session, bundle.nodes.map((node) => node.id));

      return formatVisualizationSubgraph({
        kind: definition.kind,
        nodes: bundle.nodes,
        edges: bundle.edges,
        recentUpdates,
        focusNodeId: definition.focusNodeId,
        depth: definition.depth,
      });
    } catch (error) {
      throw this.toServiceError(error);
    } finally {
      await session.close();
    }
  }

  private async assertNodeExists(label: "Team" | "Project" | "Person", id: string): Promise<void> {
    const session = getNeo4jSession("READ");

    try {
      const result = await session.run(`MATCH (node:${label} {id: $id}) RETURN node.id AS id LIMIT 1`, { id });
      if (!result.records[0]?.get("id")) {
        throw new VisualizationEntityNotFoundError(label, id);
      }
    } catch (error) {
      if (error instanceof VisualizationEntityNotFoundError) {
        throw error;
      }

      throw this.toServiceError(error);
    } finally {
      await session.close();
    }
  }

  private async loadRecentUpdates(
    session: ReturnType<typeof getNeo4jSession>,
    nodeIds: string[]
  ): Promise<RawRecentUpdate[]> {
    if (nodeIds.length === 0) {
      return [];
    }

    const result = await session.run(
      `
        MATCH (event:UpdateEvent)-[:ASSERTED]->(target)
        WHERE target.id IN $nodeIds
        WITH DISTINCT event
        OPTIONAL MATCH (event)-[:ASSERTED]->(connected)
        WHERE connected.id IN $nodeIds
        WITH event, collect(DISTINCT connected.id) AS connectedNodeIds
        RETURN {
          eventId: event.id,
          eventType: event.eventType,
          summary: event.summary,
          occurredAt: event.occurredAt,
          actorId: event.actorId,
          connectedNodeIds: connectedNodeIds,
          confidenceJson: event.confidenceJson,
          provenanceJson: event.provenanceJson
        } AS update
        ORDER BY update.occurredAt DESC
        LIMIT 12
      `,
      { nodeIds }
    );

    return result.records.map((record) => record.get("update") as RawRecentUpdate);
  }

  private toServiceError(error: unknown): Error {
    if (error instanceof VisualizationEntityNotFoundError) {
      return error;
    }

    return new VisualizationServiceUnavailableError(error instanceof Error ? error.message : undefined);
  }
}

export const visualizationService = new VisualizationService();
