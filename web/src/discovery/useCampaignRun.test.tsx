import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";

import type { RunStatus, RunView } from "../../../services/discovery/src/types.ts";
import { useCampaignRun } from "./useCampaignRun.ts";

test("retains the last successful run during a background refresh failure", async () => {
  // This would catch clearing the result when a later poll rejects.
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
  const restore = installDomGlobals(dom.window as unknown as Window);
  let calls = 0;
  const fetchRun = async () => {
    calls += 1;
    if (calls === 1) return runView("running");
    if (calls === 2) throw new Error("temporary outage");
    return runView("completed");
  };
  function Probe() {
    const state = useCampaignRun({ userId: "user-1", runId: "run-1", fetchRun, successIntervalMs: 5, errorIntervalMs: 1_000 });
    return <p>{state.run?.status ?? "empty"}|{state.error ?? ""}</p>;
  }
  const root = createRoot(dom.window.document.getElementById("root")!);
  try {
    await act(async () => { root.render(<Probe />); });
    await act(async () => { await delay(25); });
    assert.match(dom.window.document.body.textContent ?? "", /^running\|temporary outage/, "the last run remains visible with the refresh error");
    assert.equal(calls, 2, "an error uses the longer retry delay");
  } finally {
    await act(async () => root.unmount());
    restore();
  }
});

test("aborts an old campaign request before a changed run can render it", async () => {
  // This would catch a late response from a previous URL overwriting the new run.
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
  const restore = installDomGlobals(dom.window as unknown as Window);
  const pending = new Map<string, { resolve(value: RunView): void; signal: AbortSignal }>();
  const fetchRun = ({ runId, signal }: { runId: string; signal: AbortSignal }) => new Promise<RunView>((resolve) => pending.set(runId, { resolve, signal }));
  function Probe({ runId }: { runId: string }) {
    const state = useCampaignRun({ userId: "user-1", runId, fetchRun });
    return <p>{state.run?.run_id ?? "empty"}</p>;
  }
  const root = createRoot(dom.window.document.getElementById("root")!);
  try {
    await act(async () => { root.render(<Probe runId="old-run" />); });
    await act(async () => undefined);
    await act(async () => { root.render(<Probe runId="new-run" />); });
    await act(async () => undefined);
    assert.equal(pending.get("old-run")?.signal.aborted, true, "the old request is aborted");
    pending.get("new-run")?.resolve(runView("running", "new-run"));
    await act(async () => undefined);
    pending.get("old-run")?.resolve(runView("completed", "old-run"));
    await act(async () => undefined);
    assert.equal(dom.window.document.body.textContent, "new-run");
  } finally {
    await act(async () => root.unmount());
    restore();
  }
});

test("does not return a previous account's same-run value or error while the next account resolves", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
  const restore = installDomGlobals(dom.window as unknown as Window);
  const userBResult = deferred<RunView>();
  let userACalls = 0;
  const fetchRun = async ({ userId }: { userId: string }) => {
    if (userId === "user-a") {
      userACalls += 1;
      if (userACalls === 1) return { ...runView("running"), user_id: "user-a" };
      throw new Error("User A private refresh error");
    }
    return userBResult.promise;
  };
  function Probe({ userId }: { userId: string }) {
    const state = useCampaignRun({ userId, runId: "shared-run", fetchRun, successIntervalMs: 5, errorIntervalMs: 1_000 });
    return <p>{state.run?.user_id ?? "empty"}|{state.error ?? ""}</p>;
  }
  const root = createRoot(dom.window.document.getElementById("root")!);
  try {
    await act(async () => { root.render(<Probe userId="user-a" />); });
    await act(async () => { await delay(25); });
    assert.match(dom.window.document.body.textContent ?? "", /^user-a\|User A private refresh error/);

    await act(async () => { root.render(<Probe userId="user-b" />); });
    await act(async () => undefined);
    assert.equal(dom.window.document.body.textContent, "empty|", "the prior account's result and error are immediately ineligible");

    userBResult.resolve({ ...runView("completed"), user_id: "user-b" });
    await act(async () => undefined);
    assert.equal(dom.window.document.body.textContent, "user-b|");
  } finally {
    await act(async () => root.unmount());
    restore();
  }
});

test("does not apply an aborted hidden-tab response after visibility resumes", async () => {
  // This would catch a response race where an aborted hidden-tab request paints over the resumed poll.
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
  const restore = installDomGlobals(dom.window as unknown as Window);
  const pending: Array<{ resolve(value: RunView): void; signal: AbortSignal }> = [];
  const fetchRun = ({ signal }: { signal: AbortSignal }) => new Promise<RunView>((resolve) => pending.push({ resolve, signal }));
  function Probe() {
    const state = useCampaignRun({ userId: "user-1", runId: "run-1", fetchRun });
    return <p>{state.run?.status ?? "empty"}</p>;
  }
  const root = createRoot(dom.window.document.getElementById("root")!);
  try {
    await act(async () => { root.render(<Probe />); });
    await act(async () => undefined);
    Object.defineProperty(dom.window.document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange")));
    assert.equal(pending[0]?.signal.aborted, true);
    Object.defineProperty(dom.window.document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange")));
    await act(async () => undefined);
    pending[0]?.resolve(runView("completed"));
    await act(async () => undefined);
    assert.equal(dom.window.document.body.textContent, "empty", "the aborted response is ignored before the resumed poll resolves");
    pending[1]?.resolve(runView("running"));
    await act(async () => undefined);
    assert.equal(dom.window.document.body.textContent, "running");
  } finally {
    await act(async () => root.unmount());
    restore();
  }
});

function runView(status: RunStatus, runId = "run-1"): RunView {
  return {
    run_id: runId, campaign_id: "campaign-1", brief_id: "brief-1", user_id: "user-1", status, stage: status === "queued" ? "queued" : "research", policy_version: "v1", request_key: "key-1", model_config: [],
    limits: { candidates: 100, research: 25, shortlist: 10, attempts: { search: 80, document: 150, identity: 120, financial: 50, model: 64 }, input_chars: 64000, output_tokens: 10000, request_timeout_ms: 30000, run_timeout_ms: 2700000 },
    usage: { search: 1, document: 1, identity: 1, financial: 0, model: 1 }, coverage: { searches_planned: 4, searches_completed: 1, hits_truncated: 0, leads_overflow: 0, extraction_batches_skipped: 0, unresolved: 0, discovered: 3, selected: 2, assessed: 1, not_selected: 0, mechanisms: [], gaps: [] },
    started_at: null, finished_at: null, cancel_requested_at: null, shortlist: [], cost: { status: "unavailable" }, worker_waiting: false,
  };
}

function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>((next) => { resolve = next; }), resolve }; }

function installDomGlobals(domWindow: Window): () => void {
  const globals = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean; document?: Document; window?: Window };
  const previous = { act: globals.IS_REACT_ACT_ENVIRONMENT, document: globals.document, window: globals.window };
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  globals.document = domWindow.document;
  globals.window = domWindow;
  return () => { globals.IS_REACT_ACT_ENVIRONMENT = previous.act; globals.document = previous.document; globals.window = previous.window; };
}
