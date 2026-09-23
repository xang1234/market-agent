import { useMemo, useState } from "react";

import type { CandidateView, CampaignEvent, RunView } from "../../../services/discovery/src/types.ts";
import { CandidateCard } from "./CandidateCard.tsx";
import { ResearchTrail } from "./ResearchTrail.tsx";

type Tab = "shortlist" | "investigated" | "unresolved";

const INCOMPLETE_STATES: ReadonlySet<CandidateView["state"]> = new Set(["discovered", "researching", "not_selected", "unresolved_identity", "needs_evidence", "research_error"]);

export function CampaignResults({
  run,
  candidates,
  events,
  comparison,
  onCopyExport,
  onOpenInAnalyze,
  onDraftThesis,
  actionStatus,
  hasMoreEvents,
  onLoadMoreEvents,
}: {
  run: RunView;
  candidates: CandidateView[];
  events: CampaignEvent[];
  comparison?: { run: RunView; candidates?: CandidateView[] } | null;
  onCopyExport?: () => void;
  onOpenInAnalyze?: (candidate: CandidateView) => void;
  onDraftThesis?: (candidate: CandidateView) => void;
  actionStatus?: string | null;
  hasMoreEvents?: boolean;
  onLoadMoreEvents?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("shortlist");
  const candidateSet = useMemo(() => uniqueCandidates([...run.shortlist, ...candidates]), [run.shortlist, candidates]);
  const shortlist = candidateSet.filter((candidate) => candidate.state === "shortlisted");
  const investigated = candidateSet.filter((candidate) => candidate.assessment !== null && candidate.state !== "shortlisted");
  // Interrupted runs (cancelled, deadline, systemic failure) leave untouched rows
  // in discovered/researching; they belong with other incomplete companies.
  const unresolved = candidateSet.filter((candidate) => INCOMPLETE_STATES.has(candidate.state));
  const rows = tab === "shortlist" ? shortlist : tab === "investigated" ? investigated : unresolved;
  return (
    <section aria-labelledby="campaign-results-heading" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="campaign-results-heading" className="text-base font-semibold text-fg">Research results</h2><p className="text-sm text-muted">{shortlist.length} shortlisted from the companies assessed so far.</p></div>{onCopyExport ? <button type="button" onClick={onCopyExport} className="rounded-md border border-line-strong px-3 py-1.5 text-sm font-medium text-fg">Copy cited shortlist</button> : null}</div>
      {actionStatus ? <p role="status" className="text-sm text-muted">{actionStatus}</p> : null}
      <div aria-label="Research result groups" className="flex flex-wrap gap-2 border-b border-line pb-2">
        <ResultTab active={tab === "shortlist"} label={`Shortlist (${shortlist.length})`} onClick={() => setTab("shortlist")} />
        <ResultTab active={tab === "investigated"} label={`Investigated (${investigated.length})`} onClick={() => setTab("investigated")} />
        <ResultTab active={tab === "unresolved"} label={`Incomplete & not selected (${unresolved.length})`} onClick={() => setTab("unresolved")} />
      </div>
      <div aria-label={`${tab} results`} className="space-y-3">{rows.length ? rows.map((candidate) => <CandidateCard key={candidate.candidate_id} candidate={candidate} onOpenInAnalyze={onOpenInAnalyze} onDraftThesis={onDraftThesis} />) : <p className="rounded-md border border-dashed border-line p-4 text-sm text-muted">{emptyCopy(tab, run)}</p>}</div>
      <Comparison run={run} comparison={comparison ?? null} />
      <details className="rounded-md border border-line p-3"><summary className="cursor-pointer text-sm font-medium text-fg">Research trail</summary><ResearchTrail events={events} hasMore={hasMoreEvents} onLoadMore={onLoadMoreEvents} /></details>
    </section>
  );
}

function ResultTab({ active, label, onClick }: { active: boolean; label: string; onClick(): void }) { return <button type="button" aria-pressed={active} onClick={onClick} className={active ? "rounded-md bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent" : "rounded-md px-3 py-1.5 text-sm text-muted hover:bg-surface-2"}>{label}</button>; }
function emptyCopy(tab: Tab, run: RunView): string { if (tab === "shortlist" && run.status === "completed") return "No companies met the shortlist criteria in this run."; if (tab === "shortlist") return "No companies are shortlisted yet."; return tab === "investigated" ? "No additional investigated companies are available yet." : "No companies in this group are available yet."; }
function uniqueCandidates(candidates: CandidateView[]): CandidateView[] { return [...new Map(candidates.map((candidate) => [candidate.candidate_id, candidate])).values()]; }

function Comparison({ run, comparison }: { run: RunView; comparison: { run: RunView; candidates?: CandidateView[] } | null }) {
  if (!comparison) return null;
  if (comparison.run.brief_id !== run.brief_id) return <section aria-label="Run comparison" className="rounded-md border border-line p-3"><h3 className="text-sm font-semibold text-fg">Different research question</h3><p className="mt-1 text-sm text-muted">These runs used different saved briefs, so their rankings are not compared.</p></section>;
  const current = issuerMap(run.shortlist);
  const prior = issuerMap(comparison.run.shortlist);
  const added = [...current.entries()].filter(([issuer]) => !prior.has(issuer)).sort(([left], [right]) => left.localeCompare(right)).map(([, candidate]) => candidate.name);
  const removed = [...prior.entries()].filter(([issuer]) => !current.has(issuer)).sort(([left], [right]) => left.localeCompare(right)).map(([, candidate]) => candidate.name);
  return <section aria-label="Run comparison" className="rounded-md border border-line p-3"><h3 className="text-sm font-semibold text-fg">Same brief comparison</h3><p className="mt-1 text-sm text-muted">Companies are compared by issuer identity.</p><p className="mt-2 text-sm text-fg">Added: {added.length ? added.join(", ") : "None"}</p><p className="text-sm text-fg">No longer shortlisted: {removed.length ? removed.join(", ") : "None"}</p></section>;
}
function issuerMap(candidates: CandidateView[]): Map<string, CandidateView> { return new Map(candidates.filter((candidate) => candidate.identity !== null).map((candidate) => [candidate.identity!.issuer_id, candidate])); }
