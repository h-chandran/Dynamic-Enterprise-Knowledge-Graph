export type FeatureDomain = "graph" | "extraction" | "analytics" | "visualization";

export interface ServiceHealth {
  status: "ok" | "degraded" | "down";
  service: "web" | "api" | "worker";
  timestamp: string;
}

export interface TranscriptExtractionJob {
  jobId: string;
  transcriptId: string;
  requestedBy: string;
  createdAt: string;
}
