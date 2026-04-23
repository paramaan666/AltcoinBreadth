import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Cluster, ClusterPayload } from "../lib/types";

type ClustersPanelProps = {
  payload: ClusterPayload;
  className?: string;
  sectionId?: string;
  variant?: "overview" | "expanded";
};

type EmbeddingPoint = ClusterPayload["embedding"][number];
type FocusMode = "all" | "selected";
type LegendItem = {
  clusterId: number | "noise";
  label: string;
  size: number;
  color: string;
};
type ScatterTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: EmbeddingPoint }>;
  clusterLabels: Map<number | "noise", string>;
};

const PALETTE = ["#4fd57a", "#f2b236", "#3b82f6", "#8d77ff", "#ff6f9f", "#9c6ef7", "#22c1dc"];
const NOISE_COLOR = "#7b879b";

function colorForCluster(clusterId: number | "noise") {
  if (clusterId === "noise") {
    return NOISE_COLOR;
  }
  return PALETTE[(clusterId - 1) % PALETTE.length];
}

function findInitialCluster(clusters: Cluster[]) {
  return [...clusters].sort((left, right) => right.size - left.size)[0]?.cluster_id ?? null;
}

function ClusterTooltip({ active, payload, clusterLabels }: ScatterTooltipProps) {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }
  return (
    <div className="cluster-tooltip">
      <strong>{point.symbol}</strong>
      <span>{clusterLabels.get(point.cluster_id) ?? "Unknown cluster"}</span>
    </div>
  );
}

