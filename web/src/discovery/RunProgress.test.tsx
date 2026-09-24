import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { RunView } from "../../../services/discovery/src/types.ts";
import { RunProgress } from "./RunProgress.tsx";

test("uses status-specific progress copy and actual counts", () => {
  // This would catch treating cancelled, partial, failed, and empty runs as a completed 10-company result.
  for (const [status, expected] of [["queued", "Research is queued"], ["cancelled", "Cancelled"], ["partial", "Finished with partial results"], ["failed", "Research stopped"], ["completed", "0 shortlisted"]] as const) {
    const html = renderToStaticMarkup(<RunProgress run={runView(status)} onCancel={async () => undefined} />);
    assert.match(html, new RegExp(expected));
  }
  const waiting = renderToStaticMarkup(<RunProgress run={runView("queued", true)} onCancel={async () => undefined} />);
  assert.match(waiting, /Waiting for a worker/);
  assert.match(waiting, /aria-label="Cancel research run"/);
});

function runView(status: RunView["status"], workerWaiting = false): RunView {
  return { run_id: "run-1", campaign_id: "campaign-1", brief_id: "brief-1", user_id: "user-1", status, stage: status === "queued" ? "queued" : "research", policy_version: "v1", request_key: "key-1", model_config: [], limits: { candidates: 100, research: 25, shortlist: 10, attempts: { search: 80, document: 150, identity: 120, financial: 50, model: 64 }, input_chars: 64000, output_tokens: 10000, request_timeout_ms: 30000, run_timeout_ms: 2700000 }, usage: { search: 1, document: 1, identity: 1, financial: 0, model: 1 }, coverage: { searches_planned: 5, searches_completed: 2, hits_truncated: 0, leads_overflow: 0, extraction_batches_skipped: 0, unresolved: 0, discovered: 5, selected: 2, assessed: 2, not_selected: 1, mechanisms: [{ mechanism_id: "mechanism-1", discovered: 5, selected: 2, assessed: 2 }], gaps: status === "partial" ? [{ code: "source_gap", candidate_id: null, detail: "A source was unavailable." }] : [] }, started_at: null, finished_at: null, cancel_requested_at: status === "cancelled" ? "2026-09-10T00:30:00.000Z" : null, shortlist: [], cost: { status: "unavailable" }, worker_waiting: workerWaiting };
}
