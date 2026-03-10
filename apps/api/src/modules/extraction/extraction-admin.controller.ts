import type { FastifyReply, FastifyRequest } from "fastify";
import { ExtractionAdminServiceUnavailableError, extractionAdminService } from "./extraction-admin.service.js";
import { ExtractionAdminValidationError, parseExtractionStatusQuery } from "./extraction-admin.schemas.js";

export class ExtractionAdminController {
  async listStatus(request: FastifyRequest, reply: FastifyReply) {
    try {
      const query = parseExtractionStatusQuery(request.query);
      const records = await extractionAdminService.listExtractionStatus(query);
      return reply.status(200).send({
        count: records.length,
        records,
      });
    } catch (error) {
      if (error instanceof ExtractionAdminValidationError) {
        return reply.status(400).send({
          error: error.message,
          details: error.details,
        });
      }

      if (error instanceof ExtractionAdminServiceUnavailableError) {
        return reply.status(503).send({
          error: error.message,
        });
      }

      throw error;
    }
  }
}

export const extractionAdminController = new ExtractionAdminController();
