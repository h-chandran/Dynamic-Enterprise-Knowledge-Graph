import type { InsightsDashboardResponse, VisualizationSubgraphResponse } from "@shared-types";
import { appEnv } from "@/lib/env";

export async function fetchCompanyOverviewSubgraph(signal?: AbortSignal): Promise<VisualizationSubgraphResponse> {
  const response = await fetch(
    `${appEnv.NEXT_PUBLIC_API_BASE_URL}/visualization/subgraphs/company-overview`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal,
      cache: "no-store",
    }
  );

  if (!response.ok) {
    let errorMessage = "Unable to load the graph visualization.";

    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) {
        errorMessage = payload.error;
      }
    } catch {
      // Fall back to a generic message when the API doesn't return JSON.
    }

    throw new Error(errorMessage);
  }

  return (await response.json()) as VisualizationSubgraphResponse;
}

export async function fetchInsightsDashboard(signal?: AbortSignal): Promise<InsightsDashboardResponse> {
  const response = await fetch(`${appEnv.NEXT_PUBLIC_API_BASE_URL}/analytics/insights?limit=6`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    signal,
    cache: "no-store",
  });

  if (!response.ok) {
    let errorMessage = "Unable to load the insight layer.";

    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) {
        errorMessage = payload.error;
      }
    } catch {
      // Fall back to a generic message when the API doesn't return JSON.
    }

    throw new Error(errorMessage);
  }

  return (await response.json()) as InsightsDashboardResponse;
}
