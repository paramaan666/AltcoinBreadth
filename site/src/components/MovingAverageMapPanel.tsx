import { useMemo, useState } from "react";
import {
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RotationPayload, RotationPoint, RotationSymbolTrail, SnapshotRow } from "../lib/types";

type MovingAverageMapPanelProps = {
  above: SnapshotRow[];
  below: SnapshotRow[];
  rotation?: RotationPayload;
  className?: string;
  sectionId?: string;
};

type DistanceMode = "raw" | "normalized";
type TrailMode = "off" | "3d" | "7d";
type DistancePoint = SnapshotRow & {
  x: number;
  y: number;
  momentumPct: number;
  distanceMetric: number;
  status: "above" | "below";
  trendDirection?: RotationSymbolTrail["trend_direction"];
  deltas?: RotationSymbolTrail["deltas"];
};
type TrailPoint = {
  symbol: string;
  x: number;
  y: number;
  age: number;
  status: "above" | "below";
  trendDirection: RotationSymbolTrail["trend_direction"];
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

const MOMENTUM_COMPRESSION_SCALE = 10;
const NORMALIZED_DISTANCE_COMPRESSION_SCALE = 1;
const RAW_DISTANCE_COMPRESSION_SCALE = 10;
const MOMENTUM_TICKS = [5, 10, 25, 50, 100, 200, 300, 500];
const NORMALIZED_DISTANCE_TICKS = [1, 2, 5, 10, 20, 50, 100];
const RAW_DISTANCE_TICKS = [10, 25, 50, 100, 200, 400, 800];

function distanceValue(row: SnapshotRow, mode: DistanceMode) {
  return mode === "raw" ? row.raw_distance_pct : row.normalized_distance ?? 0;
}

function rotationDistanceValue(point: RotationPoint, mode: DistanceMode) {
  return mode === "raw" ? point.raw_distance_pct : point.normalized_distance ?? 0;
}

function distanceCompressionScale(mode: DistanceMode) {
  return mode === "raw" ? RAW_DISTANCE_COMPRESSION_SCALE : NORMALIZED_DISTANCE_COMPRESSION_SCALE;
}

function distanceTickValues(mode: DistanceMode) {
  return mode === "raw" ? RAW_DISTANCE_TICKS : NORMALIZED_DISTANCE_TICKS;
}

function compressSignedValue(value: number, scale: number) {
  return Math.asinh(value / scale);
}

function expandSignedValue(value: number, scale: number) {
  return Math.sinh(value) * scale;
}

function buildMomentumPoints(above: SnapshotRow[], below: SnapshotRow[], mode: DistanceMode): DistancePoint[] {
  const combined = [
    ...above.map((row) => ({ ...row, status: "above" as const })),
    ...below.map((row) => ({ ...row, status: "below" as const })),
  ];
  const yScale = distanceCompressionScale(mode);
  return combined.map((row) => ({
    ...row,
    momentumPct: row.momentum_30d_pct,
    distanceMetric: distanceValue(row, mode),
    x: compressSignedValue(row.momentum_30d_pct, MOMENTUM_COMPRESSION_SCALE),
    y: compressSignedValue(distanceValue(row, mode), yScale),
  }));
}

function snapshotRowFromRotation(row: RotationSymbolTrail): SnapshotRow {
  return {
    symbol: row.symbol,
    date: row.current.date,
    close: row.current.close,
    ma_30w: row.current.ma_30w,
    raw_distance_pct: row.current.raw_distance_pct,
    atr_pct_60: 0,
    normalized_distance: row.current.normalized_distance,
    momentum_30d_pct: row.current.momentum_30d_pct,
    days_history: row.trail.length,
    listing_date: null,
    delisted_date: null,
  };
}

function buildRotationPoints(rotation: RotationPayload, mode: DistanceMode): DistancePoint[] {
  const yScale = distanceCompressionScale(mode);
  return rotation.rows.map((row) => {
    const snapshot = snapshotRowFromRotation(row);
    const distanceMetric = rotationDistanceValue(row.current, mode);
    return {
      ...snapshot,
      momentumPct: row.current.momentum_30d_pct,
      distanceMetric,
      x: compressSignedValue(row.current.momentum_30d_pct, MOMENTUM_COMPRESSION_SCALE),
      y: compressSignedValue(distanceMetric, yScale),
      status: row.current.raw_distance_pct >= 0 ? "above" : "below",
      trendDirection: row.trend_direction,
      deltas: row.deltas,
    };
  });
}

function buildTrailPoints(rotation: RotationPayload | undefined, mode: DistanceMode, trailMode: TrailMode): TrailPoint[] {
  if (!rotation || trailMode === "off") {
    return [];
  }
  const lookback = Number.parseInt(trailMode, 10);
  const yScale = distanceCompressionScale(mode);
  return rotation.rows.flatMap((row) => {
    const points = row.trail.slice(-(lookback + 1), -1);
    return points.map((point, index) => ({
      symbol: row.symbol,
      x: compressSignedValue(point.momentum_30d_pct, MOMENTUM_COMPRESSION_SCALE),
      y: compressSignedValue(rotationDistanceValue(point, mode), yScale),
      age: points.length - index,
      status: row.current.raw_distance_pct >= 0 ? "above" as const : "below" as const,
      trendDirection: row.trend_direction,
    }));
  });
}

function symmetricDomain(values: number[], minimumPadding: number): [number, number] {
  if (values.length === 0) {
    return [-1, 1];
  }
  const maxAbs = Math.max(...values.map((value) => Math.abs(value)), minimumPadding);
  const limit = maxAbs + Math.max(maxAbs * 0.08, minimumPadding);
  return [-limit, limit];
}

function compressedTicks(domain: [number, number], scale: number, actualTickValues: number[]) {
  const actualLimit = Math.abs(expandSignedValue(domain[1], scale));
  const positiveTicks = actualTickValues.filter((value) => value <= actualLimit);
  if (positiveTicks.length === 0) {
    return [0];
  }
  return [
    ...[...positiveTicks].reverse().map((value) => compressSignedValue(-value, scale)),
    0,
    ...positiveTicks.map((value) => compressSignedValue(value, scale)),
  ];
}

function formattedTick(value: number, scale: number, suffix = "") {
  const actual = expandSignedValue(value, scale);
  const absActual = Math.abs(actual);
  const decimals = absActual > 0 && absActual < 1 ? 1 : 0;
  return `${actual.toFixed(decimals)}${suffix}`;
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
      <span>30D momentum: {point.momentumPct.toFixed(2)}%</span>
      <span>{mode === "raw" ? "Raw distance" : "Normalized distance"}: {value.toFixed(2)}{mode === "raw" ? "%" : ""}</span>
      <span>Close: {point.close.toLocaleString()}</span>
      <span>30W MA: {point.ma_30w.toLocaleString()}</span>
    </div>
  );
}

