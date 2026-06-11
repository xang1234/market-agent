import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { installDomGlobals } from "./testDom.ts";
import { GridBuilder } from "./GridBuilder.tsx";
import { EMPTY_UNIVERSE_OPTIONS, type UniverseOptions } from "./universeOptions.ts";
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
  universeOptions: UniverseOptions = EMPTY_UNIVERSE_OPTIONS,
): Promise<unknown> {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const restore = installDomGlobals(dom.window as unknown as Window);
  let emitted: unknown = null;
  try {
    const root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => {
      root.render(<GridBuilder columns={columns} universeOptions={universeOptions} onSubmit={(spec) => { emitted = spec; }} />);
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
      root.render(<GridBuilder columns={COLUMNS} universeOptions={EMPTY_UNIVERSE_OPTIONS} onSubmit={(spec) => { emitted = spec; }} />);
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

test("an id-source universe with an empty ref id does not submit", async () => {
  const emitted = await withGridBuilder(COLUMNS, async (doc, domWindow) => {
    const select = doc.querySelector('[data-testid="grid-builder-source"]') as HTMLSelectElement;
    select.value = "watchlist";
    await act(async () => {
      select.dispatchEvent(new domWindow.Event("change", { bubbles: true }));
    });
    await act(async () => { (doc.querySelector('[data-testid="grid-builder-col-latest_market_cap"]') as HTMLInputElement).click(); });
    // ref id input left empty — submitting must be a no-op, not a doomed grid
  });
  assert.equal(emitted, null);
});

const WATCHLIST_ID = "33333333-3333-4333-8333-333333333333";
const PICKER_OPTIONS: UniverseOptions = {
  watchlist: [{ id: WATCHLIST_ID, label: "Tech names" }],
  portfolio: [],
  screen: [],
};

test("watchlist source renders a picker of the user's watchlists and emits the chosen id", async () => {
  const emitted = await withGridBuilder(
    COLUMNS,
    async (doc, domWindow) => {
      const select = doc.querySelector('[data-testid="grid-builder-source"]') as HTMLSelectElement;
      select.value = "watchlist";
      await act(async () => {
        select.dispatchEvent(new domWindow.Event("change", { bubbles: true }));
      });
      // The free-text uuid input is replaced by a select of the user's objects.
      assert.equal(doc.querySelector('[data-testid="grid-builder-ref-input"]'), null);
      const picker = doc.querySelector('[data-testid="grid-builder-ref-select"]') as HTMLSelectElement;
      assert.ok(picker, "expected a ref picker for watchlist source");
      assert.match(picker.innerHTML, /Tech names/);
      picker.value = WATCHLIST_ID;
      await act(async () => { (doc.querySelector('[data-testid="grid-builder-col-latest_market_cap"]') as HTMLInputElement).click(); });
    },
    PICKER_OPTIONS,
  );
  assert.deepEqual(emitted, {
    universe_spec: { source: "watchlist", watchlist_id: WATCHLIST_ID },
    column_specs: [{ column_key: "latest_market_cap" }],
  });
});

test("peers source keeps the free-text ticker input, not a picker", async () => {
  await withGridBuilder(
    COLUMNS,
    async (doc, domWindow) => {
      const select = doc.querySelector('[data-testid="grid-builder-source"]') as HTMLSelectElement;
      select.value = "peers";
      await act(async () => {
        select.dispatchEvent(new domWindow.Event("change", { bubbles: true }));
      });
      assert.ok(doc.querySelector('[data-testid="grid-builder-ref-input"]'), "peers keeps a text input");
      assert.equal(doc.querySelector('[data-testid="grid-builder-ref-select"]'), null);
    },
    PICKER_OPTIONS,
  );
});

test("reader-kind columns are not rendered as checkboxes", async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const restore = installDomGlobals(dom.window as unknown as Window);
  try {
    const root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => {
      root.render(<GridBuilder columns={COLUMNS_WITH_READER} universeOptions={EMPTY_UNIVERSE_OPTIONS} onSubmit={() => {}} />);
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
