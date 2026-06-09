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
  const [detail, setDetail] = useState<GridRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const doFetch = args.fetchRunImpl ?? ((a) => fetchRun({ userId: a.userId, runId: a.runId }));

    async function tick() {
      try {
        const next = await doFetch({ userId, runId: runId as string });
        if (cancelled) return;
        setDetail(next);
        if (!TERMINAL.has(next.run.status)) {
          timer = setTimeout(tick, intervalMs);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "run fetch failed");
        timer = setTimeout(tick, intervalMs);
      }
    }
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [userId, runId, intervalMs]);

  return { status: detail?.run.status ?? null, detail, error };
}
