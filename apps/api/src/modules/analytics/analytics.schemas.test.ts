import assert from "node:assert/strict";
import test from "node:test";
import {
  AnalyticsValidationError,
  parseAnalyticsMetricParams,
  parseAnalyticsMetricsQuery,
} from "./analytics.schemas.js";

test("parses analytics query limit with defaults and bounds", () => {
  assert.equal(parseAnalyticsMetricsQuery({}).limit, 10);
  assert.equal(parseAnalyticsMetricsQuery({ limit: "5" }).limit, 5);
  assert.throws(
    () => parseAnalyticsMetricsQuery({ limit: "50" }),
    (error) =>
      error instanceof AnalyticsValidationError &&
      error.details.some((detail) => detail.includes("limit")),
  );
});

test("parses supported metric keys and rejects unsupported ones", () => {
  assert.equal(parseAnalyticsMetricParams({ metricKey: "team_isolation" }).metricKey, "team_isolation");
  assert.throws(
    () => parseAnalyticsMetricParams({ metricKey: "hiring_recommendations" }),
    (error) =>
      error instanceof AnalyticsValidationError &&
      error.details.some((detail) => detail.includes("metricKey")),
  );
});
