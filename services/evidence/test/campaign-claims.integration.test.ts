import assert from "node:assert/strict";
import test from "node:test";

import { bootstrapDatabase, connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { persistCampaignQuotes } from "../src/campaign-claims.ts";

const options = { skip: !dockerAvailable(), timeout: 120_000 };
const DOCUMENT_ID = "11111111-1111-4111-a111-111111111111";
const SOURCE_ID = "22222222-2222-4222-a222-222222222222";
const OTHER_SOURCE_ID = "33333333-3333-4333-a333-333333333333";
const CANONICAL_HASH = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const RAW_BLOB_HASH = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const REQUEST_HASH = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const QUOTE = "Grid modernization equipment sales increased during the quarter.";

test("campaign quote claims bind the current canonical document before mapping reuse", options, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "discovery-campaign-claims");
  const db = await connectedPool(t, databaseUrl);
  await db.query(
    `insert into sources (source_id,provider,kind,trust_tier,license_class,retrieved_at)
     values ($1::uuid,'campaign-test','press_release','primary','test',now()),
            ($2::uuid,'campaign-test','press_release','primary','test',now())`,
    [SOURCE_ID, OTHER_SOURCE_ID],
  );
  await db.query(
    `insert into documents (document_id,source_id,kind,content_hash,raw_blob_id,parse_status)
     values ($1::uuid,$2::uuid,'press_release',$3,$4,'parsed')`,
    [DOCUMENT_ID, SOURCE_ID, CANONICAL_HASH, RAW_BLOB_HASH],
  );

  const input = (source_id: string, document_hash: string) => ({
    operation_key: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/research/bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb/analyst",
    request_hash: REQUEST_HASH,
    quotes: [{
      excerpt_id: "44444444-4444-4444-a444-444444444444",
      document_id: DOCUMENT_ID,
      source_id,
      document_hash,
      normalized_start: 40,
      quote: QUOTE,
    }],
  });

  await persistCampaignQuotes(db, input(SOURCE_ID, CANONICAL_HASH));
  await assert.rejects(
    () => persistCampaignQuotes(db, input(OTHER_SOURCE_ID, CANONICAL_HASH)),
    /canonical document/i,
    "a mismatched source must not reuse the existing quote-key mapping",
  );
  await assert.rejects(
    () => persistCampaignQuotes(db, input(SOURCE_ID, RAW_BLOB_HASH)),
    /canonical document/i,
    "raw blob identity is not the canonical document hash",
  );
  const rows = await db.query<{ claims: string; mappings: string }>(
    `select
       (select count(*)::text from claims where predicate='campaign_exact_quote') as claims,
       (select count(*)::text from discovery_quote_claims) as mappings`,
  );
  assert.deepEqual(rows.rows, [{ claims: "1", mappings: "1" }]);
});
