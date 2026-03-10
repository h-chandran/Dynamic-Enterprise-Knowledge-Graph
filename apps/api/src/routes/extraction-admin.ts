import type { FastifyPluginAsync } from "fastify";
import { extractionAdminController } from "../modules/extraction/extraction-admin.controller.js";

export const extractionAdminRoute: FastifyPluginAsync = async (app) => {
  app.get("/admin/extraction/status", async (request, reply) => extractionAdminController.listStatus(request, reply));
};
