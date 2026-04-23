import { useState } from "react";
import type { SnapshotRow } from "../lib/types";

type DistanceTableProps = {
  title: string;
  rows: SnapshotRow[];
  direction: "above" | "below";
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

export function DistanceTable({ title, rows, direction }: DistanceTableProps) {
  const [sortMode, setSortMode] = useState<SortMode>("normalized");
  const [query, setQuery] = useState("");
  const filtered = filterRows(rows, query);
  const sorted = sortRows(filtered, sortMode, direction);

  return (
    <section className="panel">
      <div className="panel-header table-header">
        <div>
          <h2>{title}</h2>
          <p>{rows.length} symbols in the latest eligible snapshot.</p>
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
            {sorted.map((row) => (
              <tr key={row.symbol}>
                <td>{row.symbol}</td>
                <td>{row.close.toFixed(6)}</td>
                <td>{row.ma_30w.toFixed(6)}</td>
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

