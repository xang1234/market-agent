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
    const ta = doc.querySelector('[data-testid="grid-builder-manual-input"]') as HTMLTextAreaElement;
    await act(async () => {
      // React 19 in Node.js: isInputEventSupported=false at module-load (no window yet),
      // so bubbling `input` events don't reach React's onChange via the polyfill path.
      // Use the prototype setter to set the DOM value, then invoke the React onChange
      // prop directly so state flushes correctly inside act().
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(ta, "AAA, BBB");
      const propsKey = Object.keys(ta).find((k) => k.startsWith("__reactProps"));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (propsKey && (ta as any)[propsKey]?.onChange?.({ target: ta }));
    });
    await act(async () => { (doc.querySelector('[data-testid="grid-builder-col-latest_market_cap"]') as HTMLInputElement).click(); });
    await act(async () => { (doc.querySelector('[data-testid="grid-builder-submit"]') as HTMLButtonElement).click(); });
    await act(async () => root.unmount());
  } finally {
    restore();
  }
  assert.deepEqual(emitted, {
    universe_spec: { source: "manual", subject_refs: [{ kind: "issuer", id: "AAA" }, { kind: "issuer", id: "BBB" }] },
    column_specs: [{ column_key: "latest_market_cap" }],
  });
});
