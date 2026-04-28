import test from "node:test";
import assert from "node:assert/strict";

import { loadToolRegistry } from "../src/registry.ts";
import {
  selectToolBundle,
  type PreResolveBundleClassification,
} from "../src/bundle-selector.ts";

test("selectToolBundle selects every registered bundle from pre-resolve classification", () => {
  const registry = loadToolRegistry();

  for (const bundle_id of registry.bundleIds()) {
    const selection = selectToolBundle({
      registry,
      audience: "analyst",
      classification: classification(bundle_id),
    });

    assert.equal(selection.ok, true);
    assert.equal(selection.audience, "analyst");
    assert.equal(selection.bundle_id, bundle_id);
    assert.equal(selection.bundle.bundle_id, bundle_id);
    assert.deepEqual(
      selection.tools.map((tool) => tool.name),
      registry
        .toolsForBundle(bundle_id)
        .filter((tool) => tool.audience === "analyst")
        .map((tool) => tool.name),
    );
  }
});

test("selectToolBundle filters reader tools out of analyst bundle selections", () => {
  const registry = loadToolRegistry();

  const selection = selectToolBundle({
    registry,
    audience: "analyst",
    classification: classification("document_research"),
  });

  assert.equal(selection.ok, true);
  assert.equal(selection.tools.some((tool) => tool.name === "get_claims"), true);
  assert.equal(
    selection.tools.some((tool) => tool.name === "fetch_raw_document"),
    false,
  );
});

test("selectToolBundle returns a graceful rejection for unknown bundles", () => {
  const registry = loadToolRegistry();

  const selection = selectToolBundle({
    registry,
    audience: "analyst",
    classification: classification("made_up_bundle"),
  });

  assert.deepEqual(selection, {
    ok: false,
    reason: "unknown_bundle",
    audience: "analyst",
    bundle_id: "made_up_bundle",
    message: 'Unknown tool bundle "made_up_bundle"',
    available_bundle_ids: registry.bundleIds(),
  });
});

test("selectToolBundle preserves classification reason and returns frozen output", () => {
  const registry = loadToolRegistry();
  const selection = selectToolBundle({
    registry,
    audience: "analyst",
    classification: {
      bundle_id: "peer_comparison",
      reason: "multiple resolved subjects require comparison tools",
    },
  });

  assert.equal(selection.ok, true);
  assert.equal(
    selection.classification.reason,
    "multiple resolved subjects require comparison tools",
  );
  assert.equal(Object.isFrozen(selection), true);
  assert.equal(Object.isFrozen(selection.classification), true);
  assert.equal(Object.isFrozen(selection.tools), true);
});

test("selectToolBundle rejects malformed classifications before registry lookup", () => {
  const registry = loadToolRegistry();

  assert.throws(
    () =>
      selectToolBundle({
        registry,
        audience: "analyst",
        classification: { bundle_id: "" },
      }),
    /classification\.bundle_id/,
  );
});

test("selectToolBundle rejects missing or invalid runtime audiences", () => {
  const registry = loadToolRegistry();

  assert.throws(
    () =>
      selectToolBundle({
        registry,
        classification: classification("document_research"),
      }),
    /audience/,
  );
  assert.throws(
    () =>
      selectToolBundle({
        registry,
        audience: "portfolio_manager",
        classification: classification("document_research"),
      }),
    /audience/,
  );
});

function classification(bundle_id: string): PreResolveBundleClassification {
  return Object.freeze({
    bundle_id,
    reason: `test selected ${bundle_id}`,
  });
}
