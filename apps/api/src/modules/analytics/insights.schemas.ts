import { z } from "zod";

const insightsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(12).default(6),
});

const insightParamsSchema = z.object({
  insightId: z.string().trim().min(1),
});

export type InsightsQuery = z.infer<typeof insightsQuerySchema>;
export type InsightParams = z.infer<typeof insightParamsSchema>;

export class InsightsValidationError extends Error {
  readonly details: string[];

  constructor(message: string, details: string[]) {
    super(message);
    this.name = "InsightsValidationError";
    this.details = details;
  }
}

export const parseInsightsQuery = (input: unknown): InsightsQuery => {
  const result = insightsQuerySchema.safeParse(input);

  if (!result.success) {
    throw new InsightsValidationError("Invalid insight query parameters", formatIssues(result.error.issues));
  }

  return result.data;
};

export const parseInsightParams = (input: unknown): InsightParams => {
  const result = insightParamsSchema.safeParse(input);

  if (!result.success) {
    throw new InsightsValidationError("Invalid insight parameters", formatIssues(result.error.issues));
  }

  return result.data;
};

function formatIssues(issues: z.ZodIssue[]): string[] {
  return issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "request";
    return `${path}: ${issue.message}`;
  });
}

