import assert from "node:assert/strict";
import test from "node:test";
import { parseInsightParams, parseInsightsQuery, InsightsValidationError } from "./insights.schemas.js";

test("parses insight query limits and enforces bounds", () => {
  assert.equal(parseInsightsQuery({}).limit, 6);
  assert.equal(parseInsightsQuery({ limit: "4" }).limit, 4);
  assert.throws(
    () => parseInsightsQuery({ limit: "20" }),
    (error) => error instanceof InsightsValidationError && error.details.some((detail) => detail.includes("limit")),
  );
});

test("parses non-empty insight ids", () => {
  assert.equal(parseInsightParams({ insightId: "overload:person-1" }).insightId, "overload:person-1");
  assert.throws(
    () => parseInsightParams({ insightId: "" }),
    (error) => error instanceof InsightsValidationError && error.details.some((detail) => detail.includes("insightId")),
  );
});
