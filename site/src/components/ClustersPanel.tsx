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
import type { ClusterPayload } from "../lib/types";

type SimilarityMapPanelProps = {
  payload: ClusterPayload;
  className?: string;
  sectionId?: string;
  variant?: "overview" | "expanded";
};

type EmbeddingPoint = ClusterPayload["embedding"][number];
type ScatterTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: EmbeddingPoint }>;
};
type ScatterDotProps = {
  cx?: number;
  cy?: number;
  fill?: string;
  fillOpacity?: number;
};

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
      <span>X: {point.x.toFixed(2)}</span>
      <span>Y: {point.y.toFixed(2)}</span>
    </div>
  );
}

export function ClustersPanel({
  payload,
  className,
  sectionId,
  variant = "overview",
}: SimilarityMapPanelProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toUpperCase();
  const points = useMemo(
    () => [...payload.embedding].sort((left, right) => left.symbol.localeCompare(right.symbol)),
    [payload.embedding],
  );
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
          <p>Each point is one symbol. Nearby points had similar recent daily return behavior; absolute map direction has no market meaning.</p>
        </div>
        <div className="param-list">
          <span className="pill">{String(payload.params.lookback_days)}D daily returns</span>
          <span className="pill">Correlation distance</span>
          <span className="pill">t-SNE 2D map</span>
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
              <Scatter
                data={backgroundPoints}
                fill="#5fd5ff"
                fillOpacity={normalizedQuery ? 0.18 : 0.72}
                shape={(props: unknown) => <SimilarityDot {...(props as ScatterDotProps)} />}
              />
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
