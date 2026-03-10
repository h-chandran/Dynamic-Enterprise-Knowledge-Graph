import type { FastifyReply, FastifyRequest } from "fastify";
import {
  parseEgoNetworkParams,
  parseEgoNetworkQuery,
  parseEntityIdParams,
  VisualizationValidationError,
} from "./visualization.schemas.js";
import {
  visualizationService,
  VisualizationEntityNotFoundError,
  VisualizationServiceUnavailableError,
} from "./visualization.service.js";

export class VisualizationController {
  async companyOverview(_request: FastifyRequest, reply: FastifyReply) {
    return this.handle(reply, async () => visualizationService.getCompanyOverviewSubgraph());
  }

  async teamSubgraph(request: FastifyRequest, reply: FastifyReply) {
    return this.handle(reply, async () => {
      const params = parseEntityIdParams(request.params, "team");
      return visualizationService.getTeamSubgraph(params.id);
    });
  }

  async projectSubgraph(request: FastifyRequest, reply: FastifyReply) {
    return this.handle(reply, async () => {
      const params = parseEntityIdParams(request.params, "project");
      return visualizationService.getProjectSubgraph(params.id);
    });
  }

  async personEgoNetwork(request: FastifyRequest, reply: FastifyReply) {
    return this.handle(reply, async () => {
      const params = parseEgoNetworkParams(request.params);
      const query = parseEgoNetworkQuery(request.query);
      return visualizationService.getPersonEgoNetwork(params.id, query.depth);
    });
  }

  async blockerFocus(_request: FastifyRequest, reply: FastifyReply) {
    return this.handle(reply, async () => visualizationService.getBlockerFocusedSubgraph());
  }

  private async handle(reply: FastifyReply, operation: () => Promise<unknown>) {
    try {
      return reply.status(200).send(await operation());
    } catch (error) {
      if (error instanceof VisualizationValidationError) {
        return reply.status(400).send({
          error: error.message,
          details: error.details,
        });
      }

      if (error instanceof VisualizationEntityNotFoundError) {
        return reply.status(404).send({
          error: error.message,
        });
      }

      if (error instanceof VisualizationServiceUnavailableError) {
        return reply.status(503).send({
          error: error.message,
        });
      }

      throw error;
    }
  }
}

export const visualizationController = new VisualizationController();
