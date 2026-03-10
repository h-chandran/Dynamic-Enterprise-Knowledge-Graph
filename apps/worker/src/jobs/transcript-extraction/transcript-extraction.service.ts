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
import type { ExtractionModelProvider, RetryContext, TranscriptChunkInput } from "./extraction-provider.js";
import { PlaceholderExtractionProvider } from "./extraction-provider.js";

type PassName = "entities" | "relationships" | "events";
type ExtractionStatus = "running" | "succeeded" | "partial_success" | "failed";

interface ExtractionReviewRecord {
  meetingId: string | null;
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
  passErrors: Record<PassName, string[]>;
  passAttempts: Record<PassName, number>;
}

interface PassExecutionResult<T> {
  passName: PassName;
  success: boolean;
  items: T[];
  errors: string[];
  attempts: number;
  rawOutputs: unknown[];
}

export interface ChunkExtractionRequest {
  meetingId?: string;
  transcriptId: string;
  chunk: TranscriptChunkInput;
  extractionRunId?: string;
}

export interface ChunkExtractionResult {
  extractionRunId: string;
  meetingId?: string;
  transcriptId: string;
  chunkId: string;
  status: ExtractionStatus;
  output: TranscriptExtractionOutput | null;
  validationErrors: string[];
  passAttempts: Record<PassName, number>;
}

let extractionTablesEnsured = false;

export class TranscriptExtractionServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptExtractionServiceUnavailableError";
  }
}

export class TranscriptExtractionService {
  private readonly provider: ExtractionModelProvider;
  private readonly maxAttempts: number;

  constructor(provider: ExtractionModelProvider = createExtractionProvider(env.TRANSCRIPT_PROVIDER), maxAttempts = env.EXTRACTION_MAX_ATTEMPTS) {
    this.provider = provider;
    this.maxAttempts = Math.max(1, maxAttempts);
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
    const validationErrors: string[] = [];
    let output: TranscriptExtractionOutput | null = null;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await ensureExtractionTables(client);
      await upsertChunkJobStatus(client, {
        meetingId: request.meetingId ?? null,
        transcriptId: request.transcriptId,
        chunkId: request.chunk.chunkId,
        extractionRunId,
        status: "running",
        attemptCount: 0,
        successfulEntityCount: 0,
        successfulRelationshipCount: 0,
        successfulEventCount: 0,
        lastError: null,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      client.release();
      throw error;
    }
    client.release();

    const entityPass = await this.executePassWithRetry({
      passName: "entities",
      chunk: request.chunk,
      transcriptId: request.transcriptId,
      extractionRunId,
      validate: (modelOutput) =>
        validatePassOutput("entities", modelOutput, evidenceSpan.spanId, extractedEntitySchema, normalizeEntity),
      invoke: (retry) =>
        this.provider.extractEntities({
          extractionRunId,
          transcriptId: request.transcriptId,
          chunk: request.chunk,
          retry,
        }),
    });

    const relationshipPass = entityPass.success
      ? await this.executePassWithRetry({
          passName: "relationships",
          chunk: request.chunk,
          transcriptId: request.transcriptId,
          extractionRunId,
          validate: (modelOutput) =>
            validatePassOutput(
              "relationships",
              modelOutput,
              evidenceSpan.spanId,
              extractedRelationshipSchema,
              normalizeRelationship
            ),
          invoke: (retry) =>
            this.provider.extractRelationships({
              extractionRunId,
              transcriptId: request.transcriptId,
              chunk: request.chunk,
              entities: entityPass.items,
              retry,
            }),
        })
      : skippedPass<ExtractedRelationship>("relationships", "Skipped because entity pass failed.");

    const eventPass = entityPass.success
      ? await this.executePassWithRetry({
          passName: "events",
          chunk: request.chunk,
          transcriptId: request.transcriptId,
          extractionRunId,
          validate: (modelOutput) =>
            validatePassOutput("events", modelOutput, evidenceSpan.spanId, extractedUpdateEventSchema, normalizeUpdateEvent),
          invoke: (retry) =>
            this.provider.extractEvents({
              extractionRunId,
              transcriptId: request.transcriptId,
              chunk: request.chunk,
              entities: entityPass.items,
              relationships: relationshipPass.items,
              retry,
            }),
        })
      : skippedPass<ExtractedUpdateEvent>("events", "Skipped because entity pass failed.");

    const passErrors: Record<PassName, string[]> = {
      entities: entityPass.errors,
      relationships: relationshipPass.errors,
      events: eventPass.errors,
    };

    validationErrors.push(...entityPass.errors, ...relationshipPass.errors, ...eventPass.errors);

    const confidenceNotes = createConfidenceNotes({
      entities: entityPass.items,
      relationships: relationshipPass.items,
      updateEvents: eventPass.items,
      modelName: this.provider.modelName,
    });

    const outputParse = transcriptExtractionOutputSchema.safeParse({
      extractionRunId,
      transcriptId: request.transcriptId,
      extractedAt: new Date().toISOString(),
      extractor: {
        provider: this.provider.providerName,
        model: this.provider.modelName,
        promptVersion: env.EXTRACTION_PROMPT_VERSION,
      },
      entities: entityPass.items,
      relationships: relationshipPass.items,
      updateEvents: eventPass.items,
      confidenceNotes,
      evidenceSpans: [evidenceSpan],
    });

    if (outputParse.success) {
      output = outputParse.data;
    } else {
      const issues = outputParse.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "output";
        return `final-output:${path}: ${issue.message}`;
      });
      validationErrors.push(...issues);
      logDetailedFailure({
        passName: "events",
        attempt: eventPass.attempts,
        transcriptId: request.transcriptId,
        chunkId: request.chunk.chunkId,
        extractionRunId,
        validationErrors: issues,
        rawOutput: null,
      });
    }

