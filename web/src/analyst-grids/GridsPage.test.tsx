import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { installDomGlobals } from "./testDom.ts";
import { AuthContext } from "../shell/authTypes.ts";
import { EvidenceInspectorProvider } from "../evidence/EvidenceInspectorProvider.tsx";
import { GridsPage } from "./GridsPage.tsx";

const ISSUER_ID = "75b269c6-8586-4508-a52d-491cfeeb45eb";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const createBodies: unknown[] = [];

function route(url: string, init?: RequestInit): Response {
  if (url.includes("/v1/subjects/resolve")) {
    return json({
      subjects: [
        {
          subject_ref: { kind: "listing", id: "511d853d-54b6-47fe-a49b-6766fa50a8a5" },
          display_name: "AAA — Test Issuer",
          confidence: 0.95,
          context: { issuer: { subject_ref: { kind: "issuer", id: ISSUER_ID }, legal_name: "Test Issuer" } },
        },
      ],
      unresolved: [],
    });
  }
  if (url.includes("/v1/analyst-grids/columns")) return json({ columns: [{ column_key: "latest_market_cap", label: "Market Cap (latest)", kind: "deterministic" }] });
  if (url.endsWith("/v1/analyst-grids")) {
    createBodies.push(JSON.parse(String(init?.body ?? "null")));
    return json({ grid_id: "g1", name: "Untitled grid", description: null, universe_spec: {}, column_specs: [], created_at: "x", updated_at: "x" }, 201);
  }
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
  (globalThis as unknown as { fetch: typeof fetch }).fetch = async (input: RequestInfo | URL, init?: RequestInit) => route(String(input), init);
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
    // The typed ticker "AAA" must reach the server as a resolved issuer uuid,
    // not as a raw ticker masquerading as an id.
    assert.deepEqual(
      (createBodies[0] as { universe_spec: unknown }).universe_spec,
      { source: "manual", subject_refs: [{ kind: "issuer", id: ISSUER_ID }] },
    );
    await act(async () => root.unmount());
  } finally {
    restore();
  }
});
