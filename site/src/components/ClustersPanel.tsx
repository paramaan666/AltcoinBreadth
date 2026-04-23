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

type ClustersPanelProps = {
  payload: ClusterPayload;
};

const PALETTE = ["#5cc8ff", "#5ee39b", "#f6bd60", "#f28482", "#c77dff", "#7bdff2", "#f4a261"];

function colorForCluster(clusterId: number | "noise") {
  if (clusterId === "noise") {
    return "#7d8597";
  }
  return PALETTE[(clusterId - 1) % PALETTE.length];
}

export function ClustersPanel({ payload }: ClustersPanelProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Correlation Clusters</h2>
          <p>
            {payload.clusters.length} clusters, {payload.unassigned_symbols.length} unassigned symbols.
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

      {payload.embedding.length > 0 ? (
        <div className="chart-wrap cluster-chart">
          <ResponsiveContainer width="100%" height={320}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="#25304a" />
              <XAxis dataKey="x" type="number" tick={false} stroke="#7d8597" />
              <YAxis dataKey="y" type="number" tick={false} stroke="#7d8597" />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                contentStyle={{ background: "#0e1726", border: "1px solid #25304a", borderRadius: 12 }}
              />
              {payload.clusters.map((cluster) => (
                <Scatter
                  key={cluster.cluster_id}
                  name={cluster.label}
                  data={payload.embedding.filter((point) => point.cluster_id === cluster.cluster_id)}
                  fill={colorForCluster(cluster.cluster_id)}
                />
              ))}
              <Scatter
                name="Noise"
                data={payload.embedding.filter((point) => point.cluster_id === "noise")}
                fill={colorForCluster("noise")}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      <div className="cluster-grid">
        {payload.clusters.map((cluster) => (
          <article key={cluster.cluster_id} className="cluster-card">
            <div className="cluster-title-row">
              <h3>{cluster.label}</h3>
              <span className="pill">{cluster.size} symbols</span>
            </div>
            <p>Average pairwise correlation: {cluster.avg_pairwise_corr.toFixed(2)}</p>
            <p className="cluster-members">{cluster.symbols.join(", ")}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

