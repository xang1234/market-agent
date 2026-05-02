import test from "node:test";
import assert from "node:assert/strict";

import {
  READER_EXTRACTION_TOOL_NAMES,
  READER_TOOL_ERROR_CODES,
  ReaderToolError,
  createReaderToolDispatcher,
  type ReaderToolHandler,
  type ReaderToolHandlerMap,
} from "../src/reader-tool-dispatcher.ts";
import { loadToolRegistry } from "../src/registry.ts";

const SAMPLE_DOC_UUID = "70a0cc2e-e198-4b59-a5c9-9bd2da4a359b";
const SAMPLE_SOURCE_UUID = "11111111-1111-4111-a111-111111111111";

function emptyHandler(): ReaderToolHandler {
  return async () => ({
    items: [],
    source_ids: [SAMPLE_SOURCE_UUID],
  });
}

function fullHandlerSet(
  overrides: Partial<ReaderToolHandlerMap> = {},
): ReaderToolHandlerMap {
  return {
    extract_mentions: emptyHandler(),
    extract_claims: emptyHandler(),
    extract_candidate_facts: emptyHandler(),
    extract_events: emptyHandler(),
    classify_sentiment: emptyHandler(),
    ...overrides,
  };
}

// ---- contract-pinning constants ---------------------------------------------

test("READER_EXTRACTION_TOOL_NAMES is the bead's exact tool list, frozen", () => {
  // Pinned because the dispatcher's whole purpose is wiring THESE five
  // tools — adding a sixth changes the bead's scope and should require
  // an explicit edit + new handler. The frozen array is the contract.
  assert.deepEqual(
    [...READER_EXTRACTION_TOOL_NAMES],
    [
      "extract_mentions",
      "extract_claims",
      "extract_candidate_facts",
      "extract_events",
      "classify_sentiment",
    ],
  );
  assert.equal(Object.isFrozen(READER_EXTRACTION_TOOL_NAMES), true);
});

test("READER_TOOL_ERROR_CODES matches the registry's per-tool error_codes contract, frozen", () => {
  // Every reader extract tool's error_codes array in
  // finance_research_tool_registry.json is identical; the dispatcher
  // narrows handler errors into this same set so the wire response
  // stays inside the contract.
  assert.deepEqual(
    [...READER_TOOL_ERROR_CODES],
    [
      "INVALID_ARGUMENT",
      "NOT_FOUND",
      "UPSTREAM_UNAVAILABLE",
      "RATE_LIMITED",
      "POLICY_BLOCKED",
    ],
  );
  assert.equal(Object.isFrozen(READER_TOOL_ERROR_CODES), true);
});

// ---- construction-time wiring checks ---------------------------------------

test("createReaderToolDispatcher requires a handler for every reader extract tool", () => {
  // Missing-handler is a service-startup error, not a per-request
  // error. A request-time fallback would let a misconfigured
  // deployment silently fail-open for the un-wired tool.
  const registry = loadToolRegistry();
  assert.throws(
    () =>
      createReaderToolDispatcher({
        registry,
        handlers: {
          extract_mentions: emptyHandler(),
        },
      }),
    /missing handler.*extract_claims/,
  );
});

test("createReaderToolDispatcher rejects handlers wired to unknown tool names", () => {
  // Catches typos like { extract_mentioned: ... } at startup rather
  // than at first dispatch.
  const registry = loadToolRegistry();
  assert.throws(
    () =>
      createReaderToolDispatcher({
        registry,
        handlers: {
          ...fullHandlerSet(),
          extract_mentioned: emptyHandler(),
        } as unknown as ReaderToolHandlerMap,
      }),
    /handler.*extract_mentioned.*no matching tool/,
  );
});

test("createReaderToolDispatcher rejects handlers wired to non-reader-audience tools", () => {
  // The dispatcher only handles reader-audience tools by design.
  // If someone tries to register an analyst tool's name here, that's
  // an architecture violation — refuse at construction.
  const registry = loadToolRegistry();
  assert.throws(
    () =>
      createReaderToolDispatcher({
        registry,
        handlers: {
          ...fullHandlerSet(),
          get_claims: emptyHandler(),
        } as unknown as ReaderToolHandlerMap,
      }),
    /handler.*get_claims.*non-reader tool/,
  );
});

test("createReaderToolDispatcher.registeredToolNames returns the wired tools, frozen", () => {
  const registry = loadToolRegistry();
  const dispatcher = createReaderToolDispatcher({
    registry,
    handlers: fullHandlerSet(),
  });
  assert.deepEqual(
    [...dispatcher.registeredToolNames()],
    [...READER_EXTRACTION_TOOL_NAMES],
  );
  assert.equal(Object.isFrozen(dispatcher.registeredToolNames()), true);
});

