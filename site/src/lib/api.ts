import type {
  BreadthPoint,
  ClusterPayload,
  Methodology,
  Overview,
  SnapshotRow,
} from "./types";

async function fetchJson<T>(name: string): Promise<T> {
  const response = await fetch(`./data/${name}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${name}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function loadDashboardData(): Promise<{
  overview: Overview;
  breadth: BreadthPoint[];
  above: SnapshotRow[];
  below: SnapshotRow[];
  clusters: ClusterPayload;
  methodology: Methodology;
}> {
  const [overview, breadthPayload, abovePayload, belowPayload, clusters, methodology] =
    await Promise.all([
      fetchJson<Overview>("overview.json"),
      fetchJson<{ series: BreadthPoint[] }>("breadth_history.json"),
      fetchJson<{ as_of_date: string | null; rows: SnapshotRow[] }>("above_30w_ma.json"),
      fetchJson<{ as_of_date: string | null; rows: SnapshotRow[] }>("below_30w_ma.json"),
      fetchJson<ClusterPayload>("clusters.json"),
      fetchJson<Methodology>("methodology.json"),
    ]);

  return {
    overview,
    breadth: breadthPayload.series,
    above: abovePayload.rows,
    below: belowPayload.rows,
    clusters,
    methodology,
  };
}

