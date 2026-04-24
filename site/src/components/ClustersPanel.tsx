import { useMemo, useState } from "react";
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ClusterPayload, RotationPayload, SnapshotRow } from "../lib/types";

type SimilarityMapPanelProps = {
  payload: ClusterPayload;
  rotation?: RotationPayload;
  above?: SnapshotRow[];
  below?: SnapshotRow[];
  className?: string;
  sectionId?: string;
  variant?: "overview" | "expanded";
};

type EmbeddingPoint = ClusterPayload["embedding"][number];
type ColorMode = "group" | "quadrant" | "trend";
type EnrichedEmbeddingPoint = EmbeddingPoint & {
  fill: string;
  quadrant?: string;
  trendDirection?: string;
};
type ScatterTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: EnrichedEmbeddingPoint }>;
};
type ScatterDotProps = {
  cx?: number;
  cy?: number;
  fill?: string;
  fillOpacity?: number;
};

const GROUP_COLORS = ["#5fd5ff", "#4fd57a", "#f2b236", "#ff6f7d", "#b982ff", "#38c6b9", "#ff9f43", "#d35f9f", "#9aa8bc"];
const QUADRANT_COLORS: Record<string, string> = {
  above_momentum: "#4fd57a",
  above_fading: "#f2b236",
  below_rebound: "#3ea8ff",
  below_weak: "#ff6f7d",
};
const TREND_COLORS: Record<string, string> = {
  improving: "#4fd57a",
  deteriorating: "#ff6f7d",
  mixed: "#f2b236",
  flat: "#9aa8bc",
};

function clusterColor(clusterId: number | "noise") {
  if (clusterId === "noise") {
    return "#6f7f92";
  }
  return GROUP_COLORS[(clusterId - 1) % GROUP_COLORS.length];
}

function SimilarityDot(props: ScatterDotProps) {
  if (typeof props.cx !== "number" || typeof props.cy !== "number") {
    return null;
  }
  return <circle cx={props.cx} cy={props.cy} r={2.9} fill={props.fill} fillOpacity={props.fillOpacity ?? 1} />;
}

function SimilarityTooltip({ active, payload }: ScatterTooltipProps) {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }
  return (
    <div className="cluster-tooltip">
      <strong>{point.symbol}</strong>
      <span>Group: {point.cluster_id}</span>
      {point.quadrant ? <span>MA quadrant: {point.quadrant.replace("_", " + ")}</span> : null}
      {point.trendDirection ? <span>Trend: {point.trendDirection}</span> : null}
      {point.nearest_neighbors?.slice(0, 3).map((neighbor) => (
        <span key={neighbor.symbol}>{neighbor.symbol}: {neighbor.score.toFixed(2)}</span>
      ))}
    </div>
  );
}

