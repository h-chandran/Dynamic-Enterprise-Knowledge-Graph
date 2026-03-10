import { randomUUID } from "node:crypto";
import {
  type ConfidenceNote,
  confidenceNoteSchema,
  type EvidenceSpan,
  evidenceSpanSchema,
  type ExtractedEntity,
  extractedEntitySchema,
  type ExtractedRelationship,
  extractedRelationshipSchema,
  type ExtractedUpdateEvent,
  extractedUpdateEventSchema,
  type TranscriptExtractionOutput,
  transcriptExtractionOutputSchema,
} from "@shared-types";
import type { PoolClient } from "pg";
import { env } from "../../config/env.js";
import { getPostgresPool } from "../../infrastructure/database/postgres.js";
import type { ExtractionModelProvider, TranscriptChunkInput } from "./extraction-provider.js";
import { PlaceholderExtractionProvider } from "./extraction-provider.js";

type PassName = "entities" | "relationships" | "events";

interface ExtractionReviewRecord {
  chunkId: string;
  transcriptId: string;
  extractionRunId: string;
  status: "validated" | "failed";
  modelProvider: string;
  modelName: string;
  promptVersion: string;
  rawEntityOutput: unknown;
  rawRelationshipOutput: unknown;
  rawEventOutput: unknown;
  normalizedOutput: TranscriptExtractionOutput | null;
  validationErrors: string[];
}

export interface ChunkExtractionRequest {
  transcriptId: string;
  chunk: TranscriptChunkInput;
  extractionRunId?: string;
}

export interface ChunkExtractionResult {
  extractionRunId: string;
  transcriptId: string;
  chunkId: string;
  output: TranscriptExtractionOutput | null;
  validationErrors: string[];
}

let extractionReviewTableEnsured = false;

export class TranscriptExtractionServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptExtractionServiceUnavailableError";
  }
}

export class TranscriptExtractionService {
  private readonly provider: ExtractionModelProvider;

  constructor(provider: ExtractionModelProvider = createExtractionProvider(env.TRANSCRIPT_PROVIDER)) {
    this.provider = provider;
  }

