import Fastify from "fastify";
import { env } from "./config/env.js";
import { closeNeo4jConnection } from "./infrastructure/database/neo4j.js";
import { closePostgresConnection } from "./infrastructure/database/postgres.js";
import { healthRoute } from "./routes/health.js";
import { extractionAdminRoute } from "./routes/extraction-admin.js";
import { meetingsRoute } from "./routes/meetings.js";
import { analyticsRoute } from "./routes/analytics.js";
import { visualizationRoute } from "./routes/visualization.js";

export const createApiServer = () => {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL
    }
  });

  app.register(healthRoute);
  app.register(meetingsRoute);
  app.register(extractionAdminRoute);
  app.register(analyticsRoute);
  app.register(visualizationRoute);

  app.addHook("onClose", async () => {
    await Promise.all([closeNeo4jConnection(), closePostgresConnection()]);
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    reply.status(500).send({
      error: "Internal Server Error"
    });
  });

  return app;
};
