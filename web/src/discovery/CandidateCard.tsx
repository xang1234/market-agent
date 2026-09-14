import { useState } from "react";

import type { CandidateView, DimensionName } from "../../../services/discovery/src/types.ts";

const DIMENSIONS: ReadonlyArray<{ key: DimensionName; label: string }> = [
  { key: "theme_exposure", label: "Theme exposure" },
  { key: "evidence_strength", label: "Evidence strength" },
  { key: "business_quality", label: "Business quality" },
  { key: "valuation_context", label: "Valuation context" },
];

export function CandidateCard({ candidate }: { candidate: CandidateView }) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const identity = candidate.identity;
  return (
    <article className="space-y-3 rounded-md border border-line bg-surface p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-fg">{candidate.name}</h3>
          <p className="text-sm text-muted">{identity ? `${identity.ticker} · ${identity.legal_name}` : "Identity still needs confirmation"}</p>
        </div>
        <span className="rounded border border-line-strong px-2 py-0.5 text-xs text-fg">{candidate.rank === null ? candidateStateLabel(candidate.state) : `#${candidate.rank}`}</span>
      </header>
      {candidate.assessment ? (
        <dl className="grid gap-2 sm:grid-cols-2">
          {DIMENSIONS.map(({ key, label }) => {
            const dimension = candidate.assessment?.dimensions[key];
            return <div key={key} className="rounded bg-surface-2 p-2"><dt className="text-xs font-medium text-muted">{label}</dt><dd className="mt-1 text-sm text-fg"><span className="font-medium">{dimension ? levelLabel(dimension.level) : "Unknown"}</span>{dimension?.explanation ? ` · ${dimension.explanation}` : " · No assessment is available."}</dd></div>;
          })}
        </dl>
      ) : <p className="text-sm text-muted">Assessment has not been completed yet.</p>}
      {candidate.assessment?.counterarguments.length ? <section><h4 className="text-xs font-medium uppercase text-muted">Risk</h4><p className="text-sm text-fg">{candidate.assessment.counterarguments[0]?.text}</p></section> : null}
      {candidate.assessment?.unresolved_questions.length ? <section><h4 className="text-xs font-medium uppercase text-muted">Next question</h4><p className="text-sm text-fg">{candidate.assessment.unresolved_questions[0]}</p></section> : null}
      {candidate.assessment?.next_action ? <p className="text-sm text-muted">Next step: {candidate.assessment.next_action}</p> : null}
      <div>
        <button type="button" aria-label={`View sources for ${candidate.name}`} aria-expanded={sourcesOpen} onClick={() => setSourcesOpen((open) => !open)} className="text-sm font-medium text-accent underline">{sourcesOpen ? "Hide sources" : "View sources"}</button>
        {sourcesOpen ? <SourceDrawer candidate={candidate} onClose={() => setSourcesOpen(false)} /> : null}
      </div>
    </article>
  );
}

function SourceDrawer({ candidate, onClose }: { candidate: CandidateView; onClose(): void }) {
  return <aside aria-label={`Sources for ${candidate.name}`} className="mt-3 rounded-md border border-line bg-surface-2 p-3"><div className="flex items-start justify-between gap-2"><h4 className="text-sm font-semibold text-fg">Sources</h4><button type="button" aria-label={`Close sources for ${candidate.name}`} onClick={onClose} className="text-sm text-muted underline">Close</button></div>{!candidate.evidence_available ? <p className="mt-2 text-sm text-muted">Evidence is no longer available. This result remains visible, but its source details are redacted.</p> : candidate.sources.length === 0 ? <p className="mt-2 text-sm text-muted">No currently available sources were returned for this company.</p> : <ul className="mt-2 space-y-2">{candidate.sources.map((source) => <li key={`${source.citation.kind}:${source.citation.id}`}><a href={source.url} target="_blank" rel="noopener noreferrer" className="text-sm text-accent underline">{source.title}</a></li>)}</ul>}</aside>;
}

function candidateStateLabel(state: CandidateView["state"]): string {
  return ({ unresolved_identity: "Unresolved", discovered: "Discovered", not_selected: "Not selected", researching: "Researching", shortlisted: "Shortlisted", eligible_not_shortlisted: "Investigated", excluded: "Excluded", needs_evidence: "Needs evidence", research_error: "Needs follow-up" } as const)[state];
}
function levelLabel(level: "strong" | "mixed" | "weak" | "unknown"): string { return ({ strong: "Strong", mixed: "Mixed", weak: "Weak", unknown: "Unknown" } as const)[level]; }
