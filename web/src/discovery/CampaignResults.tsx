import { useMemo, useState } from "react";

import type { CandidateView, CampaignEvent, RunRecord, RunView } from "../../../services/discovery/src/types.ts";
import { CandidateCard } from "./CandidateCard.tsx";

type Tab = "shortlist" | "investigated" | "unresolved";

export function CampaignResults({
  run,
  candidates,
  events,
  comparison,
}: {
  run: RunView;
  candidates: CandidateView[];
  events: CampaignEvent[];
  comparison?: { run: RunRecord | RunView; candidates: CandidateView[] } | null;
}) {
  const [tab, setTab] = useState<Tab>("shortlist");
  const candidateSet = useMemo(() => uniqueCandidates([...run.shortlist, ...candidates]), [run.shortlist, candidates]);
  const shortlist = candidateSet.filter((candidate) => candidate.state === "shortlisted");
  const investigated = candidateSet.filter((candidate) => candidate.assessment !== null && candidate.state !== "shortlisted");
  const unresolved = candidateSet.filter((candidate) => candidate.state === "not_selected" || candidate.state === "unresolved_identity" || candidate.state === "needs_evidence" || candidate.state === "research_error");
  const rows = tab === "shortlist" ? shortlist : tab === "investigated" ? investigated : unresolved;
  return (
    <section aria-labelledby="campaign-results-heading" className="space-y-4">
      <div><h2 id="campaign-results-heading" className="text-base font-semibold text-fg">Research results</h2><p className="text-sm text-muted">{shortlist.length} shortlisted from the companies assessed so far.</p></div>
      <div role="tablist" aria-label="Research result groups" className="flex flex-wrap gap-2 border-b border-line pb-2">
        <ResultTab active={tab === "shortlist"} label={`Shortlist (${shortlist.length})`} onClick={() => setTab("shortlist")} />
        <ResultTab active={tab === "investigated"} label={`Investigated (${investigated.length})`} onClick={() => setTab("investigated")} />
        <ResultTab active={tab === "unresolved"} label={`Not selected & unresolved (${unresolved.length})`} onClick={() => setTab("unresolved")} />
      </div>
      <div role="tabpanel" aria-label={`${tab} results`} className="space-y-3">{rows.length ? rows.map((candidate) => <CandidateCard key={candidate.candidate_id} candidate={candidate} />) : <p className="rounded-md border border-dashed border-line p-4 text-sm text-muted">{emptyCopy(tab, run)}</p>}</div>
      <Comparison run={run} comparison={comparison ?? null} />
      <details className="rounded-md border border-line p-3"><summary className="cursor-pointer text-sm font-medium text-fg">Research trail</summary>{events.length ? <ol className="mt-3 space-y-2">{events.map((event) => <li key={event.sequence} className="text-sm text-muted">{event.summary}</li>)}</ol> : <p className="mt-2 text-sm text-muted">Activity will appear here as research progresses.</p>}</details>
    </section>
  );
}

function ResultTab({ active, label, onClick }: { active: boolean; label: string; onClick(): void }) { return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={active ? "rounded-md bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent" : "rounded-md px-3 py-1.5 text-sm text-muted hover:bg-surface-2"}>{label}</button>; }
function emptyCopy(tab: Tab, run: RunView): string { if (tab === "shortlist" && run.status === "completed") return "No companies met the shortlist criteria in this run."; if (tab === "shortlist") return "No companies are shortlisted yet."; return tab === "investigated" ? "No additional investigated companies are available yet." : "No companies in this group are available yet."; }
function uniqueCandidates(candidates: CandidateView[]): CandidateView[] { return [...new Map(candidates.map((candidate) => [candidate.candidate_id, candidate])).values()]; }

function Comparison({ run, comparison }: { run: RunView; comparison: { run: RunRecord | RunView; candidates: CandidateView[] } | null }) {
  if (!comparison) return null;
  if (comparison.run.brief_id !== run.brief_id) return <section aria-label="Run comparison" className="rounded-md border border-line p-3"><h3 className="text-sm font-semibold text-fg">Different research question</h3><p className="mt-1 text-sm text-muted">These runs used different saved briefs, so their rankings are not compared.</p></section>;
  const current = issuerMap(run.shortlist);
  const prior = issuerMap(comparison.candidates);
  const added = [...current.entries()].filter(([issuer]) => !prior.has(issuer)).sort(([left], [right]) => left.localeCompare(right)).map(([, candidate]) => candidate.name);
  const removed = [...prior.entries()].filter(([issuer]) => !current.has(issuer)).sort(([left], [right]) => left.localeCompare(right)).map(([, candidate]) => candidate.name);
  return <section aria-label="Run comparison" className="rounded-md border border-line p-3"><h3 className="text-sm font-semibold text-fg">Same brief comparison</h3><p className="mt-1 text-sm text-muted">Companies are compared by issuer identity.</p><p className="mt-2 text-sm text-fg">Added: {added.length ? added.join(", ") : "None"}</p><p className="text-sm text-fg">No longer shortlisted: {removed.length ? removed.join(", ") : "None"}</p></section>;
}
function issuerMap(candidates: CandidateView[]): Map<string, CandidateView> { return new Map(candidates.filter((candidate) => candidate.identity !== null).map((candidate) => [candidate.identity!.issuer_id, candidate])); }
