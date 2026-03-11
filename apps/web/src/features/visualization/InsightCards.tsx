"use client";

import type { InsightCard, InsightsDashboardResponse, StaffingHypothesis } from "@shared-types";

interface InsightCardsProps {
  dashboard: InsightsDashboardResponse;
}

export function InsightCards({ dashboard }: InsightCardsProps) {
  return (
    <section className="insight-section" aria-label="Insight layer">
      <div className="insight-section-header">
        <div>
          <p className="control-eyebrow">Insight Layer</p>
          <h2>Actionable signals with explicit uncertainty</h2>
          <p className="insight-methodology">
            Facts below come from confirmed graph evidence. Recommendations and staffing ideas are marked as inferred
            hypotheses and should be validated before action.
          </p>
        </div>
        <div className="insight-method-chip">
          <strong>Facts:</strong> confirmed graph evidence
          <strong>Hypotheses:</strong> inferred recommendations
        </div>
      </div>

      <div className="insight-grid">
        {dashboard.cards.map((card) => (
          <InsightSignalCard key={card.id} card={card} />
        ))}
      </div>

      {dashboard.staffingHypotheses.length > 0 ? (
        <div className="hypothesis-strip">
          {dashboard.staffingHypotheses.map((hypothesis) => (
            <HypothesisCard key={hypothesis.id} hypothesis={hypothesis} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function InsightSignalCard({ card }: { card: InsightCard }) {
  return (
    <article className="insight-card">
      <div className="insight-card-topline">
        <span className={`severity-pill severity-${card.severity}`}>{card.severity}</span>
        <span className="insight-category">{formatCategory(card.category)}</span>
      </div>
      <h3>{card.title}</h3>
      <p className="insight-summary">{card.summary}</p>
      <div className="insight-focus-row">
        <span>{card.focus.entityLabel}</span>
        <strong>{card.score.toFixed(2)}</strong>
      </div>

      <div className="insight-block">
        <p className="insight-block-label">Confirmed facts</p>
        <ul className="insight-list">
          {card.confirmedFacts.map((fact) => (
            <li key={fact.label}>
              <strong>{fact.label}:</strong> {fact.statement}
            </li>
          ))}
        </ul>
      </div>

      <div className="insight-block">
        <p className="insight-block-label">Inferred recommendation</p>
        {card.inferredRecommendations.map((recommendation) => (
          <div key={recommendation.statement} className="inference-card">
            <div className="inference-header">
              <span className="inference-pill">Inferred</span>
              <span className="confidence-pill">{recommendation.confidence} confidence</span>
            </div>
            <p>{recommendation.statement}</p>
            <p className="inference-rationale">{recommendation.rationale}</p>
            <p className="inference-uncertainty">Uncertainty: {recommendation.uncertaintyNote}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

function HypothesisCard({ hypothesis }: { hypothesis: StaffingHypothesis }) {
  return (
    <article className="hypothesis-card">
      <div className="insight-card-topline">
        <span className="inference-pill">Staffing hypothesis</span>
        <span className={`severity-pill severity-${hypothesis.severity}`}>{hypothesis.confidence} confidence</span>
      </div>
      <h3>{hypothesis.title}</h3>
      <p className="insight-summary">{hypothesis.summary}</p>
      <p className="hypothesis-target">Target: {hypothesis.target.entityLabel}</p>
      <p className="hypothesis-recommendation">{hypothesis.inferredRecommendation.statement}</p>
      <p className="inference-uncertainty">Uncertainty: {hypothesis.inferredRecommendation.uncertaintyNote}</p>
    </article>
  );
}

function formatCategory(category: InsightCard["category"]): string {
  return category.replaceAll("_", " ");
}

