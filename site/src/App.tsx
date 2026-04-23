import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ClustersPanel } from "./components/ClustersPanel";
import { DistanceTable } from "./components/DistanceTable";
import { MethodologyPanel } from "./components/MethodologyPanel";
import { MetricCard } from "./components/MetricCard";
import { loadDashboardData } from "./lib/api";
import type {
  BreadthPoint,
  ClusterPayload,
  Methodology,
  Overview,
  SnapshotRow,
} from "./lib/types";

const SOURCE_REPO_URL = import.meta.env.VITE_SOURCE_REPO_URL as string | undefined;

type DashboardState = {
  overview: Overview | null;
  breadth: BreadthPoint[];
  above: SnapshotRow[];
  below: SnapshotRow[];
  clusters: ClusterPayload | null;
  methodology: Methodology | null;
  error: string | null;
  loading: boolean;
};

export default function App() {
  const [state, setState] = useState<DashboardState>({
    overview: null,
    breadth: [],
    above: [],
    below: [],
    clusters: null,
    methodology: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    let mounted = true;
    loadDashboardData()
      .then((payload) => {
        if (!mounted) {
          return;
        }
        setState({
          overview: payload.overview,
          breadth: payload.breadth,
          above: payload.above,
          below: payload.below,
          clusters: payload.clusters,
          methodology: payload.methodology,
          error: null,
          loading: false,
        });
      })
      .catch((error: Error) => {
        if (!mounted) {
          return;
        }
        setState((current) => ({ ...current, error: error.message, loading: false }));
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (state.loading) {
    return <div className="app-shell status-view">Loading dashboard data...</div>;
  }

  if (state.error || !state.overview || !state.clusters || !state.methodology) {
    return <div className="app-shell status-view">Unable to load dashboard: {state.error ?? "unknown error"}</div>;
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Binance USDⓈ-M Futures</p>
          <h1>Crypto Market Breadth Dashboard</h1>
          <p className="hero-copy">
            Daily static analytics for breadth, 30W MA distance, delist-aware lifecycle handling, and correlation clusters.
          </p>
        </div>
        <div className="hero-meta">
          <span className="pill">Updated: {state.overview.updated_at_utc}</span>
          <span className="pill">As of: {state.overview.as_of_date ?? "n/a"}</span>
        </div>
      </header>

      <section className="metrics-grid">
        <MetricCard label="Tracked Symbols" value={String(state.overview.tracked_symbols)} helper="Symbols with stored daily history" />
        <MetricCard label="Eligible Symbols" value={String(state.overview.eligible_symbols)} helper="Enough history for 30W MA" />
        <MetricCard label="Above 30W MA" value={String(state.overview.above_count)} helper={`${state.overview.above_pct.toFixed(2)}% of eligible`} />
        <MetricCard label="Below 30W MA" value={String(state.overview.below_count)} helper="Latest eligible snapshot" />
        <MetricCard label="Active Universe" value={String(state.overview.active_symbols)} helper="Current active Binance USDT perps" />
        <MetricCard label="Delisted Symbols" value={String(state.overview.delisted_symbols_total)} helper="Retained for historical breadth" />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Breadth History</h2>
            <p>{state.overview.universe_rule}</p>
          </div>
          <div className="param-list">
            <span className="pill">{state.overview.ma_definition}</span>
            <span className="pill">{state.overview.distance_definition}</span>
          </div>
        </div>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={state.breadth}>
              <CartesianGrid strokeDasharray="3 3" stroke="#25304a" />
              <XAxis dataKey="date" minTickGap={48} stroke="#7d8597" />
              <YAxis stroke="#7d8597" domain={[0, 100]} unit="%" />
              <Tooltip
                contentStyle={{ background: "#0e1726", border: "1px solid #25304a", borderRadius: 12 }}
              />
              <Line dataKey="above_pct" dot={false} stroke="#8b5cf6" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="tables-grid">
        <DistanceTable title="Above 30W MA" rows={state.above} direction="above" />
        <DistanceTable title="Below 30W MA" rows={state.below} direction="below" />
      </div>

      <ClustersPanel payload={state.clusters} />
      <MethodologyPanel methodology={state.methodology} sourceUrl={SOURCE_REPO_URL} />
    </div>
  );
}

