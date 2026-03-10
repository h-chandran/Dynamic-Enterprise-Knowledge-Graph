import { ANALYTICS_METRIC_KEYS, type AnalyticsMetricKey } from "@shared-types";
import { z } from "zod";

const metricsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

const metricParamsSchema = z.object({
  metricKey: z.custom<AnalyticsMetricKey>((value) => typeof value === "string" && ANALYTICS_METRIC_KEYS.includes(value as AnalyticsMetricKey), {
    message: `must be one of: ${ANALYTICS_METRIC_KEYS.join(", ")}`,
  }),
});

export type AnalyticsMetricsQuery = z.infer<typeof metricsQuerySchema>;
export type AnalyticsMetricParams = z.infer<typeof metricParamsSchema>;

export class AnalyticsValidationError extends Error {
  readonly details: string[];

  constructor(message: string, details: string[]) {
    super(message);
    this.name = "AnalyticsValidationError";
    this.details = details;
  }
}

export const parseAnalyticsMetricsQuery = (input: unknown): AnalyticsMetricsQuery => {
  const result = metricsQuerySchema.safeParse(input);

  if (!result.success) {
    throw new AnalyticsValidationError("Invalid analytics query parameters", formatIssues(result.error.issues));
  }

  return result.data;
};

export const parseAnalyticsMetricParams = (input: unknown): AnalyticsMetricParams => {
  const result = metricParamsSchema.safeParse(input);

  if (!result.success) {
    throw new AnalyticsValidationError("Invalid analytics metric parameters", formatIssues(result.error.issues));
  }

  return result.data;
};

function formatIssues(issues: z.ZodIssue[]): string[] {
  return issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "request";
    return `${path}: ${issue.message}`;
  });
}