export function MovingAverageMapPanel({
  above,
  below,
  rotation,
  className,
  sectionId,
}: MovingAverageMapPanelProps) {
  const [mode, setMode] = useState<DistanceMode>("normalized");
  const [trailMode, setTrailMode] = useState<TrailMode>("7d");
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toUpperCase();
  const points = useMemo<DistancePoint[]>(() => {
    return rotation ? buildRotationPoints(rotation, mode) : buildMomentumPoints(above, below, mode);
  }, [above, below, mode, rotation]);
  const trailPoints = useMemo(() => buildTrailPoints(rotation, mode, trailMode), [mode, rotation, trailMode]);
  const abovePoints = points.filter((point) => point.status === "above");
  const belowPoints = points.filter((point) => point.status === "below");
  const matchingPoints = normalizedQuery
    ? points.filter((point) => point.symbol.includes(normalizedQuery))
    : [];
  const xDomain = useMemo(() => symmetricDomain(points.map((point) => point.x), 0.18), [points]);
  const yDomain = useMemo(() => symmetricDomain(points.map((point) => point.y), 0.18), [points]);
  const xTicks = useMemo(() => compressedTicks(xDomain, MOMENTUM_COMPRESSION_SCALE, MOMENTUM_TICKS), [xDomain]);
  const yTicks = useMemo(
    () => compressedTicks(yDomain, distanceCompressionScale(mode), distanceTickValues(mode)),
    [mode, yDomain],
  );
  const strongestAbove = [...abovePoints].sort((left, right) => right.distanceMetric - left.distanceMetric)[0] ?? null;
  const weakestBelow = [...belowPoints].sort((left, right) => left.distanceMetric - right.distanceMetric)[0] ?? null;
  const strongestMomentum = [...points].sort((left, right) => right.momentumPct - left.momentumPct)[0] ?? null;
  const weakestMomentum = [...points].sort((left, right) => left.momentumPct - right.momentumPct)[0] ?? null;
  const aboveWithMomentumCount = points.filter((point) => point.momentumPct > 0 && point.distanceMetric > 0).length;
  const aboveFadingCount = points.filter((point) => point.momentumPct < 0 && point.distanceMetric > 0).length;
  const belowReboundCount = points.filter((point) => point.momentumPct > 0 && point.distanceMetric < 0).length;
  const belowWeakCount = points.filter((point) => point.momentumPct < 0 && point.distanceMetric < 0).length;

  return (
    <section id={sectionId ?? "ma-distance"} className={className ? `panel ma-map-panel ${className}` : "panel ma-map-panel"}>
      <div className="panel-header">
        <div>
          <h2>MA Distance vs Momentum</h2>
          <p>Zero is centered. Fading trails show recent rotation path without changing the current quadrant logic.</p>
        </div>
        <div className="table-controls">
          <div className="toggle-group">
            {(["off", "3d", "7d"] as TrailMode[]).map((value) => (
              <button
                key={value}
                className={trailMode === value ? "toggle active" : "toggle"}
                onClick={() => setTrailMode(value)}
                type="button"
              >
                Trail {value === "off" ? "Off" : value.toUpperCase()}
              </button>
            ))}
          </div>
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
              <ReferenceArea x1={0} x2={xDomain[1]} y1={0} y2={yDomain[1]} fill="#4fd57a" fillOpacity={0.035} />
              <ReferenceArea x1={xDomain[0]} x2={0} y1={0} y2={yDomain[1]} fill="#f2b236" fillOpacity={0.03} />
              <ReferenceArea x1={0} x2={xDomain[1]} y1={yDomain[0]} y2={0} fill="#3ea8ff" fillOpacity={0.03} />
              <ReferenceArea x1={xDomain[0]} x2={0} y1={yDomain[0]} y2={0} fill="#ff6f7d" fillOpacity={0.035} />
              <CartesianGrid strokeDasharray="3 3" stroke="#20324b" />
              <XAxis
                type="number"
                dataKey="x"
                domain={xDomain}
                ticks={xTicks}
                stroke="#6f87a8"
                tickFormatter={(value) => formattedTick(Number(value), MOMENTUM_COMPRESSION_SCALE, "%")}
                label={{ value: "30D Momentum", position: "insideBottom", offset: -24, fill: "#9db1cf" }}
              />
              <YAxis
                type="number"
                dataKey="y"
                domain={yDomain}
                ticks={yTicks}
                stroke="#6f87a8"
                tickFormatter={(value) => formattedTick(Number(value), distanceCompressionScale(mode), mode === "raw" ? "%" : "")}
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
              <ReferenceLine x={0} stroke="#edf3ff" strokeDasharray="6 4" strokeWidth={2} opacity={0.74} />
              <ReferenceLine y={0} stroke="#edf3ff" strokeDasharray="6 4" strokeWidth={2} opacity={0.74} />
              {trailMode !== "off" ? (
                <>
                  <Scatter
                    data={trailPoints.filter((point) => point.status === "above")}
                    fill="#4fd57a"
                    fillOpacity={0.22}
                    shape={(props: unknown) => <DistanceDot {...(props as ScatterDotProps)} />}
                  />
                  <Scatter
                    data={trailPoints.filter((point) => point.status === "below")}
                    fill="#ff6f7d"
                    fillOpacity={0.22}
                    shape={(props: unknown) => <DistanceDot {...(props as ScatterDotProps)} />}
                  />
                </>
              ) : null}
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
            Zero lines meet in the center. Trails show where each coin was recently; current dots remain the strongest marks.
          </div>
          {rotation ? (
            <div className="similarity-stat-grid">
              <article className="cluster-stat-card">
                <span>Improving</span>
                <strong>{rotation.summary.trend_counts.improving ?? 0}</strong>
              </article>
              <article className="cluster-stat-card">
                <span>Deteriorating</span>
                <strong>{rotation.summary.trend_counts.deteriorating ?? 0}</strong>
              </article>
            </div>
          ) : null}
          <div className="similarity-stat-grid">
            <article className="cluster-stat-card">
              <span>Above + momentum</span>
              <strong>{aboveWithMomentumCount}</strong>
            </article>
            <article className="cluster-stat-card">
              <span>Above + fading</span>
              <strong>{aboveFadingCount}</strong>
            </article>
            <article className="cluster-stat-card">
              <span>Below + rebound</span>
              <strong>{belowReboundCount}</strong>
            </article>
            <article className="cluster-stat-card">
              <span>Below + weak</span>
              <strong>{belowWeakCount}</strong>
            </article>
          </div>
          <div className="cluster-detail-stats">
            {strongestMomentum ? (
              <div className="method-line">
                <span>Strongest momentum</span>
                <strong>{strongestMomentum.symbol} {strongestMomentum.momentumPct.toFixed(2)}%</strong>
              </div>
            ) : null}
            {weakestMomentum ? (
              <div className="method-line">
                <span>Weakest momentum</span>
                <strong>{weakestMomentum.symbol} {weakestMomentum.momentumPct.toFixed(2)}%</strong>
              </div>
            ) : null}
            {strongestAbove ? (
              <div className="method-line">
                <span>Highest above</span>
                <strong>{strongestAbove.symbol} {strongestAbove.distanceMetric.toFixed(2)}{mode === "raw" ? "%" : ""}</strong>
              </div>
            ) : null}
            {weakestBelow ? (
              <div className="method-line">
                <span>Lowest below</span>
                <strong>{weakestBelow.symbol} {weakestBelow.distanceMetric.toFixed(2)}{mode === "raw" ? "%" : ""}</strong>
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
