import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  ENTITY_IMPACT_CHANNELS,
  IMPACT_HORIZONS,
} from "../src/entity-impact-repo.ts";
import {
  PUBLIC_SUBJECT_KINDS,
  SUBJECT_KINDS,
} from "../../shared/src/subject-ref.ts";

const schemaSql = readFileSync(join(import.meta.dirname, "../../../spec/finance_research_db_schema.sql"), "utf-8");

test("evidence impact vocabulary is the commodity event-impact vocabulary", () => {
  assert.deepEqual(ENTITY_IMPACT_CHANNELS, [
    "supply",
    "demand",
    "inventory",
    "curve_structure",
    "freight",
    "policy",
    "macro_fx",
    "weather",
    "disruption",
  ]);
  assert.deepEqual(IMPACT_HORIZONS, ["1d", "1w", "1m", "3m"]);
});

test("database subject and impact enums include the public commodities contract", () => {
  for (const kind of PUBLIC_SUBJECT_KINDS) {
    assert.match(schemaSql, new RegExp(`'${kind}'`), `subject_kind enum must include ${kind}`);
  }
  for (const kind of SUBJECT_KINDS) {
    assert.match(schemaSql, new RegExp(`'${kind}'`), `migration subject_kind enum must include ${kind}`);
  }
  for (const channel of ENTITY_IMPACT_CHANNELS) {
    assert.match(schemaSql, new RegExp(`'${channel}'`), `entity_impacts.channel must include ${channel}`);
  }
  for (const horizon of IMPACT_HORIZONS) {
    assert.match(schemaSql, new RegExp(`'${horizon}'`), `impact_horizon enum must include ${horizon}`);
  }
});