// ---- audience enforcement at dispatch (the I4 frontier) --------------------

test("dispatch rejects analyst-audience invocations of reader tools (audience_mismatch)", async () => {
  // The bead's headline contract: analyst-audience tools cannot be
  // called on raw document bytes. The dispatcher's first gate is
  // authorizeToolCall — it MUST refuse audience mismatch before the
  // handler runs.
  const registry = loadToolRegistry();
  let handlerCalls = 0;
  const dispatcher = createReaderToolDispatcher({
    registry,
    handlers: fullHandlerSet({
      extract_mentions: async () => {
        handlerCalls += 1;
        return { items: [], source_ids: [SAMPLE_SOURCE_UUID] };
      },
    }),
  });

  const result = await dispatcher.dispatch({
    bundle_id: "document_research",
    audience: "analyst",
    tool_name: "extract_mentions",
    arguments: { document_id: SAMPLE_DOC_UUID },
  });

  assert.equal(result.ok, false);
  assert.equal(result.kind, "authorization");
  if (result.ok === false && result.kind === "authorization") {
    assert.equal(result.authorization.ok, false);
    if (result.authorization.ok === false) {
      assert.equal(result.authorization.reason, "audience_mismatch");
    }
  }
  assert.equal(handlerCalls, 0, "handler must not run on audience-rejected dispatch");
});

test("dispatch rejects calls to tools not in the named bundle", async () => {
  // tool_not_in_bundle path — analyst could try to invoke
  // extract_mentions in a bundle that doesn't include it.
  const registry = loadToolRegistry();
  let handlerCalls = 0;
  const dispatcher = createReaderToolDispatcher({
    registry,
    handlers: fullHandlerSet({
      extract_mentions: async () => {
        handlerCalls += 1;
        return { items: [], source_ids: [SAMPLE_SOURCE_UUID] };
      },
    }),
  });

  const result = await dispatcher.dispatch({
    bundle_id: "alert_management",
    audience: "reader",
    tool_name: "extract_mentions",
    arguments: { document_id: SAMPLE_DOC_UUID },
  });

  assert.equal(result.ok, false);
  if (result.ok === false && result.kind === "authorization") {
    assert.equal(result.authorization.ok, false);
    if (result.authorization.ok === false) {
      assert.equal(result.authorization.reason, "tool_not_in_bundle");
    }
  }
  assert.equal(handlerCalls, 0);
});

test("dispatch rejects unknown tool names", async () => {
  const registry = loadToolRegistry();
  const dispatcher = createReaderToolDispatcher({
    registry,
    handlers: fullHandlerSet(),
  });

  const result = await dispatcher.dispatch({
    bundle_id: "document_research",
    audience: "reader",
    tool_name: "nonexistent_tool",
    arguments: { document_id: SAMPLE_DOC_UUID },
  });

  assert.equal(result.ok, false);
  if (result.ok === false && result.kind === "authorization") {
    assert.equal(result.authorization.ok, false);
    if (result.authorization.ok === false) {
      assert.equal(result.authorization.reason, "unknown_tool");
    }
  }
});

test("dispatch refuses to invoke reader-audience tools outside the bead's wired set", async () => {
  // search_raw_documents and fetch_raw_document are reader-audience
  // tools but NOT this bead's responsibility (different shapes,
  // different handlers). The dispatcher must refuse them rather than
  // silently fall through to "no handler".
  const registry = loadToolRegistry();
  const dispatcher = createReaderToolDispatcher({
    registry,
    handlers: fullHandlerSet(),
  });

  const result = await dispatcher.dispatch({
    bundle_id: "document_research",
    audience: "reader",
    tool_name: "fetch_raw_document",
    arguments: { document_id: SAMPLE_DOC_UUID },
  });

  assert.equal(result.ok, false);
  if (result.ok === false && result.kind === "authorization") {
    assert.equal(result.authorization.ok, false);
    if (result.authorization.ok === false) {
      assert.equal(result.authorization.reason, "unknown_tool");
    }
  }
});

// ---- input validation (INVALID_ARGUMENT path) ------------------------------

