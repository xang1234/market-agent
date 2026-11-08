// The scenario price comparison contract (#224): what compareScenarioToPrice
// produces, in its block, satisfies the canonical block schema, and the web's
// fixture is this output. Regenerate it with `UPDATE_FIXTURES=1 node
// --experimental-strip-types --test test/scenario-price-comparison-contract.test.ts`.

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { compareScenarioToPrice, type ComparisonContent, type ComparisonInput } from "../src/index.ts";

const SCHEMA = JSON.parse(readFileSync(new URL("../../../spec/finance_research_block_schema.json", import.meta.url), "utf8"));
const WEB_FIXTURE = new URL("../../../web/src/blocks/scenarioPriceComparison.fixture.json", import.meta.url);
const LISTING = "5f000000-0000-4000-8000-0000000003e1";
const EPS_SOURCE = "44444444-4444-4444-9444-444444444444";
const POLYGON = "00000000-0000-4000-a000-000000000009";

const INPUT: ComparisonInput = {
  scenario: {
    ref: { snapshot_id: "11111111-1111-4111-9111-111111111111", run_id: "99999999-9999-4999-9999-999999999999", unit_id: "chat_unit", presentation_hash: "a".repeat(64) },
    rows: (["bear", "base", "bull"] as const).map((scenario, index) => ({
      scenario, result_id: `9${index}999999-9999-4999-9999-999999999999`, multiple_text: `${20 + 5 * index}x`, value: { value: String(80 + 20 * index), currency: "USD" },
    })),
    available: true,
    eps_publication: { available_no_later_than: "2024-02-21T23:59:59.999-05:00", timing_precision: "date", source_timezone: "America/New_York" },
    eps_anchor: { listing_id: LISTING, reference_date: "2024-06-10" },
    allowed_source_classes: ["sec_filing", "market_data"],
  },
  requested: { kind: "latest" },
  received_at: "2024-06-10T14:00:00.000Z",
  listing: { listing_id: LISTING, ticker: "SCEN", timezone: "America/New_York", session_close_at: (date) => `${date}T20:00:00.000Z` },
  closes: {
    candidates: [{
      observation_id: "5f000000-0000-4000-8000-0000000003d1", listing_id: LISTING, source_id: POLYGON, body_sha256: "d".repeat(64), kind: "session_close",
      price_text: "100.00", currency: "USD", observed_at: "2024-06-07T20:00:00.000Z", known_at: "2024-06-07T20:15:00.000Z", fetched_at: "2024-06-07T20:15:00.000Z", adjustment_basis: "unadjusted", source_kind: "market_data", source_name: "polygon_market",
    }],
    unknown_publication: false,
  },
  splits: { checked_at: "2024-06-10T12:00:00.000Z", splits: [] },
};

function block(id: string, content: ComparisonContent) {
  return {
    id,
    kind: "scenario_price_comparison",
    snapshot_id: "22222222-2222-4222-9222-222222222222",
    data_ref: { kind: "scenario_price_comparison", id },
    source_refs: content.outcome.kind === "comparison" ? [EPS_SOURCE, POLYGON] : [EPS_SOURCE],
    as_of: content.cutoff?.at ?? content.received_at,
    subject_refs: [{ kind: "listing", id: LISTING }],
    comparison: content,
  };
}

test("a generated comparison and a named gap satisfy the canonical block schema, and are the web's fixture", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(SCHEMA);
  const validate = ajv.getSchema(`${SCHEMA.$id}#/$defs/Block`)!;
  const blocks = [
    block("price-comparison-1", compareScenarioToPrice(INPUT)),
    block("price-comparison-2", compareScenarioToPrice({ ...INPUT, closes: { candidates: [], unknown_publication: true } })),
  ];
  for (const candidate of blocks) assert.ok(validate(candidate), JSON.stringify(validate.errors));
  assert.equal(validate({ ...blocks[0], title: "Upside" }), false, "no title field");
  assert.equal(validate({ ...blocks[0], comparison: { ...blocks[0]!.comparison, verified: true } }), false, "no field beyond the contract");
  const text = `${JSON.stringify(blocks, null, 2)}\n`;
  if (process.env.UPDATE_FIXTURES === "1") writeFileSync(WEB_FIXTURE, text);
  assert.equal(readFileSync(WEB_FIXTURE, "utf8"), text);
});
