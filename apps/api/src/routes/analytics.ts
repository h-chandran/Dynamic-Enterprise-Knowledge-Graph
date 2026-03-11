import type { FastifyPluginAsync } from "fastify";
import { analyticsController } from "../modules/analytics/analytics.controller.js";
import { insightsController } from "../modules/analytics/insights.controller.js";

export const analyticsRoute: FastifyPluginAsync = async (app) => {
  app.get("/analytics/metrics", async (request, reply) => analyticsController.dashboard(request, reply));
  app.get("/analytics/metrics/:metricKey", async (request, reply) => analyticsController.metric(request, reply));
  app.get("/analytics/insights", async (request, reply) => insightsController.dashboard(request, reply));
  app.get("/analytics/insights/:insightId", async (request, reply) => insightsController.detail(request, reply));
};
