import type {
  BlockerNodeProperties,
  Confidence,
  MeetingNodeProperties,
  PersonNodeProperties,
  ProjectNodeProperties,
  Provenance,
  SkillNodeProperties,
  TaskNodeProperties,
  TeamNodeProperties,
  TranscriptChunkNodeProperties,
  UpdateEventNodeProperties
} from "@shared-types";
import type { Record as Neo4jRecord, Session } from "neo4j-driver";
import { getNeo4jSession } from "../../infrastructure/database/neo4j.js";

type ManagedNodeLabel =
  | "Person"
  | "Team"
  | "Project"
  | "Task"
  | "Blocker"
  | "Skill"
  | "Meeting"
  | "TranscriptChunk"
  | "UpdateEvent";

interface GraphNodeWriteBase {
  id: string;
  properties: object;
  createdAt?: string;
  updatedAt?: string;
  provenance?: Provenance;
  confidence?: Confidence;
}

export interface PersonNodeWriteInput extends GraphNodeWriteBase {
  label: "Person";
  properties: PersonNodeProperties;
}

export interface TeamNodeWriteInput extends GraphNodeWriteBase {
  label: "Team";
  properties: TeamNodeProperties;
}

export interface ProjectNodeWriteInput extends GraphNodeWriteBase {
  label: "Project";
  properties: ProjectNodeProperties;
}

export interface TaskNodeWriteInput extends GraphNodeWriteBase {
  label: "Task";
  properties: TaskNodeProperties;
}

export interface BlockerNodeWriteInput extends GraphNodeWriteBase {
  label: "Blocker";
  properties: BlockerNodeProperties;
}

export interface SkillNodeWriteInput extends GraphNodeWriteBase {
  label: "Skill";
  properties: SkillNodeProperties;
}

export interface MeetingNodeWriteInput extends GraphNodeWriteBase {
  label: "Meeting";
  properties: MeetingNodeProperties;
}

export interface TranscriptChunkNodeWriteInput extends GraphNodeWriteBase {
  label: "TranscriptChunk";
  properties: TranscriptChunkNodeProperties;
}

export interface UpdateEventNodeWriteInput extends GraphNodeWriteBase {
  label: "UpdateEvent";
  properties: UpdateEventNodeProperties;
}

type NodeWriteInput =
  | PersonNodeWriteInput
  | TeamNodeWriteInput
  | ProjectNodeWriteInput
  | TaskNodeWriteInput
  | BlockerNodeWriteInput
  | SkillNodeWriteInput
  | MeetingNodeWriteInput
  | TranscriptChunkNodeWriteInput
  | UpdateEventNodeWriteInput;

type WriteResult = {
  id: string;
  label: ManagedNodeLabel;
  created: boolean;
  updatedAt: string;
};

export async function createOrMergePersonNode(input: Omit<PersonNodeWriteInput, "label">): Promise<WriteResult> {
  return createOrMergeNode({
    ...input,
    label: "Person"
  });
}

export async function createOrMergeTeamNode(input: Omit<TeamNodeWriteInput, "label">): Promise<WriteResult> {
  return createOrMergeNode({
    ...input,
    label: "Team"
  });
}

export async function createOrMergeProjectNode(input: Omit<ProjectNodeWriteInput, "label">): Promise<WriteResult> {
  return createOrMergeNode({
    ...input,
    label: "Project"
  });
}

export async function createOrMergeTaskNode(input: Omit<TaskNodeWriteInput, "label">): Promise<WriteResult> {
  return createOrMergeNode({
    ...input,
    label: "Task"
  });
}

export async function createOrMergeBlockerNode(input: Omit<BlockerNodeWriteInput, "label">): Promise<WriteResult> {
  return createOrMergeNode({
    ...input,
    label: "Blocker"
  });
}

export async function createOrMergeSkillNode(input: Omit<SkillNodeWriteInput, "label">): Promise<WriteResult> {
  return createOrMergeNode({
    ...input,
    label: "Skill"
  });
}

export async function createOrMergeMeetingNode(input: Omit<MeetingNodeWriteInput, "label">): Promise<WriteResult> {
  return createOrMergeNode({
    ...input,
    label: "Meeting"
  });
}

export async function createOrMergeTranscriptChunkNode(
  input: Omit<TranscriptChunkNodeWriteInput, "label">
): Promise<WriteResult> {
  return createOrMergeNode({
    ...input,
    label: "TranscriptChunk"
  });
}

export async function createOrMergeUpdateEventNode(input: Omit<UpdateEventNodeWriteInput, "label">): Promise<WriteResult> {
  return createOrMergeNode({
    ...input,
    label: "UpdateEvent"
  });
}

export async function createOrMergeNode(input: NodeWriteInput, session?: Session): Promise<WriteResult> {
  const now = new Date().toISOString();
  const payload = {
    id: input.id,
    nodeLabel: input.label,
    displayLabel: input.label,
    now,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    properties: {
      ...input.properties,
      provenanceJson: input.provenance ? JSON.stringify(input.provenance) : undefined,
      confidenceJson: input.confidence ? JSON.stringify(input.confidence) : undefined
    }
  };

  const cypher = `
    MERGE (n:${input.label} {id: $id})
    ON CREATE SET n.createdAt = $createdAt
    SET n.updatedAt = $updatedAt,
        n.displayLabel = $displayLabel,
        n.nodeLabel = $nodeLabel
    SET n += $properties
    RETURN n.id AS id, n.nodeLabel AS label, n.createdAt = n.updatedAt AS created, n.updatedAt AS updatedAt
  `;

  if (session) {
    const result = await session.run(cypher, payload);
    return toWriteResult(result.records[0], input.label);
  }

  const writeSession = getNeo4jSession("WRITE");
  try {
    const result = await writeSession.run(cypher, payload);
    return toWriteResult(result.records[0], input.label);
  } finally {
    await writeSession.close();
  }
}

function toWriteResult(record: Neo4jRecord | undefined, fallbackLabel: ManagedNodeLabel): WriteResult {
  return {
    id: String(record?.get("id") ?? ""),
    label: (record?.get("label") as ManagedNodeLabel | undefined) ?? fallbackLabel,
    created: Boolean(record?.get("created")),
    updatedAt: String(record?.get("updatedAt") ?? "")
  };
}
