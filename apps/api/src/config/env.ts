import { z } from "zod";
import { loadEnvironment } from "./load-env.js";

loadEnvironment();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  NEO4J_URI: z.string().url(),
  NEO4J_USERNAME: z.string().min(1),
  NEO4J_PASSWORD: z.string().min(1),
  POSTGRES_URL: z.string().url().optional()
});

const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
  const missing = parseResult.error.issues
    .filter((issue) => issue.code === "invalid_type" && issue.received === "undefined")
    .map((issue) => issue.path.join("."));

  const issues = parseResult.error.issues.map((issue) => {
    const key = issue.path.join(".");
    return `${key}: ${issue.message}`;
  });

  const details = issues.join("; ");
  const missingText = missing.length > 0 ? ` Missing: ${missing.join(", ")}.` : "";
  throw new Error(`Invalid API environment configuration.${missingText} Details: ${details}`);
}

export const env = parseResult.data;
