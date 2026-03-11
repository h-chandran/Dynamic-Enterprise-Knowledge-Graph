import type { NodeType, RelationshipType } from "@shared-types";

export interface EntityVisualStyle {
  background: string;
  border: string;
  text: string;
  accent: string;
}

export const ENTITY_TYPE_ORDER: NodeType[] = ["Person", "Team", "Project", "Task", "Blocker", "Skill"];

export const ENTITY_TYPE_LABELS: Record<NodeType, string> = {
  Person: "People",
  Team: "Teams",
  Project: "Projects",
  Task: "Tasks",
  Blocker: "Blockers",
  Skill: "Skills",
  Meeting: "Meetings",
  TranscriptChunk: "Transcript Chunks",
  UpdateEvent: "Updates",
};

export const ENTITY_STYLES: Record<NodeType, EntityVisualStyle> = {
  Person: {
    background: "#fff1f2",
    border: "#e11d48",
    text: "#881337",
    accent: "#fb7185",
  },
  Team: {
    background: "#eff6ff",
    border: "#2563eb",
    text: "#1e3a8a",
    accent: "#60a5fa",
  },
  Project: {
    background: "#f5f3ff",
    border: "#7c3aed",
    text: "#4c1d95",
    accent: "#a78bfa",
  },
  Task: {
    background: "#fefce8",
    border: "#ca8a04",
    text: "#713f12",
    accent: "#facc15",
  },
  Blocker: {
    background: "#fff7ed",
    border: "#ea580c",
    text: "#9a3412",
    accent: "#fb923c",
  },
  Skill: {
    background: "#ecfdf5",
    border: "#059669",
    text: "#065f46",
    accent: "#34d399",
  },
  Meeting: {
    background: "#f1f5f9",
    border: "#64748b",
    text: "#334155",
    accent: "#94a3b8",
  },
  TranscriptChunk: {
    background: "#fafaf9",
    border: "#78716c",
    text: "#44403c",
    accent: "#a8a29e",
  },
  UpdateEvent: {
    background: "#f0fdf4",
    border: "#16a34a",
    text: "#166534",
    accent: "#4ade80",
  },
};

export const RELATIONSHIP_TYPE_ORDER: RelationshipType[] = [
  "MEMBER_OF",
  "WORKS_ON",
  "OWNS",
  "PART_OF",
  "BLOCKED_BY",
  "HAS_SKILL",
  "ASSERTED",
  "SUPPORTS",
];

export const RELATIONSHIP_TYPE_LABELS: Record<RelationshipType, string> = {
  MEMBER_OF: "Member Of",
  WORKS_ON: "Works On",
  OWNS: "Owns",
  PART_OF: "Part Of",
  BLOCKED_BY: "Blocked By",
  HAS_SKILL: "Has Skill",
  ASSERTED: "Asserted",
  SUPPORTS: "Supports",
};

export const EDGE_GROUPS = {
  blockers: ["BLOCKED_BY"] as const,
  dependencies: ["PART_OF"] as const,
  collaboration: ["MEMBER_OF", "WORKS_ON", "OWNS", "HAS_SKILL"] as const,
};
