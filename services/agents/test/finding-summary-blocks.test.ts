import assert from "node:assert/strict";
import test from "node:test";

import blockSchema from "../../../web/src/blocks/blockSchema.json" with { type: "json" };
import {
  buildFindingSummaryBlocks,
  FindingSummaryBlockValidationError,
} from "../src/finding-summary-blocks.ts";
import { verifySnapshotSeal } from "../../snapshot/src/snapshot-verifier.ts";

const FINDING_ID = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE_ID = "33333333-3333-4333-8333-333333333333";
const SUBJECT_ID = "44444444-4444-4444-8444-444444444444";
const AS_OF = "2026-05-04T00:00:00.000Z";

test("buildFindingSummaryBlocks emits a schema-valid finding_card block", () => {
  const blocks = buildFindingSummaryBlocks({
    finding_id: FINDING_ID,
    snapshot_id: SNAPSHOT_ID,
    headline: "Gross margin claim corroborated by two primary sources",
    severity: "high",
    subject_refs: [{ kind: "issuer", id: SUBJECT_ID }],
    source_refs: [SOURCE_ID],
    as_of: AS_OF,
  });

  assert.equal(blocks.length, 1);
  assertFindingCardMatchesMirroredSchema(blocks[0]);
  assert.deepEqual(blocks[0], {
    id: `finding-card-${FINDING_ID}`,
    kind: "finding_card",
    snapshot_id: SNAPSHOT_ID,
    data_ref: { kind: "finding_card", id: FINDING_ID },
    source_refs: [SOURCE_ID],
    as_of: AS_OF,
    finding_id: FINDING_ID,
    headline: "Gross margin claim corroborated by two primary sources",
    severity: "high",
    subject_refs: [{ kind: "issuer", id: SUBJECT_ID }],
  });
});

test("buildFindingSummaryBlocks omits raw document text and unexpected fields", () => {
  const [block] = buildFindingSummaryBlocks({
    finding_id: FINDING_ID,
    snapshot_id: SNAPSHOT_ID,
    headline: "Pricing impact remains near-term",
    severity: "medium",
    source_refs: [SOURCE_ID],
    as_of: AS_OF,
  });

  const encoded = JSON.stringify(block);
  assert.doesNotMatch(encoded, /raw|body|blob|excerpt|content/i);
  assert.deepEqual(Object.keys(block).sort(), [
    "as_of",
    "data_ref",
    "finding_id",
    "headline",
    "id",
    "kind",
    "severity",
    "snapshot_id",
    "source_refs",
  ]);
});

test("buildFindingSummaryBlocks emits blocks accepted by the snapshot verifier", async () => {
  const [block] = buildFindingSummaryBlocks({
    finding_id: FINDING_ID,
    snapshot_id: SNAPSHOT_ID,
    headline: "Pricing impact remains near-term",
    severity: "medium",
    subject_refs: [{ kind: "issuer", id: SUBJECT_ID }],
    source_refs: [SOURCE_ID],
    as_of: AS_OF,
  });

  const result = await verifySnapshotSeal({
    snapshot_id: SNAPSHOT_ID,
    manifest: {
      subject_refs: [{ kind: "issuer", id: SUBJECT_ID }],
      fact_refs: [],
      claim_refs: [],
      event_refs: [],
      document_refs: [],
      source_ids: [SOURCE_ID],
      as_of: AS_OF,
      basis: "unadjusted",
      normalization: "raw",
    },
    blocks: [block],
    sources: [SOURCE_ID],
  });

  assert.equal(result.ok, true, JSON.stringify(result.failures));
});

test("buildFindingSummaryBlocks rejects invalid ids, severity, and timestamps", () => {
  assert.throws(
    () =>
      buildFindingSummaryBlocks({
        finding_id: "not-a-uuid",
        snapshot_id: SNAPSHOT_ID,
        headline: "Valid headline",
        severity: "high",
        source_refs: [SOURCE_ID],
        as_of: AS_OF,
      }),
    (error: Error) =>
      error instanceof FindingSummaryBlockValidationError && /finding_id.*UUID/.test(error.message),
  );

  assert.throws(
    () =>
      buildFindingSummaryBlocks({
        finding_id: FINDING_ID,
        snapshot_id: SNAPSHOT_ID,
        headline: "Valid headline",
        severity: "severe" as "high",
        source_refs: [SOURCE_ID],
        as_of: AS_OF,
      }),
    (error: Error) =>
      error instanceof FindingSummaryBlockValidationError && /severity/.test(error.message),
  );

  assert.throws(
    () =>
      buildFindingSummaryBlocks({
        finding_id: FINDING_ID,
        snapshot_id: SNAPSHOT_ID,
        headline: "Valid headline",
        severity: "high",
        source_refs: [SOURCE_ID],
        as_of: "today",
      }),
    (error: Error) =>
      error instanceof FindingSummaryBlockValidationError && /as_of/.test(error.message),
  );

  assert.throws(
    () =>
      buildFindingSummaryBlocks({
        finding_id: FINDING_ID,
        snapshot_id: SNAPSHOT_ID,
        headline: "Valid headline",
        severity: "high",
        source_refs: [SOURCE_ID],
        as_of: "2026-05-04",
      }),
    (error: Error) =>
      error instanceof FindingSummaryBlockValidationError && /as_of/.test(error.message),
  );
});

function assertFindingCardMatchesMirroredSchema(block: Record<string, unknown>): void {
  const defs = blockSchema.$defs as Record<string, unknown>;
  const baseBlock = defs.BaseBlock as {
    required: string[];
    properties: Record<string, unknown>;
  };
  const findingCard = defs.FindingCard as {
    allOf: [{ $ref: string }, { properties: Record<string, unknown>; required: string[] }];
  };
  const findingProps = findingCard.allOf[1].properties as Record<string, unknown>;
  const severitySchema = findingProps.severity as { enum: string[] };
  const dataRef = block.data_ref as { kind: string };
  const allowed = new Set([...Object.keys(baseBlock.properties), ...Object.keys(findingProps)]);

  for (const field of [...baseBlock.required, ...findingCard.allOf[1].required]) {
    assert.ok(field in block, `missing schema-required field ${field}`);
  }
  assert.equal(block.kind, "finding_card");
  assert.equal(dataRef.kind, "finding_card");
  assert.match(block.finding_id as string, uuidPattern());
  assert.match(block.snapshot_id as string, uuidPattern());
  assert.ok(severitySchema.enum.includes(block.severity as string));
  for (const key of Object.keys(block)) {
    assert.ok(allowed.has(key), `unexpected schema field ${key}`);
  }
}

function uuidPattern(): RegExp {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
}
