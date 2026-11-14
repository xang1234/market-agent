import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";

import { AuthContext } from "../shell/authTypes.ts";
import { EvidenceInspectorDock, EvidenceInspectorProvider } from "./EvidenceInspectorProvider.tsx";
import { useEvidenceInspector } from "./useEvidenceInspector.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SNAPSHOT_ID = "11111111-1111-4111-8111-111111111111";
const NEXT_SNAPSHOT_ID = "33333333-3333-4333-8333-333333333333";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";
const NEXT_SOURCE_ID = "44444444-4444-4444-8444-444444444444";

test("EvidenceInspectorProvider opens the panel with fetched inspection details", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window);
  const originalFetch = globalThis.fetch;
  const calls: Array<{ input: string; body: unknown }> = [];
  try {
    globalThis.fetch = async (input, init) => {
      calls.push({ input: String(input), body: JSON.parse(String(init?.body)) });
      assert.equal((init?.headers as Record<string, string>)["x-user-id"], USER_ID);
      return new Response(JSON.stringify({
        snapshot_id: SNAPSHOT_ID,
        ref: { kind: "source", id: SOURCE_ID },
        kind: "source",
        title: "sec filing",
        subtitle: "https://www.sec.gov/Archives/example",
        badges: ["primary"],
        rows: [{ label: "Provider", value: "sec" }],
        links: [{ label: "Open source", href: "https://www.sec.gov/Archives/example" }],
        related_refs: [{ kind: "document", id: NEXT_SOURCE_ID }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    function OpenButton() {
      const inspector = useEvidenceInspector();
      return (
        <button
          type="button"
          onClick={() => inspector?.openInspection({
            snapshotId: SNAPSHOT_ID,
            ref: { kind: "source", id: SOURCE_ID },
          })}
        >
          Inspect
        </button>
      );
    }

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
            <OpenButton />
            <EvidenceInspectorDock />
          </EvidenceInspectorProvider>
        </AuthContext.Provider>,
      );
    });

    await act(async () => {
      dom.window.document.querySelector("button")?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    await act(async () => undefined);

    assert.deepEqual(calls, [{
      input: "/v1/evidence/inspect",
      body: {
        snapshot_id: SNAPSHOT_ID,
        ref: { kind: "source", id: SOURCE_ID },
      },
    }]);
    assert.match(dom.window.document.body.innerHTML, /Evidence inspector/);
    assert.match(dom.window.document.body.innerHTML, /sec filing/);
    assert.match(dom.window.document.body.innerHTML, /Provider/);
    assert.match(dom.window.document.body.innerHTML, /Open source/);
    assert.equal(
      dom.window.document.querySelector('a[href="https://www.sec.gov/Archives/example"]')?.getAttribute("rel"),
      "noopener noreferrer",
    );
    assert.deepEqual(relatedRefTexts(dom.window.document), ["Document"]);

    await act(async () => root.unmount());
  } finally {
    globalThis.fetch = originalFetch;
    restoreGlobals();
  }
});

test("EvidenceInspectorProvider keeps the latest inspection when requests resolve out of order", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window);
  const originalFetch = globalThis.fetch;
  const responses = new Map<string, Deferred<Response>>();
  try {
    globalThis.fetch = async (_input, init) => {
      const snapshotId = JSON.parse(String(init?.body)).snapshot_id;
      const response = createDeferred<Response>();
      responses.set(snapshotId, response);
      return response.promise;
    };

    function OpenButtons() {
      const inspector = useEvidenceInspector();
      return (
        <>
          <button
            type="button"
            onClick={() => inspector?.openInspection({
              snapshotId: SNAPSHOT_ID,
              ref: { kind: "source", id: SOURCE_ID },
            })}
          >
            Inspect old
          </button>
          <button
            type="button"
            onClick={() => inspector?.openInspection({
              snapshotId: NEXT_SNAPSHOT_ID,
              ref: { kind: "source", id: NEXT_SOURCE_ID },
            })}
          >
            Inspect new
          </button>
        </>
      );
    }

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
            <OpenButtons />
            <EvidenceInspectorDock />
          </EvidenceInspectorProvider>
        </AuthContext.Provider>,
      );
    });

    const buttons = dom.window.document.querySelectorAll("button");
    await act(async () => {
      buttons[0]?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      buttons[1]?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });

    assert.equal(responses.size, 2);

    await act(async () => {
      responses.get(NEXT_SNAPSHOT_ID)?.resolve(makeInspectionResponse({
        snapshotId: NEXT_SNAPSHOT_ID,
        sourceId: NEXT_SOURCE_ID,
        title: "new filing",
      }));
    });
    assert.match(dom.window.document.body.innerHTML, /new filing/);

    await act(async () => {
      responses.get(SNAPSHOT_ID)?.resolve(makeInspectionResponse({
        snapshotId: SNAPSHOT_ID,
        sourceId: SOURCE_ID,
        title: "old filing",
      }));
    });
    await act(async () => undefined);

    assert.match(dom.window.document.body.innerHTML, /new filing/);
    assert.doesNotMatch(dom.window.document.body.innerHTML, /old filing/);

    await act(async () => root.unmount());
  } finally {
    globalThis.fetch = originalFetch;
    restoreGlobals();
  }
});

