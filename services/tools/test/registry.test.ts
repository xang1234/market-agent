import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadToolRegistry,
  parseToolRegistry,
  resolveToolRegistryPath,
} from "../src/registry.ts";

test("loadToolRegistry reads the default commodities research registry", () => {
  const registry = loadToolRegistry();

  assert.equal(registry.version, "1.0.0");
  assert.ok(registry.bundles.length > 0);
  assert.ok(registry.tools.length > 0);

  assert.deepEqual(registry.bundleIds(), [
    "commodity_quote_lookup",
    "curve_analysis",
    "report_delta_analysis",
    "event_impact_analysis",
    "balance_snapshot",
    "daily_call_run",
    "forecast_assumption_review",
    "alert_management",
  ]);

  const buildDailyCall = registry.getTool("build_daily_call");
  assert.ok(buildDailyCall);
  assert.equal(buildDailyCall.audience, "analyst");
  assert.equal(buildDailyCall.read_only, false);
  assert.equal(buildDailyCall.approval_required, true);
  assert.equal(buildDailyCall.cost_class, "high");
  assert.equal(buildDailyCall.freshness_expectation, "daily");
  assert.deepEqual(buildDailyCall.input_json_schema.properties.snapshot_id, {
    type: "string",
    format: "uuid",
  });
  assert.deepEqual(buildDailyCall.input_json_schema.required, [
    "snapshot_id",
    "commodity_refs",
    "horizons",
  ]);
  assert.equal(buildDailyCall.input_json_schema.additionalProperties, false);

  const dailyCallTools = registry.toolsForBundle("daily_call_run").map((tool) => tool.name);
  for (const requiredTool of [
    "get_commodity_latest",
    "get_curve",
    "get_balance_snapshot",
    "get_impact_drivers",
    "build_daily_call",
  ]) {
    assert.equal(dailyCallTools.includes(requiredTool), true, `${requiredTool} must be available to daily_call_run`);
  }
});

test("resolveToolRegistryPath finds a repo-level spec from a dist-like module directory", () => {
  const root = mkdtempSync(join(tmpdir(), "tool-registry-root-"));
  const specDir = join(root, "spec");
  const moduleDir = join(root, "services", "tools", "dist");
  mkdirSync(specDir, { recursive: true });
  mkdirSync(moduleDir, { recursive: true });
  const registryPath = join(specDir, "finance_research_tool_registry.json");
  writeFileSync(registryPath, JSON.stringify(registryFixture()), "utf8");

  assert.equal(
    resolveToolRegistryPath({
      moduleDir,
      cwd: join(tmpdir(), "outside-registry-root"),
      env: {},
    }),
    registryPath,
  );
});

test("loadToolRegistry reads tool definitions from the provided registry file", () => {
  const registryPath = writeRegistryFile({
    bundles: [
      {
        bundle_id: "custom_bundle",
        description: "Custom runtime bundle",
      },
    ],
    tools: [
      {
        name: "custom_tool",
        audience: "reader",
        bundles: ["custom_bundle"],
        description: "Custom runtime tool",
        read_only: true,
        approval_required: false,
        cost_class: "high",
        freshness_expectation: "seconds_to_minutes",
        input_json_schema: { type: "object", additionalProperties: false },
        output_json_schema: { type: "object", additionalProperties: false },
        error_codes: ["INVALID_ARGUMENT"],
      },
    ],
  });

  const registry = loadToolRegistry({ registryPath });

  assert.equal(registry.getBundle("custom_bundle")?.description, "Custom runtime bundle");
  assert.equal(registry.getTool("custom_tool")?.freshness_expectation, "seconds_to_minutes");
  assert.deepEqual(registry.toolsForBundle("custom_bundle").map((tool) => tool.name), [
    "custom_tool",
  ]);
});

test("parseToolRegistry rejects tools that reference unknown bundles", () => {
  assert.throws(
    () =>
      parseToolRegistry(
        registryFixture({
          bundles: [{ bundle_id: "known", description: "Known bundle" }],
          tools: [
            toolFixture({
              name: "bad_tool",
              bundles: ["missing"],
            }),
          ],
        }),
      ),
    /unknown bundle "missing"/,
  );
});

test("parseToolRegistry rejects duplicate tool names", () => {
  assert.throws(
    () =>
      parseToolRegistry(
        registryFixture({
          tools: [toolFixture({ name: "same" }), toolFixture({ name: "same" })],
        }),
      ),
    /duplicate tool "same"/,
  );
});

test("parseToolRegistry rejects duplicate bundle memberships on a tool", () => {
  assert.throws(
    () =>
      parseToolRegistry(
        registryFixture({
          tools: [
            toolFixture({
              bundles: ["test_bundle", "test_bundle"],
            }),
          ],
        }),
      ),
    /duplicate bundle "test_bundle"/,
  );
});

test("loadToolRegistry returns immutable registry structures", () => {
  const registry = loadToolRegistry();
  const tool = registry.getTool("resolve_subjects");

  assert.equal(Object.isFrozen(registry), true);
  assert.equal(Object.isFrozen(registry.bundles), true);
  assert.equal(Object.isFrozen(registry.tools), true);
  assert.ok(tool);
  assert.equal(Object.isFrozen(tool), true);
  assert.equal(Object.isFrozen(tool.bundles), true);
  assert.equal(Object.isFrozen(tool.input_json_schema), true);
});

test("public index exports the registry loader", async () => {
  const { loadToolRegistry: loadFromIndex } = await import("../src/index.ts");
  assert.equal(
    loadFromIndex().getTool("resolve_subjects")?.name,
    "resolve_subjects",
  );
});

function writeRegistryFile(overrides: {
  bundles?: unknown;
  tools?: unknown;
}): string {
  const dir = mkdtempSync(join(tmpdir(), "tool-registry-"));
  const path = join(dir, "finance_research_tool_registry.json");
  writeFileSync(path, JSON.stringify(registryFixture(overrides)), "utf8");
  return path;
}

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
    input_json_schema: { type: "object" },
    output_json_schema: { type: "object" },
    error_codes: ["INVALID_ARGUMENT"],
    ...overrides,
  };
}
