import { randomUUID } from "node:crypto";

export interface TranscriptChunkInput {
  transcriptId: string;
  chunkId: string;
  chunkOrder: number;
  text: string;
  speakerId?: string;
  startedAtMs?: number;
  endedAtMs?: number;
  sourceSystem?: string;
  sourceRecordId?: string;
  ingestionJobId?: string;
}

export interface ExtractionPassInput {
  extractionRunId: string;
  transcriptId: string;
  chunk: TranscriptChunkInput;
  retry?: RetryContext;
}

export interface ProviderPassOutput {
  rawOutput: unknown;
  parsedOutput: unknown;
}

export interface RetryContext {
  attempt: number;
  previousErrors: string[];
  correctionPrompt?: string;
}

export interface ExtractionModelProvider {
  readonly providerName: string;
  readonly modelName: string;
  extractEntities(input: ExtractionPassInput): Promise<ProviderPassOutput>;
  extractRelationships(
    input: ExtractionPassInput & {
      entities: unknown[];
    }
  ): Promise<ProviderPassOutput>;
  extractEvents(
    input: ExtractionPassInput & {
      entities: unknown[];
      relationships: unknown[];
    }
  ): Promise<ProviderPassOutput>;
}

export class PlaceholderExtractionProvider implements ExtractionModelProvider {
  readonly providerName = "placeholder";
  readonly modelName = "heuristic-v1";

  async extractEntities(input: ExtractionPassInput): Promise<ProviderPassOutput> {
    const text = input.chunk.text;
    const entities: unknown[] = [];

    const speakerName = toTitleCaseOptional(input.chunk.speakerId?.replace(/[_-]/g, " "));
    if (speakerName) {
      entities.push({
        entityId: `ent_person_${slugify(speakerName)}`,
        nodeType: "Person",
        label: speakerName,
        aliases: [],
        properties: {
          fullName: speakerName,
        },
      });
    }

    const taskMatch = text.match(/\b(?:working on|implementing|building|finishing|completed)\s+([^.!?\n]+)/i);
    const taskText = taskMatch?.[1];
    if (taskText) {
      const taskTitle = toTitleCase(cleanEntityText(taskText));
      entities.push({
        entityId: `ent_task_${slugify(taskTitle)}`,
        nodeType: "Task",
        label: taskTitle,
        aliases: [],
        properties: {
          title: taskTitle,
          status: /\bcompleted|finished|done\b/i.test(text) ? "done" : "in_progress",
        },
      });
    }

    const blockerMatch = text.match(/\b(?:blocked by|blocker is|blocked on)\s+([^.!?\n]+)/i);
    const blockerText = blockerMatch?.[1];
    if (blockerText) {
      const blockerTitle = toTitleCase(cleanEntityText(blockerText));
      entities.push({
        entityId: `ent_blocker_${slugify(blockerTitle)}`,
        nodeType: "Blocker",
        label: blockerTitle,
        aliases: [],
        properties: {
          title: blockerTitle,
          status: "open",
        },
      });
    }

    return {
      rawOutput: {
        prompt: buildPrompt("placeholder-entity-pass", input.retry),
        completion: entities,
      },
      parsedOutput: entities,
    };
  }

  async extractRelationships(
    input: ExtractionPassInput & { entities: unknown[] }
  ): Promise<ProviderPassOutput> {
    const text = input.chunk.text;
    const entities = input.entities as Array<Record<string, unknown>>;
    const personId = entities.find((entity) => entity.nodeType === "Person")?.entityId;
    const taskId = entities.find((entity) => entity.nodeType === "Task")?.entityId;
    const blockerId = entities.find((entity) => entity.nodeType === "Blocker")?.entityId;

    const relationships: unknown[] = [];

    if (personId && taskId && /\b(?:working on|own|owns|responsible for|completed)\b/i.test(text)) {
      relationships.push({
        relationshipId: `rel_${randomUUID()}`,
        type: "WORKS_ON",
        fromEntityId: personId,
        toEntityId: taskId,
        metadata: { source: "heuristic" },
      });
    }

    if (taskId && blockerId) {
      relationships.push({
        relationshipId: `rel_${randomUUID()}`,
        type: "BLOCKED_BY",
        fromEntityId: taskId,
        toEntityId: blockerId,
        metadata: { source: "heuristic" },
      });
    }

    return {
      rawOutput: {
        prompt: buildPrompt("placeholder-relationship-pass", input.retry),
        completion: relationships,
      },
      parsedOutput: relationships,
    };
  }

  async extractEvents(
    input: ExtractionPassInput & {
      entities: unknown[];
      relationships: unknown[];
    }
  ): Promise<ProviderPassOutput> {
    const text = input.chunk.text;
    const entities = input.entities as Array<Record<string, unknown>>;
    const actorEntityId = entities.find((entity) => entity.nodeType === "Person")?.entityId ?? "ent_person_unknown";
    const taskEntityId = entities.find((entity) => entity.nodeType === "Task")?.entityId;
    const blockerEntityId = entities.find((entity) => entity.nodeType === "Blocker")?.entityId;
    const occurredAt = new Date().toISOString();

    const events: unknown[] = [];

    if (taskEntityId && /\b(?:progress|%|percent)\b/i.test(text)) {
      events.push({
        eventId: `evt_${randomUUID()}`,
        type: "TASK_PROGRESS_REPORTED",
        occurredAt,
        actorEntityId,
        summary: truncateSummary(text),
        taskEntityId,
        progressDelta: 0.1,
      });
    }

    if (taskEntityId && /\b(?:completed|finished|done)\b/i.test(text)) {
      events.push({
        eventId: `evt_${randomUUID()}`,
        type: "TASK_COMPLETED",
        occurredAt,
        actorEntityId,
        summary: truncateSummary(text),
        taskEntityId,
      });
    }

    if (blockerEntityId && /\b(?:blocked|blocker|stuck)\b/i.test(text)) {
      events.push({
        eventId: `evt_${randomUUID()}`,
        type: "BLOCKER_REPORTED",
        occurredAt,
        actorEntityId,
        summary: truncateSummary(text),
        blockerEntityId,
        affectedTaskEntityIds: taskEntityId ? [taskEntityId] : [],
      });
    }

    return {
      rawOutput: {
        prompt: buildPrompt("placeholder-event-pass", input.retry),
        completion: events,
      },
      parsedOutput: events,
    };
  }
}

function cleanEntityText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function toTitleCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function toTitleCaseOptional(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return toTitleCase(value);
}

function truncateSummary(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 280 ? `${normalized.slice(0, 277)}...` : normalized;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildPrompt(basePrompt: string, retry: RetryContext | undefined): string {
  if (!retry || retry.attempt <= 1) {
    return basePrompt;
  }

  const errors = retry.previousErrors.length > 0 ? retry.previousErrors.join(" | ") : "no previous errors captured";
  return `${basePrompt} [retry=${retry.attempt}] [correction=${retry.correctionPrompt ?? "return valid schema output"}] [errors=${errors}]`;
}
