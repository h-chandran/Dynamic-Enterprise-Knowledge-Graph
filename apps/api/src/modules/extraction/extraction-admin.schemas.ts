import { z } from "zod";

export const extractionStatusQuerySchema = z.object({
  meetingId: z.string().min(1).optional(),
  transcriptId: z.string().min(1).optional(),
  chunkId: z.string().min(1).optional(),
  status: z.enum(["running", "succeeded", "partial_success", "failed"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type ExtractionStatusQuery = z.infer<typeof extractionStatusQuerySchema>;

export class ExtractionAdminValidationError extends Error {
  readonly details: string[];

  constructor(details: string[]) {
    super("Invalid extraction admin query parameters");
    this.name = "ExtractionAdminValidationError";
    this.details = details;
  }
}

export const parseExtractionStatusQuery = (input: unknown): ExtractionStatusQuery => {
  const result = extractionStatusQuerySchema.safeParse(input);

  if (!result.success) {
    const details = result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "query";
      return `${path}: ${issue.message}`;
    });
    throw new ExtractionAdminValidationError(details);
  }

  return result.data;
};
