import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { AuthContext } from "../shell/authTypes.ts";
import { EvidenceInspectorProvider } from "./EvidenceInspectorProvider.tsx";
import { useEvidenceInspector } from "./useEvidenceInspector.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SNAPSHOT_ID = "11111111-1111-4111-8111-111111111111";
const NEXT_SNAPSHOT_ID = "33333333-3333-4333-8333-333333333333";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";
const NEXT_SOURCE_ID = "44444444-4444-4444-8444-444444444444";

test("EvidenceInspectorProvider opens the drawer with fetched inspection details", async () => {
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
    assert.match(dom.window.document.body.innerHTML, /Related refs/);
    assert.match(dom.window.document.body.innerHTML, /document:/);

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
