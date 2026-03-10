import { z } from "zod";

const appEnvSchema = z.object({
  NEXT_PUBLIC_APP_NAME: z.string().min(1),
  NEXT_PUBLIC_API_BASE_URL: z.string().url()
});

const parseResult = appEnvSchema.safeParse({
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL
});

if (!parseResult.success) {
  const issues = parseResult.error.issues.map((issue) => {
    const key = issue.path.join(".");
    return `${key}: ${issue.message}`;
  });
  throw new Error(`Invalid web environment configuration. Details: ${issues.join("; ")}`);
}

export const appEnv = parseResult.data;
