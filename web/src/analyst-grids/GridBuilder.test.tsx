import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { installDomGlobals } from "./testDom.ts";
import { GridBuilder } from "./GridBuilder.tsx";
import type { GridColumn } from "./gridsTypes.ts";

const COLUMNS: GridColumn[] = [{ column_key: "latest_market_cap", label: "Market Cap (latest)", kind: "deterministic" }];

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
