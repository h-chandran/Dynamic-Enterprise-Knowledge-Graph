import type { FastifyReply, FastifyRequest } from "fastify";
import {
  MeetingIngestionValidationError,
  parseIngestMeetingRequest
} from "./meeting-ingestion.schemas.js";
import {
  MeetingIngestionServiceUnavailableError,
  meetingIngestionService
} from "./meeting-ingestion.service.js";

export class MeetingIngestionController {
  async ingest(request: FastifyRequest, reply: FastifyReply) {
    try {
      const payload = parseIngestMeetingRequest(request.body);
      const result = await meetingIngestionService.createMeeting(payload);

      return reply.status(201).send(result);
    } catch (error) {
      if (error instanceof MeetingIngestionValidationError) {
        return reply.status(400).send({
          error: error.message,
          details: error.details
        });
      }

      if (error instanceof MeetingIngestionServiceUnavailableError) {
        return reply.status(503).send({
          error: error.message
        });
      }

      throw error;
    }
  }
}

export const meetingIngestionController = new MeetingIngestionController();
