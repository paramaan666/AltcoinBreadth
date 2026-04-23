import { useEffect, useState } from "react";
import { BreadthPanel } from "./components/BreadthPanel";
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

type DashboardTab = "overview" | "breadth" | "above" | "below" | "clusters" | "methodology";

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

const TABS: Array<{ id: DashboardTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "breadth", label: "Breadth" },
  { id: "above", label: "Above 30W MA" },
  { id: "below", label: "Below 30W MA" },
  { id: "clusters", label: "Clusters" },
  { id: "methodology", label: "Methodology" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
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

  const { overview, breadth, above, below, clusters, methodology } = state;

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
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={activeTab === tab.id ? "topnav-button active" : "topnav-button"}
              onClick={() => {
                setActiveTab(tab.id);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="hero-meta">
          <span className="pill">Last update: {overview.updated_at_utc}</span>
          <span className="pill">As of: {overview.as_of_date ?? "n/a"}</span>
        </div>
      </header>

      <div className="page-view">
        {activeTab === "overview" ? (
          <>
            <section className="metrics-grid" id="overview">
              <MetricCard label="Total Coins Tracked" value={String(overview.tracked_symbols)} helper="All futures symbols with stored history" />
              <MetricCard label="Eligible Coins" value={String(overview.eligible_symbols)} helper="With sufficient history" />
              <MetricCard label="Above 30W MA" value={String(overview.above_count)} helper={`${overview.above_pct.toFixed(1)}% of eligible`} />
              <MetricCard label="Below 30W MA" value={String(overview.below_count)} helper={`${(100 - overview.above_pct).toFixed(1)}% of eligible`} />
              <MetricCard label="Breadth (Above %)" value={`${overview.above_pct.toFixed(1)}%`} helper={`${overview.active_symbols} active symbols`} />
            </section>

            <div className="overview-stack">
              <BreadthPanel overview={overview} breadth={breadth} variant="overview" sectionId="breadth" />

              <div className="tables-grid">
                <DistanceTable
                  title="Above 30W MA"
                  rows={above}
                  direction="above"
                  className="panel--table"
                  sectionId="above-30w"
                />
                <DistanceTable
                  title="Below 30W MA"
                  rows={below}
                  direction="below"
                  className="panel--table"
                  sectionId="below-30w"
                />
              </div>

              <ClustersPanel payload={clusters} variant="overview" sectionId="clusters" />

              <MethodologyPanel
                methodology={methodology}
                sourceUrl={SOURCE_REPO_URL}
                className="panel--methodology"
                sectionId="methodology"
              />
            </div>
          </>
        ) : null}

        {activeTab === "breadth" ? (
          <BreadthPanel overview={overview} breadth={breadth} variant="expanded" className="panel--focus" sectionId="breadth" />
        ) : null}

        {activeTab === "above" ? (
          <DistanceTable
            title="Above 30W MA"
            rows={above}
            direction="above"
            className="panel--focus panel--focus-table"
            sectionId="above-30w"
          />
        ) : null}

        {activeTab === "below" ? (
          <DistanceTable
            title="Below 30W MA"
            rows={below}
            direction="below"
            className="panel--focus panel--focus-table"
            sectionId="below-30w"
          />
        ) : null}

        {activeTab === "clusters" ? (
          <ClustersPanel payload={clusters} variant="expanded" className="panel--focus panel--focus-clusters" sectionId="clusters" />
        ) : null}

        {activeTab === "methodology" ? (
          <MethodologyPanel
            methodology={methodology}
            sourceUrl={SOURCE_REPO_URL}
            className="panel--focus panel--methodology"
            sectionId="methodology"
          />
        ) : null}
      </div>
    </div>
  );
}
