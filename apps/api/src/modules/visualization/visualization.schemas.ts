import { z } from "zod";

const entityIdParamSchema = z.object({
  id: z.string().min(1),
});

const egoNetworkParamsSchema = z.object({
  id: z.string().min(1),
});

const egoNetworkQuerySchema = z.object({
  depth: z.coerce.number().int().min(1).max(4).default(2),
});

export type EntityIdParams = z.infer<typeof entityIdParamSchema>;
export type EgoNetworkParams = z.infer<typeof egoNetworkParamsSchema>;
export type EgoNetworkQuery = z.infer<typeof egoNetworkQuerySchema>;

export class VisualizationValidationError extends Error {
  readonly details: string[];

  constructor(message: string, details: string[]) {
    super(message);
    this.name = "VisualizationValidationError";
    this.details = details;
  }
}

export const parseEntityIdParams = (input: unknown, label: string): EntityIdParams => {
  const result = entityIdParamSchema.safeParse(input);

  if (!result.success) {
    throw new VisualizationValidationError(`Invalid ${label} parameters`, formatIssues(result.error.issues));
  }

  return result.data;
};

export const parseEgoNetworkParams = (input: unknown): EgoNetworkParams => {
  const result = egoNetworkParamsSchema.safeParse(input);

  if (!result.success) {
    throw new VisualizationValidationError("Invalid ego-network parameters", formatIssues(result.error.issues));
  }

  return result.data;
};

export const parseEgoNetworkQuery = (input: unknown): EgoNetworkQuery => {
  const result = egoNetworkQuerySchema.safeParse(input);

  if (!result.success) {
    throw new VisualizationValidationError("Invalid ego-network query parameters", formatIssues(result.error.issues));
  }

  return result.data;
};

function formatIssues(issues: z.ZodIssue[]): string[] {
  return issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "request";
    return `${path}: ${issue.message}`;
  });
}
