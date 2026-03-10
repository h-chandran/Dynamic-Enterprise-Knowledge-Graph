import type { FastifyPluginAsync } from "fastify";
import { checkNeo4jConnection } from "../infrastructure/database/neo4j.js";
import { checkPostgresConnection } from "../infrastructure/database/postgres.js";

export const healthRoute: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => {
    const [neo4j, postgres] = await Promise.all([
      checkNeo4jConnection(),
      checkPostgresConnection()
    ]);

    const status =
      neo4j.status === "up" && (postgres.status === "up" || postgres.status === "not_configured")
        ? "ok"
        : "degraded";

    return {
      status,
      services: {
        api: { status: "up" },
        neo4j,
        postgres
      }
    };
  });
};
