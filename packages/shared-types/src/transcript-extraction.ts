import { z } from "zod";
import { DAILY_UPDATE_EVENT_TYPES, NODE_TYPES, RELATIONSHIP_TYPES } from "./ontology.js";

type EntityNodeTypeTuple = readonly ["Person", "Team", "Project", "Task", "Blocker", "Skill", "Meeting"];

export const ENTITY_NODE_TYPES = [
  "Person",
  "Team",
  "Project",
  "Task",
  "Blocker",
  "Skill",
  "Meeting",
] as const satisfies EntityNodeTypeTuple;

const isoDateTimeSchema = z.string().datetime({ offset: true });
const nonEmptyStringSchema = z.string().trim().min(1);
const scoreSchema = z.number().min(0).max(1);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

export const entityNodeTypeSchema = z.enum(ENTITY_NODE_TYPES);

const entityPropertySchemas = {
  Person: z
    .object({
      fullName: nonEmptyStringSchema,
      email: z.string().email().optional(),
      title: nonEmptyStringSchema.optional(),
      timezone: nonEmptyStringSchema.optional(),
    })
    .strict(),
  Team: z
    .object({
      name: nonEmptyStringSchema,
      department: nonEmptyStringSchema.optional(),
    })
    .strict(),
  Project: z
    .object({
      name: nonEmptyStringSchema,
      status: z.enum(["planned", "active", "blocked", "done"]).optional(),
      targetDate: isoDateSchema.optional(),
    })
    .strict(),
  Task: z
    .object({
      title: nonEmptyStringSchema,
      status: z.enum(["todo", "in_progress", "blocked", "done"]).optional(),
      dueDate: isoDateSchema.optional(),
    })
    .strict(),
  Blocker: z
    .object({
      title: nonEmptyStringSchema,
      severity: z.enum(["low", "medium", "high", "critical"]).optional(),
      status: z.enum(["open", "resolved"]).optional(),
    })
    .strict(),
  Skill: z
    .object({
      name: nonEmptyStringSchema,
      category: nonEmptyStringSchema.optional(),
    })
    .strict(),
  Meeting: z
    .object({
      title: nonEmptyStringSchema,
      startedAt: isoDateTimeSchema,
      endedAt: isoDateTimeSchema.optional(),
    })
    .strict(),
} as const;

const entityResolutionSchema = z
  .object({
    action: z.enum(["create", "match_existing", "merge_with_existing"]),
    normalizedKey: nonEmptyStringSchema,
    candidateNodeIds: z.array(nonEmptyStringSchema).default([]),
    chosenNodeId: nonEmptyStringSchema.optional(),
    reason: nonEmptyStringSchema.optional(),
  })
  .strict();

export const extractedEntitySchema = z.discriminatedUnion("nodeType", [
  z
    .object({
      entityId: nonEmptyStringSchema,
      nodeType: z.literal("Person"),
      label: nonEmptyStringSchema,
      aliases: z.array(nonEmptyStringSchema).default([]),
      properties: entityPropertySchemas.Person,
      resolution: entityResolutionSchema,
      confidence: scoreSchema,
      evidenceSpanIds: z.array(nonEmptyStringSchema).min(1),
    })
    .strict(),
  z
    .object({
      entityId: nonEmptyStringSchema,
      nodeType: z.literal("Team"),
      label: nonEmptyStringSchema,
      aliases: z.array(nonEmptyStringSchema).default([]),
      properties: entityPropertySchemas.Team,
      resolution: entityResolutionSchema,
      confidence: scoreSchema,
      evidenceSpanIds: z.array(nonEmptyStringSchema).min(1),
    })
    .strict(),
  z
    .object({
      entityId: nonEmptyStringSchema,
      nodeType: z.literal("Project"),
      label: nonEmptyStringSchema,
      aliases: z.array(nonEmptyStringSchema).default([]),
      properties: entityPropertySchemas.Project,
      resolution: entityResolutionSchema,
      confidence: scoreSchema,
      evidenceSpanIds: z.array(nonEmptyStringSchema).min(1),
    })
    .strict(),
  z
    .object({
      entityId: nonEmptyStringSchema,
      nodeType: z.literal("Task"),
      label: nonEmptyStringSchema,
      aliases: z.array(nonEmptyStringSchema).default([]),
      properties: entityPropertySchemas.Task,
      resolution: entityResolutionSchema,
      confidence: scoreSchema,
      evidenceSpanIds: z.array(nonEmptyStringSchema).min(1),
    })
    .strict(),
  z
    .object({
      entityId: nonEmptyStringSchema,
      nodeType: z.literal("Blocker"),
      label: nonEmptyStringSchema,
      aliases: z.array(nonEmptyStringSchema).default([]),
      properties: entityPropertySchemas.Blocker,
      resolution: entityResolutionSchema,
      confidence: scoreSchema,
      evidenceSpanIds: z.array(nonEmptyStringSchema).min(1),
    })
    .strict(),
  z
    .object({
      entityId: nonEmptyStringSchema,
      nodeType: z.literal("Skill"),
      label: nonEmptyStringSchema,
      aliases: z.array(nonEmptyStringSchema).default([]),
      properties: entityPropertySchemas.Skill,
      resolution: entityResolutionSchema,
      confidence: scoreSchema,
      evidenceSpanIds: z.array(nonEmptyStringSchema).min(1),
    })
    .strict(),
  z
    .object({
      entityId: nonEmptyStringSchema,
      nodeType: z.literal("Meeting"),
      label: nonEmptyStringSchema,
      aliases: z.array(nonEmptyStringSchema).default([]),
      properties: entityPropertySchemas.Meeting,
      resolution: entityResolutionSchema,
      confidence: scoreSchema,
      evidenceSpanIds: z.array(nonEmptyStringSchema).min(1),
    })
    .strict(),
]);