export function ClustersPanel({
  payload,
  rotation,
  className,
  sectionId,
  variant = "overview",
}: SimilarityMapPanelProps) {
  const [query, setQuery] = useState("");
  const [colorMode, setColorMode] = useState<ColorMode>("group");
  const normalizedQuery = query.trim().toUpperCase();
  const rotationBySymbol = useMemo(() => new Map(rotation?.rows.map((row) => [row.symbol, row]) ?? []), [rotation]);
  const points = useMemo(() => {
    return [...payload.embedding]
      .sort((left, right) => left.symbol.localeCompare(right.symbol))
      .map((point): EnrichedEmbeddingPoint => {
        const rotationRow = rotationBySymbol.get(point.symbol);
        const quadrant = rotationRow?.quadrant;
        const trendDirection = rotationRow?.trend_direction;
        const fill =
          colorMode === "quadrant"
            ? QUADRANT_COLORS[quadrant ?? ""] ?? "#6f7f92"
            : colorMode === "trend"
              ? TREND_COLORS[trendDirection ?? ""] ?? "#6f7f92"
              : clusterColor(point.cluster_id);
        return { ...point, fill, quadrant, trendDirection };
      });
  }, [colorMode, payload.embedding, rotationBySymbol]);
  const matchingPoints = useMemo(() => {
    if (!normalizedQuery) {
      return [];
    }
    return points.filter((point) => point.symbol.includes(normalizedQuery));
  }, [normalizedQuery, points]);
  const backgroundPoints = useMemo(() => {
    if (!normalizedQuery) {
      return points;
    }
    const matches = new Set(matchingPoints.map((point) => point.symbol));
    return points.filter((point) => !matches.has(point.symbol));
  }, [matchingPoints, normalizedQuery, points]);
  const backgroundGroups = useMemo(() => {
    const groups = new Map<string, EnrichedEmbeddingPoint[]>();
    for (const point of backgroundPoints) {
      const key = point.fill;
      groups.set(key, [...(groups.get(key) ?? []), point]);
    }
    return [...groups.entries()].map(([fill, data]) => ({ fill, data }));
  }, [backgroundPoints]);
  const legendItems = useMemo(() => {
    if (colorMode === "quadrant") {
      return Object.entries(QUADRANT_COLORS).map(([label, color]) => ({ label: label.replace("_", " + "), color }));
    }
    if (colorMode === "trend") {
      return Object.entries(TREND_COLORS).map(([label, color]) => ({ label, color }));
    }
    return payload.clusters.slice(0, 8).map((cluster) => ({
      label: `${cluster.label} (${cluster.size})`,
      color: clusterColor(cluster.cluster_id),
    }));
  }, [colorMode, payload.clusters]);

  return (
    <section
      id={sectionId ?? "clusters"}
      className={
        className
          ? `panel similarity-panel similarity-panel--${variant} ${className}`
          : `panel similarity-panel similarity-panel--${variant}`
      }
    >
      <div className="panel-header">
        <div>
          <h2>Crypto Similarity Map</h2>
          <p>Residual-return map: nearby symbols moved similarly after removing broad market beta.</p>
        </div>
        <div className="param-list">
          <span className="pill">{String(payload.params.lookback_days)}D daily returns</span>
          <span className="pill">Residual correlation</span>
          <span className="pill">Spectral kNN map</span>
        </div>
      </div>

      <div className={`similarity-layout similarity-layout--${variant}`}>
        <div className="similarity-map-shell">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#20324b" />
              <XAxis type="number" dataKey="x" axisLine={false} tickLine={false} tick={false} />
              <YAxis type="number" dataKey="y" axisLine={false} tickLine={false} tick={false} />
              <Tooltip
                cursor={{ stroke: "#2a4160", strokeWidth: 1 }}
                content={(props) => <SimilarityTooltip {...(props as ScatterTooltipProps)} />}
              />
              {backgroundGroups.map((group) => (
                <Scatter
                  key={group.fill}
                  data={group.data}
                  fill={group.fill}
                  fillOpacity={normalizedQuery ? 0.18 : 0.72}
                  shape={(props: unknown) => <SimilarityDot {...(props as ScatterDotProps)} />}
                />
              ))}
              {matchingPoints.length > 0 ? (
                <Scatter
                  data={matchingPoints}
                  fill="#f2b236"
                  fillOpacity={0.98}
                  shape={(props: unknown) => <SimilarityDot {...(props as ScatterDotProps)} />}
                />
              ) : null}
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        <aside className="similarity-side-panel">
          <div className="toggle-group">
            {(["group", "quadrant", "trend"] as ColorMode[]).map((value) => (
              <button
                key={value}
                type="button"
                className={colorMode === value ? "toggle active" : "toggle"}
                onClick={() => setColorMode(value)}
              >
                {value === "group" ? "Groups" : value === "quadrant" ? "MA Quadrants" : "Trend"}
              </button>
            ))}
          </div>
          <div className="similarity-stat-grid">
            <article className="cluster-stat-card">
              <span>Mapped symbols</span>
              <strong>{points.length}</strong>
            </article>
            <article className="cluster-stat-card">
              <span>Lookback</span>
              <strong>{String(payload.params.lookback_days)}D</strong>
            </article>
          </div>
          <div className="similarity-legend">
            {legendItems.map((item) => (
              <span key={item.label} className="similarity-legend-item">
                <i style={{ background: item.color }} />
                {item.label}
              </span>
            ))}
          </div>

          <input
            className="search-input similarity-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search symbol"
            list="similarity-symbols"
          />
          <datalist id="similarity-symbols">
            {points.map((point) => (
              <option key={point.symbol} value={point.symbol} />
            ))}
          </datalist>

          <div className="similarity-match-list">
            {(normalizedQuery ? matchingPoints : points.slice(0, 24)).slice(0, 36).map((point) => (
              <span key={point.symbol} className={normalizedQuery ? "symbol-chip symbol-chip--highlight" : "symbol-chip"}>
                {point.symbol}
              </span>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}
