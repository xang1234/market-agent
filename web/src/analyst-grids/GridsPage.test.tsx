import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { installDomGlobals } from "./testDom.ts";
import { AuthContext } from "../shell/authTypes.ts";
import { EvidenceInspectorProvider } from "../evidence/EvidenceInspectorProvider.tsx";
import { GridsPage } from "./GridsPage.tsx";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function route(url: string): Response {
  if (url.includes("/v1/analyst-grids/columns")) return json({ columns: [{ column_key: "latest_market_cap", label: "Market Cap (latest)", kind: "deterministic" }] });
  if (url.endsWith("/v1/analyst-grids")) return json({ grid_id: "g1", name: "Untitled grid", description: null, universe_spec: {}, column_specs: [], created_at: "x", updated_at: "x" }, 201);
  if (url.endsWith("/g1/runs")) return json({ runId: "r1", status: "pending" }, 202);
  if (url.includes("/v1/analyst-grids/runs/r1")) {
    return json({
      run: { grid_run_id: "r1", status: "completed", cell_total: 1, cell_done: 1, dropped_row_count: 0 },
      rows: [{ grid_row_id: "row-a", row_number: 0, subject_ref: { kind: "issuer", id: "AAA" }, status: "resolved" }],
      cells: [{ grid_row_id: "row-a", column_key: "latest_market_cap", status: "ok", display: { value: "$2.5T", tone: null }, snapshot_id: "snap-1", primary_ref: { kind: "fact", id: "f1" }, coverage_flag: null }],
    });
  }
  return json({}, 404);
}

test("GridsPage builds a grid, runs it, and renders the resulting cell value", async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const restore = installDomGlobals(dom.window as unknown as Window);
  (globalThis as unknown as { fetch: typeof fetch }).fetch = async (input: RequestInfo | URL) => route(String(input));
  try {
    const root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => {
      root.render(
        <AuthContext.Provider value={{ session: { userId: "11111111-1111-4111-a111-111111111111", displayName: "U" }, signIn: () => undefined, signOut: () => undefined }}>
          <EvidenceInspectorProvider>
            <GridsPage />
          </EvidenceInspectorProvider>
        </AuthContext.Provider>,
      );
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); }); // columns load
    const doc = dom.window.document;
    (doc.querySelector('[data-testid="grid-builder-manual-input"]') as HTMLTextAreaElement).value = "AAA";
    await act(async () => { (doc.querySelector('[data-testid="grid-builder-col-latest_market_cap"]') as HTMLInputElement).click(); });
    await act(async () => { (doc.querySelector('[data-testid="grid-builder"]') as HTMLFormElement).requestSubmit(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); }); // create+run+poll
    assert.match(doc.getElementById("root")!.innerHTML, /\$2\.5T/);
    await act(async () => root.unmount());
  } finally {
    restore();
  }
});
