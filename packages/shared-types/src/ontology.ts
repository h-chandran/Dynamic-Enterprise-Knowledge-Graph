export const NODE_TYPES = [
  "Person",
  "Team",
  "Project",
  "Task",
  "Blocker",
  "Skill",
  "Meeting",
  "TranscriptChunk",
  "UpdateEvent",
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export const RELATIONSHIP_TYPES = [
  "MEMBER_OF",
  "WORKS_ON",
  "OWNS",
  "PART_OF",
  "BLOCKED_BY",
  "HAS_SKILL",
  "ASSERTED",
  "SUPPORTS",
] as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export const DAILY_UPDATE_EVENT_TYPES = [
  "DAILY_SUMMARY_RECORDED",
  "TASK_PROGRESS_REPORTED",
  "TASK_COMPLETED",
  "BLOCKER_REPORTED",
  "BLOCKER_RESOLVED",
  "MEETING_NOTED",
] as const;

export type DailyUpdateEventType = (typeof DAILY_UPDATE_EVENT_TYPES)[number];

export interface Confidence {
  score: number;
  model?: string;
  method?: "human" | "llm" | "rule" | "hybrid";
  rationale?: string;
  evaluatedAt: string;
}

export interface Provenance {
  sourceSystem: string;
  sourceRecordId?: string;
  ingestionJobId?: string;
  assertedBy: string;
  assertedAt: string;
  traceId?: string;
  evidence?: string[];
}

export interface BaseNode<TType extends NodeType, TProperties extends object>
  extends GraphDecorators {
  id: string;
  type: TType;
  label: string;
  properties: TProperties;
  createdAt: string;
  updatedAt: string;
}

export interface PersonNodeProperties {
  fullName: string;
  employeeId?: string;
  email?: string;
  title?: string;
  timezone?: string;
}

export interface TeamNodeProperties {
  name: string;
  department?: string;
}

export interface ProjectNodeProperties {
  name: string;
  status?: "planned" | "active" | "blocked" | "done";
  targetDate?: string;
}

export interface TaskNodeProperties {
  title: string;
  status?: "todo" | "in_progress" | "blocked" | "done";
  dueDate?: string;
}

export interface BlockerNodeProperties {
  title: string;
  severity?: "low" | "medium" | "high" | "critical";
  status?: "open" | "resolved";
}

export interface SkillNodeProperties {
  name: string;
  category?: string;
}

export interface MeetingNodeProperties {
  title: string;
  startedAt: string;
  endedAt?: string;
}

export interface TranscriptChunkNodeProperties {
  transcriptId: string;
  chunkIndex: number;
  text: string;
  speakerId?: string;
}

export interface UpdateEventNodeProperties {
  eventType: DailyUpdateEventType;
  occurredAt: string;
  actorId: string;
  summary: string;
}

export type PersonNode = BaseNode<"Person", PersonNodeProperties>;
export type TeamNode = BaseNode<"Team", TeamNodeProperties>;
export type ProjectNode = BaseNode<"Project", ProjectNodeProperties>;
export type TaskNode = BaseNode<"Task", TaskNodeProperties>;
export type BlockerNode = BaseNode<"Blocker", BlockerNodeProperties>;
export type SkillNode = BaseNode<"Skill", SkillNodeProperties>;
export type MeetingNode = BaseNode<"Meeting", MeetingNodeProperties>;
export type TranscriptChunkNode = BaseNode<"TranscriptChunk", TranscriptChunkNodeProperties>;
export type UpdateEventNode = BaseNode<"UpdateEvent", UpdateEventNodeProperties>;

export type GraphNode =
  | PersonNode
  | TeamNode
  | ProjectNode
  | TaskNode
  | BlockerNode
  | SkillNode
  | MeetingNode
  | TranscriptChunkNode
  | UpdateEventNode;

export interface BaseEdge<TRelationship extends RelationshipType = RelationshipType>
  extends GraphDecorators {
  id: string;
  type: TRelationship;
  from: string;
  to: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export type GraphEdge = BaseEdge;

export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
  generatedAt: string;
}

interface DailyUpdateEventBase {
  eventId: string;
  type: DailyUpdateEventType;
  occurredAt: string;
  actorId: string;
  summary: string;
  provenance: Provenance;
  confidence?: Confidence;
}

export interface DailySummaryRecordedEventPayload extends DailyUpdateEventBase {
  type: "DAILY_SUMMARY_RECORDED";
  updatesCount: number;
}

export interface TaskProgressReportedEventPayload extends DailyUpdateEventBase {
  type: "TASK_PROGRESS_REPORTED";
  taskId: string;
  progressDelta: number;
}

export interface TaskCompletedEventPayload extends DailyUpdateEventBase {
  type: "TASK_COMPLETED";
  taskId: string;
}

export interface BlockerReportedEventPayload extends DailyUpdateEventBase {
  type: "BLOCKER_REPORTED";
  blockerId: string;
  affectedTaskIds?: string[];
}

export interface BlockerResolvedEventPayload extends DailyUpdateEventBase {
  type: "BLOCKER_RESOLVED";
  blockerId: string;
  resolutionSummary?: string;
}

export interface MeetingNotedEventPayload extends DailyUpdateEventBase {
  type: "MEETING_NOTED";
  meetingId: string;
}

export type DailyUpdateEventPayload =
  | DailySummaryRecordedEventPayload
  | TaskProgressReportedEventPayload
  | TaskCompletedEventPayload
  | BlockerReportedEventPayload
  | BlockerResolvedEventPayload
  | MeetingNotedEventPayload;

export interface GraphDecorators {
  provenance?: Provenance;
  confidence?: Confidence;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult<T> {
  valid: boolean;
  errors: ValidationIssue[];
  value?: T;
}

type AllowedEdgePattern = {
  from: NodeType;
  to: NodeType;
};

export const ALLOWED_RELATIONSHIP_ENDPOINTS: Record<RelationshipType, AllowedEdgePattern[]> = {
  MEMBER_OF: [{ from: "Person", to: "Team" }],
  WORKS_ON: [
    { from: "Person", to: "Project" },
    { from: "Person", to: "Task" },
    { from: "Team", to: "Project" },
  ],
  OWNS: [
    { from: "Person", to: "Project" },
    { from: "Person", to: "Task" },
    { from: "Team", to: "Project" },
  ],
  PART_OF: [
    { from: "Task", to: "Project" },
    { from: "Project", to: "Team" },
    { from: "TranscriptChunk", to: "Meeting" },
  ],
  BLOCKED_BY: [
    { from: "Task", to: "Blocker" },
    { from: "Project", to: "Blocker" },
  ],
  HAS_SKILL: [
    { from: "Person", to: "Skill" },
    { from: "Team", to: "Skill" },
  ],
  ASSERTED: [
    { from: "UpdateEvent", to: "Task" },
    { from: "UpdateEvent", to: "Blocker" },
    { from: "UpdateEvent", to: "Project" },
  ],
  SUPPORTS: [
    { from: "TranscriptChunk", to: "Task" },
    { from: "TranscriptChunk", to: "Blocker" },
    { from: "TranscriptChunk", to: "UpdateEvent" },
  ],
};

export function isNodeType(value: unknown): value is NodeType {
  return typeof value === "string" && NODE_TYPES.includes(value as NodeType);
}

export function isRelationshipType(value: unknown): value is RelationshipType {
  return typeof value === "string" && RELATIONSHIP_TYPES.includes(value as RelationshipType);
}

export function isDailyUpdateEventType(value: unknown): value is DailyUpdateEventType {
  return typeof value === "string" && DAILY_UPDATE_EVENT_TYPES.includes(value as DailyUpdateEventType);
}

export function validateConfidence(value: unknown): ValidationResult<Confidence> {
  const errors: ValidationIssue[] = [];

  if (!isObject(value)) {
    return invalid("confidence", "must be an object");
  }

  const score = value.score;
  if (typeof score !== "number" || Number.isNaN(score) || score < 0 || score > 1) {
    errors.push({ path: "confidence.score", message: "must be a number between 0 and 1" });
  }

  if (!isIsoDateString(value.evaluatedAt)) {
    errors.push({ path: "confidence.evaluatedAt", message: "must be an ISO-8601 datetime string" });
  }

  if (value.method !== undefined && !["human", "llm", "rule", "hybrid"].includes(String(value.method))) {
    errors.push({ path: "confidence.method", message: "must be one of: human, llm, rule, hybrid" });
  }

  if (value.model !== undefined && typeof value.model !== "string") {
    errors.push({ path: "confidence.model", message: "must be a string when provided" });
  }

  if (value.rationale !== undefined && typeof value.rationale !== "string") {
    errors.push({ path: "confidence.rationale", message: "must be a string when provided" });
  }

  return toResult(errors, value as Confidence);
}

export function validateProvenance(value: unknown): ValidationResult<Provenance> {
  const errors: ValidationIssue[] = [];

  if (!isObject(value)) {
    return invalid("provenance", "must be an object");
  }

  if (!isNonEmptyString(value.sourceSystem)) {
    errors.push({ path: "provenance.sourceSystem", message: "must be a non-empty string" });
  }

  if (!isNonEmptyString(value.assertedBy)) {
    errors.push({ path: "provenance.assertedBy", message: "must be a non-empty string" });
  }

  if (!isIsoDateString(value.assertedAt)) {
    errors.push({ path: "provenance.assertedAt", message: "must be an ISO-8601 datetime string" });
  }

  if (value.sourceRecordId !== undefined && typeof value.sourceRecordId !== "string") {
    errors.push({ path: "provenance.sourceRecordId", message: "must be a string when provided" });
  }

  if (value.ingestionJobId !== undefined && typeof value.ingestionJobId !== "string") {
    errors.push({ path: "provenance.ingestionJobId", message: "must be a string when provided" });
  }

  if (value.traceId !== undefined && typeof value.traceId !== "string") {
    errors.push({ path: "provenance.traceId", message: "must be a string when provided" });
  }

  if (value.evidence !== undefined && !isStringArray(value.evidence)) {
    errors.push({ path: "provenance.evidence", message: "must be a string array when provided" });
  }

  return toResult(errors, value as Provenance);
}

export function validateGraphNode(value: unknown): ValidationResult<GraphNode> {
  const errors: ValidationIssue[] = [];

  if (!isObject(value)) {
    return invalid("node", "must be an object");
  }

  if (!isNonEmptyString(value.id)) {
    errors.push({ path: "node.id", message: "must be a non-empty string" });
  }

  if (!isNodeType(value.type)) {
    errors.push({ path: "node.type", message: "must be a valid node type" });
  }

  if (!isNonEmptyString(value.label)) {
    errors.push({ path: "node.label", message: "must be a non-empty string" });
  }

  if (!isObject(value.properties)) {
    errors.push({ path: "node.properties", message: "must be an object" });
  }

  if (!isIsoDateString(value.createdAt)) {
    errors.push({ path: "node.createdAt", message: "must be an ISO-8601 datetime string" });
  }

  if (!isIsoDateString(value.updatedAt)) {
    errors.push({ path: "node.updatedAt", message: "must be an ISO-8601 datetime string" });
  }

  if (value.confidence !== undefined) {
    errors.push(...prefixErrors("node.confidence", validateConfidence(value.confidence).errors));
  }

  if (value.provenance !== undefined) {
    errors.push(...prefixErrors("node.provenance", validateProvenance(value.provenance).errors));
  }

  return toResult(errors, value as GraphNode);
}

export function validateGraphEdge(value: unknown): ValidationResult<GraphEdge> {
  const errors: ValidationIssue[] = [];

  if (!isObject(value)) {
    return invalid("edge", "must be an object");
  }

  if (!isNonEmptyString(value.id)) {
    errors.push({ path: "edge.id", message: "must be a non-empty string" });
  }

  if (!isRelationshipType(value.type)) {
    errors.push({ path: "edge.type", message: "must be a valid relationship type" });
  }

  if (!isNonEmptyString(value.from)) {
    errors.push({ path: "edge.from", message: "must be a non-empty string" });
  }

  if (!isNonEmptyString(value.to)) {
    errors.push({ path: "edge.to", message: "must be a non-empty string" });
  }

  if (!isIsoDateString(value.createdAt)) {
    errors.push({ path: "edge.createdAt", message: "must be an ISO-8601 datetime string" });
  }

  if (value.confidence !== undefined) {
    errors.push(...prefixErrors("edge.confidence", validateConfidence(value.confidence).errors));
  }

  if (value.provenance !== undefined) {
    errors.push(...prefixErrors("edge.provenance", validateProvenance(value.provenance).errors));
  }

  return toResult(errors, value as GraphEdge);
}

export function validateDailyUpdateEventPayload(value: unknown): ValidationResult<DailyUpdateEventPayload> {
  const errors: ValidationIssue[] = [];

  if (!isObject(value)) {
    return invalid("event", "must be an object");
  }

  if (!isNonEmptyString(value.eventId)) {
    errors.push({ path: "event.eventId", message: "must be a non-empty string" });
  }

  if (!isDailyUpdateEventType(value.type)) {
    errors.push({ path: "event.type", message: "must be a valid daily update event type" });
  }

  if (!isIsoDateString(value.occurredAt)) {
    errors.push({ path: "event.occurredAt", message: "must be an ISO-8601 datetime string" });
  }

  if (!isNonEmptyString(value.actorId)) {
    errors.push({ path: "event.actorId", message: "must be a non-empty string" });
  }

  if (!isNonEmptyString(value.summary)) {
    errors.push({ path: "event.summary", message: "must be a non-empty string" });
  }

  errors.push(...prefixErrors("event.provenance", validateProvenance(value.provenance).errors));

  if (value.confidence !== undefined) {
    errors.push(...prefixErrors("event.confidence", validateConfidence(value.confidence).errors));
  }

  if (value.type === "TASK_PROGRESS_REPORTED") {
    if (!isNonEmptyString(value.taskId)) {
      errors.push({ path: "event.taskId", message: "must be a non-empty string for TASK_PROGRESS_REPORTED" });
    }

    if (typeof value.progressDelta !== "number" || Number.isNaN(value.progressDelta)) {
      errors.push({ path: "event.progressDelta", message: "must be a number for TASK_PROGRESS_REPORTED" });
    }
  }

  if (value.type === "TASK_COMPLETED" && !isNonEmptyString(value.taskId)) {
    errors.push({ path: "event.taskId", message: "must be a non-empty string for TASK_COMPLETED" });
  }

  if (value.type === "BLOCKER_REPORTED" && !isNonEmptyString(value.blockerId)) {
    errors.push({ path: "event.blockerId", message: "must be a non-empty string for BLOCKER_REPORTED" });
  }

  if (value.type === "BLOCKER_REPORTED" && value.affectedTaskIds !== undefined && !isStringArray(value.affectedTaskIds)) {
    errors.push({ path: "event.affectedTaskIds", message: "must be a string array when provided" });
  }

  if (value.type === "BLOCKER_RESOLVED" && !isNonEmptyString(value.blockerId)) {
    errors.push({ path: "event.blockerId", message: "must be a non-empty string for BLOCKER_RESOLVED" });
  }

  if (value.type === "MEETING_NOTED" && !isNonEmptyString(value.meetingId)) {
    errors.push({ path: "event.meetingId", message: "must be a non-empty string for MEETING_NOTED" });
  }

  if (value.type === "DAILY_SUMMARY_RECORDED") {
    if (typeof value.updatesCount !== "number" || Number.isNaN(value.updatesCount) || value.updatesCount < 0) {
      errors.push({ path: "event.updatesCount", message: "must be a non-negative number for DAILY_SUMMARY_RECORDED" });
    }
  }

  return toResult(errors, value as DailyUpdateEventPayload);
}

export function validateGraphSnapshot(value: unknown): ValidationResult<GraphSnapshot> {
  const errors: ValidationIssue[] = [];

  if (!isObject(value)) {
    return invalid("graph", "must be an object");
  }

  if (!Array.isArray(value.nodes)) {
    errors.push({ path: "graph.nodes", message: "must be an array" });
  }

  if (!Array.isArray(value.edges)) {
    errors.push({ path: "graph.edges", message: "must be an array" });
  }

  if (!isIsoDateString(value.generatedAt)) {
    errors.push({ path: "graph.generatedAt", message: "must be an ISO-8601 datetime string" });
  }

  const nodeMap = new Map<string, NodeType>();

  if (Array.isArray(value.nodes)) {
    value.nodes.forEach((node, index) => {
      const nodeResult = validateGraphNode(node);
      errors.push(...prefixErrors(`graph.nodes[${index}]`, nodeResult.errors));

      if (nodeResult.value) {
        nodeMap.set(nodeResult.value.id, nodeResult.value.type);
      }
    });
  }

  if (Array.isArray(value.edges)) {
    value.edges.forEach((edge, index) => {
      const edgeResult = validateGraphEdge(edge);
      errors.push(...prefixErrors(`graph.edges[${index}]`, edgeResult.errors));

      if (edgeResult.value) {
        errors.push(...validateRelationshipEndpoints(edgeResult.value, nodeMap, index));
      }
    });
  }

  return toResult(errors, value as GraphSnapshot);
}

function validateRelationshipEndpoints(edge: GraphEdge, nodeMap: Map<string, NodeType>, edgeIndex: number): ValidationIssue[] {
  const fromType = nodeMap.get(edge.from);
  const toType = nodeMap.get(edge.to);

  if (!fromType || !toType) {
    return [
      {
        path: `graph.edges[${edgeIndex}]`,
        message: "references unknown node ids; validate nodes before edge endpoint validation",
      },
    ];
  }

  const allowedPatterns = ALLOWED_RELATIONSHIP_ENDPOINTS[edge.type];
  const isAllowed = allowedPatterns.some((pattern) => pattern.from === fromType && pattern.to === toType);

  return isAllowed
    ? []
    : [
        {
          path: `graph.edges[${edgeIndex}]`,
          message: `${edge.type} does not allow ${fromType} -> ${toType}`,
        },
      ];
}

function invalid(path: string, message: string): ValidationResult<never> {
  return {
    valid: false,
    errors: [{ path, message }],
  };
}

function toResult<T>(errors: ValidationIssue[], value: T): ValidationResult<T> {
  return {
    valid: errors.length === 0,
    errors,
    value: errors.length === 0 ? value : undefined,
  };
}

function prefixErrors(prefix: string, issues: ValidationIssue[]): ValidationIssue[] {
  return issues.map((issue) => ({
    path: `${prefix}.${issue.path}`,
    message: issue.message,
  }));
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isIsoDateString(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const time = Date.parse(value);
  return Number.isFinite(time);
}
