import { useEffect, useState } from "react";
import { fetchRun } from "./gridsClient.ts";
import type { GridRunDetail, GridRunStatus } from "./gridsTypes.ts";

const TERMINAL: ReadonlySet<GridRunStatus> = new Set(["completed", "partial", "failed"]);

export type UseGridRunResult = {
  status: GridRunStatus | null;
  detail: GridRunDetail | null;
  error: string | null;
};

export function useGridRun(args: {
  userId: string;
  runId: string | null;
  intervalMs?: number;
  fetchRunImpl?: (a: { userId: string; runId: string }) => Promise<GridRunDetail>;
}): UseGridRunResult {
  const { userId, runId, intervalMs = 1500 } = args;
  // State is tagged with the runId it was fetched for. When runId changes the
  // tag no longer matches and the derived getters below return null, so stale
  // detail/error can never render against the wrong run — without a
  // setState-in-effect reset (which would cascade renders).
  const [state, setState] = useState<{ runId: string; detail: GridRunDetail } | null>(null);
  const [errorState, setErrorState] = useState<{ runId: string; message: string } | null>(null);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const doFetch = args.fetchRunImpl ?? ((a) => fetchRun({ userId: a.userId, runId: a.runId }));

    async function tick() {
      try {
        const next = await doFetch({ userId, runId: runId as string });
        if (cancelled) return;
        setState({ runId: runId as string, detail: next });
        if (!TERMINAL.has(next.run.status)) {
          timer = setTimeout(tick, intervalMs);
        }
      } catch (err) {
        if (cancelled) return;
        setErrorState({ runId: runId as string, message: err instanceof Error ? err.message : "run fetch failed" });
        timer = setTimeout(tick, intervalMs);
      }
    }
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [userId, runId, intervalMs]);

  const detail = state !== null && state.runId === runId ? state.detail : null;
  const error = errorState !== null && errorState.runId === runId ? errorState.message : null;
  return { status: detail?.run.status ?? null, detail, error };
}