    const status = deriveChunkStatus(entityPass.success, relationshipPass.success, eventPass.success, output !== null);

    const totalAttempts = entityPass.attempts + relationshipPass.attempts + eventPass.attempts;

    const writeClient = await pool.connect();
    try {
      await writeClient.query("BEGIN");
      await ensureExtractionTables(writeClient);
      await saveExtractionReviewRecord(writeClient, {
        meetingId: request.meetingId ?? null,
        chunkId: request.chunk.chunkId,
        transcriptId: request.transcriptId,
        extractionRunId,
        status: output ? "validated" : "failed",
        modelProvider: this.provider.providerName,
        modelName: this.provider.modelName,
        promptVersion: env.EXTRACTION_PROMPT_VERSION,
        rawEntityOutput: entityPass.rawOutputs,
        rawRelationshipOutput: relationshipPass.rawOutputs,
        rawEventOutput: eventPass.rawOutputs,
        normalizedOutput: output,
        validationErrors,
        passErrors,
        passAttempts: {
          entities: entityPass.attempts,
          relationships: relationshipPass.attempts,
          events: eventPass.attempts,
        },
      });

      await upsertChunkJobStatus(writeClient, {
        meetingId: request.meetingId ?? null,
        transcriptId: request.transcriptId,
        chunkId: request.chunk.chunkId,
        extractionRunId,
        status,
        attemptCount: totalAttempts,
        successfulEntityCount: entityPass.items.length,
        successfulRelationshipCount: relationshipPass.items.length,
        successfulEventCount: eventPass.items.length,
        lastError: validationErrors.length > 0 ? (validationErrors[validationErrors.length - 1] ?? null) : null,
      });
      await writeClient.query("COMMIT");
    } catch (error) {
      await writeClient.query("ROLLBACK");
      throw error;
    } finally {
      writeClient.release();
    }

