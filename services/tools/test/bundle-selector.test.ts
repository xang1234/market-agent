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
      classification: classification(bundle_id),
    });

    assert.equal(selection.ok, true);
    assert.equal(selection.bundle_id, bundle_id);
    assert.equal(selection.bundle.bundle_id, bundle_id);
    assert.deepEqual(
      selection.tools.map((tool) => tool.name),
      registry.toolsForBundle(bundle_id).map((tool) => tool.name),
    );
  }
});

test("selectToolBundle returns a graceful rejection for unknown bundles", () => {
  const registry = loadToolRegistry();

  const selection = selectToolBundle({
    registry,
    classification: classification("made_up_bundle"),
  });

  assert.deepEqual(selection, {
    ok: false,
    reason: "unknown_bundle",
    bundle_id: "made_up_bundle",
    message: 'Unknown tool bundle "made_up_bundle"',
    available_bundle_ids: registry.bundleIds(),
  });
});

test("selectToolBundle preserves classification reason and returns frozen output", () => {
  const registry = loadToolRegistry();
  const selection = selectToolBundle({
    registry,
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
        classification: { bundle_id: "" },
      }),
    /classification\.bundle_id/,
  );
});

function classification(bundle_id: string): PreResolveBundleClassification {
  return Object.freeze({
    bundle_id,
    reason: `test selected ${bundle_id}`,
  });
}
