// Reader-audience tool dispatcher (fra-wmx).
//
// Wires the bead's five reader-audience extraction tools — extract_*,
// classify_sentiment — to a runtime that:
//   1. Static-audits the registry at construction (I4 frontier in code).
//   2. Authorizes every dispatch against the registry (audience match,
//      tool-in-bundle, raw-payload reject for analyst).
//   3. Validates the input shape (document_id is a UUID) before invoking
//      the handler.
//   4. Narrows handler-thrown ReaderToolErrors into the registry's
//      declared error_codes; lets unexpected throws (programmer bugs,
//      handler-output-shape failures) bubble unmodified so observability
//      records them as bugs, not as domain errors with a misleading
//      client-blameable error_code.
//
// Input contract narrowing: the registry's input_json_schema declares
// `additionalProperties: true` for all five tools, but parseReaderToolInput
// forwards only the contract's named fields (document_id, schema_hint).
// Extras are dropped silently — handlers don't see them today. Downstream
// beads (fra-6j0.3 / fra-6j0.4) that want extras (model_hint, temperature,
// etc.) must extend ReaderToolInput here AND add the field to handler
// signatures, both of which require an explicit edit here.
//
// Handlers themselves live in services/evidence/src/reader/* — the
// dispatcher is intentionally agnostic to where extraction happens.

import {
  assertRegistryAudienceBoundary,
  authorizeToolCall,
  type ToolCallAuthorization,
} from "./audience-enforcement.ts";
import type {
  JsonObject,
  JsonValue,
  ToolAudience,
  ToolRegistry,
} from "./registry.ts";

// The five tools whose handlers fra-wmx wires. Pinned as a frozen
// tuple so adding a sixth requires an explicit edit + handler.
export const READER_EXTRACTION_TOOL_NAMES = Object.freeze([
  "extract_mentions",
  "extract_claims",
  "extract_candidate_facts",
  "extract_events",
  "classify_sentiment",
] as const);

export type ReaderExtractionToolName =
  (typeof READER_EXTRACTION_TOOL_NAMES)[number];

// Per-tool error_codes from finance_research_tool_registry.json — every
// reader extract tool declares the same set, so the dispatcher narrows
// handler errors into this single union.
export const READER_TOOL_ERROR_CODES = Object.freeze([
  "INVALID_ARGUMENT",
  "NOT_FOUND",
  "UPSTREAM_UNAVAILABLE",
  "RATE_LIMITED",
  "POLICY_BLOCKED",
] as const);

export type ReaderToolErrorCode = (typeof READER_TOOL_ERROR_CODES)[number];

export class ReaderToolError extends Error {
  readonly code: ReaderToolErrorCode;
  constructor(code: ReaderToolErrorCode, message: string) {
    // Validate at construction so a misspelled or invented code cannot
    // leak onto the wire — the dispatcher trusts error.code from any
    // ReaderToolError thrown by a handler. The constructor is the
    // single chokepoint where every emitted code is provably one of
    // READER_TOOL_ERROR_CODES (matches each tool's registry contract).
    if (!READER_TOOL_ERROR_CODES.includes(code)) {
      throw new Error(
        `ReaderToolError: code "${code}" is not declared in READER_TOOL_ERROR_CODES (${[...READER_TOOL_ERROR_CODES].join(", ")})`,
      );
    }
    super(`${code}: ${message}`);
    this.name = "ReaderToolError";
    this.code = code;
  }
}

// Common shape across all five extract*/classify_sentiment tools per
// the registry's input/output JSON schemas.
export type ReaderToolInput = {
  document_id: string;
  schema_hint?: JsonValue;
};

export type ReaderToolOutput = {
  items: ReadonlyArray<JsonObject>;
  source_ids: ReadonlyArray<string>;
};

export type ReaderToolHandler = (
  input: ReaderToolInput,
) => Promise<ReaderToolOutput>;

export type ReaderToolHandlerMap = {
  readonly [K in ReaderExtractionToolName]?: ReaderToolHandler;
};

