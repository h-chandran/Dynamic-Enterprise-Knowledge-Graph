"use client";

import type { Dispatch, SetStateAction } from "react";

interface TemporalControlsProps {
  selectedAt: string;
  windowStart: string;
  windowHours: number;
  activeUpdateCount: number;
  selectedIndex: number;
  maxIndex: number;
  isReplayActive: boolean;
  onTimelineChange: Dispatch<SetStateAction<number>>;
  onWindowHoursChange: Dispatch<SetStateAction<number>>;
  onReplayToggle: () => void;
}

const WINDOW_OPTIONS = [24, 48, 72, 168] as const;

export function TemporalControls({
  selectedAt,
  windowStart,
  windowHours,
  activeUpdateCount,
  selectedIndex,
  maxIndex,
  isReplayActive,
  onTimelineChange,
  onWindowHoursChange,
  onReplayToggle,
}: TemporalControlsProps) {
  return (
    <div className="temporal-card">
      <div className="temporal-header">
        <div>
          <p className="control-eyebrow">Temporal exploration</p>
          <h3>Company graph over time</h3>
        </div>
        <button type="button" className="switch-pill" onClick={onReplayToggle} disabled={maxIndex === 0}>
          {isReplayActive ? "Pause replay" : "Replay updates"}
        </button>
      </div>

      <div className="temporal-summary-grid">
        <div className="temporal-summary-item">
          <span>As of</span>
          <strong>{formatDateTime(selectedAt)}</strong>
        </div>
        <div className="temporal-summary-item">
          <span>Highlight window</span>
          <strong>{windowHours >= 168 ? "7 days" : `${windowHours} hours`}</strong>
        </div>
        <div className="temporal-summary-item">
          <span>Window start</span>
          <strong>{formatDateTime(windowStart)}</strong>
        </div>
        <div className="temporal-summary-item">
          <span>Recent events</span>
          <strong>{activeUpdateCount}</strong>
        </div>
      </div>

      <label className="temporal-slider-block">
        <span>Timeline</span>
        <input
          type="range"
          min={0}
          max={Math.max(maxIndex, 0)}
          step={1}
          value={Math.min(selectedIndex, Math.max(maxIndex, 0))}
          onChange={(event) => onTimelineChange(Number(event.target.value))}
        />
      </label>

      <div className="temporal-window-options">
        {WINDOW_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            className={`filter-pill${windowHours === option ? " filter-pill-active" : ""}`}
            onClick={() => onWindowHoursChange(option)}
          >
            {option >= 168 ? "7d" : `${option}h`}
          </button>
        ))}
      </div>

      <p className="control-hint">
        The graph keeps current structure where history is unavailable, but uses backend timestamps
        and recent event-layer updates to show what changed inside the selected window.
      </p>
    </div>
  );
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}
