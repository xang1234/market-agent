import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { installDomGlobals } from "./testDom.ts";
import { AuthContext } from "../shell/authTypes.ts";
import { EvidenceInspectorProvider } from "../evidence/EvidenceInspectorProvider.tsx";
import { EvidenceInspectorContext } from "../evidence/evidenceInspectorContext.ts";
import { GridTable } from "./GridTable.tsx";
import type { GridColumn, GridRunDetail } from "./gridsTypes.ts";
import type { FinancialAnswerBlock } from "../blocks/types.ts";

const COLUMNS: GridColumn[] = [{ column_key: "latest_market_cap", label: "Market Cap (latest)", kind: "deterministic" }];

const DETAIL: GridRunDetail = {
  run: { grid_run_id: "r1", status: "completed", cell_total: 2, cell_done: 2, dropped_row_count: 0 },
  rows: [
    { grid_row_id: "row-a", row_number: 0, subject_ref: { kind: "issuer", id: "AAA" }, status: "resolved" },
    { grid_row_id: "row-b", row_number: 1, subject_ref: { kind: "issuer", id: "BBB" }, status: "resolved" },
  ],
  cells: [
    { grid_row_id: "row-a", column_key: "latest_market_cap", status: "ok", display: { value: "$2.5T", tone: null }, snapshot_id: "snap-1", primary_ref: { kind: "fact", id: "fact-1" }, coverage_flag: null },
    { grid_row_id: "row-b", column_key: "latest_market_cap", status: "missing_data", display: { value: "—", tone: null }, snapshot_id: null, primary_ref: null, coverage_flag: null },
  ],
};

test("GridTable renders one row per subject and the cell value", () => {
  const html = renderToStaticMarkup(<GridTable columns={COLUMNS} detail={DETAIL} />);
  assert.match(html, /Market Cap \(latest\)/);
  assert.match(html, /\$2\.5T/);
  assert.match(html, /AAA/);
  assert.match(html, /BBB/);
});

test("GridTable shows the subject label when present, falling back to the raw id", () => {
  const labeled: GridRunDetail = {
    ...DETAIL,
    rows: [
      { ...DETAIL.rows[0], subject_label: "Acme Corp" },
      DETAIL.rows[1], // no label — falls back to the id
    ],
  };
  const html = renderToStaticMarkup(<GridTable columns={COLUMNS} detail={labeled} />);
  assert.match(html, /Acme Corp/);
  assert.doesNotMatch(html, />AAA</, "labeled rows must not show the raw id");
  assert.match(html, /BBB/);
});

test("GridTable marks an ok cell with a snapshot as inspectable and a missing cell as not", () => {
  const html = renderToStaticMarkup(<GridTable columns={COLUMNS} detail={DETAIL} />);
  assert.match(html, /data-cell-inspectable="true"[^>]*data-snapshot-id="snap-1"/);
  assert.match(html, /data-cell-status="missing_data"/);
});

test("an inspectable cell exposes a keyboard-operable button, a missing one does not", () => {
  const html = renderToStaticMarkup(<GridTable columns={COLUMNS} detail={DETAIL} />);
  // The inspectable cell's value is wrapped in a real <button>; the missing
  // cell renders inert text (no button to tab into).
  assert.match(html, /<button[^>]*>\$2\.5T<\/button>/);
  assert.doesNotMatch(html, /<button[^>]*>—<\/button>/);
});

test("clicking a fact cell opens the inspector with the text the cell shows", async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const restore = installDomGlobals(dom.window as unknown as Window);
  const opened: unknown[] = [];
  const inspector = {
    openInspection(input: unknown) { opened.push(input); },
    openBlockInspection() {},
    closeInspection() {},
  };
  try {
    const root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => {
      root.render(
        <EvidenceInspectorContext.Provider value={inspector}>
          <GridTable columns={COLUMNS} detail={DETAIL} />
        </EvidenceInspectorContext.Provider>,
      );
    });
    const okButton = dom.window.document.querySelector('[data-snapshot-id="snap-1"] button') as HTMLElement;
    await act(async () => { okButton.click(); });
    assert.deepEqual(opened, [{ snapshotId: "snap-1", ref: { kind: "fact", id: "fact-1" }, shownAs: "$2.5T" }]);
    await act(async () => root.unmount());
  } finally {
    restore();
  }
});