  async processChunk(request: ChunkExtractionRequest): Promise<ChunkExtractionResult> {
    const pool = getPostgresPool();
    if (!pool) {
      throw new TranscriptExtractionServiceUnavailableError(
        "Transcript extraction review storage requires POSTGRES_URL to be configured"
      );
    }

    const extractionRunId = request.extractionRunId ?? randomUUID();
    const evidenceSpan = buildChunkEvidenceSpan({
      transcriptId: request.transcriptId,
      chunk: request.chunk,
    });

    let rawEntityOutput: unknown = null;
    let rawRelationshipOutput: unknown = null;
    let rawEventOutput: unknown = null;
    let normalizedOutput: TranscriptExtractionOutput | null = null;
    const validationErrors: string[] = [];

    try {
      const entityPass = await this.provider.extractEntities({
        extractionRunId,
        transcriptId: request.transcriptId,
        chunk: request.chunk,
      });
      rawEntityOutput = entityPass.rawOutput;
      const entities = validatePassOutput(
        "entities",
        entityPass.parsedOutput,
        evidenceSpan.spanId,
        extractedEntitySchema,
        normalizeEntity
      );

      const relationshipPass = await this.provider.extractRelationships({
        extractionRunId,
        transcriptId: request.transcriptId,
        chunk: request.chunk,
        entities,
      });
      rawRelationshipOutput = relationshipPass.rawOutput;
      const relationships = validatePassOutput(
        "relationships",
        relationshipPass.parsedOutput,
        evidenceSpan.spanId,
        extractedRelationshipSchema,
        normalizeRelationship
      );

      const eventPass = await this.provider.extractEvents({
        extractionRunId,
        transcriptId: request.transcriptId,
        chunk: request.chunk,
        entities,
        relationships,
      });
      rawEventOutput = eventPass.rawOutput;
      const updateEvents = validatePassOutput(
        "events",
        eventPass.parsedOutput,
        evidenceSpan.spanId,
        extractedUpdateEventSchema,
        normalizeUpdateEvent
      );

      const confidenceNotes = createConfidenceNotes({
        entities,
        relationships,
        updateEvents,
        modelName: this.provider.modelName,
      });

      normalizedOutput = transcriptExtractionOutputSchema.parse({
        extractionRunId,
        transcriptId: request.transcriptId,
        extractedAt: new Date().toISOString(),
        extractor: {
          provider: this.provider.providerName,
          model: this.provider.modelName,
          promptVersion: env.EXTRACTION_PROMPT_VERSION,
        },
        entities,
        relationships,
        updateEvents,
        confidenceNotes,
        evidenceSpans: [evidenceSpanSchema.parse(evidenceSpan)],
      });
    } catch (error) {
      validationErrors.push(asErrorMessage(error));
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await ensureExtractionReviewTables(client);
      await saveExtractionReviewRecord(client, {
        chunkId: request.chunk.chunkId,
        transcriptId: request.transcriptId,
        extractionRunId,
        status: normalizedOutput ? "validated" : "failed",
        modelProvider: this.provider.providerName,
        modelName: this.provider.modelName,
        promptVersion: env.EXTRACTION_PROMPT_VERSION,
        rawEntityOutput,
        rawRelationshipOutput,
        rawEventOutput,
        normalizedOutput,
        validationErrors,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return {
      extractionRunId,
      transcriptId: request.transcriptId,
      chunkId: request.chunk.chunkId,
      output: normalizedOutput,
      validationErrors,
    };
  }
}

export const transcriptExtractionService = new TranscriptExtractionService();

function createExtractionProvider(providerName: string): ExtractionModelProvider {
  if (providerName === "placeholder") {
    return new PlaceholderExtractionProvider();
  }

  throw new Error(`Unsupported transcript extraction provider: ${providerName}`);
}

async function ensureExtractionReviewTables(client: PoolClient) {
  if (extractionReviewTableEnsured) {
    return;
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS transcript_chunk_extraction_reviews (
      id BIGSERIAL PRIMARY KEY,
      extraction_run_id TEXT NOT NULL,
      transcript_id TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('validated', 'failed')),
      model_provider TEXT NOT NULL,
      model_name TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      raw_entity_output JSONB,
      raw_relationship_output JSONB,
      raw_event_output JSONB,
      normalized_output JSONB,
      validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_extraction_reviews_transcript_chunk
      ON transcript_chunk_extraction_reviews (transcript_id, chunk_id, created_at DESC);
  `);

  extractionReviewTableEnsured = true;
}

async function saveExtractionReviewRecord(client: PoolClient, record: ExtractionReviewRecord) {
  await client.query(
    `
      INSERT INTO transcript_chunk_extraction_reviews (
        extraction_run_id,
        transcript_id,
        chunk_id,
        status,
        model_provider,
        model_name,
        prompt_version,
        raw_entity_output,
        raw_relationship_output,
        raw_event_output,
        normalized_output,
        validation_errors
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb)
    `,
    [
      record.extractionRunId,
      record.transcriptId,
      record.chunkId,
      record.status,
      record.modelProvider,
      record.modelName,
      record.promptVersion,
      JSON.stringify(record.rawEntityOutput),
      JSON.stringify(record.rawRelationshipOutput),
      JSON.stringify(record.rawEventOutput),
      JSON.stringify(record.normalizedOutput),
      JSON.stringify(record.validationErrors),
    ]
  );
}

function validatePassOutput<T>(
  passName: PassName,
  modelOutput: unknown,
  defaultEvidenceSpanId: string,
  schema: { parse: (input: unknown) => T },
  normalize: (item: Record<string, unknown>, defaultEvidenceSpanId: string) => Record<string, unknown>
): T[] {
  if (!Array.isArray(modelOutput)) {
    throw new Error(`${passName} pass output must be an array`);
  }

  return modelOutput.map((item, index) => {
    if (!isObject(item)) {
      throw new Error(`${passName} pass item at index ${index} must be an object`);
    }

    try {
      return schema.parse(normalize(item, defaultEvidenceSpanId));
    } catch (error) {
      throw new Error(`${passName} pass validation failed at index ${index}: ${asErrorMessage(error)}`);
    }
  });
}

function normalizeEntity(item: Record<string, unknown>, defaultEvidenceSpanId: string): Record<string, unknown> {
  const nodeType = typeof item.nodeType === "string" ? item.nodeType : "Task";
  const label = inferLabel(item);
  const properties = isObject(item.properties) ? item.properties : {};

  return {
    ...item,
    entityId: asNonEmptyString(item.entityId, `ent_${nodeType.toLowerCase()}_${randomUUID()}`),
    nodeType,
    label,
    aliases: Array.isArray(item.aliases) ? item.aliases : [],
    properties: normalizeEntityProperties(nodeType, properties, label),
    resolution: isObject(item.resolution)
      ? item.resolution
      : {
          action: "create",
          normalizedKey: `${nodeType.toLowerCase()}:${label.toLowerCase()}`,
          candidateNodeIds: [],
        },
    confidence: asConfidenceScore(item.confidence),
    evidenceSpanIds: asEvidenceSpanIds(item.evidenceSpanIds, defaultEvidenceSpanId),
  };
}

function normalizeRelationship(item: Record<string, unknown>, defaultEvidenceSpanId: string): Record<string, unknown> {
  return {
    ...item,
    relationshipId: asNonEmptyString(item.relationshipId, `rel_${randomUUID()}`),
    metadata: isObject(item.metadata) ? item.metadata : {},
    confidence: asConfidenceScore(item.confidence),
    evidenceSpanIds: asEvidenceSpanIds(item.evidenceSpanIds, defaultEvidenceSpanId),
  };
}

function normalizeUpdateEvent(item: Record<string, unknown>, defaultEvidenceSpanId: string): Record<string, unknown> {
  return {
    ...item,
    eventId: asNonEmptyString(item.eventId, `evt_${randomUUID()}`),
    occurredAt: asNonEmptyString(item.occurredAt, new Date().toISOString()),
    summary: asNonEmptyString(item.summary, "Update extracted from transcript chunk"),
    confidence: asConfidenceScore(item.confidence),
    evidenceSpanIds: asEvidenceSpanIds(item.evidenceSpanIds, defaultEvidenceSpanId),
  };
}

function normalizeEntityProperties(nodeType: string, properties: Record<string, unknown>, label: string): Record<string, unknown> {
  switch (nodeType) {
    case "Person":
      return { fullName: asNonEmptyString(properties.fullName, label), ...properties };
    case "Team":
      return { name: asNonEmptyString(properties.name, label), ...properties };
    case "Project":
      return { name: asNonEmptyString(properties.name, label), ...properties };
    case "Task":
      return { title: asNonEmptyString(properties.title, label), ...properties };
    case "Blocker":
      return { title: asNonEmptyString(properties.title, label), ...properties };
    case "Skill":
      return { name: asNonEmptyString(properties.name, label), ...properties };
    case "Meeting":
      return {
        title: asNonEmptyString(properties.title, label),
        startedAt: asNonEmptyString(properties.startedAt, new Date().toISOString()),
        ...properties,
      };
    default:
      return properties;
  }
}

function createConfidenceNotes(input: {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  updateEvents: ExtractedUpdateEvent[];
  modelName: string;
}): ConfidenceNote[] {
  const createdAt = new Date().toISOString();
  const notes: ConfidenceNote[] = [];

  for (const entity of input.entities) {
    notes.push(
      confidenceNoteSchema.parse({
        noteId: `cn_${randomUUID()}`,
        targetType: "entity",
        targetId: entity.entityId,
        score: entity.confidence,
        level: confidenceLevel(entity.confidence),
        model: input.modelName,
        method: "llm",
        uncertaintyFlags: [],
        rationale: "Entity confidence generated during chunk extraction.",
        createdAt,
      })
    );
  }

  for (const relationship of input.relationships) {
    notes.push(
      confidenceNoteSchema.parse({
        noteId: `cn_${randomUUID()}`,
        targetType: "relationship",
        targetId: relationship.relationshipId,
        score: relationship.confidence,
        level: confidenceLevel(relationship.confidence),
        model: input.modelName,
        method: "llm",
        uncertaintyFlags: [],
        rationale: "Relationship confidence generated during chunk extraction.",
        createdAt,
      })
    );
  }

  for (const updateEvent of input.updateEvents) {
    notes.push(
      confidenceNoteSchema.parse({
        noteId: `cn_${randomUUID()}`,
        targetType: "update_event",
        targetId: updateEvent.eventId,
        score: updateEvent.confidence,
        level: confidenceLevel(updateEvent.confidence),
        model: input.modelName,
        method: "llm",
        uncertaintyFlags: [],
        rationale: "Event confidence generated during chunk extraction.",
        createdAt,
      })
    );
  }

  return notes;
}

function buildChunkEvidenceSpan(input: { transcriptId: string; chunk: TranscriptChunkInput }): EvidenceSpan {
  const text = input.chunk.text.trim();
  return evidenceSpanSchema.parse({
    spanId: `span_${input.chunk.chunkId}`,
    transcriptId: input.transcriptId,
    chunkId: input.chunk.chunkId,
    speakerId: input.chunk.speakerId,
    startChar: 0,
    endChar: Math.max(text.length - 1, 0),
    quote: text || "[empty chunk]",
    startedAtMs: input.chunk.startedAtMs,
    endedAtMs: input.chunk.endedAtMs,
    sourceSystem: input.chunk.sourceSystem ?? "meeting_transcript",
    sourceRecordId: input.chunk.sourceRecordId,
    ingestionJobId: input.chunk.ingestionJobId,
  });
}

function inferLabel(item: Record<string, unknown>): string {
  if (typeof item.label === "string" && item.label.trim().length > 0) {
    return item.label.trim();
  }

  if (isObject(item.properties)) {
    const maybeProperties = item.properties;
    const candidateKeys = ["fullName", "name", "title"];
    for (const key of candidateKeys) {
      const value = maybeProperties[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
  }

  return "Unnamed";
}

function asNonEmptyString(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return fallback;
}

function asConfidenceScore(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }
  return 0.6;
}

function asEvidenceSpanIds(value: unknown, fallbackSpanId: string): string[] {
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    if (items.length > 0) {
      return items;
    }
  }
  return [fallbackSpanId];
}

function confidenceLevel(score: number): "high" | "medium" | "low" {
  if (score >= 0.8) {
    return "high";
  }

  if (score >= 0.5) {
    return "medium";
  }

  return "low";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown extraction error";
}
