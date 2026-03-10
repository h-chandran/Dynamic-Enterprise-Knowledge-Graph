import type { FastifyReply, FastifyRequest } from "fastify";
import {
  AnalyticsValidationError,
  parseAnalyticsMetricParams,
  parseAnalyticsMetricsQuery,
} from "./analytics.schemas.js";
import {
  analyticsService,
  AnalyticsServiceUnavailableError,
  AnalyticsUnknownMetricError,
} from "./analytics.service.js";

export class AnalyticsController {
  async dashboard(request: FastifyRequest, reply: FastifyReply) {
    return this.handle(reply, async () => {
      const query = parseAnalyticsMetricsQuery(request.query);
      return analyticsService.getDashboard(query.limit);
    });
  }

  async metric(request: FastifyRequest, reply: FastifyReply) {
    return this.handle(reply, async () => {
      const params = parseAnalyticsMetricParams(request.params);
      const query = parseAnalyticsMetricsQuery(request.query);
      return analyticsService.getMetric(params.metricKey, query.limit);
    });
  }

  private async handle(reply: FastifyReply, operation: () => Promise<unknown>) {
    try {
      return reply.status(200).send(await operation());
    } catch (error) {
      if (error instanceof AnalyticsValidationError) {
        return reply.status(400).send({
          error: error.message,
          details: error.details,
        });
      }

      if (error instanceof AnalyticsUnknownMetricError) {
        return reply.status(404).send({
          error: error.message,
        });
      }

      if (error instanceof AnalyticsServiceUnavailableError) {
        return reply.status(503).send({
          error: error.message,
        });
      }

      throw error;
    }
  }
}

export const analyticsController = new AnalyticsController();
