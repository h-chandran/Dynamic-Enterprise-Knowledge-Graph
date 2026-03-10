import { getPostgresPool } from "../../infrastructure/database/postgres.js";
import type { ExtractionStatusQuery } from "./extraction-admin.schemas.js";

export class ExtractionAdminServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionAdminServiceUnavailableError";
  }
}

export interface ExtractionStatusRecord {
  meetingId: string | null;
  transcriptId: string;
  chunkId: string;
  extractionRunId: string;
  status: "running" | "succeeded" | "partial_success" | "failed";
  attemptCount: number;
  successfulEntityCount: number;
  successfulRelationshipCount: number;
  successfulEventCount: number;
  lastError: string | null;
  startedAt: string;
  finishedAt: string | null;
  updatedAt: string;
  latestReviewCreatedAt: string | null;
  latestValidationErrors: unknown;
  latestPassAttempts: unknown;
}

export class ExtractionAdminService {
  async listExtractionStatus(filters: ExtractionStatusQuery): Promise<ExtractionStatusRecord[]> {
    const pool = getPostgresPool();
    if (!pool) {
      throw new ExtractionAdminServiceUnavailableError(
        "Extraction admin status requires POSTGRES_URL to be configured"
      );
    }

    const whereClauses: string[] = [];
    const params: unknown[] = [];

    if (filters.meetingId) {
      params.push(filters.meetingId);
      whereClauses.push(`j.meeting_id = $${params.length}`);
    }

    if (filters.transcriptId) {
      params.push(filters.transcriptId);
      whereClauses.push(`j.transcript_id = $${params.length}`);
    }

    if (filters.chunkId) {
      params.push(filters.chunkId);
      whereClauses.push(`j.chunk_id = $${params.length}`);
    }

    if (filters.status) {
      params.push(filters.status);
      whereClauses.push(`j.status = $${params.length}`);
    }

    params.push(filters.limit);
    const limitParam = `$${params.length}`;
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const query = `
      SELECT
        j.meeting_id AS "meetingId",
        j.transcript_id AS "transcriptId",
        j.chunk_id AS "chunkId",
        j.extraction_run_id AS "extractionRunId",
        j.status,
        j.attempt_count AS "attemptCount",
        j.successful_entity_count AS "successfulEntityCount",
        j.successful_relationship_count AS "successfulRelationshipCount",
        j.successful_event_count AS "successfulEventCount",
        j.last_error AS "lastError",
        j.started_at AS "startedAt",
        j.finished_at AS "finishedAt",
        j.updated_at AS "updatedAt",
        r.created_at AS "latestReviewCreatedAt",
        r.validation_errors AS "latestValidationErrors",
        r.pass_attempts AS "latestPassAttempts"
      FROM transcript_chunk_extraction_jobs j
      LEFT JOIN LATERAL (
        SELECT created_at, validation_errors, pass_attempts
        FROM transcript_chunk_extraction_reviews
        WHERE transcript_id = j.transcript_id AND chunk_id = j.chunk_id
        ORDER BY created_at DESC
        LIMIT 1
      ) r ON TRUE
      ${whereSql}
      ORDER BY j.updated_at DESC
      LIMIT ${limitParam}
    `;

    const result = await pool.query<ExtractionStatusRecord>(query, params);
    return result.rows;
  }
}

export const extractionAdminService = new ExtractionAdminService();