export const extractedRelationshipSchema = z
  .object({
    relationshipId: nonEmptyStringSchema,
    type: z.enum(RELATIONSHIP_TYPES),
    fromEntityId: nonEmptyStringSchema,
    toEntityId: nonEmptyStringSchema,
    metadata: z.record(z.unknown()).default({}),
    confidence: scoreSchema,
    evidenceSpanIds: z.array(nonEmptyStringSchema).min(1),
  })
  .strict();

const updateEventBaseSchema = z
  .object({
    eventId: nonEmptyStringSchema,
    type: z.enum(DAILY_UPDATE_EVENT_TYPES),
    occurredAt: isoDateTimeSchema,
    actorEntityId: nonEmptyStringSchema,
    summary: nonEmptyStringSchema,
    confidence: scoreSchema,
    evidenceSpanIds: z.array(nonEmptyStringSchema).min(1),
  })
  .strict();

export const extractedUpdateEventSchema = z.discriminatedUnion("type", [
  updateEventBaseSchema
    .extend({
      type: z.literal("DAILY_SUMMARY_RECORDED"),
      updatesCount: z.number().int().min(0),
    })
    .strict(),
  updateEventBaseSchema
    .extend({
      type: z.literal("TASK_PROGRESS_REPORTED"),
      taskEntityId: nonEmptyStringSchema,
      progressDelta: z.number(),
    })
    .strict(),
  updateEventBaseSchema
    .extend({
      type: z.literal("TASK_COMPLETED"),
      taskEntityId: nonEmptyStringSchema,
    })
    .strict(),
  updateEventBaseSchema
    .extend({
      type: z.literal("BLOCKER_REPORTED"),
      blockerEntityId: nonEmptyStringSchema,
      affectedTaskEntityIds: z.array(nonEmptyStringSchema).default([]),
    })
    .strict(),
  updateEventBaseSchema
    .extend({
      type: z.literal("BLOCKER_RESOLVED"),
      blockerEntityId: nonEmptyStringSchema,
      resolutionSummary: nonEmptyStringSchema.optional(),
    })
    .strict(),
  updateEventBaseSchema
    .extend({
      type: z.literal("MEETING_NOTED"),
      meetingEntityId: nonEmptyStringSchema,
    })
    .strict(),
]);

export const confidenceNoteSchema = z
  .object({
    noteId: nonEmptyStringSchema,
    targetType: z.enum(["entity", "relationship", "update_event", "evidence_span"]),
    targetId: nonEmptyStringSchema,
    score: scoreSchema,
    level: z.enum(["high", "medium", "low"]),
    model: nonEmptyStringSchema.optional(),
    method: z.enum(["human", "llm", "rule", "hybrid"]),
    uncertaintyFlags: z
      .array(
        z.enum([
          "ambiguous_name",
          "speculative_statement",
          "incomplete_context",
          "conflicting_statement",
          "temporal_uncertainty",
        ])
      )
      .default([]),
    rationale: nonEmptyStringSchema,
    createdAt: isoDateTimeSchema,
  })
  .strict();

export const evidenceSpanSchema = z
  .object({
    spanId: nonEmptyStringSchema,
    transcriptId: nonEmptyStringSchema,
    chunkId: nonEmptyStringSchema,
    speakerId: nonEmptyStringSchema.optional(),
    startChar: z.number().int().min(0),
    endChar: z.number().int().min(0),
    quote: nonEmptyStringSchema,
    startedAtMs: z.number().int().min(0).optional(),
    endedAtMs: z.number().int().min(0).optional(),
    sourceSystem: nonEmptyStringSchema,
    sourceRecordId: nonEmptyStringSchema.optional(),
    ingestionJobId: nonEmptyStringSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.endChar < value.startChar) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endChar"],
        message: "endChar must be greater than or equal to startChar",
      });
    }

    if (
      value.startedAtMs !== undefined &&
      value.endedAtMs !== undefined &&
      value.endedAtMs < value.startedAtMs
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endedAtMs"],
        message: "endedAtMs must be greater than or equal to startedAtMs",
      });
    }
  });

