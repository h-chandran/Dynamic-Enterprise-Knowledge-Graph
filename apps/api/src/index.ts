import { createApiServer } from "./app.js";
import { env } from "./config/env.js";

const bootstrap = async () => {
  const app = createApiServer();

  try {
    await app.listen({
      host: env.API_HOST,
      port: env.API_PORT
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void bootstrap();
