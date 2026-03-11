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

export * from "./ontology.js";
export * from "./analytics.js";
export * from "./insights.js";
export * from "./transcript-extraction.js";
export * from "./visualization.js";