test("clicking an inspectable cell triggers an evidence inspection fetch", async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const restore = installDomGlobals(dom.window as unknown as Window);
  const calls: string[] = [];
  (globalThis as unknown as { fetch: typeof fetch }).fetch = async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(
      JSON.stringify({
        snapshot_id: "snap-1",
        ref: { kind: "fact", id: "fact-1" },
        kind: "fact",
        title: "Test Fact",
        subtitle: null,
        badges: [],
        rows: [],
        links: [],
        related_refs: [],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try {
    const root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => {
      root.render(
        <AuthContext.Provider value={{ session: { userId: "11111111-1111-4111-a111-111111111111", displayName: "U" }, signIn: () => undefined, signOut: () => undefined }}>
          <EvidenceInspectorProvider>
            <GridTable columns={COLUMNS} detail={DETAIL} />
          </EvidenceInspectorProvider>
        </AuthContext.Provider>,
      );
    });
    const okButton = dom.window.document.querySelector('[data-snapshot-id="snap-1"] button') as HTMLElement;
    await act(async () => { okButton.click(); });
    assert.ok(calls.some((u) => u.includes("/v1/evidence/inspect")), `expected an inspect call, saw ${calls.join(",")}`);
    await act(async () => root.unmount());
  } finally {
    restore();
  }
});

test("a blank cell shows its coverage reason in words, from the sealed block when there is one", () => {
  const gapBlock = { financial: { results: [{ result_id: "r", presented: { kind: "gap", text: "A required input or calculation is unavailable." } }] } } as unknown as FinancialAnswerBlock;
  const detail: GridRunDetail = {
    ...DETAIL,
    cells: [
      { ...DETAIL.cells[1]!, grid_row_id: "row-a", coverage_flag: "no_documents" },
      { ...DETAIL.cells[1]!, coverage_flag: "blocked_by_dependency", financial_block: gapBlock },
    ],
  };
  const html = renderToStaticMarkup(<GridTable columns={COLUMNS} detail={detail} />);
  assert.match(html, /tabindex="0" aria-describedby="[^"]+"/, "the blank is keyboard reachable");
  assert.match(html, /role="tooltip"[^>]*>No filings or documents for this company yet\.</);
  assert.match(html, /role="tooltip"[^>]*>A required input or calculation is unavailable\.</);
  assert.doesNotMatch(html, /no_documents|no documents|blocked_by_dependency/, "never a raw code");
});

test("an unknown coverage code falls back to the cell status, never the code", () => {
  const detail: GridRunDetail = { ...DETAIL, cells: [{ ...DETAIL.cells[1]!, status: "no_coverage", coverage_flag: "some_future_code" }] };
  const html = renderToStaticMarkup(<GridTable columns={COLUMNS} detail={detail} />);
  assert.match(html, /role="tooltip"[^>]*>Not covered for this company\.</);
  assert.doesNotMatch(html, /some_future_code|some future code/);
});

test("a certified gap cell shows its reason, not an inspect button, even with an inspector present", () => {
  const gapBlock = { financial: { results: [{ result_id: "r", presented: { kind: "gap", text: "A required input or calculation is unavailable." } }] } } as unknown as FinancialAnswerBlock;
  const detail: GridRunDetail = { ...DETAIL, cells: [{ ...DETAIL.cells[1]!, snapshot_id: "snap-2", coverage_flag: "blocked_by_dependency", financial_block: gapBlock }] };
  const inspector = { openInspection() {}, openBlockInspection() {}, openFinancialResult() {}, closeInspection() {} };
  const html = renderToStaticMarkup(
    <EvidenceInspectorContext.Provider value={inspector}>
      <GridTable columns={COLUMNS} detail={detail} />
    </EvidenceInspectorContext.Provider>,
  );
  assert.doesNotMatch(html, /<button/);
  assert.match(html, /role="tooltip"[^>]*>A required input or calculation is unavailable\.</);
});
