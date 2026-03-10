import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getPostgresPool } from "../../infrastructure/database/postgres.js";
import type { IngestMeetingRequest } from "./meeting-ingestion.schemas.js";
import { defaultTranscriptChunkingPipeline } from "./transcript-chunking.js";

interface CreateMeetingResult {
  meetingId: string;
}

export class MeetingIngestionServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeetingIngestionServiceUnavailableError";
  }
}

let tablesEnsured = false;

const ensureMeetingTables = async (client: PoolClient) => {
  if (tablesEnsured) {
    return;
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      meeting_type TEXT NOT NULL DEFAULT 'employee_check_in',
      source TEXT NOT NULL,
      external_meeting_id TEXT,
      title TEXT,
      prompt_version TEXT NOT NULL,
      transcript_text TEXT NOT NULL,
      meeting_started_at TIMESTAMPTZ,
      meeting_ended_at TIMESTAMPTZ,
      transcript_timestamps JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    ALTER TABLE meetings
    ADD COLUMN IF NOT EXISTS meeting_type TEXT NOT NULL DEFAULT 'employee_check_in';
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS meeting_participants (
      id BIGSERIAL PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      employee_id TEXT NOT NULL,
      employee_name TEXT,
      employee_email TEXT,
      employee_title TEXT,
      employee_department TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS meeting_transcript_chunks (
      chunk_id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      chunk_order INTEGER NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('active_work', 'progress_update', 'blocker', 'dependency', 'skill_gap', 'uncertainty')),
      chunk_text TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (meeting_id, chunk_order)
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS meeting_raw_transcripts (
      meeting_id TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
      raw_transcript BYTEA NOT NULL,
      content_type TEXT NOT NULL,
      transcript_sha256 TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_meetings_created_at ON meetings (created_at);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_meeting_participants_meeting_id ON meeting_participants (meeting_id);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_meeting_chunks_meeting_order ON meeting_transcript_chunks (meeting_id, chunk_order);
  `);

  tablesEnsured = true;
};

export class MeetingIngestionService {
  async createMeeting(input: IngestMeetingRequest): Promise<CreateMeetingResult> {
    const pool = getPostgresPool();

    if (!pool) {
      throw new MeetingIngestionServiceUnavailableError(
        "Meeting ingestion requires POSTGRES_URL to be configured"
      );
    }

    const client = await pool.connect();
    const meetingId = randomUUID();
    const transcriptSha256 = createHash("sha256").update(input.rawTranscript, "utf8").digest("hex");
    const rawTranscriptBuffer = Buffer.from(input.rawTranscript, "utf8");

    try {
      await client.query("BEGIN");

      await ensureMeetingTables(client);

      await client.query(
        `
          INSERT INTO meetings (
            id,
            meeting_type,
            source,
            external_meeting_id,
            title,
            prompt_version,
            transcript_text,
            meeting_started_at,
            meeting_ended_at,
            transcript_timestamps
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
        `,
        [
          meetingId,
          input.meetingType,
          input.source,
          input.externalMeetingId ?? null,
          input.title ?? null,
          input.promptVersion,
          input.transcriptText,
          input.meetingStartedAt ?? null,
          input.meetingEndedAt ?? null,
          JSON.stringify(input.transcriptTimestamps)
        ]
      );

      if (input.meetingType === "employee_check_in") {
        const classifiedChunks = defaultTranscriptChunkingPipeline.createClassifiedChunks({
          meetingId,
          transcriptText: input.transcriptText
        });

        for (const chunk of classifiedChunks) {
          await client.query(
            `
              INSERT INTO meeting_transcript_chunks (
                chunk_id,
                meeting_id,
                chunk_order,
                category,
                chunk_text
              )
              VALUES ($1, $2, $3, $4, $5)
            `,
            [chunk.chunkId, meetingId, chunk.chunkOrder, chunk.category, chunk.text]
          );
        }
      }

      for (const employee of input.employees) {
        await client.query(
          `
            INSERT INTO meeting_participants (
              meeting_id,
              employee_id,
              employee_name,
              employee_email,
              employee_title,
              employee_department,
              metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
          `,
          [
            meetingId,
            employee.employeeId,
            employee.name ?? null,
            employee.email ?? null,
            employee.title ?? null,
            employee.department ?? null,
            JSON.stringify(employee.metadata)
          ]
        );
      }

      await client.query(
        `
          INSERT INTO meeting_raw_transcripts (
            meeting_id,
            raw_transcript,
            content_type,
            transcript_sha256
          )
          VALUES ($1, $2, $3, $4)
        `,
        [meetingId, rawTranscriptBuffer, input.rawTranscriptContentType, transcriptSha256]
      );

      await client.query("COMMIT");

      return { meetingId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export const meetingIngestionService = new MeetingIngestionService();