test("EvidenceInspectorProvider maps inspection 404s to stable user-facing copy", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      Response.json({ error: "ref is not present in snapshot manifest" }, { status: 404 });

    function OpenButton() {
      const inspector = useEvidenceInspector();
      return (
        <button
          type="button"
          onClick={() => inspector?.openInspection({
            snapshotId: SNAPSHOT_ID,
            ref: { kind: "source", id: SOURCE_ID },
          })}
        >
          Inspect
        </button>
      );
    }

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
            <OpenButton />
            <EvidenceInspectorDock />
          </EvidenceInspectorProvider>
        </AuthContext.Provider>,
      );
    });

    await act(async () => {
      dom.window.document.querySelector("button")?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    await act(async () => undefined);

    assert.match(dom.window.document.body.innerHTML, /Evidence is not available for this artifact/);
    assert.doesNotMatch(dom.window.document.body.innerHTML, /ref is not present/);

    await act(async () => root.unmount());
  } finally {
    globalThis.fetch = originalFetch;
    restoreGlobals();
  }
});

const FACT_ID = "55555555-5555-4555-8555-555555555555";
const CLAIM_ID = "66666666-6666-4666-8666-666666666666";

const FACT_INSPECTION = {
  snapshot_id: SNAPSHOT_ID,
  ref: { kind: "fact", id: FACT_ID },
  kind: "fact",
  title: "42 %",
  subtitle: "fiscal_q 2026 Q2",
  badges: ["verified"],
  rows: [
    { label: "Value", value: "42" },
    { label: "As of", value: "2026-05-29T00:00:00.000Z" },
  ],
  links: [{ label: "Open source", href: "https://www.sec.gov/Archives/example" }],
  related_refs: [
    { kind: "source", id: SOURCE_ID, label: "sec" },
    { kind: "claim", id: CLAIM_ID },
  ],
};

const SOURCE_INSPECTION = {
  snapshot_id: SNAPSHOT_ID,
  ref: { kind: "source", id: SOURCE_ID },
  kind: "source",
  title: "sec filing",
  subtitle: "https://www.sec.gov/Archives/example",
  badges: [],
  rows: [
    { label: "Provider", value: "sec" },
    { label: "Retrieved", value: "2026-05-30T08:00:00.000Z" },
  ],
  links: [],
  related_refs: [],
};

test("the inspector docks in the content row in place of the rail, and the rail returns on close", async () => {
  const app = await mountDockedInspector(async (ref) => jsonResponse(ref.kind === "fact" ? FACT_INSPECTION : SOURCE_INSPECTION));
  try {
    assert.deepEqual(app.rowChildren(), ["MAIN", "Activity rail"]);

    await app.click(app.opener("Revenue"));

    assert.deepEqual(app.rowChildren(), ["MAIN", "Evidence inspector"]);
    assert.equal(app.panel()?.classList.contains("fixed"), false);
    assert.equal(app.panel()?.classList.contains("w-[420px]"), true);

    await app.click(app.button("Close"));

    assert.deepEqual(app.rowChildren(), ["MAIN", "Activity rail"]);
  } finally {
    await app.unmount();
  }
});

