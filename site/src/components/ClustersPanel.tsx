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
};

type EmbeddingPoint = ClusterPayload["embedding"][number];
type ScatterTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: EmbeddingPoint }>;
  clusterLabels: Map<number | "noise", string>;
};

const PALETTE = ["#5fd5ff", "#8d77ff", "#48d18f", "#f2b36a", "#ff7f90", "#60a5fa", "#7dd3c7", "#f59e0b"];
const NOISE_COLOR = "#6f87a8";

function findInitialCluster(clusters: Cluster[]) {
  return [...clusters].sort((left, right) => right.size - left.size)[0]?.cluster_id ?? null;
}

function colorForCluster(clusterId: number | "noise") {
  if (clusterId === "noise") {
    return NOISE_COLOR;
  }
  return PALETTE[(clusterId - 1) % PALETTE.length];
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

export function ClustersPanel({ payload, className }: ClustersPanelProps) {
  const clusterList = useMemo(
    () => [...payload.clusters].sort((left, right) => right.size - left.size),
    [payload.clusters],
  );
  const [selectedClusterId, setSelectedClusterId] = useState<number | null>(findInitialCluster(clusterList));

  useEffect(() => {
    setSelectedClusterId(findInitialCluster(clusterList));
  }, [clusterList]);

  const assignedSymbols = payload.clusters.reduce((accumulator, cluster) => accumulator + cluster.size, 0);
  const activeCluster = clusterList.find((cluster) => cluster.cluster_id === selectedClusterId) ?? clusterList[0] ?? null;
  const clusterLabels = useMemo(() => {
    const mapping = new Map<number | "noise", string>();
    for (const cluster of payload.clusters) {
      mapping.set(cluster.cluster_id, cluster.label);
    }
    mapping.set("noise", "Noise / Unassigned");
    return mapping;
  }, [payload.clusters]);
  const groupedEmbedding = useMemo(() => {
    const buckets = new Map<number | "noise", EmbeddingPoint[]>();
    for (const point of payload.embedding) {
      const existing = buckets.get(point.cluster_id) ?? [];
      existing.push(point);
      buckets.set(point.cluster_id, existing);
    }
    const orderedKeys = [...buckets.keys()].sort((left, right) => {
      if (left === "noise") {
        return 1;
      }
      if (right === "noise") {
        return -1;
      }
      return left - right;
    });
    return orderedKeys.map((clusterId) => ({
      clusterId,
      label: clusterLabels.get(clusterId) ?? String(clusterId),
      color: colorForCluster(clusterId),
      points: buckets.get(clusterId) ?? [],
    }));
  }, [clusterLabels, payload.embedding]);

  return (
    <section id="clusters" className={className ? `panel ${className}` : "panel"}>
      <div className="panel-header">
        <div>
          <h2>Behavior Clusters</h2>
          <p>2D co-movement map from standardized daily returns.</p>
        </div>
        <div className="param-list">
          <span className="pill">{String(payload.params.lookback_days)}d returns</span>
          <span className="pill">Avg-linkage {String(payload.params.distance_threshold)}</span>
          <span className="pill">PCA 2D embedding</span>
        </div>
      </div>

      <div className="clusters-layout">
        <div className="cluster-visual-panel">
          <div className="cluster-scatter-shell">
            {groupedEmbedding.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 12, right: 12, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#20324b" />
                  <XAxis type="number" dataKey="x" axisLine={false} tickLine={false} tick={false} />
                  <YAxis type="number" dataKey="y" axisLine={false} tickLine={false} tick={false} />
                  <Tooltip
                    cursor={{ stroke: "#2a4160", strokeWidth: 1 }}
                    content={(props) => <ClusterTooltip {...(props as ScatterTooltipProps)} clusterLabels={clusterLabels} />}
                  />
                  {groupedEmbedding.map((group) => (
                    <Scatter
                      key={String(group.clusterId)}
                      data={group.points}
                      fill={group.color}
                      fillOpacity={
                        selectedClusterId === null
                          ? group.clusterId === "noise"
                            ? 0.24
                            : 0.8
                          : group.clusterId === selectedClusterId
                            ? 0.95
                            : group.clusterId === "noise"
                              ? 0.16
                              : 0.18
                      }
                    />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            ) : (
              <div className="cluster-empty-state">
                No 2D embedding is available for the current snapshot. The cluster payload exists, but the visual map could
                not be built from the current data window.
              </div>
            )}
          </div>
          <div className="cluster-visual-note">
            {payload.embedding.length} projected symbols. Bright points highlight {activeCluster?.label ?? "the selected cluster"}.
          </div>
        </div>

        <aside className="cluster-detail-panel">
          <div className="cluster-stat-grid">
            <article className="cluster-stat-card">
              <span>Clusters</span>
              <strong>{payload.clusters.length}</strong>
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

          <div className="cluster-list-scroll">
            {clusterList.map((cluster) => (
              <button
                key={cluster.cluster_id}
                className={cluster.cluster_id === selectedClusterId ? "cluster-list-button active" : "cluster-list-button"}
                type="button"
                onClick={() => setSelectedClusterId(cluster.cluster_id)}
              >
                <span className="cluster-list-label">
                  <span className="cluster-dot" style={{ background: colorForCluster(cluster.cluster_id) }} />
                  {cluster.label}
                </span>
                <strong>{cluster.size}</strong>
              </button>
            ))}
          </div>

          {activeCluster ? (
            <>
              <div className="cluster-detail-stats">
                <div className="method-line">
                  <span>Members</span>
                  <strong>{activeCluster.size}</strong>
                </div>
                <div className="method-line">
                  <span>Avg pairwise corr</span>
                  <strong>{activeCluster.avg_pairwise_corr.toFixed(2)}</strong>
                </div>
                <div className="method-line">
                  <span>Share of assigned</span>
                  <strong>{((activeCluster.size / Math.max(assignedSymbols, 1)) * 100).toFixed(1)}%</strong>
                </div>
              </div>

              <div className="top-members-block">
                <h4>Top Members</h4>
                <div className="member-chip-list">
                  {activeCluster.top_members.slice(0, 8).map((member) => (
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
