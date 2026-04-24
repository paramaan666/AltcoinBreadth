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
  avg_residual_corr: number;
  top_members: Array<{ symbol: string; weight: number }>;
  nearest_neighbors?: Array<{ symbol: string; neighbors: Array<{ symbol: string; score: number }> }>;
};

export type ClusterPayload = {
  as_of_date: string | null;
  params: Record<string, string | number | boolean>;
  clusters: Cluster[];
  unassigned_symbols: string[];
  embedding: Array<{
    symbol: string;
    x: number;
    y: number;
    cluster_id: number | "noise";
    nearest_neighbors?: Array<{ symbol: string; score: number }>;
  }>;
};

export type RotationPoint = {
  date: string;
  close: number;
  ma_30w: number;
  momentum_30d_pct: number;
  raw_distance_pct: number;
  normalized_distance: number | null;
};

export type RotationDelta = {
  from_date: string | null;
  momentum_change: number | null;
  raw_distance_change: number | null;
  normalized_distance_change: number | null;
};

export type RotationSymbolTrail = {
  symbol: string;
  quadrant: "above_momentum" | "above_fading" | "below_rebound" | "below_weak";
  trend_direction: "improving" | "deteriorating" | "mixed" | "flat";
  current: RotationPoint;
  deltas: Record<string, RotationDelta>;
  trail: RotationPoint[];
};

export type RotationPayload = {
  as_of_date: string | null;
  trail_days: number;
  lookbacks: number[];
  summary: {
    symbol_count: number;
    trend_counts: Record<string, number>;
    quadrant_counts: Record<string, number>;
    median_momentum_30d_pct: number | null;
    median_normalized_distance: number | null;
  };
  rows: RotationSymbolTrail[];
};

export type Methodology = {
  breadth: Record<string, string | number>;
  distance: Record<string, string | number>;
  rotation: Record<string, string | number>;
  clusters: Record<string, string | number>;
  lifecycle: Record<string, string | number>;
};
