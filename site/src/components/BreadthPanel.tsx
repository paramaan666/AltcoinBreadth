import { useEffect, useMemo, useState } from "react";
import {
  Brush,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BreadthPoint, Overview } from "../lib/types";

type BreadthPanelProps = {
  overview: Overview;
  breadth: BreadthPoint[];
  className?: string;
  sectionId?: string;
  variant?: "overview" | "expanded";
};

type BrushRange = { startIndex: number; endIndex: number };

function normalizeBrushRange(points: BreadthPoint[], range: BrushRange): BrushRange {
  if (points.length === 0) {
    return { startIndex: 0, endIndex: 0 };
  }
  return {
    startIndex: Math.max(0, Math.min(range.startIndex, points.length - 1)),
    endIndex: Math.max(0, Math.min(range.endIndex, points.length - 1)),
  };
}

export function BreadthPanel({
  overview,
  breadth,
  className,
  sectionId,
  variant = "overview",
}: BreadthPanelProps) {
  const [brushRange, setBrushRange] = useState<BrushRange>({
    startIndex: 0,
    endIndex: Math.max(0, breadth.length - 1),
  });
  const normalizedRange = useMemo(() => normalizeBrushRange(breadth, brushRange), [breadth, brushRange]);
  const selectedBreadth = useMemo(
    () => breadth.slice(normalizedRange.startIndex, normalizedRange.endIndex + 1),
    [breadth, normalizedRange.endIndex, normalizedRange.startIndex],
  );
  const latestPoint = selectedBreadth[selectedBreadth.length - 1] ?? breadth[breadth.length - 1] ?? null;
  const rangeLabel =
    selectedBreadth.length > 0
      ? `${selectedBreadth[0].date} -> ${selectedBreadth[selectedBreadth.length - 1].date}`
      : "No data";

  useEffect(() => {
    setBrushRange({ startIndex: 0, endIndex: Math.max(0, breadth.length - 1) });
  }, [breadth.length]);

  return (
    <section
      id={sectionId}
      className={className ? `panel breadth-panel breadth-panel--${variant} ${className}` : `panel breadth-panel breadth-panel--${variant}`}
    >
      <div className="panel-header">
        <div>
          <h2>Market Breadth: % of Coins Above 30-Week MA</h2>
          <p>{overview.universe_rule}</p>
        </div>
        <div className="param-list">
          <span className="pill">As of {overview.as_of_date ?? "n/a"}</span>
          <span className="pill">{overview.ma_definition}</span>
        </div>
      </div>

      <div className="breadth-toolbar">
        <div className="range-summary-card">
          <span>Selected range</span>
          <strong>{rangeLabel}</strong>
          <small>{selectedBreadth.length.toLocaleString()} daily points</small>
        </div>
        <button
          className="toggle active"
          type="button"
          onClick={() => setBrushRange({ startIndex: 0, endIndex: Math.max(0, breadth.length - 1) })}
        >
          Reset Zoom
        </button>
        {latestPoint ? (
          <div className="breadth-latest-card">
            <span>{latestPoint.date}</span>
            <strong>{latestPoint.above_pct.toFixed(1)}%</strong>
            <small>
              Above: {latestPoint.above_count} / Eligible: {latestPoint.eligible_count}
            </small>
          </div>
        ) : null}
      </div>

      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={breadth}>
            <CartesianGrid strokeDasharray="3 3" stroke="#20324b" />
            <XAxis dataKey="date" minTickGap={40} stroke="#6f87a8" />
            <YAxis stroke="#6f87a8" domain={[0, 100]} unit="%" />
            <Tooltip
              formatter={(value: number) => `${value.toFixed(2)}%`}
              contentStyle={{ background: "#081523", border: "1px solid #20324b", borderRadius: 12 }}
            />
            <ReferenceLine y={50} stroke="#7d64ff" strokeDasharray="4 4" opacity={0.75} />
            <Line dataKey="above_pct" dot={false} stroke="#8d77ff" strokeWidth={2} />
            <Brush
              dataKey="date"
              height={34}
              travellerWidth={12}
              stroke="#8d77ff"
              fill="#0f1c2d"
              startIndex={normalizedRange.startIndex}
              endIndex={normalizedRange.endIndex}
              onChange={(nextRange: { startIndex?: number; endIndex?: number }) => {
                if (typeof nextRange.startIndex !== "number" || typeof nextRange.endIndex !== "number") {
                  return;
                }
                setBrushRange({
                  startIndex: nextRange.startIndex,
                  endIndex: nextRange.endIndex,
                });
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="panel-footnote">
        Breadth tracks the share of eligible symbols trading above the 210-day proxy for the 30-week moving average.
      </p>
    </section>
  );
}
