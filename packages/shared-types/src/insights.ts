import type { NodeType } from "./ontology.js";

export const INSIGHT_CATEGORIES = [
  "repeated_blockers",
  "skill_gap",
  "overload_risk",
  "staffing_hypothesis",
] as const;

export type InsightCategory = (typeof INSIGHT_CATEGORIES)[number];

export const INSIGHT_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type InsightSeverity = (typeof INSIGHT_SEVERITIES)[number];

export const INSIGHT_CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export type InsightConfidenceLevel = (typeof INSIGHT_CONFIDENCE_LEVELS)[number];

export const HYPOTHESIS_TYPES = ["hire", "rebalance", "cross_train", "backup_owner"] as const;
export type HypothesisType = (typeof HYPOTHESIS_TYPES)[number];

export type InsightFocusType = "person" | "team" | "system" | "skill";

export interface InsightEntityReference {
  entityId: string;
  entityLabel: string;
  entityType: NodeType | "System";
  focusType: InsightFocusType;
  sourceNodeType?: NodeType;
}

export interface InsightFact {
  status: "confirmed";
  label: string;
  statement: string;
  value?: number | string;
  unit?: "count" | "score" | "ratio" | "text";
  entities: InsightEntityReference[];
}

export interface InsightRecommendation {
  status: "inferred";
  statement: string;
  confidence: InsightConfidenceLevel;
  rationale: string;
  uncertaintyNote: string;
  suggestedActions: string[];
  entities: InsightEntityReference[];
}

export interface InsightCard {
  id: string;
  category: Exclude<InsightCategory, "staffing_hypothesis">;
  title: string;
  summary: string;
  severity: InsightSeverity;
  score: number;
  focus: InsightEntityReference;
  confirmedFacts: InsightFact[];
  inferredRecommendations: InsightRecommendation[];
}

export interface StaffingHypothesis {
  id: string;
  category: "staffing_hypothesis";
  type: HypothesisType;
  title: string;
  summary: string;
  confidence: InsightConfidenceLevel;
  severity: InsightSeverity;
  target: InsightEntityReference;
  basedOnInsightIds: string[];
  confirmedFacts: InsightFact[];
  inferredRecommendation: InsightRecommendation;
}

export interface InsightsDashboardResponse {
  generatedAt: string;
  cards: InsightCard[];
  staffingHypotheses: StaffingHypothesis[];
  methodology: {
    factsLabel: "confirmed_graph_evidence";
    recommendationsLabel: "inferred_hypotheses";
    uncertaintyPrinciple: string;
  };
}

