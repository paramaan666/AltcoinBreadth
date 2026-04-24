export type Overview = {
  as_of_date: string | null;
  updated_at_utc: string;
  tracked_symbols: number;
  eligible_symbols: number;
  above_count: number;
  above_pct: number;
  below_count: number;
  active_symbols: number;
  delisted_symbols_total: number;
  candidate_delisted_symbols: number;
  universe_rule: string;
  ma_definition: string;
  distance_definition: string;
  methodology_version: string;
};

export type BreadthPoint = {
  date: string;
  eligible_count: number;
  above_count: number;
  above_pct: number;
};

export type SnapshotRow = {
  symbol: string;
  date: string;
  close: number;
  ma_30w: number;
  raw_distance_pct: number;
  atr_pct_60: number;
  normalized_distance: number | null;
  momentum_30d_pct: number;
  days_history: number;
  listing_date: string | null;
  delisted_date: string | null;
};

export type Cluster = {
  cluster_id: number;
  label: string;
  size: number;
  symbols: string[];
  avg_pairwise_corr: number;
  top_members: Array<{ symbol: string; weight: number }>;
};

export type ClusterPayload = {
  as_of_date: string | null;
  params: Record<string, string | number | boolean>;
  clusters: Cluster[];
  unassigned_symbols: string[];
  embedding: Array<{ symbol: string; x: number; y: number; cluster_id: number | "noise" }>;
};

export type Methodology = {
  breadth: Record<string, string | number>;
  distance: Record<string, string | number>;
  clusters: Record<string, string | number>;
  lifecycle: Record<string, string | number>;
};
