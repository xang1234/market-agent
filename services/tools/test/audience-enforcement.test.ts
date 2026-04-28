import test from "node:test";
import assert from "node:assert/strict";

import {
  assertRegistryAudienceBoundary,
  authorizeToolCall,
  authorizeToolResult,
  toolsForAudience,
  validateRegistryAudienceBoundary,
} from "../src/audience-enforcement.ts";
import { loadToolRegistry, parseToolRegistry } from "../src/registry.ts";

test("default registry satisfies the reader and analyst audience boundary", () => {
  assert.doesNotThrow(() => assertRegistryAudienceBoundary(loadToolRegistry()));
});

test("validateRegistryAudienceBoundary rejects analyst schemas that expose raw document handles", () => {
  const registry = parseToolRegistry(
    registryFixture({
      tools: [
        toolFixture({
          name: "unsafe_analyst_tool",
          output_json_schema: {
            type: "object",
            properties: {
              raw_blob_url: { type: "string" },
            },
            required: ["raw_blob_url"],
            additionalProperties: false,
          },
        }),
      ],
    }),
  );

  const result = validateRegistryAudienceBoundary(registry);

  assert.equal(result.ok, false);
  assert.deepEqual(result.violations, [
    {
      reason: "analyst_raw_schema",
      tool_name: "unsafe_analyst_tool",
      audience: "analyst",
      path: "output_json_schema.properties.raw_blob_url",
      field: "raw_blob_url",
      message:
        'Analyst tool "unsafe_analyst_tool" exposes raw document field "raw_blob_url" at output_json_schema.properties.raw_blob_url',
    },
  ]);
  assert.throws(
    () => assertRegistryAudienceBoundary(registry),
    /unsafe_analyst_tool.*raw_blob_url/,
  );
});

test("validateRegistryAudienceBoundary rejects analyst schemas with permissive additional properties", () => {
  const registry = parseToolRegistry(
    registryFixture({
      tools: [
        toolFixture({
          name: "permissive_analyst_tool",
          output_json_schema: {
            type: "object",
            properties: {
              document: {
                type: "object",
                additionalProperties: true,
              },
            },
            required: ["document"],
            additionalProperties: false,
          },
        }),
      ],
    }),
  );

  const result = validateRegistryAudienceBoundary(registry);

  assert.equal(result.ok, false);
  assert.deepEqual(result.violations, [
    {
      reason: "analyst_permissive_schema",
      tool_name: "permissive_analyst_tool",
      audience: "analyst",
      path: "output_json_schema.properties.document.additionalProperties",
      message:
        'Analyst tool "permissive_analyst_tool" permits arbitrary raw document fields at output_json_schema.properties.document.additionalProperties',
    },
  ]);
});

test("validateRegistryAudienceBoundary rejects analyst additional-property schemas without a raw-key guard", () => {
  const registry = parseToolRegistry(
    registryFixture({
      tools: [
        toolFixture({
          name: "unguarded_analyst_tool",
          input_json_schema: {
            type: "object",
            properties: {
              filters: {
                type: "object",
                additionalProperties: { type: "string" },
              },
            },
            required: ["filters"],
            additionalProperties: false,
          },
        }),
      ],
    }),
  );

  const result = validateRegistryAudienceBoundary(registry);

  assert.equal(result.ok, false);
  assert.deepEqual(result.violations, [
    {
      reason: "analyst_permissive_schema",
      tool_name: "unguarded_analyst_tool",
      audience: "analyst",
      path: "input_json_schema.properties.filters.additionalProperties",
      message:
        'Analyst tool "unguarded_analyst_tool" permits arbitrary raw document fields at input_json_schema.properties.filters.additionalProperties',
    },
  ]);
});

test("toolsForAudience separates reader-only tools from analyst tools inside shared bundles", () => {
  const registry = loadToolRegistry();

  const analystTools = toolsForAudience({
    registry,
    bundle_id: "document_research",
    audience: "analyst",
  });
  const readerTools = toolsForAudience({
    registry,
    bundle_id: "document_research",
    audience: "reader",
  });

  assert.equal(analystTools.some((tool) => tool.name === "get_claims"), true);
  assert.equal(
    analystTools.some((tool) => tool.name === "fetch_raw_document"),
    false,
  );
  assert.equal(readerTools.some((tool) => tool.name === "fetch_raw_document"), true);
  assert.equal(Object.isFrozen(analystTools), true);
  assert.equal(Object.isFrozen(readerTools), true);
});

