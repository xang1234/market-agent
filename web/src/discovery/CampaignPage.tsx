import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import type { CandidateView, CampaignDetail, RunRecord, RunView, SavedBrief } from "../../../services/discovery/src/types.ts";
import { useAuth } from "../shell/useAuth.ts";
import { BriefEditor, type BriefDraft, type BriefSave } from "./BriefEditor.tsx";
import { cancelRun, discoveryMessage, draftBrief, getCampaign, getRun, listCandidates, listEvents, listRuns, saveBrief, startRun } from "./api.ts";
import { CampaignResults } from "./CampaignResults.tsx";
import { formatCampaignMarkdown } from "./export.ts";
import { readAuthorizedResearchView, researchHandoffForCandidate, researchSummaryForCandidate } from "./handoff.ts";
import { RunProgress } from "./RunProgress.tsx";
import { useCampaignRun } from "./useCampaignRun.ts";
import { analyzeEntryFromResearchSummary } from "../analyze/analyzeEntry.ts";

export function CampaignPage() {
  const { session } = useAuth();
  const { campaignId = "", runId: routeRunId } = useParams<{ campaignId: string; runId?: string }>();
  const navigate = useNavigate();
  const userId = session?.userId ?? null;
  const [detailState, setDetailState] = useState<{ userId: string; campaignId: string; detail: CampaignDetail } | null>(null);
  const [pageError, setPageError] = useState<{ userId: string; campaignId: string; message: string } | null>(null);
  const [selectedState, setSelectedState] = useState<{ userId: string | null; campaignId: string; runId: string | null }>({ userId, campaignId, runId: routeRunId ?? null });
  const [refreshKey, setRefreshKey] = useState(0);
  const [resultRefreshKey, setResultRefreshKey] = useState(0);
  const [resultState, setResultState] = useState<{ userId: string; runId: string; candidates: CandidateView[]; events: CampaignResultsProps["events"]; nextSequence: number; hasMoreEvents: boolean } | null>(null);
  const [runsState, setRunsState] = useState<{ userId: string; campaignId: string; runs: RunRecord[] } | null>(null);
  const [comparisonChoice, setComparisonChoice] = useState<{ userId: string | null; campaignId: string; runId: string }>({ userId, campaignId, runId: "" });
  const [comparisonState, setComparisonState] = useState<{ userId: string; campaignId: string; runId: string; comparison: CampaignResultsProps["comparison"] } | null>(null);
  const [cancellingRun, setCancellingRun] = useState<{ userId: string; runId: string } | null>(null);
  const [actionStatus, setActionStatus] = useState<{ userId: string; message: string } | null>(null);
  const [exportState, setExportState] = useState<{ campaignId: string; runId: string; userId: string; markdown: string } | null>(null);
  const startRequestKeys = useRef(new Map<string, string>());
  const startController = useRef<{ campaignId: string; userId: string; routeRunId: string | null; controller: AbortController } | null>(null);
  const draftController = useRef<{ campaignId: string; userId: string; controller: AbortController } | null>(null);
  const cancellingRunRef = useRef<{ userId: string; runId: string } | null>(null);
  const researchActionController = useRef<AbortController | null>(null);
  const routeIdentity = useRef({ campaignId, userId, routeRunId: routeRunId ?? null, selectedRunId: null as string | null });

  const detail = detailState?.userId === userId && detailState.campaignId === campaignId ? detailState.detail : null;
  const scopedError = pageError?.userId === userId && pageError.campaignId === campaignId ? pageError.message : null;
  const selectedRunId = routeRunId ?? (selectedState.userId === userId && selectedState.campaignId === campaignId ? selectedState.runId : null) ?? detail?.latest_run?.run_id ?? null;
  const comparisonId = comparisonChoice.userId === userId && comparisonChoice.campaignId === campaignId ? comparisonChoice.runId : "";
  const comparison = comparisonState?.userId === userId && comparisonState.campaignId === campaignId && comparisonState.runId === comparisonId ? comparisonState.comparison : null;
  const scopedActionStatus = actionStatus?.userId === userId ? actionStatus.message : null;

  useEffect(() => {
    if (!userId || !campaignId) return;
    const controller = new AbortController();
    getCampaign({ userId, campaignId, signal: controller.signal })
      .then((next) => { if (!controller.signal.aborted) setDetailState({ userId, campaignId, detail: next }); })
      .catch((error) => { if (!controller.signal.aborted) setPageError({ userId, campaignId, message: discoveryMessage(error, "This campaign could not be loaded.") }); });
    return () => controller.abort();
  }, [userId, campaignId, refreshKey]);

  useEffect(() => {
    return () => {
      setExportState(null);
      const pending = startController.current;
      if (pending?.campaignId === campaignId && pending.userId === userId && pending.routeRunId === (routeRunId ?? null)) {
        pending.controller.abort();
        startController.current = null;
      }
      const pendingDraft = draftController.current;
      if (pendingDraft?.campaignId === campaignId && pendingDraft.userId === userId) {
        pendingDraft.controller.abort();
        draftController.current = null;
      }
      researchActionController.current?.abort();
      researchActionController.current = null;
    };
  }, [campaignId, userId, routeRunId, selectedRunId]);

  useEffect(() => {
    routeIdentity.current = { campaignId, userId, routeRunId: routeRunId ?? null, selectedRunId };
  }, [campaignId, userId, routeRunId, selectedRunId]);

  useEffect(() => {
    if (!userId || !campaignId) return;
    let current = true;
    listRuns({ userId, campaignId }).then((page) => { if (current) setRunsState({ userId, campaignId, runs: page.items }); }).catch(() => { if (current) setRunsState({ userId, campaignId, runs: [] }); });
    return () => { current = false; };
  }, [userId, campaignId, refreshKey]);

  const onAcceptedRun = useCallback(() => {
    setResultRefreshKey((key) => key + 1);
  }, []);
  const { run: polledRun, error: pollingError } = useCampaignRun({ userId: userId ?? "", runId: userId ? selectedRunId : null, refreshKey, onAcceptedRun });
  const run = polledRun?.campaign_id === campaignId ? polledRun : null;

  useEffect(() => {
    if (!userId || !selectedRunId) return;
    let disposed = false;
    let controller: AbortController | null = null;
    const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
    const refresh = () => {
      if (disposed || hidden()) return;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      Promise.all([
        listCandidates({ userId, runId: selectedRunId, signal: request.signal }),
        listEvents({ userId, runId: selectedRunId, signal: request.signal }),
      ]).then(([candidatePage, eventPage]) => {
        if (!disposed && !request.signal.aborted && controller === request) setResultState({ userId, runId: selectedRunId, candidates: candidatePage.items, events: eventPage.items, nextSequence: eventPage.next_sequence, hasMoreEvents: eventPage.has_more });
      }).catch(() => undefined);
    };
    const onVisibilityChange = () => { if (hidden()) controller?.abort(); else refresh(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    refresh();
    return () => { disposed = true; document.removeEventListener("visibilitychange", onVisibilityChange); controller?.abort(); };
  }, [userId, selectedRunId, refreshKey, resultRefreshKey]);

  function onLoadMoreEvents(): void {
    if (!userId || !selectedRunId || resultState?.userId !== userId || resultState.runId !== selectedRunId || !resultState.hasMoreEvents) return;
    const runId = selectedRunId;
    const after = resultState.nextSequence;
    void listEvents({ userId, runId, after }).then((page) => {
      if (routeIdentity.current.campaignId !== campaignId || routeIdentity.current.userId !== userId) return;
      setResultState((current) => current?.userId === userId && current.runId === runId ? {
        ...current,
        events: mergeEvents(current.events, page.items),
        nextSequence: page.next_sequence,
        hasMoreEvents: page.has_more,
      } : current);
    }).catch(() => undefined);
  }

  useEffect(() => {
    if (!userId || !comparisonId) return;
    const controller = new AbortController();
    getRun({ userId, runId: comparisonId, signal: controller.signal })
      .then((nextRun) => { if (!controller.signal.aborted) setComparisonState({ userId, campaignId, runId: comparisonId, comparison: { run: nextRun } }); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [userId, campaignId, comparisonId]);

  async function onSave(body: BriefSave): Promise<SavedBrief> {
    if (!userId) throw new Error("signed out");
    const saved = await saveBrief({ userId, campaignId, expectedVersion: body.expectedVersion, brief: body.brief });
    setDetailState((current) => current?.userId === userId && current.campaignId === campaignId ? { userId, campaignId, detail: { ...current.detail, brief: saved } } : current);
    setRefreshKey((key) => key + 1);
    return saved;
  }

  async function onDraft(body: BriefDraft) {
    if (!userId) throw new Error("signed out");
    if (draftController.current) throw new Error("A research brief is already being generated.");
    const actionUserId = userId;
    const actionCampaignId = campaignId;
    const controller = new AbortController();
    draftController.current = { campaignId: actionCampaignId, userId: actionUserId, controller };
    setPageError(null);
    try {
      const proposal = await draftBrief({ userId: actionUserId, campaignId: actionCampaignId, expectedVersion: body.expectedVersion, signal: controller.signal });
      if (controller.signal.aborted || routeIdentity.current.campaignId !== actionCampaignId || routeIdentity.current.userId !== actionUserId) {
        throw new DOMException("This research brief request was cancelled because the campaign changed.", "AbortError");
      }
      return proposal;
    } finally {
      if (draftController.current?.controller === controller) draftController.current = null;
    }
  }

  async function onApprove(saved: SavedBrief) {
    if (!userId || startController.current) return;
    const controller = new AbortController();
    const startedFromRunId = routeRunId ?? null;
    startController.current = { campaignId, userId, routeRunId: startedFromRunId, controller };
    const requestScope = `${userId}:${campaignId}`;
    const requestKey = startRequestKeys.current.get(requestScope) ?? newId();
    startRequestKeys.current.set(requestScope, requestKey);
    setPageError(null);
    try {
      const started = await startRun({ userId, campaignId, briefVersion: saved.version, briefHash: saved.hash, requestKey, signal: controller.signal });
      if (controller.signal.aborted || routeIdentity.current.campaignId !== campaignId || routeIdentity.current.userId !== userId || routeIdentity.current.routeRunId !== startedFromRunId) return;
      startRequestKeys.current.delete(requestScope);
      setSelectedState({ userId, campaignId, runId: started.run_id });
      setRefreshKey((key) => key + 1);
      navigate(`/discovery/${encodeURIComponent(campaignId)}/runs/${encodeURIComponent(started.run_id)}`);
    } catch (error) {
      if (controller.signal.aborted || routeIdentity.current.campaignId !== campaignId || routeIdentity.current.userId !== userId || routeIdentity.current.routeRunId !== startedFromRunId) return;
      setPageError({ userId, campaignId, message: discoveryMessage(error, "Research could not start. Your brief is still available to retry.") });
      throw error;
    } finally {
      if (startController.current?.controller === controller) startController.current = null;
    }
  }

  async function onCancel() {
    if (!userId || !selectedRunId || (cancellingRunRef.current?.userId === userId && cancellingRunRef.current.runId === selectedRunId)) return;
    const cancellingId = selectedRunId;
    const cancellation = { userId, runId: cancellingId };
    cancellingRunRef.current = cancellation;
    setCancellingRun(cancellation);
    setPageError(null);
    try {
      await cancelRun({ userId, runId: cancellingId });
      if (routeIdentity.current.campaignId === campaignId && routeIdentity.current.userId === userId) setRefreshKey((key) => key + 1);
    } catch (error) {
      if (routeIdentity.current.campaignId === campaignId && routeIdentity.current.userId === userId) setPageError({ userId, campaignId, message: discoveryMessage(error, "The cancellation request could not be sent.") });
    } finally {
      if (cancellingRunRef.current === cancellation) cancellingRunRef.current = null;
      setCancellingRun((current) => current === cancellation ? null : current);
    }
  }

  async function readFreshResearch() {
    if (!userId || !selectedRunId) throw new Error('This research run is no longer available.')
    const actionUserId = userId;
    const actionRunId = selectedRunId;
    const actionRouteRunId = routeRunId ?? null;
    const controller = new AbortController();
    researchActionController.current?.abort();
    researchActionController.current = controller;
    try {
      const view = await readAuthorizedResearchView({
        userId: actionUserId,
        campaignId,
        runId: actionRunId,
        signal: controller.signal,
        getRun,
        listCandidates: async (args) => (await listCandidates(args)).items,
      });
      if (
        controller.signal.aborted
        || routeIdentity.current.campaignId !== campaignId
        || routeIdentity.current.userId !== actionUserId
        || routeIdentity.current.routeRunId !== actionRouteRunId
        || routeIdentity.current.selectedRunId !== actionRunId
      ) throw new Error('This research action was cancelled because the selected run changed.')
      return view;
    } finally {
      if (researchActionController.current === controller) researchActionController.current = null;
    }
  }

  async function withFreshCandidate(candidate: CandidateView, action: (fresh: CandidateView, run: RunView) => void): Promise<void> {
    if (!userId) return;
    const actionUserId = userId;
    try {
      setActionStatus({ userId: actionUserId, message: 'Checking current research access…' });
      const view = await readFreshResearch();
      const fresh = view.candidates.find((item) => item.candidate_id === candidate.candidate_id);
      if (!fresh) throw new Error('This company is no longer available for the selected research run.')
      action(fresh, view.run);
      setActionStatus(null);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setActionStatus({ userId: actionUserId, message: error instanceof Error ? `Research access changed; action cancelled. ${error.message}` : 'Research access changed; action cancelled.' });
    }
  }

  async function onCopyExport(): Promise<void> {
    try {
      if (!userId) throw new Error('This research run is no longer available.');
      setActionStatus({ userId, message: 'Checking current research access…' });
      const actionCampaignId = campaignId;
      const actionRunId = selectedRunId;
      const actionUserId = userId;
      const actionRouteRunId = routeRunId ?? null;
      if (!actionUserId || !actionRunId) throw new Error('This research run is no longer available.');
      const view = await readFreshResearch();
      const markdown = formatCampaignMarkdown(view);
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(markdown);
      if (
        routeIdentity.current.campaignId !== actionCampaignId
        || routeIdentity.current.userId !== actionUserId
        || routeIdentity.current.routeRunId !== actionRouteRunId
        || routeIdentity.current.selectedRunId !== actionRunId
      ) throw new Error('This research action was cancelled because the selected run changed.');
      setExportState({ campaignId: actionCampaignId, runId: actionRunId, userId: actionUserId, markdown });
      setActionStatus({ userId: actionUserId, message: 'Cited research export is ready.' });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (userId) setActionStatus({ userId, message: error instanceof Error ? `Research access changed; export cancelled. ${error.message}` : 'Research access changed; export cancelled.' });
    }
  }

  function onOpenInAnalyze(candidate: CandidateView): void {
    void withFreshCandidate(candidate, (fresh, freshRun) => {
      const summary = researchSummaryForCandidate(freshRun, fresh);
      if (!summary) throw new Error('A canonical listing identity is required before Analyze can open this research.')
      const entry = analyzeEntryFromResearchSummary(summary, fresh.name);
      navigate(entry.to, { state: entry.state });
    });
  }

  function onDraftThesis(candidate: CandidateView): void {
    void withFreshCandidate(candidate, (fresh, freshRun) => {
      if (!fresh.can_promote) throw new Error('Permission to promote this research has changed.')
      const handoff = researchHandoffForCandidate(freshRun, fresh);
      if (!handoff) throw new Error('A canonical listing identity is required before drafting a thesis.')
      navigate('/agents', { state: { researchHandoff: handoff } });
    });
  }

  if (!userId) return <div className="p-4 text-sm text-muted">Sign in to manage research campaigns.</div>;
  if (!detail && !scopedError) return <div className="p-4 text-sm text-muted">Loading campaign…</div>;
  if (!detail) return <div className="p-4 text-sm text-negative" role="alert">{scopedError}</div>;
  const results = resultState?.userId === userId && resultState.runId === selectedRunId ? resultState : null;
  const exportMarkdown = exportState?.campaignId === campaignId && exportState.runId === selectedRunId && exportState.userId === userId ? exportState.markdown : null;
  const canDraft = !detail.readiness.missing.includes("model");
  return <main className="space-y-5 p-4"><header><p className="text-sm text-muted">Discovery campaign</p><h1 className="text-xl font-semibold text-fg">{detail.campaign.name}</h1><p className="mt-1 text-sm text-muted">{detail.campaign.question}</p></header>{!detail.readiness.ready ? <p role="alert" className="rounded-md border border-line p-3 text-sm text-muted">{readinessMessage(detail.readiness.missing)}</p> : null}<BriefEditor key={`${userId}:${campaignId}`} campaignId={campaignId} savedBrief={detail.brief} fallbackQuestion={detail.campaign.question} onSave={onSave} onDraft={canDraft ? onDraft : undefined} draftDisabledReason={canDraft ? undefined : "Research-brief generation needs the model capability."} onApprove={detail.readiness.ready ? onApprove : undefined} />{scopedError ? <p role="alert" className="text-sm text-negative">{scopedError}</p> : null}{pollingError ? <p role="status" className="text-sm text-muted">Progress could not be refreshed. Showing the last available update.</p> : null}{run ? <><RunProgress run={run} onCancel={onCancel} cancelling={cancellingRun?.userId === userId && cancellingRun.runId === selectedRunId} /><CampaignResults run={run} candidates={results?.candidates ?? []} events={results?.events ?? []} comparison={comparison} onCopyExport={() => void onCopyExport()} onOpenInAnalyze={onOpenInAnalyze} onDraftThesis={onDraftThesis} actionStatus={scopedActionStatus} hasMoreEvents={results?.hasMoreEvents} onLoadMoreEvents={onLoadMoreEvents} />{exportMarkdown ? <label className="grid gap-1 text-sm text-fg">Cited research export<textarea aria-label="Cited research export" readOnly value={exportMarkdown} rows={12} className="rounded-md border border-line bg-surface-2 p-3 font-mono text-xs" /></label> : null}{(runsState?.userId === userId && runsState.campaignId === campaignId && runsState.runs.length > 1) ? <label className="grid max-w-md gap-1 text-sm text-fg">Compare with another run<select aria-label="Compare with another run" value={comparisonId} onChange={(event) => { setComparisonChoice({ userId, campaignId, runId: event.target.value }); setComparisonState(null); }} className="rounded-md border border-line bg-surface-2 px-3 py-2"><option value="">Choose a run</option>{runsState.runs.filter((item) => item.run_id !== run.run_id).map((item) => <option key={item.run_id} value={item.run_id}>{runLabel(item)}</option>)}</select></label> : null}</> : selectedRunId ? <p className="text-sm text-muted">Loading research run…</p> : null}</main>;
}

function readinessMessage(missing: CampaignDetail["readiness"]["missing"]): string {
  if (missing.length === 0) return "Research setup needs attention before a run can start.";
  return `Research cannot start until ${missing.join(missing.length === 2 ? " and " : ", ")} ${missing.length === 1 ? "is" : "are"} configured.`;
}

type CampaignResultsProps = Parameters<typeof CampaignResults>[0];
function runLabel(run: RunRecord): string { return `${run.status} · ${new Date(run.started_at ?? run.finished_at ?? 0).toLocaleDateString()}`; }
function mergeEvents(current: CampaignResultsProps["events"], more: CampaignResultsProps["events"]): CampaignResultsProps["events"] { return [...new Map([...current, ...more].map((event) => [event.sequence, event])).values()].sort((left, right) => left.sequence - right.sequence); }
function newId(): string { return globalThis.crypto?.randomUUID?.() ?? `00000000-0000-4000-8000-${Math.random().toString(16).slice(2).padEnd(12, "0").slice(0, 12)}`; }
