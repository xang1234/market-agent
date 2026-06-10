import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { installDomGlobals } from "./testDom.ts";
import { GridBuilder } from "./GridBuilder.tsx";
import type { GridColumn } from "./gridsTypes.ts";

const COLUMNS: GridColumn[] = [{ column_key: "latest_market_cap", label: "Market Cap (latest)", kind: "deterministic" }];

// Columns list that also includes a reader-kind entry to cover filtering tests.
const COLUMNS_WITH_READER: GridColumn[] = [
  { column_key: "latest_market_cap", label: "Market Cap (latest)", kind: "deterministic" },
  { column_key: "reader_question", label: "Question", kind: "reader" },
];

// Helper: build a JSDOM + root, render GridBuilder, call fn(doc), submit, unmount.
async function withGridBuilder(
  columns: GridColumn[],
  fn: (doc: Document, domWindow: typeof globalThis.window) => void | Promise<void>,
): Promise<unknown> {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const restore = installDomGlobals(dom.window as unknown as Window);
  let emitted: unknown = null;
  try {
    const root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => {
      root.render(<GridBuilder columns={columns} onSubmit={(spec) => { emitted = spec; }} />);
    });
    const doc = dom.window.document;
    await fn(doc, dom.window as unknown as typeof globalThis.window);
    await act(async () => {
      const form = doc.querySelector('[data-testid="grid-builder"]') as HTMLFormElement;
      if (typeof form.requestSubmit === "function") form.requestSubmit();
      else form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    });
    await act(async () => root.unmount());
  } finally {
    restore();
  }
  return emitted;
}

test("GridBuilder assembles a manual universe + selected columns and emits them", async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const restore = installDomGlobals(dom.window as unknown as Window);
  let emitted: unknown = null;
  try {
    const root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => {
      root.render(<GridBuilder columns={COLUMNS} onSubmit={(spec) => { emitted = spec; }} />);
    });
    const doc = dom.window.document;
    // Uncontrolled: set the textarea value directly; FormData reads the live DOM value at submit.
    (doc.querySelector('[data-testid="grid-builder-manual-input"]') as HTMLTextAreaElement).value = "AAA, BBB";
    await act(async () => { (doc.querySelector('[data-testid="grid-builder-col-latest_market_cap"]') as HTMLInputElement).click(); });
    await act(async () => {
      const form = doc.querySelector('[data-testid="grid-builder"]') as HTMLFormElement;
      // Prefer a real submit; fall back to dispatching the submit event if the JSDOM
      // button click doesn't trigger form submission.
      if (typeof form.requestSubmit === "function") form.requestSubmit();
      else form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    });
    await act(async () => root.unmount());
  } finally {
    restore();
  }
  assert.deepEqual(emitted, {
    universe_spec: { source: "manual", subject_refs: [{ kind: "issuer", id: "AAA" }, { kind: "issuer", id: "BBB" }] },
    column_specs: [{ column_key: "latest_market_cap" }],
  });
});

test("includes a reader_question column when a question is entered", async () => {
  const emitted = await withGridBuilder(COLUMNS_WITH_READER, async (doc) => {
    (doc.querySelector('[data-testid="grid-builder-manual-input"]') as HTMLTextAreaElement).value = "AAPL";
    await act(async () => { (doc.querySelector('[data-testid="grid-builder-col-latest_market_cap"]') as HTMLInputElement).click(); });
    (doc.querySelector('[data-testid="grid-builder-question-input"]') as HTMLTextAreaElement).value = "Any China exposure flagged in risk factors?";
  });
  assert.deepEqual(emitted, {
    universe_spec: { source: "manual", subject_refs: [{ kind: "issuer", id: "AAPL" }] },
    column_specs: [
      { column_key: "latest_market_cap" },
      { column_key: "reader_question", params: { prompt: "Any China exposure flagged in risk factors?" } },
    ],
  });
});

test("omits reader_question when the question field is empty", async () => {
  const emitted = await withGridBuilder(COLUMNS_WITH_READER, async (doc) => {
    (doc.querySelector('[data-testid="grid-builder-manual-input"]') as HTMLTextAreaElement).value = "AAPL";
    await act(async () => { (doc.querySelector('[data-testid="grid-builder-col-latest_market_cap"]') as HTMLInputElement).click(); });
    // question field left empty (default)
  });
  assert.deepEqual(emitted, {
    universe_spec: { source: "manual", subject_refs: [{ kind: "issuer", id: "AAPL" }] },
    column_specs: [{ column_key: "latest_market_cap" }],
  });
});

test("a question-only grid submits with just the question column", async () => {
  const emitted = await withGridBuilder(COLUMNS_WITH_READER, async (doc) => {
    (doc.querySelector('[data-testid="grid-builder-manual-input"]') as HTMLTextAreaElement).value = "MSFT";
    // no checkbox selected
    (doc.querySelector('[data-testid="grid-builder-question-input"]') as HTMLTextAreaElement).value = "What are the key growth risks?";
  });
  assert.deepEqual(emitted, {
    universe_spec: { source: "manual", subject_refs: [{ kind: "issuer", id: "MSFT" }] },
    column_specs: [{ column_key: "reader_question", params: { prompt: "What are the key growth risks?" } }],
  });
});

test("reader-kind columns are not rendered as checkboxes", async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const restore = installDomGlobals(dom.window as unknown as Window);
  try {
    const root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => {
      root.render(<GridBuilder columns={COLUMNS_WITH_READER} onSubmit={() => {}} />);
    });
    const doc = dom.window.document;
    // deterministic column should have a checkbox
    assert.ok(doc.querySelector('[data-testid="grid-builder-col-latest_market_cap"]'), "deterministic column checkbox should exist");
    // reader-kind column should NOT have a checkbox
    assert.equal(doc.querySelector('[data-testid="grid-builder-col-reader_question"]'), null, "reader-kind column should not render as checkbox");
    await act(async () => root.unmount());
  } finally {
    restore();
  }
});
