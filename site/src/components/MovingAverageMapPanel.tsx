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
type ScatterDotProps = {
  cx?: number;
  cy?: number;
  fill?: string;
  fillOpacity?: number;
};

function distanceValue(row: SnapshotRow, mode: DistanceMode) {
  return mode === "raw" ? row.raw_distance_pct : row.normalized_distance ?? 0;
}

function buildMomentumPoints(above: SnapshotRow[], below: SnapshotRow[], mode: DistanceMode): DistancePoint[] {
  const combined = [
    ...above.map((row) => ({ ...row, status: "above" as const })),
    ...below.map((row) => ({ ...row, status: "below" as const })),
  ];
  return combined.map((row) => ({
    ...row,
    x: row.momentum_30d_pct,
    y: distanceValue(row, mode),
  }));
}

function paddedDomain(values: number[], minimumPadding: number): [number, number] {
  if (values.length === 0) {
    return [-1, 1];
  }
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const padding = Math.max((max - min) * 0.08, minimumPadding);
  return [min - padding, max + padding];
}

function DistanceDot(props: ScatterDotProps) {
  if (typeof props.cx !== "number" || typeof props.cy !== "number") {
    return null;
  }
  return <circle cx={props.cx} cy={props.cy} r={3} fill={props.fill} fillOpacity={props.fillOpacity ?? 1} />;
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
      <span>30D momentum: {point.x.toFixed(2)}%</span>
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
    return buildMomentumPoints(above, below, mode);
  }, [above, below, mode]);
  const abovePoints = points.filter((point) => point.status === "above");
  const belowPoints = points.filter((point) => point.status === "below");
  const matchingPoints = normalizedQuery
    ? points.filter((point) => point.symbol.includes(normalizedQuery))
    : [];
  const xDomain = useMemo(() => paddedDomain(points.map((point) => point.x), 2), [points]);
  const yDomain = useMemo(() => paddedDomain(points.map((point) => point.y), mode === "raw" ? 2 : 0.25), [mode, points]);
  const strongestAbove = [...abovePoints].sort((left, right) => right.y - left.y)[0] ?? null;
  const weakestBelow = [...belowPoints].sort((left, right) => left.y - right.y)[0] ?? null;
  const strongestMomentum = [...points].sort((left, right) => right.x - left.x)[0] ?? null;
  const weakestMomentum = [...points].sort((left, right) => left.x - right.x)[0] ?? null;
  const bullishQuadrantCount = points.filter((point) => point.x > 0 && point.y > 0).length;
  const bearishQuadrantCount = points.filter((point) => point.x < 0 && point.y < 0).length;

  return (
    <section id={sectionId ?? "ma-distance"} className={className ? `panel ma-map-panel ${className}` : "panel ma-map-panel"}>
      <div className="panel-header">
        <div>
          <h2>MA Distance vs Momentum</h2>
          <p>Right means stronger 30D momentum. Higher means farther above 30W MA. Top-right is current leadership; bottom-left is weak momentum below trend.</p>
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
            <ScatterChart margin={{ top: 28, right: 34, bottom: 38, left: 22 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#20324b" />
              <XAxis
                type="number"
                dataKey="x"
                domain={xDomain}
                stroke="#6f87a8"
                tickFormatter={(value) => `${Number(value).toFixed(0)}%`}
                label={{ value: "30D Momentum", position: "insideBottom", offset: -24, fill: "#9db1cf" }}
              />
              <YAxis
                type="number"
                dataKey="y"
                domain={yDomain}
                stroke="#6f87a8"
                tickFormatter={(value) => (mode === "raw" ? `${value}%` : String(value))}
                label={{
                  value: mode === "raw" ? "Distance from 30W MA" : "Normalized Distance",
                  angle: -90,
                  position: "insideLeft",
                  fill: "#9db1cf",
                }}
              />
              <Tooltip
                cursor={{ stroke: "#2a4160", strokeWidth: 1 }}
                content={(props) => <DistanceTooltip {...(props as DistanceTooltipProps)} mode={mode} />}
              />
              <ReferenceLine x={0} stroke="#314763" strokeDasharray="3 4" strokeWidth={1} opacity={0.8} />
              <ReferenceLine y={0} stroke="#edf3ff" strokeDasharray="6 4" strokeWidth={2} opacity={0.74} />
              <Scatter
                data={abovePoints}
                fill="#4fd57a"
                fillOpacity={normalizedQuery ? 0.22 : 0.78}
                shape={(props: unknown) => <DistanceDot {...(props as ScatterDotProps)} />}
              />
              <Scatter
                data={belowPoints}
                fill="#ff6f7d"
                fillOpacity={normalizedQuery ? 0.22 : 0.78}
                shape={(props: unknown) => <DistanceDot {...(props as ScatterDotProps)} />}
              />
              {matchingPoints.length > 0 ? (
                <Scatter
                  data={matchingPoints}
                  fill="#f2b236"
                  fillOpacity={1}
                  shape={(props: unknown) => <DistanceDot {...(props as ScatterDotProps)} />}
                />
              ) : null}
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        <aside className="ma-map-side-panel">
          <div className="cluster-empty-state ma-map-note">
            X-axis is 30D price momentum. Y-axis is distance from 30W MA. Top-right = strong momentum above trend; bottom-left = weak momentum below trend.
          </div>
          <div className="similarity-stat-grid">
            <article className="cluster-stat-card">
              <span>Top-right</span>
              <strong>{bullishQuadrantCount}</strong>
            </article>
            <article className="cluster-stat-card">
              <span>Bottom-left</span>
              <strong>{bearishQuadrantCount}</strong>
            </article>
          </div>
          <div className="cluster-detail-stats">
            {strongestMomentum ? (
              <div className="method-line">
                <span>Strongest momentum</span>
                <strong>{strongestMomentum.symbol} {strongestMomentum.x.toFixed(2)}%</strong>
              </div>
            ) : null}
            {weakestMomentum ? (
              <div className="method-line">
                <span>Weakest momentum</span>
                <strong>{weakestMomentum.symbol} {weakestMomentum.x.toFixed(2)}%</strong>
              </div>
            ) : null}
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
