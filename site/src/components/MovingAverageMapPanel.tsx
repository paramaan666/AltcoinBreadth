import { useMemo, useState } from "react";
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SnapshotRow } from "../lib/types";

type MovingAverageMapPanelProps = {
  above: SnapshotRow[];
  below: SnapshotRow[];
  className?: string;
  sectionId?: string;
};

type DistanceMode = "raw" | "normalized";
type DistancePoint = SnapshotRow & {
  x: number;
  y: number;
  status: "above" | "below";
};
type DistanceTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: DistancePoint }>;
  mode: DistanceMode;
};

function symbolJitter(symbol: string) {
  let hash = 0;
  for (const char of symbol) {
    hash = (hash * 31 + char.charCodeAt(0)) % 1009;
  }
  return (hash / 1009 - 0.5) * 1.8;
}

function distanceValue(row: SnapshotRow, mode: DistanceMode) {
  return mode === "raw" ? row.raw_distance_pct : row.normalized_distance ?? 0;
}

function DistanceTooltip({ active, payload, mode }: DistanceTooltipProps) {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }
  const value = distanceValue(point, mode);
  return (
    <div className="cluster-tooltip">
      <strong>{point.symbol}</strong>
      <span>{mode === "raw" ? "Raw distance" : "Normalized distance"}: {value.toFixed(2)}{mode === "raw" ? "%" : ""}</span>
      <span>Close: {point.close.toLocaleString()}</span>
      <span>30W MA: {point.ma_30w.toLocaleString()}</span>
    </div>
  );
}

export function MovingAverageMapPanel({
  above,
  below,
  className,
  sectionId,
}: MovingAverageMapPanelProps) {
  const [mode, setMode] = useState<DistanceMode>("normalized");
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toUpperCase();
  const points = useMemo<DistancePoint[]>(() => {
    const combined = [
      ...above.map((row) => ({ ...row, status: "above" as const })),
      ...below.map((row) => ({ ...row, status: "below" as const })),
    ];
    return combined.map((row) => ({
      ...row,
      x: symbolJitter(row.symbol),
      y: distanceValue(row, mode),
    }));
  }, [above, below, mode]);
  const abovePoints = points.filter((point) => point.status === "above");
  const belowPoints = points.filter((point) => point.status === "below");
  const matchingPoints = normalizedQuery
    ? points.filter((point) => point.symbol.includes(normalizedQuery))
    : [];
  const strongestAbove = [...abovePoints].sort((left, right) => right.y - left.y)[0] ?? null;
  const weakestBelow = [...belowPoints].sort((left, right) => left.y - right.y)[0] ?? null;

  return (
    <section id={sectionId ?? "ma-distance"} className={className ? `panel ma-map-panel ${className}` : "panel ma-map-panel"}>
      <div className="panel-header">
        <div>
          <h2>Distance From 30W Moving Average</h2>
          <p>Each point is one symbol. The center line is the 30W MA; points above it trade above MA and points below it trade below MA.</p>
        </div>
        <div className="table-controls">
          <div className="toggle-group">
            <button
              className={mode === "raw" ? "toggle active" : "toggle"}
              onClick={() => setMode("raw")}
              type="button"
            >
              Raw Distance
            </button>
            <button
              className={mode === "normalized" ? "toggle active" : "toggle"}
              onClick={() => setMode("normalized")}
              type="button"
            >
              Normalized Distance
            </button>
          </div>
          <input
            className="search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search symbol"
            list="ma-distance-symbols"
          />
          <datalist id="ma-distance-symbols">
            {points.map((point) => (
              <option key={point.symbol} value={point.symbol} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="ma-map-layout">
        <div className="ma-map-shell">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 28, right: 30, bottom: 28, left: 18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#20324b" />
              <XAxis type="number" dataKey="x" domain={[-1, 1]} axisLine={false} tickLine={false} tick={false} />
              <YAxis
                type="number"
                dataKey="y"
                stroke="#6f87a8"
                tickFormatter={(value) => (mode === "raw" ? `${value}%` : String(value))}
              />
              <Tooltip
                cursor={{ stroke: "#2a4160", strokeWidth: 1 }}
                content={(props) => <DistanceTooltip {...(props as DistanceTooltipProps)} mode={mode} />}
              />
              <ReferenceLine y={0} stroke="#edf3ff" strokeDasharray="6 4" strokeWidth={2} opacity={0.74} />
              <Scatter data={abovePoints} fill="#4fd57a" fillOpacity={normalizedQuery ? 0.22 : 0.78} />
              <Scatter data={belowPoints} fill="#ff6f7d" fillOpacity={normalizedQuery ? 0.22 : 0.78} />
              {matchingPoints.length > 0 ? (
                <Scatter data={matchingPoints} fill="#f2b236" fillOpacity={1} />
              ) : null}
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        <aside className="ma-map-side-panel">
          <div className="similarity-stat-grid">
            <article className="cluster-stat-card">
              <span>Above MA</span>
              <strong>{above.length}</strong>
            </article>
            <article className="cluster-stat-card">
              <span>Below MA</span>
              <strong>{below.length}</strong>
            </article>
          </div>
          <div className="cluster-detail-stats">
            {strongestAbove ? (
              <div className="method-line">
                <span>Highest above</span>
                <strong>{strongestAbove.symbol} {strongestAbove.y.toFixed(2)}{mode === "raw" ? "%" : ""}</strong>
              </div>
            ) : null}
            {weakestBelow ? (
              <div className="method-line">
                <span>Lowest below</span>
                <strong>{weakestBelow.symbol} {weakestBelow.y.toFixed(2)}{mode === "raw" ? "%" : ""}</strong>
              </div>
            ) : null}
          </div>
          <div className="similarity-match-list">
            {(normalizedQuery ? matchingPoints : points.slice(0, 30)).slice(0, 42).map((point) => (
              <span key={point.symbol} className={point.status === "above" ? "symbol-chip symbol-chip--above" : "symbol-chip symbol-chip--below"}>
                {point.symbol}
              </span>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}
