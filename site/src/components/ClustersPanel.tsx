import { useEffect, useState } from "react";
import type { Cluster, ClusterPayload } from "../lib/types";

type ClustersPanelProps = {
  payload: ClusterPayload;
  className?: string;
};

function findInitialCluster(clusters: Cluster[]) {
  return clusters[0]?.cluster_id ?? null;
}

export function ClustersPanel({ payload, className }: ClustersPanelProps) {
  const [selectedClusterId, setSelectedClusterId] = useState<number | null>(findInitialCluster(payload.clusters));

  useEffect(() => {
    setSelectedClusterId(findInitialCluster(payload.clusters));
  }, [payload.clusters]);

  const assignedSymbols = payload.clusters.reduce((accumulator, cluster) => accumulator + cluster.size, 0);
  const activeCluster = payload.clusters.find((cluster) => cluster.cluster_id === selectedClusterId) ?? payload.clusters[0] ?? null;
  const largestClusterSize = payload.clusters.reduce(
    (largest, cluster) => Math.max(largest, cluster.size),
    0,
  );

  return (
    <section id="clusters" className={className ? `panel ${className}` : "panel"}>
      <div className="panel-header">
        <div>
          <h2>Clusters (Correlation-based)</h2>
          <p>
            {payload.clusters.length} clusters, {assignedSymbols} assigned symbols, {payload.unassigned_symbols.length} noise / unassigned.
          </p>
        </div>
        <div className="param-list">
          {Object.entries(payload.params).map(([key, value]) => (
            <span key={key} className="pill">
              {key}: {String(value)}
            </span>
          ))}
        </div>
      </div>

      <div className="clusters-layout">
        <div className="cluster-visual-panel">
          <div className="cluster-stat-grid">
            <article className="cluster-stat-card">
              <span>Total clusters</span>
              <strong>{payload.clusters.length}</strong>
            </article>
            <article className="cluster-stat-card">
              <span>Assigned symbols</span>
              <strong>{assignedSymbols}</strong>
            </article>
            <article className="cluster-stat-card">
              <span>Unassigned</span>
              <strong>{payload.unassigned_symbols.length}</strong>
            </article>
          </div>

          <div className="cluster-size-chart">
            {payload.clusters.map((cluster) => (
              <div key={cluster.cluster_id} className="cluster-bar-row">
                <div className="cluster-bar-label">
                  <span className="cluster-dot" style={{ background: colorForCluster(cluster.cluster_id) }} />
                  <span>{cluster.label}</span>
                </div>
                <div className="cluster-bar-track">
                  <div
                    className="cluster-bar-fill"
                    style={{
                      width: `${largestClusterSize > 0 ? (cluster.size / largestClusterSize) * 100 : 0}%`,
                      background: colorForCluster(cluster.cluster_id),
                    }}
                  />
                </div>
                <span className="cluster-bar-value">{cluster.size}</span>
              </div>
            ))}
          </div>

          {payload.unassigned_symbols.length > 0 ? (
            <div className="cluster-empty-state">
              Unassigned preview: {payload.unassigned_symbols.slice(0, 12).join(", ")}
              {payload.unassigned_symbols.length > 12 ? ` +${payload.unassigned_symbols.length - 12} more` : ""}
            </div>
          ) : (
            <div className="cluster-empty-state">
              All currently clustered symbols were assigned to a cluster at the selected settings.
            </div>
          )}
        </div>

        <aside className="cluster-detail-panel">
          <div className="cluster-detail-header">
            <h3>Cluster Details</h3>
            {payload.clusters.length > 0 ? (
              <select
                className="cluster-select"
                value={selectedClusterId ?? ""}
                onChange={(event) => setSelectedClusterId(Number(event.target.value))}
              >
                {payload.clusters.map((cluster) => (
                  <option key={cluster.cluster_id} value={cluster.cluster_id}>
                    {cluster.label}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          {activeCluster ? (
            <>
              <div className="cluster-detail-stats">
                <div className="method-line">
                  <span>Size</span>
                  <strong>{activeCluster.size} symbols</strong>
                </div>
                <div className="method-line">
                  <span>Avg pairwise correlation</span>
                  <strong>{activeCluster.avg_pairwise_corr.toFixed(2)}</strong>
                </div>
                <div className="method-line">
                  <span>Coverage</span>
                  <strong>{((activeCluster.size / Math.max(assignedSymbols, 1)) * 100).toFixed(1)}%</strong>
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

              <div className="cluster-symbol-scroll">
                {activeCluster.symbols.map((symbol) => (
                  <span key={symbol} className="symbol-chip">
                    {symbol}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className="cluster-empty-state">No cluster payload available for the current snapshot.</div>
          )}
        </aside>
      </div>
    </section>
  );
}

const PALETTE = ["#5fd5ff", "#8d77ff", "#48d18f", "#f2b36a", "#ff7f90", "#60a5fa", "#7dd3c7"];

function colorForCluster(clusterId: number) {
  return PALETTE[(clusterId - 1) % PALETTE.length];
}
