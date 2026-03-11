import type { VisualizationNode, VisualizationNodeMetadata } from "@shared-types";

export interface SelectedGraphNode {
  node: VisualizationNode;
  metadata?: VisualizationNodeMetadata;
}
