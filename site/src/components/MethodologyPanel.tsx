import type { Methodology } from "../lib/types";

type MethodologyPanelProps = {
  methodology: Methodology;
  sourceUrl: string | undefined;
};

function renderEntries(entries: Record<string, string | number>) {
  return Object.entries(entries).map(([key, value]) => (
    <div key={key} className="method-line">
      <span>{key}</span>
      <strong>{String(value)}</strong>
    </div>
  ));
}

export function MethodologyPanel({ methodology, sourceUrl }: MethodologyPanelProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Methodology</h2>
          <p>Compact definitions for breadth, distance normalization, clustering, and lifecycle handling.</p>
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

