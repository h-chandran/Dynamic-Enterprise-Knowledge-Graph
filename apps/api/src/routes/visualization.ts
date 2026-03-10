import type { FastifyPluginAsync } from "fastify";
import { visualizationController } from "../modules/visualization/visualization.controller.js";

export const visualizationRoute: FastifyPluginAsync = async (app) => {
  app.get("/visualization/subgraphs/company-overview", async (request, reply) =>
    visualizationController.companyOverview(request, reply)
  );
  app.get("/visualization/subgraphs/teams/:id", async (request, reply) =>
    visualizationController.teamSubgraph(request, reply)
  );
  app.get("/visualization/subgraphs/projects/:id", async (request, reply) =>
    visualizationController.projectSubgraph(request, reply)
  );
  app.get("/visualization/subgraphs/people/:id/ego-network", async (request, reply) =>
    visualizationController.personEgoNetwork(request, reply)
  );
  app.get("/visualization/subgraphs/blockers/focused", async (request, reply) =>
    visualizationController.blockerFocus(request, reply)
  );
};
