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

function laneOffset(index: number) {
  if (index === 0) {
    return 0;
  }
  const magnitude = Math.ceil(index / 2);
  const direction = index % 2 === 0 ? 1 : -1;
  return Math.max(-0.44, Math.min(0.44, direction * magnitude * 0.055));
}

function distanceValue(row: SnapshotRow, mode: DistanceMode) {
  return mode === "raw" ? row.raw_distance_pct : row.normalized_distance ?? 0;
}

function buildBeeswarmPoints(above: SnapshotRow[], below: SnapshotRow[], mode: DistanceMode): DistancePoint[] {
  const combined = [
    ...above.map((row) => ({ ...row, status: "above" as const })),
    ...below.map((row) => ({ ...row, status: "below" as const })),
  ];
  if (combined.length === 0) {
    return [];
  }
  const values = combined.map((row) => distanceValue(row, mode));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const binSize = Math.max((max - min) / 80, mode === "raw" ? 0.5 : 0.05);
  const bins = new Map<number, number>();

  return [...combined]
    .sort((left, right) => distanceValue(left, mode) - distanceValue(right, mode) || left.symbol.localeCompare(right.symbol))
    .map((row) => {
      const y = distanceValue(row, mode);
      const bin = Math.round(y / binSize);
      const index = bins.get(bin) ?? 0;
      bins.set(bin, index + 1);
      return {
        ...row,
        x: laneOffset(index),
        y,
      };
    });
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
    return buildBeeswarmPoints(above, below, mode);
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
          <p>Read this vertically: higher points are farther above 30W MA, lower points are farther below. Horizontal spread only prevents overlapping dots.</p>
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
              <XAxis type="number" dataKey="x" domain={[-0.55, 0.55]} axisLine={false} tickLine={false} tick={false} />
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
            X-axis has no signal. Coins are spread left/right only when their MA distance is nearly the same.
          </div>
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