test("authorizeToolCall allows analyst calls to analyst tools in the selected bundle", () => {
  const registry = loadToolRegistry();

  const authorization = authorizeToolCall({
    registry,
    bundle_id: "document_research",
    audience: "analyst",
    tool_name: "get_claims",
    arguments: {
      subject_refs: [],
      predicates: { event_type: "earnings" },
    },
  });

  assert.equal(authorization.ok, true);
  assert.equal(authorization.tool.name, "get_claims");
});

test("authorizeToolCall rejects analyst calls to reader-only tools", () => {
  const registry = loadToolRegistry();

  const authorization = authorizeToolCall({
    registry,
    bundle_id: "document_research",
    audience: "analyst",
    tool_name: "fetch_raw_document",
    arguments: {
      document_id: "70a0cc2e-e198-4b59-a5c9-9bd2da4a359b",
    },
  });

  assert.deepEqual(authorization, {
    ok: false,
    reason: "audience_mismatch",
    tool_name: "fetch_raw_document",
    bundle_id: "document_research",
    audience: "analyst",
    tool_audience: "reader",
    message:
      'Tool "fetch_raw_document" is for reader audience and cannot be used by analyst',
  });
});

test("authorizeToolCall rejects analyst calls that carry raw_blob_url", () => {
  const registry = loadToolRegistry();

  const authorization = authorizeToolCall({
    registry,
    bundle_id: "document_research",
    audience: "analyst",
    tool_name: "get_claims",
    arguments: {
      raw_blob_url: "s3://raw-filings/aapl-10q.html",
    },
  });

  assert.deepEqual(authorization, {
    ok: false,
    reason: "raw_document_payload",
    audience: "analyst",
    tool_name: "get_claims",
    path: "arguments.raw_blob_url",
    field: "raw_blob_url",
    message:
      'Analyst audience cannot receive raw document field "raw_blob_url" at arguments.raw_blob_url',
  });
});

test("authorizeToolResult rejects raw document handles before analyst delivery", () => {
  const registry = loadToolRegistry();

  const authorization = authorizeToolResult({
    registry,
    bundle_id: "document_research",
    audience: "analyst",
    tool_name: "get_evidence_bundle",
    result: {
      documents: [
        {
          document_id: "70a0cc2e-e198-4b59-a5c9-9bd2da4a359b",
          raw_blob_url: "s3://raw-filings/aapl-10q.html",
        },
      ],
    },
  });

  assert.deepEqual(authorization, {
    ok: false,
    reason: "raw_document_payload",
    audience: "analyst",
    tool_name: "get_evidence_bundle",
    path: "result.documents[0].raw_blob_url",
    field: "raw_blob_url",
    message:
      'Analyst audience cannot receive raw document field "raw_blob_url" at result.documents[0].raw_blob_url',
  });
});

test("authorizeToolResult allows reader results to carry raw document handles", () => {
  const registry = loadToolRegistry();

  const authorization = authorizeToolResult({
    registry,
    bundle_id: "document_research",
    audience: "reader",
    tool_name: "fetch_raw_document",
    result: {
      document: {
        document_id: "70a0cc2e-e198-4b59-a5c9-9bd2da4a359b",
      },
      raw_blob_url: "s3://raw-filings/aapl-10q.html",
    },
  });

  assert.equal(authorization.ok, true);
  assert.equal(authorization.tool.name, "fetch_raw_document");
});

function registryFixture(overrides: {
  bundles?: unknown;
  tools?: unknown;
} = {}) {
  return {
    version: "test",
    description: "Test registry",
    design_rules: [],
    bundles: overrides.bundles ?? [
      { bundle_id: "test_bundle", description: "Test bundle" },
    ],
    tools: overrides.tools ?? [toolFixture()],
  };
}

function toolFixture(overrides: Record<string, unknown> = {}) {
  return {
    name: "test_tool",
    audience: "analyst",
    bundles: ["test_bundle"],
    description: "Test tool",
    read_only: true,
    approval_required: false,
    cost_class: "low",
    freshness_expectation: "varies",
    input_json_schema: { type: "object", additionalProperties: false },
    output_json_schema: { type: "object", additionalProperties: false },
    error_codes: ["INVALID_ARGUMENT"],
    ...overrides,
  };
}