export type DispatchInput = {
  bundle_id: string;
  audience: ToolAudience;
  tool_name: string;
  arguments: JsonValue;
};

export type DispatchSuccess = {
  ok: true;
  tool_name: ReaderExtractionToolName;
  result: ReaderToolOutput;
};

export type DispatchAuthorizationRejection = {
  ok: false;
  kind: "authorization";
  authorization: ToolCallAuthorization;
};

export type DispatchToolError = {
  ok: false;
  kind: "tool_error";
  tool_name: string;
  error_code: ReaderToolErrorCode;
  message: string;
};

export type DispatchResult =
  | DispatchSuccess
  | DispatchAuthorizationRejection
  | DispatchToolError;

export type ReaderToolDispatcher = {
  dispatch(input: DispatchInput): Promise<DispatchResult>;
  registeredToolNames(): ReadonlyArray<ReaderExtractionToolName>;
};

export type CreateReaderToolDispatcherInput = {
  registry: ToolRegistry;
  handlers: ReaderToolHandlerMap;
};

// Same regex as services/evidence/src/validators.ts — duplicated by the
// codebase's per-service-decoupled-validators convention. Keep in sync.
const UUID_V4 =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

const READER_EXTRACTION_TOOL_NAME_SET: ReadonlySet<string> = new Set(
  READER_EXTRACTION_TOOL_NAMES,
);

export function createReaderToolDispatcher(
  input: CreateReaderToolDispatcherInput,
): ReaderToolDispatcher {
  const { registry, handlers } = input;

  // I4 frontier in code: refuse to construct a dispatcher against a
  // registry whose schemas violate the analyst-can't-see-raw-text rule.
  // No subsequent runtime path can lie about the registry being safe.
  assertRegistryAudienceBoundary(registry);

  const handlerNames = Object.keys(handlers);
  for (const name of handlerNames) {
    const tool = registry.getTool(name);
    if (!tool) {
      throw new Error(
        `createReaderToolDispatcher: handler "${name}" has no matching tool in the registry`,
      );
    }
    if (tool.audience !== "reader") {
      throw new Error(
        `createReaderToolDispatcher: handler "${name}" wires a non-reader tool (audience="${tool.audience}"); reader-tool dispatcher only accepts reader-audience tools`,
      );
    }
    if (!READER_EXTRACTION_TOOL_NAME_SET.has(name)) {
      throw new Error(
        `createReaderToolDispatcher: handler "${name}" is reader-audience but not in the dispatcher's wired set (${[...READER_EXTRACTION_TOOL_NAMES].join(", ")})`,
      );
    }
  }
  for (const name of READER_EXTRACTION_TOOL_NAMES) {
    if (!handlers[name]) {
      throw new Error(
        `createReaderToolDispatcher: missing handler for reader extract tool "${name}"`,
      );
    }
  }
  // Construction validated every wired tool has a handler — promote
  // to Required<> so dispatch() can index without an undefined check.
  const validatedHandlers = handlers as Required<ReaderToolHandlerMap>;

  const wiredNames = Object.freeze([...READER_EXTRACTION_TOOL_NAMES]);

  return Object.freeze({
    registeredToolNames: () => wiredNames,
    async dispatch(call: DispatchInput): Promise<DispatchResult> {
      // Gate 1: registry-driven authorization (audience, bundle, raw payload).
      const authorization = authorizeToolCall({
        registry,
        bundle_id: call.bundle_id,
        audience: call.audience,
        tool_name: call.tool_name,
        arguments: call.arguments,
      });
      if (!authorization.ok) {
        return Object.freeze({
          ok: false,
          kind: "authorization",
          authorization,
        });
      }

      // Gate 2: refuse reader-audience tools the dispatcher does not own
      // (search_raw_documents, fetch_raw_document, etc.). They share
      // audience but have different shapes/handlers.
      if (!isReaderExtractionToolName(call.tool_name)) {
        return Object.freeze({
          ok: false,
          kind: "authorization",
          authorization: Object.freeze({
            ok: false,
            reason: "unknown_tool",
            tool_name: call.tool_name,
            message: `Reader extraction dispatcher does not handle "${call.tool_name}"`,
          }),
        });
      }

      // Gate 3: input shape.
      const parsed = parseReaderToolInput(call.arguments);
      if (parsed.kind === "error") {
        return toolError(call.tool_name, parsed.code, parsed.message);
      }

      // Invoke. ReaderToolError is the documented domain-error path;
      // anything else is a programmer bug and bubbles unmodified so
      // observability can record it as such (not as a domain error).
      let raw: ReaderToolOutput;
      try {
        raw = await validatedHandlers[call.tool_name](parsed.input);
      } catch (error) {
        if (error instanceof ReaderToolError) {
          return toolError(call.tool_name, error.code, error.message);
        }
        throw error;
      }

      // Gate 4: output shape (defends the wire contract from handler
      // bugs). Failures here are programmer bugs, not domain errors —
      // bubbled like the non-ReaderToolError throw above so observability
      // sees them as bugs rather than as a misleading INVALID_ARGUMENT
      // response that a caller couldn't act on.
      const validated = assertValidReaderToolOutput(raw);

      return Object.freeze({
        ok: true,
        tool_name: call.tool_name,
        result: validated,
      });
    },
  });
}