    return {
      extractionRunId,
      meetingId: request.meetingId,
      transcriptId: request.transcriptId,
      chunkId: request.chunk.chunkId,
      status,
      output,
      validationErrors,
      passAttempts: {
        entities: entityPass.attempts,
        relationships: relationshipPass.attempts,
        events: eventPass.attempts,
      },
    };
  }

  private async executePassWithRetry<T>(input: {
    passName: PassName;
    chunk: TranscriptChunkInput;
    transcriptId: string;
    extractionRunId: string;
    validate: (modelOutput: unknown) => T[];
    invoke: (retry: RetryContext) => Promise<{ rawOutput: unknown; parsedOutput: unknown }>;
  }): Promise<PassExecutionResult<T>> {
    const errors: string[] = [];
    const rawOutputs: unknown[] = [];

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const retryContext: RetryContext = {
        attempt,
        previousErrors: [...errors],
        correctionPrompt: buildCorrectionPrompt(input.passName, errors),
      };

      try {
        const passOutput = await input.invoke(retryContext);
        rawOutputs.push(passOutput.rawOutput);
        const items = input.validate(passOutput.parsedOutput);
        return {
          passName: input.passName,
          success: true,
          items,
          errors,
          attempts: attempt,
          rawOutputs,
        };
      } catch (error) {
        const message = `${input.passName}-attempt-${attempt}: ${asErrorMessage(error)}`;
        errors.push(message);
        logDetailedFailure({
          passName: input.passName,
          attempt,
          transcriptId: input.transcriptId,
          chunkId: input.chunk.chunkId,
          extractionRunId: input.extractionRunId,
          validationErrors: [message],
          rawOutput: rawOutputs[rawOutputs.length - 1] ?? null,
        });
      }
    }

    return {
      passName: input.passName,
      success: false,
      items: [],
      errors,
      attempts: this.maxAttempts,
      rawOutputs,
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

function skippedPass<T>(passName: PassName, reason: string): PassExecutionResult<T> {
  return {
    passName,
    success: false,
    items: [],
    errors: [reason],
    attempts: 0,
    rawOutputs: [],
  };
}

async function ensureExtractionTables(client: PoolClient) {
  if (extractionTablesEnsured) {
    return;
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS transcript_chunk_extraction_reviews (
      id BIGSERIAL PRIMARY KEY,
      extraction_run_id TEXT NOT NULL,
      meeting_id TEXT,
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
      pass_errors JSONB NOT NULL DEFAULT '{}'::jsonb,
      pass_attempts JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS transcript_chunk_extraction_jobs (
      transcript_id TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      meeting_id TEXT,
      extraction_run_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'partial_success', 'failed')),
      attempt_count INTEGER NOT NULL DEFAULT 0,
      successful_entity_count INTEGER NOT NULL DEFAULT 0,
      successful_relationship_count INTEGER NOT NULL DEFAULT 0,
      successful_event_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (transcript_id, chunk_id)
    );
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_extraction_reviews_transcript_chunk
      ON transcript_chunk_extraction_reviews (transcript_id, chunk_id, created_at DESC);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_extraction_jobs_meeting_status
      ON transcript_chunk_extraction_jobs (meeting_id, status, updated_at DESC);
  `);

  extractionTablesEnsured = true;
}

async function saveExtractionReviewRecord(client: PoolClient, record: ExtractionReviewRecord) {
  await client.query(
    `
      INSERT INTO transcript_chunk_extraction_reviews (
        extraction_run_id,
        meeting_id,
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
        validation_errors,
        pass_errors,
        pass_attempts
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb)
    `,
    [
      record.extractionRunId,
      record.meetingId,
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
      JSON.stringify(record.passErrors),
      JSON.stringify(record.passAttempts),
    ]
  );
}

async function upsertChunkJobStatus(
  client: PoolClient,
  input: {
    meetingId: string | null;
    transcriptId: string;
    chunkId: string;
    extractionRunId: string;
    status: ExtractionStatus;
    attemptCount: number;
    successfulEntityCount: number;
    successfulRelationshipCount: number;
    successfulEventCount: number;
    lastError: string | null;
  }
) {
  await client.query(
    `
      INSERT INTO transcript_chunk_extraction_jobs (
        transcript_id,
        chunk_id,
        meeting_id,
        extraction_run_id,
        status,
        attempt_count,
        successful_entity_count,
        successful_relationship_count,
        successful_event_count,
        last_error,
        started_at,
        finished_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        NOW(),
        CASE WHEN $5 = 'running' THEN NULL ELSE NOW() END,
        NOW()
      )
      ON CONFLICT (transcript_id, chunk_id) DO UPDATE
      SET
        meeting_id = EXCLUDED.meeting_id,
        extraction_run_id = EXCLUDED.extraction_run_id,
        status = EXCLUDED.status,
        attempt_count = EXCLUDED.attempt_count,
        successful_entity_count = EXCLUDED.successful_entity_count,
        successful_relationship_count = EXCLUDED.successful_relationship_count,
        successful_event_count = EXCLUDED.successful_event_count,
        last_error = EXCLUDED.last_error,
        finished_at = CASE WHEN EXCLUDED.status = 'running' THEN NULL ELSE NOW() END,
        updated_at = NOW()
    `,
    [
      input.transcriptId,
      input.chunkId,
      input.meetingId,
      input.extractionRunId,
      input.status,
      input.attemptCount,
      input.successfulEntityCount,
      input.successfulRelationshipCount,
      input.successfulEventCount,
      input.lastError,
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

    return schema.parse(normalize(item, defaultEvidenceSpanId));
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

function deriveChunkStatus(
  entitySuccess: boolean,
  relationshipSuccess: boolean,
  eventSuccess: boolean,
  outputSuccess: boolean
): ExtractionStatus {
  if (outputSuccess && entitySuccess && relationshipSuccess && eventSuccess) {
    return "succeeded";
  }

  if (outputSuccess && (entitySuccess || relationshipSuccess || eventSuccess)) {
    return "partial_success";
  }

  return "failed";
}

function buildCorrectionPrompt(passName: PassName, errors: string[]): string {
  if (errors.length === 0) {
    return `Return valid ${passName} JSON that matches the shared schema.`;
  }

  return `Fix these ${passName} validation errors and return schema-valid JSON only: ${errors.join(" | ")}`;
}

function logDetailedFailure(input: {
  passName: PassName;
  attempt: number;
  transcriptId: string;
  chunkId: string;
  extractionRunId: string;
  validationErrors: string[];
  rawOutput: unknown;
}) {
  const raw = safeJsonPreview(input.rawOutput);
  console.error("Transcript extraction pass failure", {
    extractionRunId: input.extractionRunId,
    transcriptId: input.transcriptId,
    chunkId: input.chunkId,
    passName: input.passName,
    attempt: input.attempt,
    errors: input.validationErrors,
    rawOutputPreview: raw,
  });
}

function safeJsonPreview(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    if (!serialized) {
      return "null";
    }
    return serialized.length > 1500 ? `${serialized.slice(0, 1500)}...` : serialized;
  } catch {
    return "[unserializable]";
  }
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
