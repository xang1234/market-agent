import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";

import type { Brief, SavedBrief } from "../../../services/discovery/src/types.ts";
import { parseBrief } from "../../../services/discovery/src/validation.ts";
import { HttpJsonError } from "../http/authFetch.ts";
import { BriefEditor } from "./BriefEditor.tsx";

const BRIEF: Brief = {
  schema_version: 1,
  question: "Which US-listed companies benefit from grid modernization spending?",
  market: "us_listed",
  horizon_months: 24,
  lookback_months: 12,
  mechanisms: [{ mechanism_id: "grid-demand", label: "Grid demand", chain: ["Investment", "Equipment orders"] }],
  criteria: [{ criterion_id: "profitability", importance: "must", statement: "Has durable profits", falsifier: "Persistent losses" }],
  seed_queries: ["grid equipment suppliers"],
  exclusions: [],
  preferences: [],
  queries: [{ mechanism_id: "grid-demand", query: "grid equipment suppliers" }],
};

function savedBrief(version: number, question = BRIEF.question): SavedBrief {
  return {
    brief_id: "brief-1",
    campaign_id: "campaign-1",
    version,
    brief: { ...BRIEF, question },
    hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    approved_at: null,
    created_at: "2026-09-10T00:00:00.000Z",
  };
}

test("keeps a typed question and base version when a server brief refreshes", async () => {
  // This would catch an effect that synchronizes draft from every new brief prop.
  const harness = await mountEditor(savedBrief(1));
  try {
    await harness.edit("Question", "Find suppliers of electricity infrastructure equipment.");
    await harness.receiveServerBrief(savedBrief(2, "A different saved question."));

    assert.equal(harness.field("Question").value, "Find suppliers of electricity infrastructure equipment.");
    await harness.click("Save research brief");
    assert.equal(harness.lastBody?.expectedVersion, 1);
  } finally {
    await harness.unmount();
  }
});

test("loads a newer saved brief only when the user explicitly asks", async () => {
  // This would catch a load action that changes visible fields without advancing the save version.
  const harness = await mountEditor(savedBrief(1));
  try {
    await harness.edit("Question", "Unsaved local question");
    await harness.receiveServerBrief(savedBrief(2, "The saved question"));
    assert.equal(harness.field("Question").value, "Unsaved local question");

    await harness.click("Load saved brief");
    assert.equal(harness.field("Question").value, "The saved question");
    await harness.click("Save research brief");
    assert.equal(harness.lastBody?.expectedVersion, 2);
  } finally {
    await harness.unmount();
  }
});

test("keeps a stale-save draft and exposes editable research controls", async () => {
  // This would catch a conflict handler that discards the user's draft, or fields that only look editable.
  const harness = await mountEditor(savedBrief(1), async () => { throw new Error("brief version is stale"); });
  try {
    await harness.edit("Question", "Find suppliers of electricity infrastructure equipment.");
    await harness.edit("Horizon (months)", "36");
    await harness.edit("Mechanism 1 label", "Transmission spending");
    await harness.edit("Criterion 1", "The company has durable grid demand exposure.");
    await harness.edit("Seed queries", "transmission equipment suppliers\ngrid upgrade contractors");
    await harness.click("Save research brief");
    assert.equal(harness.field("Question").value, "Find suppliers of electricity infrastructure equipment.");
    assert.equal(harness.field("Horizon (months)").value, "36");
    assert.equal(harness.field("Mechanism 1 label").value, "Transmission spending");
    assert.match(harness.document.body.textContent ?? "", /newer saved brief/i);
  } finally {
    await harness.unmount();
  }
});

test("generates a version-zero proposal locally and saves it only when asked", async () => {
  // This would catch generated work being silently saved, or first drafts using a
  // nonexistent version instead of the API's version-zero concurrency token.
  const proposal = { ...BRIEF, question: "Find makers of transmission equipment." };
  const harness = await mountEditor(null, undefined, async (request) => {
    assert.equal(request.expectedVersion, 0);
    return { brief: proposal, base_version: 0 };
  });
  try {
    await harness.click("Generate research brief");
    assert.equal(harness.field("Question").value, proposal.question);
    assert.equal(harness.saveCalls, 0);

    await harness.click("Save research brief");
    assert.equal(harness.lastBody?.expectedVersion, 0);
    assert.equal(harness.saveCalls, 1);
  } finally {
    await harness.unmount();
  }
});

test("the untouched default brief includes a query for every mechanism", async () => {
  const harness = await mountEditor(null);
  try {
    await harness.click("Save research brief");
    assert.ok(harness.lastBody);
    const brief = parseBrief(harness.lastBody.brief);
    assert.deepEqual(
      new Set(brief.queries.map((query) => query.mechanism_id)),
      new Set(brief.mechanisms.map((mechanism) => mechanism.mechanism_id)),
    );
  } finally {
    await harness.unmount();
  }
});

test("saves a generated proposal against its existing base version", async () => {
  // This would catch proposal state becoming the save base and sending an
  // invented version instead of the currently saved brief's version.
  const harness = await mountEditor(savedBrief(3), undefined, async (request) => ({
    brief: { ...BRIEF, question: "Find companies that make grid software." },
    base_version: request.expectedVersion,
  }));
  try {
    await harness.click("Generate research brief");
    assert.equal(harness.saveCalls, 0);
    await harness.click("Save research brief");
    assert.equal(harness.lastBody?.expectedVersion, 3);
  } finally {
    await harness.unmount();
  }
});