function isReaderExtractionToolName(
  name: string,
): name is ReaderExtractionToolName {
  return READER_EXTRACTION_TOOL_NAME_SET.has(name);
}

function toolError(
  tool_name: string,
  code: ReaderToolErrorCode,
  message: string,
): DispatchToolError {
  return Object.freeze({
    ok: false,
    kind: "tool_error",
    tool_name,
    error_code: code,
    message,
  });
}

type ParseInputResult =
  | { kind: "ok"; input: ReaderToolInput }
  | { kind: "error"; code: ReaderToolErrorCode; message: string };

function parseReaderToolInput(args: JsonValue): ParseInputResult {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return {
      kind: "error",
      code: "INVALID_ARGUMENT",
      message: "arguments: must be an object",
    };
  }

  const record = args as { [key: string]: JsonValue | undefined };
  const document_id = record.document_id;
  if (typeof document_id !== "string" || document_id.length === 0) {
    return {
      kind: "error",
      code: "INVALID_ARGUMENT",
      message: "document_id: must be a non-empty string",
    };
  }
  if (!UUID_V4.test(document_id)) {
    return {
      kind: "error",
      code: "INVALID_ARGUMENT",
      message: "document_id: must be a UUID v4",
    };
  }

  const schema_hint = record.schema_hint;
  if (schema_hint === undefined) {
    return { kind: "ok", input: { document_id } };
  }
  return { kind: "ok", input: { document_id, schema_hint } };
}

function assertValidReaderToolOutput(output: unknown): ReaderToolOutput {
  if (output === null || typeof output !== "object" || Array.isArray(output)) {
    throw new Error("handler output: must be an object");
  }

  const record = output as { [key: string]: unknown };
  const items = record.items;
  if (!Array.isArray(items)) {
    throw new Error("handler output.items: must be an array");
  }
  for (const [i, item] of items.entries()) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`handler output.items[${i}]: must be a JSON object`);
    }
  }

  const source_ids = record.source_ids;
  if (!Array.isArray(source_ids)) {
    throw new Error("handler output.source_ids: must be an array");
  }
  for (const [i, id] of source_ids.entries()) {
    if (typeof id !== "string" || !UUID_V4.test(id)) {
      throw new Error(`handler output.source_ids[${i}]: must be a UUID v4`);
    }
  }

  return Object.freeze({
    items: Object.freeze([...items]) as ReadonlyArray<JsonObject>,
    source_ids: Object.freeze([...source_ids]) as ReadonlyArray<string>,
  });
}
