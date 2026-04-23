import { useMemo, useState } from "react";
import {
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

type RangeKey = "1Y" | "2Y" | "3Y" | "All";

const RANGE_DAYS: Record<Exclude<RangeKey, "All">, number> = {
  "1Y": 365,
  "2Y": 365 * 2,
  "3Y": 365 * 3,
};

function filterRange(points: BreadthPoint[], range: RangeKey): BreadthPoint[] {
  if (range === "All" || points.length === 0) {
    return points;
  }
  const latest = new Date(`${points[points.length - 1].date}T00:00:00Z`);
  const threshold = new Date(latest);
  threshold.setUTCDate(threshold.getUTCDate() - RANGE_DAYS[range]);
  return points.filter((point) => new Date(`${point.date}T00:00:00Z`) >= threshold);
}

export function BreadthPanel({
  overview,
  breadth,
  className,
  sectionId,
  variant = "overview",
}: BreadthPanelProps) {
  const [range, setRange] = useState<RangeKey>("All");
  const filteredBreadth = useMemo(() => filterRange(breadth, range), [breadth, range]);
  const latestPoint = filteredBreadth[filteredBreadth.length - 1] ?? breadth[breadth.length - 1] ?? null;

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
        <div className="toggle-group">
          {(["1Y", "2Y", "3Y", "All"] as RangeKey[]).map((option) => (
            <button
              key={option}
              type="button"
              className={range === option ? "toggle active" : "toggle"}
              onClick={() => setRange(option)}
            >
              {option}
            </button>
          ))}
        </div>
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
          <LineChart data={filteredBreadth}>
            <CartesianGrid strokeDasharray="3 3" stroke="#20324b" />
            <XAxis dataKey="date" minTickGap={40} stroke="#6f87a8" />
            <YAxis stroke="#6f87a8" domain={[0, 100]} unit="%" />
            <Tooltip
              formatter={(value: number) => `${value.toFixed(2)}%`}
              contentStyle={{ background: "#081523", border: "1px solid #20324b", borderRadius: 12 }}
            />
            <ReferenceLine y={50} stroke="#7d64ff" strokeDasharray="4 4" opacity={0.75} />
            <Line dataKey="above_pct" dot={false} stroke="#8d77ff" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="panel-footnote">
        Breadth tracks the share of eligible symbols trading above the 210-day proxy for the 30-week moving average.
      </p>
    </section>
  );
}