test("dispatch returns INVALID_ARGUMENT when document_id is missing", async () => {
  const registry = loadToolRegistry();
  let handlerCalls = 0;
  const dispatcher = createReaderToolDispatcher({
    registry,
    handlers: fullHandlerSet({
      extract_claims: async () => {
        handlerCalls += 1;
        return { items: [], source_ids: [SAMPLE_SOURCE_UUID] };
      },
    }),
  });

  const result = await dispatcher.dispatch({
    bundle_id: "document_research",
    audience: "reader",
    tool_name: "extract_claims",
    arguments: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.kind, "tool_error");
  if (result.ok === false && result.kind === "tool_error") {
    assert.equal(result.error_code, "INVALID_ARGUMENT");
    assert.match(result.message, /document_id/);
  }
  assert.equal(handlerCalls, 0);
});

test("dispatch returns INVALID_ARGUMENT when document_id is not a UUID v4", async () => {
  const registry = loadToolRegistry();
  const dispatcher = createReaderToolDispatcher({
    registry,
    handlers: fullHandlerSet(),
  });

  const result = await dispatcher.dispatch({
    bundle_id: "document_research",
    audience: "reader",
    tool_name: "extract_events",
    arguments: { document_id: "not-a-uuid" },
  });

  assert.equal(result.ok, false);
  if (result.ok === false && result.kind === "tool_error") {
    assert.equal(result.error_code, "INVALID_ARGUMENT");
  }
});

test("dispatch returns INVALID_ARGUMENT when arguments is not an object", async () => {
  const registry = loadToolRegistry();
  const dispatcher = createReaderToolDispatcher({
    registry,
    handlers: fullHandlerSet(),
  });

  const result = await dispatcher.dispatch({
    bundle_id: "document_research",
    audience: "reader",
    tool_name: "extract_events",
    arguments: "not-an-object" as unknown as object,
  });

  assert.equal(result.ok, false);
  if (result.ok === false && result.kind === "tool_error") {
    assert.equal(result.error_code, "INVALID_ARGUMENT");
  }
});

// ---- happy path ------------------------------------------------------------

test("dispatch invokes the registered handler with the parsed input on the success path", async () => {
  const registry = loadToolRegistry();
  let receivedInput: { document_id: string; schema_hint?: unknown } | null = null;
  const dispatcher = createReaderToolDispatcher({
    registry,
    handlers: fullHandlerSet({
      extract_candidate_facts: async (input) => {
        receivedInput = input;
        return {
          items: [{ kind: "candidate_fact", value: 42 }],
          source_ids: [SAMPLE_SOURCE_UUID],
        };
      },
    }),
  });

  const result = await dispatcher.dispatch({
    bundle_id: "document_research",
    audience: "reader",
    tool_name: "extract_candidate_facts",
    arguments: {
      document_id: SAMPLE_DOC_UUID,
      schema_hint: { fact_kind: "guidance" },
    },
  });

  assert.equal(result.ok, true);
  if (result.ok === true) {
    assert.equal(result.tool_name, "extract_candidate_facts");
    assert.deepEqual(result.result.items, [{ kind: "candidate_fact", value: 42 }]);
    assert.deepEqual([...result.result.source_ids], [SAMPLE_SOURCE_UUID]);
  }
  assert.deepEqual(receivedInput, {
    document_id: SAMPLE_DOC_UUID,
    schema_hint: { fact_kind: "guidance" },
  });
});

test("dispatch passes only document_id when schema_hint is absent (no spurious undefined)", async () => {
  const registry = loadToolRegistry();
  let receivedInput: { document_id: string; schema_hint?: unknown } | null = null;
  const dispatcher = createReaderToolDispatcher({
    registry,
    handlers: fullHandlerSet({
      extract_mentions: async (input) => {
        receivedInput = input;
        return { items: [], source_ids: [SAMPLE_SOURCE_UUID] };
      },
    }),
  });

  await dispatcher.dispatch({
    bundle_id: "document_research",
    audience: "reader",
    tool_name: "extract_mentions",
    arguments: { document_id: SAMPLE_DOC_UUID },
  });

  assert.deepEqual(receivedInput, { document_id: SAMPLE_DOC_UUID });
  assert.equal(
    Object.hasOwn(receivedInput as object, "schema_hint"),
    false,
    "absent schema_hint must not be carried as undefined",
  );
});

// ---- handler-thrown ReaderToolError translates to error_code ---------------

test("dispatch maps a ReaderToolError(NOT_FOUND) thrown by the handler to a NOT_FOUND tool_error", async () => {
  // Handlers report domain errors by throwing ReaderToolError; the
  // dispatcher narrows them into the registry's error_codes contract
  // so the wire response always declares one of the documented codes.
  const registry = loadToolRegistry();
  const dispatcher = createReaderToolDispatcher({
    registry,
    handlers: fullHandlerSet({
      extract_claims: async () => {
        throw new ReaderToolError("NOT_FOUND", "document does not exist");
      },
    }),
  });

  const result = await dispatcher.dispatch({
    bundle_id: "document_research",
    audience: "reader",
    tool_name: "extract_claims",
    arguments: { document_id: SAMPLE_DOC_UUID },
  });

  assert.equal(result.ok, false);
  if (result.ok === false && result.kind === "tool_error") {
    assert.equal(result.tool_name, "extract_claims");
    assert.equal(result.error_code, "NOT_FOUND");
    assert.match(result.message, /document does not exist/);
  }
});

test("dispatch propagates non-ReaderToolError throws (programmer bugs surface, not get hidden)", async () => {
  // A handler that throws TypeError isn't reporting a domain error;
  // it's a bug. Translating it to UPSTREAM_UNAVAILABLE would mask
  // the bug from observability. Let it bubble.
  const registry = loadToolRegistry();
  const dispatcher = createReaderToolDispatcher({
    registry,
    handlers: fullHandlerSet({
      extract_events: async () => {
        throw new TypeError("oops, programmer bug");
      },
    }),
  });

  await assert.rejects(
    () =>
      dispatcher.dispatch({
        bundle_id: "document_research",
        audience: "reader",
        tool_name: "extract_events",
        arguments: { document_id: SAMPLE_DOC_UUID },
      }),
    /programmer bug/,
  );
});

// ---- handler output validation ---------------------------------------------

test("dispatch returns INVALID_ARGUMENT when handler output omits items", async () => {
  // Defensive against handler bugs — a handler returning the wrong
  // shape would corrupt the wire contract. Catch and route through
  // tool_error rather than letting a malformed payload reach the caller.
  const registry = loadToolRegistry();
  const dispatcher = createReaderToolDispatcher({
    registry,
    handlers: fullHandlerSet({
      classify_sentiment: async () =>
        ({ source_ids: [SAMPLE_SOURCE_UUID] } as unknown as {
          items: never[];
          source_ids: string[];
        }),
    }),
  });

  const result = await dispatcher.dispatch({
    bundle_id: "document_research",
    audience: "reader",
    tool_name: "classify_sentiment",
    arguments: { document_id: SAMPLE_DOC_UUID },
  });

  assert.equal(result.ok, false);
  if (result.ok === false && result.kind === "tool_error") {
    assert.equal(result.error_code, "INVALID_ARGUMENT");
    assert.match(result.message, /items/);
  }
});

test("dispatch returns INVALID_ARGUMENT when handler output source_ids contains non-UUIDs", async () => {
  const registry = loadToolRegistry();
  const dispatcher = createReaderToolDispatcher({
    registry,
    handlers: fullHandlerSet({
      classify_sentiment: async () => ({
        items: [],
        source_ids: ["not-a-uuid"],
      }),
    }),
  });

  const result = await dispatcher.dispatch({
    bundle_id: "document_research",
    audience: "reader",
    tool_name: "classify_sentiment",
    arguments: { document_id: SAMPLE_DOC_UUID },
  });

  assert.equal(result.ok, false);
  if (result.ok === false && result.kind === "tool_error") {
    assert.equal(result.error_code, "INVALID_ARGUMENT");
    assert.match(result.message, /source_ids/);
  }
});

// ---- I4 invariant: registry static-audit gate at construction ---------------

test("createReaderToolDispatcher rejects a registry that violates the audience boundary", () => {
  // If the registry itself is misconfigured (e.g. an analyst tool
  // exposes raw_blob_url), the dispatcher refuses to start. This is
  // the I4 frontier in code form — no traffic can flow until the
  // static audit is clean.
  const registry = loadToolRegistry();
  // Mutate the registry's tool list at parse-time to inject a bad
  // analyst tool. We use the same loader but feed it altered JSON.
  // Easier path: build a fake registry-shaped object that violates
  // the boundary. The dispatcher's audit call must throw.
  const badRegistry = {
    ...registry,
    tools: Object.freeze([
      ...registry.tools,
      Object.freeze({
        name: "leaky_analyst_tool",
        audience: "analyst" as const,
        bundles: registry.tools[0]?.bundles ?? [],
        description: "leaky",
        read_only: true,
        approval_required: false,
        cost_class: "low" as const,
        freshness_expectation: "static",
        input_json_schema: {},
        output_json_schema: {
          type: "object",
          properties: { raw_blob_url: { type: "string" } },
          required: ["raw_blob_url"],
          additionalProperties: false,
        },
        error_codes: ["INVALID_ARGUMENT"],
      }),
    ]),
  };

  assert.throws(
    () =>
      createReaderToolDispatcher({
        registry: badRegistry,
        handlers: fullHandlerSet(),
      }),
    /audience boundary.*leaky_analyst_tool/,
  );
});
