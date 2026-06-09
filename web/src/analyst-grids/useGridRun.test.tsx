import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { installDomGlobals } from "./testDom.ts";
import { useGridRun } from "./useGridRun.ts";
import type { GridRunDetail } from "./gridsTypes.ts";

test("useGridRun polls until terminal status then stops", async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const restore = installDomGlobals(dom.window as unknown as Window);
  let calls = 0;
  const responses: GridRunDetail[] = [
    { run: { grid_run_id: "r1", status: "running", cell_total: 1, cell_done: 0, dropped_row_count: 0 }, rows: [], cells: [] },
    { run: { grid_run_id: "r1", status: "completed", cell_total: 1, cell_done: 1, dropped_row_count: 0 }, rows: [], cells: [] },
  ];
  const fetchRunImpl = async () => responses[Math.min(calls++, responses.length - 1)];

  const seen: string[] = [];
  function Probe() {
    const { detail } = useGridRun({ userId: "u", runId: "r1", intervalMs: 5, fetchRunImpl });
    if (detail) seen.push(detail.run.status);
    return null;
  }

  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => { root.render(<Probe />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
  await act(async () => root.unmount());
  restore();

  assert.ok(seen.includes("completed"), `expected a completed poll, saw ${seen.join(",")}`);
  const callsAtStop = calls;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls, callsAtStop, "polling should stop after terminal status");
});
