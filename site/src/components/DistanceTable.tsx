import { useState } from "react";
import type { SnapshotRow } from "../lib/types";

type DistanceTableProps = {
  title: string;
  rows: SnapshotRow[];
  direction: "above" | "below";
  className?: string;
  sectionId?: string;
};

type SortMode = "raw" | "normalized";

function sortRows(rows: SnapshotRow[], mode: SortMode, direction: "above" | "below") {
  const copy = [...rows];
  copy.sort((left, right) => {
    const leftValue = mode === "raw" ? left.raw_distance_pct : left.normalized_distance ?? Number.NEGATIVE_INFINITY;
    const rightValue = mode === "raw" ? right.raw_distance_pct : right.normalized_distance ?? Number.NEGATIVE_INFINITY;
    return direction === "above" ? rightValue - leftValue : leftValue - rightValue;
  });
  return copy;
}

function filterRows(rows: SnapshotRow[], query: string) {
  if (!query) {
    return rows;
  }
  const normalized = query.trim().toLowerCase();
  return rows.filter((row) => row.symbol.toLowerCase().includes(normalized));
}

function formatPrice(value: number) {
  if (value >= 1000) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (value >= 1) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  if (value >= 0.01) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 5 });
  }
  return value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 8 });
}

export function DistanceTable({ title, rows, direction, className, sectionId }: DistanceTableProps) {
  const [sortMode, setSortMode] = useState<SortMode>("normalized");
  const [query, setQuery] = useState("");
  const filtered = filterRows(rows, query);
  const sorted = sortRows(filtered, sortMode, direction);
  const leader = sorted[0];

  return (
    <section id={sectionId} className={className ? `panel ${className}` : "panel"}>
      <div className="panel-header table-header">
        <div>
          <h2>{title}</h2>
          <p>
            {rows.length} symbols in the latest eligible snapshot.
            {leader ? ` Lead: ${leader.symbol} (${leader.raw_distance_pct.toFixed(2)}%)` : ""}
          </p>
        </div>
        <div className="table-controls">
          <div className="toggle-group">
            <button
              className={sortMode === "raw" ? "toggle active" : "toggle"}
              onClick={() => setSortMode("raw")}
              type="button"
            >
              Raw Distance
            </button>
            <button
              className={sortMode === "normalized" ? "toggle active" : "toggle"}
              onClick={() => setSortMode("normalized")}
              type="button"
            >
              Normalized Distance
            </button>
          </div>
          <input
            className="search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search symbol"
          />
        </div>
      </div>
      <div className="table-shell">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Symbol</th>
              <th>Close</th>
              <th>30W MA</th>
              <th>Raw %</th>
              <th>ATR% 60D</th>
              <th>Normalized</th>
              <th>Days</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, index) => (
              <tr key={row.symbol}>
                <td>{index + 1}</td>
                <td>{row.symbol}</td>
                <td>{formatPrice(row.close)}</td>
                <td>{formatPrice(row.ma_30w)}</td>
                <td className={direction === "above" ? "positive" : "negative"}>
                  {row.raw_distance_pct.toFixed(2)}%
                </td>
                <td>{row.atr_pct_60.toFixed(2)}%</td>
                <td className={direction === "above" ? "positive" : "negative"}>
                  {(row.normalized_distance ?? 0).toFixed(2)}
                </td>
                <td>{row.days_history}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
