import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { EvidenceInspectorProvider } from "../evidence/EvidenceInspectorProvider.tsx";
import { AuthContext } from "../shell/authTypes.ts";
import { BlockRegistryProvider, BlockView, createDefaultBlockRegistry } from "./index.ts";
import type { RichTextBlock } from "./types.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SNAPSHOT_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";
const CLAIM_ID = "33333333-3333-4333-8333-333333333333";

test("BlockView opens local block metadata in the evidence inspector", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window);
  try {
    const block: RichTextBlock = {
      id: "rich-text-1",
      kind: "rich_text",
      snapshot_id: SNAPSHOT_ID,
      data_ref: { kind: "rich_text", id: "rich-text-1" },
      source_refs: [SOURCE_ID],
      as_of: "2026-05-29T00:00:00.000Z",
      title: "Summary",
      segments: [
        { type: "text", text: "Revenue improved. " },
        { type: "ref", ref_kind: "claim", ref_id: CLAIM_ID, format: "Management cited demand." },
      ],
    };

    const root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => {
      root.render(
        <AuthContext.Provider
          value={{
            session: { userId: USER_ID, displayName: "Mock User" },
            signIn: () => undefined,
            signOut: () => undefined,
          }}
        >
          <EvidenceInspectorProvider>
            <BlockRegistryProvider registry={createDefaultBlockRegistry()}>
              <BlockView block={block} />
            </BlockRegistryProvider>
          </EvidenceInspectorProvider>
        </AuthContext.Provider>,
      );
    });

    await act(async () => {
      dom.window.document
        .querySelector('[data-testid="block-rich-text-1-metadata"]')
        ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });

    assert.match(dom.window.document.body.innerHTML, /Block metadata/);
    assert.match(dom.window.document.body.innerHTML, /rich_text/);
    assert.match(dom.window.document.body.innerHTML, /source:/);
    assert.match(dom.window.document.body.innerHTML, /claim:/);

    await act(async () => root.unmount());
  } finally {
    restoreGlobals();
  }
});

function installDomGlobals(domWindow: Window): () => void {
  const globals = globalThis as unknown as {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
    document?: Document;
    window?: Window;
  };
  const hadActEnv = Object.prototype.hasOwnProperty.call(globals, "IS_REACT_ACT_ENVIRONMENT");
  const hadDocument = Object.prototype.hasOwnProperty.call(globals, "document");
  const hadWindow = Object.prototype.hasOwnProperty.call(globals, "window");
  const previousActEnv = globals.IS_REACT_ACT_ENVIRONMENT;
  const previousDocument = globals.document;
  const previousWindow = globals.window;

  globals.IS_REACT_ACT_ENVIRONMENT = true;
  globals.document = domWindow.document;
  globals.window = domWindow;

  return () => {
    if (hadActEnv) globals.IS_REACT_ACT_ENVIRONMENT = previousActEnv;
    else delete globals.IS_REACT_ACT_ENVIRONMENT;
    if (hadDocument) globals.document = previousDocument;
    else delete globals.document;
    if (hadWindow) globals.window = previousWindow;
    else delete globals.window;
  };
}
