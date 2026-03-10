import { z } from "zod";

const isoDateTimeSchema = z.string().datetime({ offset: true });

export const transcriptTimestampSchema = z.object({
  offsetMs: z.number().int().min(0),
  text: z.string().min(1).optional(),
  speaker: z.string().min(1).optional(),
  at: isoDateTimeSchema.optional()
});

export const employeeMetadataSchema = z.object({
  employeeId: z.string().min(1),
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  title: z.string().min(1).optional(),
  department: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.string()).default({})
});

export const ingestMeetingSchema = z
  .object({
    source: z.string().min(1),
    externalMeetingId: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    meetingStartedAt: isoDateTimeSchema.optional(),
    meetingEndedAt: isoDateTimeSchema.optional(),
    promptVersion: z.string().min(1),
    transcriptText: z.string().min(1),
    rawTranscript: z.string().min(1),
    rawTranscriptContentType: z.string().min(1).default("text/plain; charset=utf-8"),
    transcriptTimestamps: z.array(transcriptTimestampSchema).default([]),
    employees: z.array(employeeMetadataSchema).min(1)
  })
  .superRefine((data, ctx) => {
    if (data.meetingStartedAt && data.meetingEndedAt) {
      const start = new Date(data.meetingStartedAt).getTime();
      const end = new Date(data.meetingEndedAt).getTime();

      if (end < start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["meetingEndedAt"],
          message: "meetingEndedAt must be greater than or equal to meetingStartedAt"
        });
      }
    }
  });

export type IngestMeetingRequest = z.infer<typeof ingestMeetingSchema>;

export class MeetingIngestionValidationError extends Error {
  readonly details: string[];

  constructor(details: string[]) {
    super("Invalid meeting ingestion payload");
    this.name = "MeetingIngestionValidationError";
    this.details = details;
  }
}

export const parseIngestMeetingRequest = (input: unknown): IngestMeetingRequest => {
  const result = ingestMeetingSchema.safeParse(input);

  if (!result.success) {
    const details = result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "body";
      return `${path}: ${issue.message}`;
    });

    throw new MeetingIngestionValidationError(details);
  }

  return result.data;
};