export const transcriptExtractionOutputSchema = z
  .object({
    extractionRunId: nonEmptyStringSchema,
    transcriptId: nonEmptyStringSchema,
    extractedAt: isoDateTimeSchema,
    extractor: z
      .object({
        provider: nonEmptyStringSchema,
        model: nonEmptyStringSchema,
        promptVersion: nonEmptyStringSchema,
      })
      .strict(),
    entities: z.array(extractedEntitySchema),
    relationships: z.array(extractedRelationshipSchema),
    updateEvents: z.array(extractedUpdateEventSchema),
    confidenceNotes: z.array(confidenceNoteSchema),
    evidenceSpans: z.array(evidenceSpanSchema),
  })
  .strict();

export type EntityNodeType = z.infer<typeof entityNodeTypeSchema>;
export type EntityResolution = z.infer<typeof entityResolutionSchema>;
export type ExtractedEntity = z.infer<typeof extractedEntitySchema>;
export type ExtractedRelationship = z.infer<typeof extractedRelationshipSchema>;
export type ExtractedUpdateEvent = z.infer<typeof extractedUpdateEventSchema>;
export type ConfidenceNote = z.infer<typeof confidenceNoteSchema>;
export type EvidenceSpan = z.infer<typeof evidenceSpanSchema>;
export type TranscriptExtractionOutput = z.infer<typeof transcriptExtractionOutputSchema>;

export function validateExtractedEntity(input: unknown): ExtractedEntity {
  return extractedEntitySchema.parse(input);
}

export function validateExtractedRelationship(input: unknown): ExtractedRelationship {
  return extractedRelationshipSchema.parse(input);
}

export function validateExtractedUpdateEvent(input: unknown): ExtractedUpdateEvent {
  return extractedUpdateEventSchema.parse(input);
}

export function validateConfidenceNote(input: unknown): ConfidenceNote {
  return confidenceNoteSchema.parse(input);
}

export function validateEvidenceSpan(input: unknown): EvidenceSpan {
  return evidenceSpanSchema.parse(input);
}

export function validateTranscriptExtractionOutput(input: unknown): TranscriptExtractionOutput {
  return transcriptExtractionOutputSchema.parse(input);
}

export function safeValidateTranscriptExtractionOutput(input: unknown) {
  return transcriptExtractionOutputSchema.safeParse(input);
}

