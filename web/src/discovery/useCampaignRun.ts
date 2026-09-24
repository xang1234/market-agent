import { useEffect, useState } from "react";

import type { RunStatus, RunView } from "../../../services/discovery/src/types.ts";
import { getRun } from "./api.ts";

const TERMINAL: ReadonlySet<RunStatus> = new Set(["completed", "partial", "failed", "cancelled"]);

export type CampaignRunState = { run: RunView | null; error: string | null };

export function useCampaignRun(args: {
  userId: string;
  runId: string | null;
  fetchRun?: (args: { userId: string; runId: string; signal: AbortSignal }) => Promise<RunView>;
  successIntervalMs?: number;
  errorIntervalMs?: number;
  refreshKey?: number;
  onAcceptedRun?: (run: RunView) => void;
}): CampaignRunState {
  const { userId, runId, fetchRun: fetchRunOverride, successIntervalMs = 2_000, errorIntervalMs = 10_000, refreshKey, onAcceptedRun } = args;
  const [result, setResult] = useState<{ userId: string; runId: string; run: RunView } | null>(null);
  const [failure, setFailure] = useState<{ userId: string; runId: string; message: string } | null>(null);

  useEffect(() => {
    if (runId === null) return;
    const activeRunId: string = runId;
    let disposed = false;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    const fetchRun = fetchRunOverride ?? getRun;

    function clearWork() {
      if (timer) { clearTimeout(timer); timer = null; }
      controller?.abort();
      controller = null;
      inFlight = false;
    }
    function hidden() { return typeof document !== "undefined" && document.visibilityState === "hidden"; }
    function schedule(delay: number) {
      if (!disposed && !hidden()) timer = setTimeout(() => { void poll(); }, delay);
    }
    async function poll() {
      if (disposed || hidden() || inFlight) return;
      inFlight = true;
      const request = new AbortController();
      controller = request;
      try {
        const next = await fetchRun({ userId, runId: activeRunId, signal: request.signal });
        if (disposed || request.signal.aborted || controller !== request) return;
        setResult({ userId, runId: activeRunId, run: next });
        onAcceptedRun?.(next);
        setFailure(null);
        if (!TERMINAL.has(next.status)) schedule(successIntervalMs);
      } catch (error) {
        if (disposed || request.signal.aborted || controller !== request) return;
        setFailure({ userId, runId: activeRunId, message: error instanceof Error ? error.message : "Research progress could not be refreshed." });
        schedule(errorIntervalMs);
      } finally {
        if (controller === request) inFlight = false;
      }
    }
    function onVisibilityChange() {
      if (hidden()) { clearWork(); return; }
      void poll();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    void poll();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearWork();
    };
  }, [userId, runId, successIntervalMs, errorIntervalMs, fetchRunOverride, refreshKey, onAcceptedRun]);

  return {
    run: result?.userId === userId && result.runId === runId ? result.run : null,
    error: failure?.userId === userId && failure.runId === runId ? failure.message : null,
  };
}
