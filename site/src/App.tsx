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
import { MetricCard } from "./components/MetricCard";
import { loadDashboardData } from "./lib/api";
import type {
  BreadthPoint,
  ClusterPayload,
  Overview,
  SnapshotRow,
} from "./lib/types";

type DashboardState = {
  overview: Overview | null;
  breadth: BreadthPoint[];
  above: SnapshotRow[];
  below: SnapshotRow[];
  clusters: ClusterPayload | null;
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

  if (state.error || !state.overview || !state.clusters) {
    return <div className="app-shell status-view">Unable to load dashboard: {state.error ?? "unknown error"}</div>;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <span className="bar bar-1" />
            <span className="bar bar-2" />
            <span className="bar bar-3" />
          </div>
          <div>
            <h1>Crypto Market Breadth Dashboard</h1>
            <p className="topbar-subtitle">Binance USDⓈ-M Futures</p>
          </div>
        </div>
        <nav className="topnav" aria-label="Dashboard sections">
          <a href="#overview">Overview</a>
          <a href="#breadth">Breadth</a>
          <a href="#above-30w">Above 30W MA</a>
          <a href="#below-30w">Below 30W MA</a>
          <a href="#clusters">Clusters</a>
        </nav>
        <div className="hero-meta">
          <span className="pill">Last update: {state.overview.updated_at_utc}</span>
          <span className="pill">As of: {state.overview.as_of_date ?? "n/a"}</span>
          <span className="pill">
            Active: {state.overview.active_symbols} / Tracked: {state.overview.tracked_symbols}
          </span>
        </div>
      </header>

      <section className="metrics-grid" id="overview">
        <MetricCard
          label="Tracked Symbols"
          value={String(state.overview.tracked_symbols)}
          helper={`${state.overview.active_symbols} active · ${state.overview.delisted_symbols_total} delisted history`}
        />
        <MetricCard label="Eligible Symbols" value={String(state.overview.eligible_symbols)} helper="Enough history for 30W MA" />
        <MetricCard label="Above 30W MA" value={String(state.overview.above_count)} helper={`${state.overview.above_pct.toFixed(2)}% of eligible`} />
        <MetricCard
          label="Below 30W MA"
          value={String(state.overview.below_count)}
          helper={`${(100 - state.overview.above_pct).toFixed(2)}% of eligible`}
        />
        <MetricCard
          label="Breadth (Above %)"
          value={`${state.overview.above_pct.toFixed(1)}%`}
          helper={`${state.overview.as_of_date ?? "Latest"} snapshot`}
        />
      </section>

      <main className="dashboard-grid">
        <section className="panel panel--breadth" id="breadth">
          <div className="panel-header">
            <div>
              <h2>Breadth (% Above 30W MA)</h2>
              <p>{state.overview.universe_rule}</p>
            </div>
            <div className="param-list">
              <span className="pill">210d trailing MA</span>
              <span className="pill">ATR%(60) normalized</span>
            </div>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={state.breadth}>
                <CartesianGrid strokeDasharray="3 3" stroke="#20324b" />
                <XAxis dataKey="date" minTickGap={48} stroke="#6f87a8" />
                <YAxis stroke="#6f87a8" domain={[0, 100]} unit="%" />
                <Tooltip
                  contentStyle={{ background: "#081523", border: "1px solid #20324b", borderRadius: 12 }}
                />
                <Line dataKey="above_pct" dot={false} stroke="#63d2ff" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <ClustersPanel payload={state.clusters} className="panel--clusters" />
        <DistanceTable
          title="Above 30W MA"
          rows={state.above}
          direction="above"
          className="panel--table panel--table-above"
          sectionId="above-30w"
        />
        <DistanceTable
          title="Below 30W MA"
          rows={state.below}
          direction="below"
          className="panel--table panel--table-below"
          sectionId="below-30w"
        />
      </main>
    </div>
  );
}