export const transcriptExtractionExamples = {
  entity: {
    entityId: "ent_person_ada_lovelace",
    nodeType: "Person",
    label: "Ada Lovelace",
    aliases: ["Ada"],
    properties: {
      fullName: "Ada Lovelace",
      title: "Engineering Manager",
      email: "ada@example.com",
      timezone: "America/Chicago",
    },
    resolution: {
      action: "match_existing",
      normalizedKey: "person:ada lovelace",
      candidateNodeIds: ["person_001", "person_013"],
      chosenNodeId: "person_013",
      reason: "Matched exact full name and email alias.",
    },
    confidence: 0.97,
    evidenceSpanIds: ["span_01"],
  } satisfies ExtractedEntity,
  relationship: {
    relationshipId: "rel_01",
    type: "OWNS",
    fromEntityId: "ent_person_ada_lovelace",
    toEntityId: "ent_task_migrate_ingestion",
    metadata: {
      tense: "present",
      polarity: "positive",
    },
    confidence: 0.9,
    evidenceSpanIds: ["span_02"],
  } satisfies ExtractedRelationship,
  updateEvent: {
    eventId: "evt_01",
    type: "TASK_PROGRESS_REPORTED",
    occurredAt: "2026-03-09T16:12:00Z",
    actorEntityId: "ent_person_ada_lovelace",
    summary: "Ingestion migration is about 70% complete.",
    taskEntityId: "ent_task_migrate_ingestion",
    progressDelta: 0.2,
    confidence: 0.88,
    evidenceSpanIds: ["span_03"],
  } satisfies ExtractedUpdateEvent,
  confidenceNote: {
    noteId: "cn_01",
    targetType: "entity",
    targetId: "ent_project_platform_refresh",
    score: 0.63,
    level: "medium",
    model: "gpt-4.1-mini",
    method: "llm",
    uncertaintyFlags: ["ambiguous_name"],
    rationale: "Project name appears once without a unique identifier.",
    createdAt: "2026-03-09T16:13:00Z",
  } satisfies ConfidenceNote,
  evidenceSpan: {
    spanId: "span_01",
    transcriptId: "tr_2026_03_09_eng_sync",
    chunkId: "chunk_0007",
    speakerId: "speaker_ada",
    startChar: 14,
    endChar: 112,
    quote: "Ada here. I own the ingestion migration and we are roughly seventy percent done.",
    startedAtMs: 194000,
    endedAtMs: 202500,
    sourceSystem: "zoom",
    sourceRecordId: "zoom_meeting_984",
    ingestionJobId: "job_ingest_404",
  } satisfies EvidenceSpan,
  fullOutput: {
    extractionRunId: "extract_run_2026_03_09_001",
    transcriptId: "tr_2026_03_09_eng_sync",
    extractedAt: "2026-03-09T16:14:00Z",
    extractor: {
      provider: "openai",
      model: "gpt-4.1",
      promptVersion: "phase4-v1",
    },
    entities: [
      {
        entityId: "ent_person_ada_lovelace",
        nodeType: "Person",
        label: "Ada Lovelace",
        aliases: ["Ada"],
        properties: {
          fullName: "Ada Lovelace",
          title: "Engineering Manager",
          email: "ada@example.com",
          timezone: "America/Chicago",
        },
        resolution: {
          action: "match_existing",
          normalizedKey: "person:ada lovelace",
          candidateNodeIds: ["person_013"],
          chosenNodeId: "person_013",
          reason: "Exact person match by full name and email alias.",
        },
        confidence: 0.97,
        evidenceSpanIds: ["span_01"],
      },
      {
        entityId: "ent_task_migrate_ingestion",
        nodeType: "Task",
        label: "Migrate ingestion pipeline",
        aliases: ["ingestion migration"],
        properties: {
          title: "Migrate ingestion pipeline",
          status: "in_progress",
          dueDate: "2026-03-20",
        },
        resolution: {
          action: "create",
          normalizedKey: "task:migrate ingestion pipeline",
          candidateNodeIds: [],
        },
        confidence: 0.92,
        evidenceSpanIds: ["span_02", "span_03"],
      },
    ],
    relationships: [
      {
        relationshipId: "rel_01",
        type: "OWNS",
        fromEntityId: "ent_person_ada_lovelace",
        toEntityId: "ent_task_migrate_ingestion",
        metadata: {
          tense: "present",
          polarity: "positive",
        },
        confidence: 0.9,
        evidenceSpanIds: ["span_02"],
      },
    ],
    updateEvents: [
      {
        eventId: "evt_01",
        type: "TASK_PROGRESS_REPORTED",
        occurredAt: "2026-03-09T16:12:00Z",
        actorEntityId: "ent_person_ada_lovelace",
        summary: "Ingestion migration is about 70% complete.",
        taskEntityId: "ent_task_migrate_ingestion",
        progressDelta: 0.2,
        confidence: 0.88,
        evidenceSpanIds: ["span_03"],
      },
    ],
    confidenceNotes: [
      {
        noteId: "cn_01",
        targetType: "entity",
        targetId: "ent_task_migrate_ingestion",
        score: 0.88,
        level: "high",
        model: "gpt-4.1",
        method: "llm",
        uncertaintyFlags: [],
        rationale: "Direct first-person ownership statement tied to explicit task title.",
        createdAt: "2026-03-09T16:14:00Z",
      },
    ],
    evidenceSpans: [
      {
        spanId: "span_01",
        transcriptId: "tr_2026_03_09_eng_sync",
        chunkId: "chunk_0007",
        speakerId: "speaker_ada",
        startChar: 14,
        endChar: 112,
        quote: "Ada here. I own the ingestion migration and we are roughly seventy percent done.",
        startedAtMs: 194000,
        endedAtMs: 202500,
        sourceSystem: "zoom",
        sourceRecordId: "zoom_meeting_984",
        ingestionJobId: "job_ingest_404",
      },
      {
        spanId: "span_02",
        transcriptId: "tr_2026_03_09_eng_sync",
        chunkId: "chunk_0008",
        startChar: 0,
        endChar: 67,
        quote: "Ada still owns the migration task through sprint close.",
        sourceSystem: "zoom",
      },
      {
        spanId: "span_03",
        transcriptId: "tr_2026_03_09_eng_sync",
        chunkId: "chunk_0009",
        startChar: 20,
        endChar: 95,
        quote: "We are around seventy percent done with ingestion migration.",
        sourceSystem: "zoom",
      },
    ],
  } satisfies TranscriptExtractionOutput,
} as const;
