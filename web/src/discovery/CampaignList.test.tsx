import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

import { AuthContext } from "../shell/authTypes.ts";
import { CampaignList } from "./CampaignList.tsx";

test("lists owned campaigns and creates a campaign from the question form", async () => {
  // This would catch a form that appears to work but omits the required question payload.
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
  const restore = installDomGlobals(dom.window as unknown as Window);
  const previousFetch = globalThis.fetch;
  let created: unknown = null;
  (globalThis as { fetch: typeof fetch }).fetch = async (input, init) => {
    if (String(input).endsWith("/v1/discovery/campaigns") && init?.method === "POST") {
      created = JSON.parse(String(init.body));
      return json({ campaign_id: "campaign-new", user_id: "user-1", name: "Grid equipment", question: "Which US-listed companies supply grid equipment?", current_brief_version: 0, created_at: "2026-09-10T00:00:00.000Z", updated_at: "2026-09-10T00:00:00.000Z", archived_at: null }, 201);
    }
    return json({ items: [{ campaign_id: "campaign-old", user_id: "user-1", name: "Existing campaign", question: "Which US-listed companies benefit from grid modernization?", current_brief_version: 1, created_at: "2026-09-10T00:00:00.000Z", updated_at: "2026-09-10T00:00:00.000Z", archived_at: null }], next_cursor: null });
  };
  const root = createRoot(dom.window.document.getElementById("root")!);
  try {
    await act(async () => { root.render(<AuthContext.Provider value={{ session: { userId: "user-1", displayName: "User" }, signIn: () => undefined, signOut: () => undefined }}><MemoryRouter><CampaignList /></MemoryRouter></AuthContext.Provider>); });
    await act(async () => { await delay(10); });
    assert.match(dom.window.document.body.textContent ?? "", /Existing campaign/);
    await act(async () => {
      setValue(dom.window.document.querySelector('[aria-label="Campaign name"]') as HTMLInputElement, "Grid equipment");
      setValue(dom.window.document.querySelector('[aria-label="Research question"]') as HTMLTextAreaElement, "Which US-listed companies supply grid equipment?");
    });
    await act(async () => { (dom.window.document.querySelector("form") as HTMLFormElement).requestSubmit(); await delay(10); });
    assert.deepEqual(created, { name: "Grid equipment", question: "Which US-listed companies supply grid equipment?" });
  } finally {
    await act(async () => root.unmount());
    (globalThis as { fetch: typeof fetch }).fetch = previousFetch;
    restore();
  }
});

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof element.ownerDocument.defaultView!.HTMLTextAreaElement ? element.ownerDocument.defaultView!.HTMLTextAreaElement.prototype : element.ownerDocument.defaultView!.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new element.ownerDocument.defaultView!.Event("input", { bubbles: true }));
}
function json(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function installDomGlobals(domWindow: Window): () => void { const globals = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean; document?: Document; window?: Window }; const prior = { act: globals.IS_REACT_ACT_ENVIRONMENT, document: globals.document, window: globals.window }; globals.IS_REACT_ACT_ENVIRONMENT = true; globals.document = domWindow.document; globals.window = domWindow; return () => { globals.IS_REACT_ACT_ENVIRONMENT = prior.act; globals.document = prior.document; globals.window = prior.window; }; }
