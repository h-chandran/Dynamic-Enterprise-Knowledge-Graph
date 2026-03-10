import type { FastifyPluginAsync } from "fastify";
import { meetingIngestionController } from "../modules/meetings/meeting-ingestion.controller.js";

export const meetingsRoute: FastifyPluginAsync = async (app) => {
  app.post("/meetings/ingest", async (request, reply) => meetingIngestionController.ingest(request, reply));
};