export function ClustersPanel({
  payload,
  className,
  sectionId,
  variant = "overview",
}: ClustersPanelProps) {
  const clusterList = useMemo(
    () => [...payload.clusters].sort((left, right) => right.size - left.size),
    [payload.clusters],
  );
  const [selectedClusterId, setSelectedClusterId] = useState<number | null>(findInitialCluster(clusterList));
  const [focusMode, setFocusMode] = useState<FocusMode>(variant === "expanded" ? "selected" : "all");

  useEffect(() => {
    setSelectedClusterId(findInitialCluster(clusterList));
  }, [clusterList]);

  useEffect(() => {
    setFocusMode(variant === "expanded" ? "selected" : "all");
  }, [variant]);

  const assignedSymbols = payload.clusters.reduce((accumulator, cluster) => accumulator + cluster.size, 0);
  const activeCluster = clusterList.find((cluster) => cluster.cluster_id === selectedClusterId) ?? clusterList[0] ?? null;
  const clusterLabels = useMemo(() => {
    const mapping = new Map<number | "noise", string>();
    for (const cluster of clusterList) {
      mapping.set(cluster.cluster_id, cluster.label);
    }
    mapping.set("noise", "Noise / Unassigned");
    return mapping;
  }, [clusterList]);

  const groupedEmbedding = useMemo(() => {
    const buckets = new Map<number | "noise", EmbeddingPoint[]>();
    for (const point of payload.embedding) {
      const existing = buckets.get(point.cluster_id) ?? [];
      existing.push(point);
      buckets.set(point.cluster_id, existing);
    }
    const keys = [...buckets.keys()].sort((left, right) => {
      if (left === "noise") {
        return 1;
      }
      if (right === "noise") {
        return -1;
      }
      return left - right;
    });
    return keys.map((clusterId) => ({
      clusterId,
      color: colorForCluster(clusterId),
      points: buckets.get(clusterId) ?? [],
    }));
  }, [payload.embedding]);

  const displayedGroups = useMemo(() => {
    if (focusMode !== "selected" || !activeCluster) {
      return groupedEmbedding;
    }
    return groupedEmbedding.filter((group) => group.clusterId === activeCluster.cluster_id);
  }, [activeCluster, focusMode, groupedEmbedding]);

  const legendItems: LegendItem[] = useMemo(() => {
    const items: LegendItem[] = clusterList.map((cluster) => ({
      clusterId: cluster.cluster_id,
      label: cluster.label,
      size: cluster.size,
      color: colorForCluster(cluster.cluster_id),
    }));
    items.push({
      clusterId: "noise",
      label: "Unassigned / Noise",
      size: payload.unassigned_symbols.length,
      color: NOISE_COLOR,
    });
    return items;
  }, [clusterList, payload.unassigned_symbols.length]);

  return (
    <section
      id={sectionId ?? "clusters"}
      className={
        className
          ? `panel clusters-panel clusters-panel--${variant} ${className}`
          : `panel clusters-panel clusters-panel--${variant}`
      }
    >
      <div className="panel-header">
        <div>
          <h2>Clusters (Correlation-based)</h2>
          <p>
            Symbols are grouped by similarity of daily return behavior and projected into a 2D map for visual exploration.
          </p>
        </div>
        <div className="param-list">
          <span className="pill">Method: {String(payload.params.lookback_days)}D daily returns</span>
          <span className="pill">Distance: {String(payload.params.distance_metric ?? "correlation")}</span>
          <span className="pill">Min cluster: {String(payload.params.min_cluster_size)}</span>
        </div>
      </div>

      <div className={`clusters-layout clusters-layout--${variant}`}>
        <div className="cluster-visual-panel">
          {variant === "expanded" ? (
            <div className="cluster-mode-toggle">
              <button
                type="button"
                className={focusMode === "all" ? "toggle active" : "toggle"}
                onClick={() => setFocusMode("all")}
              >
                All Map
              </button>
              <button
                type="button"
                className={focusMode === "selected" ? "toggle active" : "toggle"}
                onClick={() => setFocusMode("selected")}
              >
                Focus Selected
              </button>
            </div>
          ) : null}

          <div className="cluster-map-layout">
            <div className="cluster-scatter-shell">
              {displayedGroups.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 12, right: 12, bottom: 12, left: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#20324b" />
                    <XAxis type="number" dataKey="x" axisLine={false} tickLine={false} tick={false} />
                    <YAxis type="number" dataKey="y" axisLine={false} tickLine={false} tick={false} />
                    <Tooltip
                      cursor={{ stroke: "#2a4160", strokeWidth: 1 }}
                      content={(props) => <ClusterTooltip {...(props as ScatterTooltipProps)} clusterLabels={clusterLabels} />}
                    />
                    {displayedGroups.map((group) => (
                      <Scatter
                        key={String(group.clusterId)}
                        data={group.points}
                        fill={group.color}
                        fillOpacity={
                          focusMode === "selected"
                            ? 0.92
                            : selectedClusterId === null
                              ? group.clusterId === "noise"
                                ? 0.22
                                : 0.88
                              : group.clusterId === selectedClusterId
                                ? 0.95
                                : group.clusterId === "noise"
                                  ? 0.16
                                  : 0.28
                        }
                      />
                    ))}
                  </ScatterChart>
                </ResponsiveContainer>
              ) : (
                <div className="cluster-empty-state">No embedding is available for the current snapshot.</div>
              )}
            </div>

            <div className="cluster-legend-panel">
              {legendItems.map((item) => (
                <button
                  key={String(item.clusterId)}
                  type="button"
                  className={
                    item.clusterId === selectedClusterId
                      ? "cluster-legend-row active"
                      : item.clusterId === "noise"
                        ? "cluster-legend-row cluster-legend-row--noise"
                        : "cluster-legend-row"
                  }
                  onClick={() => {
                    if (item.clusterId === "noise") {
                      return;
                    }
                    setSelectedClusterId(item.clusterId);
                  }}
                >
                  <span className="cluster-list-label">
                    <span className="cluster-dot" style={{ background: item.color }} />
                    {item.label}
                  </span>
                  <strong>{item.size}</strong>
                </button>
              ))}

              <div className="cluster-summary-block">
                <div className="method-line">
                  <span>Total coins</span>
                  <strong>{payload.embedding.length}</strong>
                </div>
                <div className="method-line">
                  <span>Clustered coins</span>
                  <strong>
                    {assignedSymbols} ({((assignedSymbols / Math.max(payload.embedding.length, 1)) * 100).toFixed(1)}%)
                  </strong>
                </div>
              </div>
            </div>
          </div>
        </div>

        <aside className="cluster-detail-panel">
          <div className="cluster-detail-header">
            <h3>Cluster Details</h3>
            {activeCluster ? (
              <select
                className="cluster-select"
                value={selectedClusterId ?? ""}
                onChange={(event) => setSelectedClusterId(Number(event.target.value))}
              >
                {clusterList.map((cluster) => (
                  <option key={cluster.cluster_id} value={cluster.cluster_id}>
                    {cluster.label}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          <div className="cluster-stat-grid">
            <article className="cluster-stat-card">
              <span>Clusters</span>
              <strong>{clusterList.length}</strong>
            </article>
            <article className="cluster-stat-card">
              <span>Assigned</span>
              <strong>{assignedSymbols}</strong>
            </article>
            <article className="cluster-stat-card">
              <span>Noise</span>
              <strong>{payload.unassigned_symbols.length}</strong>
            </article>
          </div>

          {activeCluster ? (
            <>
              <div className="cluster-detail-stats">
                <div className="method-line">
                  <span>Size</span>
                  <strong>{activeCluster.size} coins</strong>
                </div>
                <div className="method-line">
                  <span>Avg pairwise correlation</span>
                  <strong>{activeCluster.avg_pairwise_corr.toFixed(2)}</strong>
                </div>
                <div className="method-line">
                  <span>Description</span>
                  <strong>Symbols with similar recent return behavior.</strong>
                </div>
              </div>

              <div className="top-members-block">
                <h4>Top Members</h4>
                <div className="member-chip-list">
                  {activeCluster.top_members.map((member) => (
                    <span key={member.symbol} className="member-chip">
                      {member.symbol} <strong>{member.weight.toFixed(2)}</strong>
                    </span>
                  ))}
                </div>
              </div>

              <div className="cluster-members-scroll">
                {activeCluster.symbols.map((symbol) => (
                  <span key={symbol} className="symbol-chip">
                    {symbol}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className="cluster-empty-state">No stable cluster is available in the current snapshot.</div>
          )}
        </aside>
      </div>
    </section>
  );
}
