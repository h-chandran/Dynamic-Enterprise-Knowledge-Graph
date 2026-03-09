import Fastify from "fastify";
import { env } from "./config/env.js";
import { healthRoute } from "./routes/health.js";

export const createApiServer = () => {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL
    }
  });

  app.register(healthRoute);

  return app;
};
