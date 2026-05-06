import test from "node:test";
import assert from "node:assert/strict";
import {
  generateFindingHeadline,
  generateHomeCardHeadline,
} from "../src/headline-generator.ts";

const SNAPSHOT = {
  snapshot_id: "33333333-3333-4333-8333-333333333333",
  as_of: "2026-05-04T00:00:00.000Z",
};

test("generateFindingHeadline normalizes deterministic model output to an 80-char single line", async () => {
  const headline = await generateFindingHeadline({
    snapshot: SNAPSHOT,
    claimCluster: {
      cluster_id: "55555555-5555-4555-8555-555555555555",
      claim: "Apple demand improved in China after channel checks.",
    },
    model: async () => "  Apple Demand Improves in China\nwith extra text  ",
  });

  assert.equal(headline, "Apple Demand Improves in China");
  assert.equal(headline.length <= 80, true);
});

test("generateFindingHeadline falls back deterministically from cluster claim", async () => {
  const headline = await generateFindingHeadline({
    snapshot: SNAPSHOT,
    claimCluster: {
      cluster_id: "55555555-5555-4555-8555-555555555555",
      claim: "margin pressure widened as freight costs rose unexpectedly.",
    },
    model: async () => {
      throw new Error("model unavailable");
    },
  });

  assert.equal(headline, "Margin Pressure Widened as Freight Costs Rose Unexpectedly");
});

test("generateFindingHeadline fallback preserves acronym casing", async () => {
  const headline = await generateFindingHeadline({
    snapshot: SNAPSHOT,
    claimCluster: {
      cluster_id: "55555555-5555-4555-8555-555555555555",
      claim: "IFRS EPS growth accelerated after pricing improved.",
    },
    model: async () => {
      throw new Error("model unavailable");
    },
  });

  assert.equal(headline, "IFRS EPS Growth Accelerated After Pricing Improved");
});

test("generateFindingHeadline falls back when model returns a blank first line", async () => {
  const headline = await generateFindingHeadline({
    snapshot: SNAPSHOT,
    claimCluster: {
      cluster_id: "55555555-5555-4555-8555-555555555555",
      claim: "services margin improved as mix shifted higher.",
    },
    model: async () => "\nIgnored Second Line",
  });

  assert.equal(headline, "Services Margin Improved as Mix Shifted Higher");
});

test("generateHomeCardHeadline prefers finding context and applies the same cap", async () => {
  const headline = await generateHomeCardHeadline({
    finding: {
      headline: "raw claim text that should be rewritten",
      severity: "high",
      subjectLabel: "Apple",
    },
    clusterContext: "Multiple sources confirmed improving services demand.",
    model: async () => "Apple Services Demand Improves",
  });

  assert.equal(headline, "Apple Services Demand Improves");
});

test("generateHomeCardHeadline falls back when model returns whitespace", async () => {
  const headline = await generateHomeCardHeadline({
    finding: {
      headline: "EPS upside widened after cost cuts.",
      severity: "high",
      subjectLabel: "Apple",
    },
    model: async () => "   \n  ",
  });

  assert.equal(headline, "EPS Upside Widened After Cost Cuts");
});
