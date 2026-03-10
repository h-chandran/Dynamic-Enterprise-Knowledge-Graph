import type { NodeType, RelationshipType } from "./ontology.js";

export const ANALYTICS_METRIC_KEYS = [
  "blocker_centrality",
  "dependency_concentration",
  "project_load_per_person",
  "single_point_of_failure",
  "skill_scarcity",
  "team_isolation",
] as const;

export type AnalyticsMetricKey = (typeof ANALYTICS_METRIC_KEYS)[number];

export interface AnalyticsMetricCard {
  key: AnalyticsMetricKey;
  title: string;
  value: number;
  unit: "score" | "count" | "ratio";
  displayValue: string;
  severity: "low" | "medium" | "high" | "critical";
  summary: string;
}

export interface AnalyticsOverlayNode {
  entityType: "node";
  id: string;
  nodeType: NodeType;
  label: string;
  score: number;
  severity: "low" | "medium" | "high" | "critical";
  metadata: Record<string, unknown>;
}

export interface AnalyticsOverlayEdge {
  entityType: "edge";
  id: string;
  edgeType: RelationshipType;
  source: string;
  target: string;
  score: number;
  severity: "low" | "medium" | "high" | "critical";
  metadata: Record<string, unknown>;
}

export type AnalyticsOverlayEntity = AnalyticsOverlayNode | AnalyticsOverlayEdge;

export interface AnalyticsMetricBreakdownItem {
  label: string;
  value: number;
  unit: "score" | "count" | "ratio";
  metadata?: Record<string, unknown>;
}

export interface AnalyticsMetricResponse {
  metric: AnalyticsMetricKey;
  generatedAt: string;
  card: AnalyticsMetricCard;
  overlay: {
    nodes: AnalyticsOverlayNode[];
    edges: AnalyticsOverlayEdge[];
  };
  breakdown: AnalyticsMetricBreakdownItem[];
  methodology: {
    description: string;
    excludesRecommendations: true;
  };
}

export interface AnalyticsDashboardResponse {
  generatedAt: string;
  metrics: Record<AnalyticsMetricKey, AnalyticsMetricResponse>;
}
