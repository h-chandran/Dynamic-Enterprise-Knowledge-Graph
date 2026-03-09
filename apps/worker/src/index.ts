import { env } from "./config/env.js";

const bootstrap = async () => {
  const context = {
    service: "worker",
    nodeEnv: env.NODE_ENV,
    concurrency: env.WORKER_CONCURRENCY,
    logLevel: env.LOG_LEVEL
  };

  console.info("Worker service initialized", context);
};

void bootstrap();
