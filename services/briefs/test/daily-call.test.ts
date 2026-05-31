import assert from "node:assert/strict";
import test from "node:test";

import {
  DAILY_CALL_STATUSES,
  buildDailyCallDraft,
  publishDailyCall,
} from "../src/daily-call.ts";

const SNAPSHOT_ID = "11111111-1111-4111-9111-111111111111";
const COPPER_ID = "22222222-2222-4222-9222-222222222222";
const IRON_ORE_ID = "33333333-3333-4333-9333-333333333333";

test("buildDailyCallDraft creates an analyst-signoff brief for copper and iron ore", () => {
  assert.deepEqual(DAILY_CALL_STATUSES, ["draft", "published"]);

  const brief = buildDailyCallDraft({
    brief_id: "brief-1",
    snapshot_id: SNAPSHOT_ID,
    as_of: "2026-05-31T00:00:00.000Z",
    commodity_refs: [
      { kind: "commodity", id: COPPER_ID },
      { kind: "commodity", id: IRON_ORE_ID },
    ],
    narrative: "Copper and iron ore calls are mixed into the Asia open.",
    driver_ids: ["driver-1", "driver-2"],
    watch_items: ["China PMI", "LME inventory draw"],
  });

  assert.equal(brief.status, "draft");
  assert.equal(brief.requires_analyst_signoff, true);
  assert.deepEqual(brief.horizons, ["1d", "1w", "1m", "3m"]);
  assert.equal(Object.isFrozen(brief.driver_ids), true);
});

test("publishDailyCall stamps reviewer and published timestamp without mutating draft", () => {
  const draft = buildDailyCallDraft({
    brief_id: "brief-1",
    snapshot_id: SNAPSHOT_ID,
    as_of: "2026-05-31T00:00:00.000Z",
    commodity_refs: [{ kind: "commodity", id: COPPER_ID }],
    narrative: "Copper tone is constructive.",
    driver_ids: ["driver-1"],
    watch_items: [],
  });

  const published = publishDailyCall(draft, {
    reviewer_user_id: "44444444-4444-4444-9444-444444444444",
    published_at: "2026-05-31T01:00:00.000Z",
  });

  assert.equal(draft.status, "draft");
  assert.equal(published.status, "published");
  assert.equal(published.reviewer_user_id, "44444444-4444-4444-9444-444444444444");
  assert.equal(published.published_at, "2026-05-31T01:00:00.000Z");
});
