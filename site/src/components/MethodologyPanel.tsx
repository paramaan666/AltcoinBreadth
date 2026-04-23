import type { Methodology } from "../lib/types";

type MethodologyPanelProps = {
  methodology: Methodology;
  sourceUrl: string | undefined;
  className?: string;
};

function formatLabel(key: string) {
  const normalized = key.replace(/_/g, " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function renderEntries(entries: Record<string, string | number>) {
  return Object.entries(entries).map(([key, value]) => (
    <div key={key} className="method-line">
      <span>{formatLabel(key)}</span>
      <strong>{String(value)}</strong>
    </div>
  ));
}

export function MethodologyPanel({ methodology, sourceUrl, className }: MethodologyPanelProps) {
  return (
    <section id="methodology" className={className ? `panel ${className}` : "panel"}>
      <div className="panel-header">
        <div>
          <h2>Methodology / About</h2>
          <p>Compact definitions for breadth, distance normalization, clustering, lifecycle handling, and data sourcing.</p>
        </div>
        {sourceUrl ? (
          <a className="source-link" href={sourceUrl} target="_blank" rel="noreferrer">
            Source Repository
          </a>
        ) : null}
      </div>
      <div className="method-grid">
        <article className="method-card">
          <h3>Breadth</h3>
          {renderEntries(methodology.breadth)}
        </article>
        <article className="method-card">
          <h3>Distance</h3>
          {renderEntries(methodology.distance)}
        </article>
        <article className="method-card">
          <h3>Clusters</h3>
          {renderEntries(methodology.clusters)}
        </article>
        <article className="method-card">
          <h3>Lifecycle</h3>
          {renderEntries(methodology.lifecycle)}
        </article>
      </div>
    </section>
  );
}
