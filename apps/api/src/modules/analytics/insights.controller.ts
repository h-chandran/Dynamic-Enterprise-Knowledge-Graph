import type { FastifyReply, FastifyRequest } from "fastify";
import { parseInsightParams, parseInsightsQuery, InsightsValidationError } from "./insights.schemas.js";
import {
  insightService,
  InsightNotFoundError,
  InsightServiceUnavailableError,
} from "./insights.service.js";

export class InsightsController {
  async dashboard(request: FastifyRequest, reply: FastifyReply) {
    return this.handle(reply, async () => {
      const query = parseInsightsQuery(request.query);
      return insightService.getDashboard(query.limit);
    });
  }

  async detail(request: FastifyRequest, reply: FastifyReply) {
    return this.handle(reply, async () => {
      const params = parseInsightParams(request.params);
      const query = parseInsightsQuery(request.query);
      return insightService.getInsight(params.insightId, query.limit);
    });
  }

  private async handle(reply: FastifyReply, operation: () => Promise<unknown>) {
    try {
      return reply.status(200).send(await operation());
    } catch (error) {
      if (error instanceof InsightsValidationError) {
        return reply.status(400).send({
          error: error.message,
          details: error.details,
        });
      }

      if (error instanceof InsightNotFoundError) {
        return reply.status(404).send({
          error: error.message,
        });
      }

      if (error instanceof InsightServiceUnavailableError) {
        return reply.status(503).send({
          error: error.message,
        });
      }

      throw error;
    }
  }
}

export const insightsController = new InsightsController();

