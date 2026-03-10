import { Pool } from "pg";
import { env } from "../../config/env.js";

let postgresPool: Pool | null = null;

export const getPostgresPool = () => {
  if (!env.POSTGRES_URL) {
    return null;
  }

  if (!postgresPool) {
    postgresPool = new Pool({ connectionString: env.POSTGRES_URL });
  }

  return postgresPool;
};

export const closePostgresConnection = async () => {
  if (!postgresPool) {
    return;
  }

  await postgresPool.end();
  postgresPool = null;
};