test("opening moves focus to the panel heading, and Escape closes it and returns focus to the opener", async () => {
  const app = await mountDockedInspector(async () => jsonResponse(FACT_INSPECTION));
  try {
    const opener = app.opener("Revenue");
    await app.click(opener);

    const focused = app.document.activeElement;
    assert.equal(focused?.tagName, "H2");
    assert.equal(focused?.textContent, "42 %");
    assert.equal(opener.getAttribute("data-inspecting"), "true");

    await act(async () => {
      focused?.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    assert.equal(app.panel(), null);
    assert.equal(app.document.activeElement, opener);
    assert.equal(opener.getAttribute("data-inspecting"), null);
  } finally {
    await app.unmount();
  }
});

test("the header names the kind, provider, and as-of date instead of the snapshot id", async () => {
  const app = await mountDockedInspector(async () => jsonResponse(FACT_INSPECTION));
  try {
    await app.click(app.opener("Revenue"));

    assert.equal(app.headerSubtitle(), "Fact · sec · As of May 29, 2026");
    assert.equal(app.panel()?.querySelector("header")?.textContent?.includes(SNAPSHOT_ID), false);
  } finally {
    await app.unmount();
  }
});

test("related refs read as their label, or as their kind when the server sends none", async () => {
  const app = await mountDockedInspector(async () => jsonResponse(FACT_INSPECTION));
  try {
    await app.click(app.opener("Revenue"));

    assert.deepEqual(relatedRefTexts(app.document), ["sec", "Claim"]);
  } finally {
    await app.unmount();
  }
});

test("following a related ref pushes a page, and Back returns to the previous page as it was", async () => {
  const app = await mountDockedInspector(async (ref) => jsonResponse(ref.kind === "fact" ? FACT_INSPECTION : SOURCE_INSPECTION));
  try {
    const opener = app.opener("Revenue");
    await app.click(opener);
    await app.click(app.relatedRef("sec"));

    assert.equal(app.heading(), "sec filing");
    assert.equal(app.headerSubtitle(), "Source · sec · Retrieved May 30, 2026");
    assert.deepEqual(app.breadcrumb(), ["42 %", "sec filing"]);
    assert.equal(app.document.activeElement?.textContent, "sec filing");
    assert.equal(opener.getAttribute("data-inspecting"), "true");

    await app.click(app.button("Back"));

    assert.equal(app.heading(), "42 %");
    assert.equal(app.document.activeElement?.textContent, "42 %");
    assert.deepEqual(relatedRefTexts(app.document), ["sec", "Claim"]);
    assert.equal(app.breadcrumb(), null);
    assert.deepEqual(app.fetchedKinds, ["fact", "source"]);
  } finally {
    await app.unmount();
  }
});

test("a breadcrumb entry steps back to that page", async () => {
  const app = await mountDockedInspector(async (ref) => jsonResponse(ref.kind === "fact" ? FACT_INSPECTION : SOURCE_INSPECTION));
  try {
    await app.click(app.opener("Revenue"));
    await app.click(app.relatedRef("sec"));

    await app.click(app.button("42 %"));

    assert.equal(app.heading(), "42 %");
    assert.equal(app.breadcrumb(), null);
  } finally {
    await app.unmount();
  }
});

test("a response for a page the user went back from is ignored", async () => {
  const pending = createDeferred<Response>();
  const app = await mountDockedInspector(async (ref) => ref.kind === "fact" ? jsonResponse(FACT_INSPECTION) : pending.promise);
  try {
    await app.click(app.opener("Revenue"));
    await app.click(app.relatedRef("sec"));
    assert.equal(app.heading(), "Source");

    await app.click(app.button("Back"));
    await act(async () => pending.resolve(jsonResponse(SOURCE_INSPECTION)));

    assert.equal(app.heading(), "42 %");
    assert.equal(app.panel()?.textContent?.includes("sec filing"), false);
  } finally {
    await app.unmount();
  }
});

test("opening from the page starts a fresh stack and moves the highlight to the new opener", async () => {
  const app = await mountDockedInspector(async (ref) => jsonResponse(ref.kind === "fact" ? FACT_INSPECTION : SOURCE_INSPECTION));
  try {
    const revenue = app.opener("Revenue");
    const filing = app.opener("Filing");
    await app.click(revenue);
    await app.click(app.relatedRef("sec"));

    await app.click(filing);

    assert.equal(app.heading(), "sec filing");
    assert.equal(app.breadcrumb(), null);
    assert.equal(revenue.getAttribute("data-inspecting"), null);
    assert.equal(filing.getAttribute("data-inspecting"), "true");

    await app.click(app.button("Close"));

    assert.equal(filing.getAttribute("data-inspecting"), null);
    assert.equal(app.document.activeElement, filing);
  } finally {
    await app.unmount();
  }
});

test("signing out closes the inspector, so no evidence is left for the next user", async () => {
  const app = await mountDockedInspector(async () => jsonResponse(FACT_INSPECTION));
  try {
    await app.click(app.opener("Revenue"));
    assert.equal(app.heading(), "42 %");

    await app.signOut();

    assert.equal(app.panel(), null);
    assert.deepEqual(app.rowChildren(), ["MAIN", "Activity rail"]);
  } finally {
    await app.unmount();
  }
});

test("closing returns focus to the main content when the opener is gone", async () => {
  const app = await mountDockedInspector(async () => jsonResponse(FACT_INSPECTION));
  try {
    await app.click(app.opener("Once"));
    assert.equal(app.document.querySelector("main")?.textContent?.includes("Once"), false);

    await app.click(app.button("Close"));

    assert.equal(app.document.activeElement?.id, "workspace-main");
  } finally {
    await app.unmount();
  }
});

test("the panel heads with the text the user clicked, and with the server title when there is none", async () => {
  const app = await mountDockedInspector(async (ref) =>
    jsonResponse(ref.kind === "fact" ? { ...FACT_INSPECTION, title: "30 multiple" } : SOURCE_INSPECTION));
  try {
    await app.click(app.opener("P/E"));
    assert.equal(app.heading(), "30.0×");

    await app.click(app.relatedRef("sec"));
    assert.deepEqual(app.breadcrumb(), ["30.0×", "sec filing"]);

    await app.click(app.opener("Revenue"));
    assert.equal(app.heading(), "30 multiple");
  } finally {
    await app.unmount();
  }
});

async function mountDockedInspector(respond: (ref: { kind: string; id: string }) => Promise<Response>) {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window);
  const originalFetch = globalThis.fetch;
  const fetchedKinds: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const { ref } = JSON.parse(String(init?.body));
    fetchedKinds.push(ref.kind);
    return respond(ref);
  };

  function Openers() {
    const inspector = useEvidenceInspector();
    const [once, setOnce] = useState(true);
    return (
      <>
        {once ? (
          <button
            type="button"
            onClick={() => {
              setOnce(false);
              inspector?.openInspection({ snapshotId: SNAPSHOT_ID, ref: { kind: "fact", id: FACT_ID } });
            }}
          >
            Once
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => inspector?.openInspection({ snapshotId: SNAPSHOT_ID, ref: { kind: "fact", id: FACT_ID } })}
        >
          Revenue
        </button>
        <button
          type="button"
          onClick={() => inspector?.openInspection({ snapshotId: SNAPSHOT_ID, ref: { kind: "source", id: SOURCE_ID } })}
        >
          Filing
        </button>
        <button
          type="button"
          onClick={() => inspector?.openInspection({ snapshotId: SNAPSHOT_ID, ref: { kind: "fact", id: FACT_ID }, shownAs: "30.0×" })}
        >
          P/E
        </button>
      </>
    );
  }

  const root = createRoot(dom.window.document.getElementById("root")!);
  const render = (session: { userId: string; displayName: string } | null) =>
    act(async () => {
      root.render(
        <AuthContext.Provider value={{ session, signIn: () => undefined, signOut: () => undefined }}>
          <EvidenceInspectorProvider>
            <div data-testid="content-row" className="flex">
              <main id="workspace-main" tabIndex={-1}>
                <Openers />
              </main>
              <EvidenceInspectorDock fallback={<aside aria-label="Activity rail">Rail</aside>} />
            </div>
          </EvidenceInspectorProvider>
        </AuthContext.Provider>,
      );
    });
  await render({ userId: USER_ID, displayName: "Mock User" });

  const document = dom.window.document;
  const panel = () => document.querySelector<HTMLElement>('aside[aria-label="Evidence inspector"]');
  const buttonIn = (scope: ParentNode, text: string) => {
    const match = [...scope.querySelectorAll<HTMLElement>("button")].find((button) => button.textContent === text);
    assert.ok(match, `no button reads ${text}`);
    return match;
  };
  return {
    window: dom.window,
    document,
    fetchedKinds,
    panel,
    opener: (text: string) => buttonIn(document.querySelector("main")!, text),
    button: (text: string) => buttonIn(panel()!, text),
    relatedRef: (text: string) => {
      const match = [...panel()!.querySelectorAll<HTMLElement>("button[data-inspection-kind]")]
        .find((button) => button.textContent === text);
      assert.ok(match, `no related ref reads ${text}`);
      return match;
    },
    heading: () => panel()?.querySelector("h2")?.textContent ?? null,
    headerSubtitle: () => panel()?.querySelector("h2 + p")?.textContent ?? null,
    breadcrumb: () => {
      const nav = panel()?.querySelector('nav[aria-label="Inspector pages"]');
      return nav ? [...nav.querySelectorAll("li > :last-child")].map((crumb) => crumb.textContent) : null;
    },
    rowChildren: () =>
      [...document.querySelector('[data-testid="content-row"]')!.children].map((child) =>
        child.getAttribute("aria-label") ?? child.tagName,
      ),
    async click(element: HTMLElement) {
      await act(async () => {
        element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      });
      await act(async () => undefined);
    },
    signOut: () => render(null),
    async unmount() {
      await act(async () => root.unmount());
      globalThis.fetch = originalFetch;
      restoreGlobals();
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function relatedRefTexts(document: Document): string[] {
  return [...document.querySelectorAll('aside[aria-label="Evidence inspector"] li > button[data-inspection-kind]')]
    .map((button) => button.textContent ?? "");
}

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

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeInspectionResponse(input: {
  snapshotId: string;
  sourceId: string;
  title: string;
}): Response {
  return new Response(JSON.stringify({
    snapshot_id: input.snapshotId,
    ref: { kind: "source", id: input.sourceId },
    kind: "source",
    title: input.title,
    subtitle: null,
    badges: [],
    rows: [{ label: "Provider", value: "sec" }],
    links: [],
    related_refs: [],
  }), { status: 200, headers: { "content-type": "application/json" } });
}