test("suppresses a second draft request while the first is in flight", async () => {
  // This would catch two planner requests leaving before React has repainted the disabled button.
  const pending = deferred<{ brief: Brief; base_version: number }>();
  const harness = await mountEditor(savedBrief(1), undefined, async () => pending.promise);
  try {
    const button = harness.button("Generate research brief");
    await act(async () => {
      button.dispatchEvent(new harness.window.MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new harness.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(harness.draftCalls, 1);
    pending.resolve({ brief: BRIEF, base_version: 1 });
    await harness.settle();
  } finally {
    await harness.unmount();
  }
});

test("does not replace an edit made after draft generation begins", async () => {
  // This would catch a delayed planner response overwriting a newer local edit.
  const pending = deferred<{ brief: Brief; base_version: number }>();
  const harness = await mountEditor(savedBrief(1), undefined, async () => pending.promise);
  try {
    await harness.click("Generate research brief");
    await harness.edit("Question", "Keep this newer question.");
    pending.resolve({ brief: { ...BRIEF, question: "Delayed planner response" }, base_version: 1 });
    await harness.settle();
    assert.equal(harness.field("Question").value, "Keep this newer question.");
  } finally {
    await harness.unmount();
  }
});

test("keeps the editable draft and gives recovery guidance for draft failures", async () => {
  // This would catch stale, rate-limited, or unavailable planner errors clearing the
  // local brief or leaving the person with no next action.
  for (const [error, guidance] of [
    [new HttpJsonError(409, { code: "stale_brief" }), /newer saved brief/i],
    [new HttpJsonError(429, { code: "draft_rate_limit" }), /wait.*try again/i],
    [new HttpJsonError(503, { code: "unavailable" }), /try again later/i],
  ] as const) {
    const harness = await mountEditor(savedBrief(1), undefined, async () => { throw error; });
    try {
      await harness.edit("Question", "Do not discard this draft.");
      await harness.click("Generate research brief");
      assert.equal(harness.field("Question").value, "Do not discard this draft.");
      assert.match(harness.document.body.textContent ?? "", guidance);
    } finally {
      await harness.unmount();
    }
  }
});

async function mountEditor(
  initialBrief: SavedBrief | null,
  saveOverride?: (body: { expectedVersion: number; brief: Brief }) => Promise<SavedBrief>,
  draftOverride?: (body: { expectedVersion: number }) => Promise<{ brief: Brief; base_version: number }>,
) {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
  const restore = installDomGlobals(dom.window as unknown as Window);
  const root = createRoot(dom.window.document.getElementById("root")!);
  let serverBrief = initialBrief;
  let lastBody: { expectedVersion: number; brief: Brief } | null = null;
  let saveCalls = 0;
  let draftCalls = 0;

  const render = async () => {
    await act(async () => {
      root.render(
        <BriefEditor
          campaignId="campaign-1"
          savedBrief={serverBrief}
          onSave={async (body) => {
            saveCalls += 1;
            lastBody = body;
            if (saveOverride) return saveOverride(body);
            return savedBrief(body.expectedVersion + 1, body.brief.question);
          }}
          onDraft={draftOverride ? async (body) => { draftCalls += 1; return draftOverride(body); } : undefined}
        />,
      );
    });
    await act(async () => undefined);
  };
  await render();

  return {
    document: dom.window.document,
    window: dom.window,
    get lastBody() { return lastBody; },
    get saveCalls() { return saveCalls; },
    get draftCalls() { return draftCalls; },
    field(label: string) {
      const field = [...dom.window.document.querySelectorAll("textarea, input")].find((element) => element.getAttribute("aria-label") === label);
      assert.ok(field, `missing field: ${label}`);
      return field as HTMLInputElement | HTMLTextAreaElement;
    },
    async edit(label: string, value: string) {
      const field = this.field(label);
      await act(async () => changeValue(field, value));
    },
    async receiveServerBrief(next: SavedBrief) {
      serverBrief = next;
      await render();
    },
    async click(label: string) {
      const button = [...dom.window.document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
      assert.ok(button, `missing button: ${label}`);
      await act(async () => button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
      await act(async () => undefined);
    },
    button(label: string) {
      const button = [...dom.window.document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
      assert.ok(button, `missing button: ${label}`);
      return button;
    },
    async settle() {
      await act(async () => { await delay(10); });
    },
    async unmount() {
      await act(async () => root.unmount());
      restore();
    },
  };
}

function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>((next) => { resolve = next; }), resolve }; }
function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

function changeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof element.ownerDocument.defaultView!.HTMLTextAreaElement
    ? element.ownerDocument.defaultView!.HTMLTextAreaElement.prototype
    : element.ownerDocument.defaultView!.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new element.ownerDocument.defaultView!.Event("input", { bubbles: true }));
  element.dispatchEvent(new element.ownerDocument.defaultView!.Event("change", { bubbles: true }));
}

function installDomGlobals(domWindow: Window): () => void {
  const globals = globalThis as unknown as {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
    document?: Document;
    window?: Window;
  };
  const previous = { act: globals.IS_REACT_ACT_ENVIRONMENT, document: globals.document, window: globals.window };
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  globals.document = domWindow.document;
  globals.window = domWindow;
  return () => {
    globals.IS_REACT_ACT_ENVIRONMENT = previous.act;
    globals.document = previous.document;
    globals.window = previous.window;
  };
}
