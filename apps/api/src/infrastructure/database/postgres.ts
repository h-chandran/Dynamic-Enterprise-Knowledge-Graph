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

export const checkPostgresConnection = async () => {
  const pool = getPostgresPool();

  if (!pool) {
    return { status: "not_configured" as const };
  }

  try {
    await pool.query("SELECT 1");
    return { status: "up" as const };
  } catch (error) {
    return {
      status: "down" as const,
      error: error instanceof Error ? error.message : "Postgres connectivity check failed."
    };
  }
};

export const closePostgresConnection = async () => {
  if (!postgresPool) {
    return;
  }

  await postgresPool.end();
  postgresPool = null;
};
