import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ENTITY_IMPACT_CHANNELS,
  IMPACT_DIRECTIONS,
  IMPACT_HORIZONS,
  createEntityImpact,
  listEntityImpactsForClaim,
} from "../src/entity-impact-repo.ts";
import type { QueryExecutor } from "../src/types.ts";

const ENTITY_IMPACT_ID = "11111111-1111-4111-a111-111111111111";
const CLAIM_ID = "22222222-2222-4222-a222-222222222222";
const SUBJECT_ID = "33333333-3333-4333-a333-333333333333";

function impactRow(overrides: Record<string, unknown> = {}) {
  return {
    entity_impact_id: ENTITY_IMPACT_ID,
    claim_id: CLAIM_ID,
    subject_kind: "issuer",
    subject_id: SUBJECT_ID,
    direction: "negative",
    channel: "supply_chain",
    horizon: "near_term",
    confidence: "0.82",
    created_at: new Date("2026-05-03T00:00:00.000Z"),
    ...overrides,
  };
}

function recordingDb(rows = [impactRow()]) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return {
        rows: rows as R[],
        command: text.includes("insert") ? "INSERT" : "SELECT",
        rowCount: rows.length,
        oid: 0,
        fields: [],
      };
    },
  };
  return { db, queries };
}

test("createEntityImpact inserts a routed subject impact", async () => {
  const { db, queries } = recordingDb();

  const impact = await createEntityImpact(db, {
    claim_id: CLAIM_ID,
    subject_kind: "issuer",
    subject_id: SUBJECT_ID,
    direction: "negative",
    channel: "supply_chain",
    horizon: "near_term",
    confidence: 0.82,
  });

  assert.equal(impact.entity_impact_id, ENTITY_IMPACT_ID);
  assert.deepEqual(impact.subject_ref, { kind: "issuer", id: SUBJECT_ID });
  assert.equal(impact.direction, "negative");
  assert.equal(impact.channel, "supply_chain");
  assert.equal(impact.horizon, "near_term");
  assert.equal(impact.confidence, 0.82);
  assert.match(queries[0]!.text, /insert into entity_impacts/);
  assert.deepEqual(queries[0]!.values, [
    CLAIM_ID,
    "issuer",
    SUBJECT_ID,
    "negative",
    "supply_chain",
    "near_term",
    0.82,
  ]);
});

test("listEntityImpactsForClaim returns impacts ordered by subject and id", async () => {
  const { db, queries } = recordingDb([
    impactRow({ entity_impact_id: "44444444-4444-4444-a444-444444444444", channel: "pricing" }),
    impactRow({ entity_impact_id: ENTITY_IMPACT_ID, channel: "supply_chain" }),
  ]);

  const impacts = await listEntityImpactsForClaim(db, CLAIM_ID);

  assert.equal(impacts.length, 2);
  assert.equal(impacts[0]!.channel, "pricing");
  assert.match(queries[0]!.text, /where claim_id = \$1/);
  assert.match(queries[0]!.text, /order by subject_kind/);
  assert.match(queries[0]!.text, /subject_id/);
  assert.match(queries[0]!.text, /entity_impact_id/);
  assert.deepEqual(queries[0]!.values, [CLAIM_ID]);
});

test("createEntityImpact rejects invalid inputs before querying", async () => {
  const { db, queries } = recordingDb();
  const valid = {
    claim_id: CLAIM_ID,
    subject_kind: "issuer" as const,
    subject_id: SUBJECT_ID,
    direction: "negative" as const,
    channel: "supply_chain" as const,
    horizon: "near_term" as const,
    confidence: 0.82,
  };

  await assert.rejects(() => createEntityImpact(db, { ...valid, claim_id: "not-a-uuid" }), /claim_id/);
  await assert.rejects(() => createEntityImpact(db, { ...valid, subject_kind: "company" as never }), /subject_kind/);
  await assert.rejects(() => createEntityImpact(db, { ...valid, subject_id: "not-a-uuid" }), /subject_id/);
  await assert.rejects(() => createEntityImpact(db, { ...valid, direction: "flat" as never }), /direction/);
  await assert.rejects(() => createEntityImpact(db, { ...valid, channel: "fundamentals" as never }), /channel/);
  await assert.rejects(() => createEntityImpact(db, { ...valid, horizon: "overnight" as never }), /horizon/);
  await assert.rejects(() => createEntityImpact(db, { ...valid, confidence: 1.1 }), /confidence/);

  assert.equal(queries.length, 0);
});

test("listEntityImpactsForClaim rejects invalid claim IDs before querying", async () => {
  const { db, queries } = recordingDb();

  await assert.rejects(() => listEntityImpactsForClaim(db, "not-a-uuid"), /claim_id/);

  assert.equal(queries.length, 0);
});

test("listEntityImpactsForClaim rejects stored values outside enum contracts", async () => {
  await assert.rejects(
    () => listEntityImpactsForClaim(recordingDb([impactRow({ direction: "flat" })]).db, CLAIM_ID),
    /direction/,
  );
  await assert.rejects(
    () => listEntityImpactsForClaim(recordingDb([impactRow({ channel: "fundamentals" })]).db, CLAIM_ID),
    /channel/,
  );
  await assert.rejects(
    () => listEntityImpactsForClaim(recordingDb([impactRow({ horizon: "overnight" })]).db, CLAIM_ID),
    /horizon/,
  );
  await assert.rejects(
    () => listEntityImpactsForClaim(recordingDb([impactRow({ confidence: "NaN" })]).db, CLAIM_ID),
    /confidence/,
  );
});

test("impact enum arrays pin the P3.4 routing contract", () => {
  assert.deepEqual(IMPACT_DIRECTIONS, ["positive", "negative", "mixed", "unknown"]);
  assert.deepEqual(ENTITY_IMPACT_CHANNELS, [
    "demand",
    "pricing",
    "supply_chain",
    "regulation",
    "competition",
    "balance_sheet",
    "sentiment",
  ]);
  assert.deepEqual(IMPACT_HORIZONS, ["near_term", "medium_term", "long_term"]);
  assert.equal(Object.isFrozen(IMPACT_DIRECTIONS), true);
  assert.equal(Object.isFrozen(ENTITY_IMPACT_CHANNELS), true);
  assert.equal(Object.isFrozen(IMPACT_HORIZONS), true);
});

test("entity_impacts.channel is constrained in the normative schema and forward migration", () => {
  const schema = readFileSync(
    new URL("../../../spec/finance_research_db_schema.sql", import.meta.url),
    "utf8",
  );
  const forwardMigration = readFileSync(
    new URL("../../../db/migrations/0014_entity_impacts_channel_constraint.up.sql", import.meta.url),
    "utf8",
  );

  assert.match(schema, /channel text not null check \(channel in \(/);
  assert.match(forwardMigration, /add constraint entity_impacts_channel_check/);
  assert.match(forwardMigration, /check \(channel in \(/);
  for (const channel of ENTITY_IMPACT_CHANNELS) {
    assert.match(schema, new RegExp(`'${channel}'`));
    assert.match(forwardMigration, new RegExp(`'${channel}'`));
  }
});
