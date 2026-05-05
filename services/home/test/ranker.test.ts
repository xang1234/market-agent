import assert from "node:assert/strict";
import test from "node:test";

import { rankHomeCards, scoreHomeCard } from "../src/ranker.ts";
import type { HomeFindingCard, HomeFindingSeverity } from "../src/types.ts";

const BASE_TIME = "2026-05-05T12:00:00.000Z";

function card(overrides: Partial<HomeFindingCard> & {
  home_card_id: string;
  severity: HomeFindingSeverity;
  created_at: string;
  user_affinity?: number;
}): HomeFindingCard {
  const finding = {
    finding_id: `${overrides.home_card_id}-finding`,
    agent_id: "33333333-3333-4333-a333-333333333333",
    snapshot_id: "44444444-4444-4444-a444-444444444444",
    subject_refs: [],
    claim_cluster_ids: [],
    severity: overrides.severity,
    headline: overrides.headline ?? overrides.home_card_id,
    summary_blocks: [],
    created_at: overrides.created_at,
  };
  return {
    home_card_id: overrides.home_card_id,
    dedupe_key: overrides.dedupe_key ?? overrides.home_card_id,
    primary_finding: finding,
    support_count: overrides.support_count ?? 1,
    contributing_finding_count: overrides.contributing_finding_count ?? 1,
    severity: overrides.severity,
    headline: overrides.headline ?? overrides.home_card_id,
    subject_refs: [],
    summary_blocks: [],
    created_at: overrides.created_at,
    agent_ids: ["33333333-3333-4333-a333-333333333333"],
    finding_ids: [finding.finding_id],
    claim_cluster_ids: [],
    user_affinity: overrides.user_affinity ?? 0,
    destination: overrides.destination ?? {
      kind: "none",
      reason: "test_fixture",
    },
  };
}

test("critical findings outrank low severity high-affinity cards by default", () => {
  const cards = [
    card({
      home_card_id: "low-affinity",
      severity: "low",
      created_at: "2026-05-05T12:00:00.000Z",
      user_affinity: 1,
    }),
    card({
      home_card_id: "critical-stale",
      severity: "critical",
      created_at: "2026-05-04T12:00:00.000Z",
      user_affinity: 0,
    }),
  ];

  const ranked = rankHomeCards(cards, { now: BASE_TIME });

  assert.equal(ranked[0].home_card_id, "critical-stale");
});

test("recent cards outrank stale cards when severity and affinity match", () => {
  const ranked = rankHomeCards(
    [
      card({
        home_card_id: "stale",
        severity: "medium",
        created_at: "2026-05-03T12:00:00.000Z",
      }),
      card({
        home_card_id: "recent",
        severity: "medium",
        created_at: "2026-05-05T11:00:00.000Z",
      }),
    ],
    { now: BASE_TIME },
  );

  assert.equal(ranked[0].home_card_id, "recent");
});

test("configurable weights can make affinity dominate", () => {
  const ranked = rankHomeCards(
    [
      card({
        home_card_id: "recent-low-affinity",
        severity: "medium",
        created_at: "2026-05-05T12:00:00.000Z",
        user_affinity: 0,
      }),
      card({
        home_card_id: "stale-high-affinity",
        severity: "medium",
        created_at: "2026-05-01T12:00:00.000Z",
        user_affinity: 1,
      }),
    ],
    {
      now: BASE_TIME,
      weights: {
        recency: 0,
        severity: 0,
        affinity: 1,
        recency_half_life_hours: 24,
        critical_override_margin: 0.5,
      },
    },
  );

  assert.equal(ranked[0].home_card_id, "stale-high-affinity");
});

test("scoreHomeCard clamps affinity and decays recency deterministically", () => {
  const fresh = scoreHomeCard(
    card({
      home_card_id: "fresh",
      severity: "low",
      created_at: BASE_TIME,
      user_affinity: 2,
    }),
    { now: BASE_TIME },
  );
  const halfLifeOld = scoreHomeCard(
    card({
      home_card_id: "old",
      severity: "low",
      created_at: "2026-05-04T12:00:00.000Z",
      user_affinity: 2,
    }),
    { now: BASE_TIME },
  );

  assert.equal(fresh.components.affinity, 1);
  assert.equal(fresh.components.recency, 1);
  assert.equal(halfLifeOld.components.recency, 0.5);
});

test("tie-breakers are deterministic", () => {
  const ranked = rankHomeCards(
    [
      card({
        home_card_id: "b-card",
        severity: "high",
        created_at: "2026-05-05T10:00:00.000Z",
      }),
      card({
        home_card_id: "a-card",
        severity: "high",
        created_at: "2026-05-05T10:00:00.000Z",
      }),
    ],
    { now: BASE_TIME },
  );

  assert.deepEqual(ranked.map((item) => item.home_card_id), ["a-card", "b-card"]);
});

test("rankHomeCards rejects invalid ranking weights", () => {
  assert.throws(
    () => rankHomeCards(
      [
        card({
          home_card_id: "bad-config",
          severity: "medium",
          created_at: BASE_TIME,
        }),
      ],
      {
        now: BASE_TIME,
        weights: {
          recency: Number.NaN,
          severity: 0,
          affinity: 0,
          recency_half_life_hours: 24,
          critical_override_margin: 0.5,
        },
      },
    ),
    /weights.recency must be a finite non-negative number/,
  );
});

test("rankHomeCards rejects invalid Date instances for now", () => {
  assert.throws(
    () => rankHomeCards(
      [
        card({
          home_card_id: "bad-now",
          severity: "medium",
          created_at: BASE_TIME,
        }),
      ],
      { now: new Date("not a date") },
    ),
    /now must be a valid date/,
  );
});
