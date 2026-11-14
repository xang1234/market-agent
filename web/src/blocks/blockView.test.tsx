import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { EvidenceInspectorDock, EvidenceInspectorProvider } from "../evidence/EvidenceInspectorProvider.tsx";
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
            <EvidenceInspectorDock />
          </EvidenceInspectorProvider>
        </AuthContext.Provider>,
      );
    });

    await act(async () => {
      dom.window.document
        .querySelector('[data-testid="block-rich-text-1-metadata"]')
        ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });

    const panel = dom.window.document.querySelector('aside[aria-label="Evidence inspector"]');
    assert.deepEqual(
      [...(panel?.querySelectorAll("dt") ?? [])].map((term) => `${term.textContent}: ${term.nextElementSibling?.textContent}`).slice(0, 2),
      ["Block id: rich-text-1", "Kind: Rich text"],
    );
    assert.equal(panel?.querySelector('[data-testid="inspector-details"]')?.hasAttribute("open"), false, "identifiers wait under a closed Details");
    assert.deepEqual(
      [...dom.window.document.querySelectorAll('aside[aria-label="Evidence inspector"] li > button[data-inspection-kind]')]
        .map((button) => button.textContent),
      ["Source", "Claim"],
    );

    await act(async () => root.unmount());
  } finally {
    restoreGlobals();
  }
});

function richText(segments?: RichTextBlock["segments"]): RichTextBlock {
  const block = {
    id: "rich-text-1",
    kind: "rich_text",
    snapshot_id: SNAPSHOT_ID,
    data_ref: { kind: "rich_text", id: "rich-text-1" },
    source_refs: [],
    as_of: "2026-05-29T00:00:00.000Z",
    ...(segments === undefined ? {} : { segments }),
  };
  return block as RichTextBlock;
}

async function renderBlocks() {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window);
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const render = (block: RichTextBlock) =>
    act(async () => {
      root.render(
        <BlockRegistryProvider registry={createDefaultBlockRegistry()}>
          <BlockView block={block} />
        </BlockRegistryProvider>,
      );
    });
  const notice = () => container.querySelector('[data-testid="block-render-failed"]')?.textContent ?? null;
  const cleanup = async () => {
    await act(async () => root.unmount());
    restoreGlobals();
  };
  return { container, render, notice, cleanup };
}

test("a block that failed to render shows its corrected copy under the same id, and the notice goes", async () => {
  const originalError = console.error;
  console.error = () => undefined;
  const view = await renderBlocks();
  try {
    await view.render(richText());
    assert.equal(view.notice(), "This part of the answer couldn't be displayed.");

    await view.render(richText([{ type: "text", text: "Revenue improved." }]));
    assert.equal(view.notice(), null);
    assert.equal(view.container.textContent, "Revenue improved.");
  } finally {
    console.error = originalError;
    await view.cleanup();
  }
});

test("a rendered block keeps its DOM across re-renders with the same block or an updated one", async () => {
  const view = await renderBlocks();
  try {
    const block = richText([{ type: "text", text: "Revenue" }]);
    await view.render(block);
    const node = view.container.firstElementChild;
    assert.notEqual(node, null);

    await view.render(block);
    assert.equal(view.container.firstElementChild, node);

    await view.render(richText([{ type: "text", text: "Revenue improved." }]));
    assert.equal(view.container.firstElementChild, node);
    assert.equal(view.container.textContent, "Revenue improved.");
  } finally {
    await view.cleanup();
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
