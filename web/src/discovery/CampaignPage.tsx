import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import type { CandidateView, CampaignDetail, RunRecord, SavedBrief } from "../../../services/discovery/src/types.ts";
import { useAuth } from "../shell/useAuth.ts";
import { BriefEditor, type BriefSave } from "./BriefEditor.tsx";
import { cancelRun, discoveryMessage, getCampaign, getRun, listCandidates, listEvents, listRuns, saveBrief, startRun } from "./api.ts";
import { CampaignResults } from "./CampaignResults.tsx";
import { RunProgress } from "./RunProgress.tsx";
import { useCampaignRun } from "./useCampaignRun.ts";

export function CampaignPage() {
  const { session } = useAuth();
  const { campaignId = "", runId: routeRunId } = useParams<{ campaignId: string; runId?: string }>();
  const navigate = useNavigate();
  const userId = session?.userId ?? null;
  const [detailState, setDetailState] = useState<{ campaignId: string; detail: CampaignDetail } | null>(null);
  const [pageError, setPageError] = useState<{ campaignId: string; message: string } | null>(null);
  const [selectedState, setSelectedState] = useState<{ campaignId: string; runId: string | null }>({ campaignId, runId: routeRunId ?? null });
  const [refreshKey, setRefreshKey] = useState(0);
  const [resultState, setResultState] = useState<{ runId: string; candidates: CandidateView[]; events: CampaignResultsProps["events"] } | null>(null);
  const [runsState, setRunsState] = useState<{ campaignId: string; runs: RunRecord[] } | null>(null);
  const [comparisonChoice, setComparisonChoice] = useState<{ campaignId: string; runId: string }>({ campaignId, runId: "" });
  const [comparisonState, setComparisonState] = useState<{ campaignId: string; runId: string; comparison: CampaignResultsProps["comparison"] } | null>(null);
  const startInFlight = useRef(false);
  const retryKey = useRef<string | null>(null);

  const detail = detailState?.campaignId === campaignId ? detailState.detail : null;
  const scopedError = pageError?.campaignId === campaignId ? pageError.message : null;
  const selectedRunId = routeRunId ?? (selectedState.campaignId === campaignId ? selectedState.runId : null) ?? detail?.latest_run?.run_id ?? null;
  const comparisonId = comparisonChoice.campaignId === campaignId ? comparisonChoice.runId : "";
  const comparison = comparisonState?.campaignId === campaignId && comparisonState.runId === comparisonId ? comparisonState.comparison : null;

  useEffect(() => {
    if (!userId || !campaignId) return;
    const controller = new AbortController();
    getCampaign({ userId, campaignId, signal: controller.signal })
      .then((next) => { if (!controller.signal.aborted) setDetailState({ campaignId, detail: next }); })
      .catch((error) => { if (!controller.signal.aborted) setPageError({ campaignId, message: discoveryMessage(error, "This campaign could not be loaded.") }); });
    return () => controller.abort();
  }, [userId, campaignId, refreshKey]);

  useEffect(() => {
    if (!userId || !campaignId) return;
    let current = true;
    listRuns({ userId, campaignId }).then((page) => { if (current) setRunsState({ campaignId, runs: page.items }); }).catch(() => { if (current) setRunsState({ campaignId, runs: [] }); });
    return () => { current = false; };
  }, [userId, campaignId, refreshKey]);

  const { run, error: pollingError } = useCampaignRun({ userId: userId ?? "", runId: userId ? selectedRunId : null, refreshKey });

  useEffect(() => {
    if (!userId || !selectedRunId) return;
    const controller = new AbortController();
    Promise.all([
      listCandidates({ userId, runId: selectedRunId, signal: controller.signal }),
      listEvents({ userId, runId: selectedRunId, signal: controller.signal }),
    ]).then(([candidatePage, eventPage]) => {
      if (!controller.signal.aborted) setResultState({ runId: selectedRunId, candidates: candidatePage.items, events: eventPage.items });
    }).catch(() => undefined);
    return () => controller.abort();
  }, [userId, selectedRunId, refreshKey]);

  useEffect(() => {
    if (!userId || !comparisonId) return;
    const controller = new AbortController();
    Promise.all([getRun({ userId, runId: comparisonId, signal: controller.signal }), listCandidates({ userId, runId: comparisonId, signal: controller.signal })])
      .then(([nextRun, candidatePage]) => { if (!controller.signal.aborted) setComparisonState({ campaignId, runId: comparisonId, comparison: { run: nextRun, candidates: candidatePage.items } }); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [userId, campaignId, comparisonId]);

  async function onSave(body: BriefSave): Promise<SavedBrief> {
    if (!userId) throw new Error("signed out");
    const saved = await saveBrief({ userId, campaignId, expectedVersion: body.expectedVersion, brief: body.brief });
    setDetailState((current) => current?.campaignId === campaignId ? { campaignId, detail: { ...current.detail, brief: saved } } : current);
    setRefreshKey((key) => key + 1);
    return saved;
  }

  async function onApprove(saved: SavedBrief) {
    if (!userId || startInFlight.current) return;
    startInFlight.current = true;
    const requestKey = retryKey.current ?? newId();
    retryKey.current = requestKey;
    setPageError(null);
    try {
      const started = await startRun({ userId, campaignId, briefVersion: saved.version, briefHash: saved.hash, requestKey });
      retryKey.current = null;
      setSelectedState({ campaignId, runId: started.run_id });
      setRefreshKey((key) => key + 1);
      navigate(`/discovery/${encodeURIComponent(campaignId)}/runs/${encodeURIComponent(started.run_id)}`);
    } catch (error) {
      setPageError({ campaignId, message: discoveryMessage(error, "Research could not start. Your brief is still available to retry.") });
      throw error;
    } finally {
      startInFlight.current = false;
    }
  }

  async function onCancel() {
    if (!userId || !selectedRunId) return;
    setPageError(null);
    try {
      await cancelRun({ userId, runId: selectedRunId });
      setRefreshKey((key) => key + 1);
    } catch (error) {
      setPageError({ campaignId, message: discoveryMessage(error, "The cancellation request could not be sent.") });
    }
  }

  if (!userId) return <div className="p-4 text-sm text-muted">Sign in to manage research campaigns.</div>;
  if (!detail && !scopedError) return <div className="p-4 text-sm text-muted">Loading campaign…</div>;
  if (!detail) return <div className="p-4 text-sm text-negative" role="alert">{scopedError}</div>;
  const results = resultState?.runId === selectedRunId ? resultState : null;
  return <main className="space-y-5 p-4"><header><p className="text-sm text-muted">Discovery campaign</p><h1 className="text-xl font-semibold text-fg">{detail.campaign.name}</h1><p className="mt-1 text-sm text-muted">{detail.campaign.question}</p></header>{!detail.readiness.ready ? <p role="alert" className="rounded-md border border-line p-3 text-sm text-muted">Research setup needs attention before a run can start.</p> : null}<BriefEditor key={campaignId} campaignId={campaignId} savedBrief={detail.brief} fallbackQuestion={detail.campaign.question} onSave={onSave} onApprove={detail.readiness.ready ? onApprove : undefined} />{scopedError ? <p role="alert" className="text-sm text-negative">{scopedError}</p> : null}{pollingError ? <p role="status" className="text-sm text-muted">Progress could not be refreshed. Showing the last available update.</p> : null}{run ? <><RunProgress run={run} onCancel={onCancel} /><CampaignResults run={run} candidates={results?.candidates ?? []} events={results?.events ?? []} comparison={comparison} />{(runsState?.campaignId === campaignId && runsState.runs.length > 1) ? <label className="grid max-w-md gap-1 text-sm text-fg">Compare with another run<select aria-label="Compare with another run" value={comparisonId} onChange={(event) => { setComparisonChoice({ campaignId, runId: event.target.value }); setComparisonState(null); }} className="rounded-md border border-line bg-surface-2 px-3 py-2"><option value="">Choose a run</option>{runsState.runs.filter((item) => item.run_id !== run.run_id).map((item) => <option key={item.run_id} value={item.run_id}>{runLabel(item)}</option>)}</select></label> : null}</> : selectedRunId ? <p className="text-sm text-muted">Loading research run…</p> : null}</main>;
}

type CampaignResultsProps = Parameters<typeof CampaignResults>[0];
function runLabel(run: RunRecord): string { return `${run.status} · ${new Date(run.started_at ?? run.finished_at ?? 0).toLocaleDateString()}`; }
function newId(): string { return globalThis.crypto?.randomUUID?.() ?? `00000000-0000-4000-8000-${Math.random().toString(16).slice(2).padEnd(12, "0").slice(0, 12)}`; }
