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
const USER_ID = "99999999-9999-4999-a999-999999999999";
const CAMPAIGN_ID = "88888888-8888-4888-a888-888888888888";
const BRIEF_ID = "77777777-7777-4777-a777-777777777777";

test("campaign quote claims bind the current canonical document before mapping reuse", options, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "discovery-campaign-claims");
  const db = await connectedPool(t, databaseUrl);
  await db.query("insert into users (user_id,email,display_name) values ($1::uuid,'quote-owner@example.test','Quote Owner')", [USER_ID]);
  await db.query(
    `insert into discovery_campaigns (campaign_id,user_id,name,question,current_brief_version)
     values ($1::uuid,$2::uuid,'Quote ownership','Which companies benefit from grid modernization spending?',1)`,
    [CAMPAIGN_ID, USER_ID],
  );
  await db.query(
    `insert into discovery_briefs (brief_id,campaign_id,version,brief,content_hash,approved_at)
     values ($1::uuid,$2::uuid,1,'{}'::jsonb,$3,now())`,
    [BRIEF_ID, CAMPAIGN_ID, "sha256:" + "d".repeat(64)],
  );
  for (const runId of ["aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", "dddddddd-dddd-4ddd-addd-dddddddddddd"]) {
    await db.query(
      `insert into discovery_runs (run_id,campaign_id,user_id,brief_id,request_key,status,stage,policy_version,limits,usage,checkpoint,coverage)
       values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,gen_random_uuid(),'completed','finalization','v1','{}','{}','{}','{}')`,
      [runId, CAMPAIGN_ID, USER_ID, BRIEF_ID],
    );
  }
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
  await persistCampaignQuotes(db, {
    ...input(SOURCE_ID, CANONICAL_HASH),
    operation_key: "dddddddd-dddd-4ddd-addd-dddddddddddd/research/bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb/analyst",
  });
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
  const rows = await db.query<{ claims: string; mappings: string; refs: string }>(
    `select
       (select count(*)::text from claims where predicate='campaign_exact_quote') as claims,
       (select count(*)::text from discovery_quote_claims) as mappings,
       (select count(*)::text from discovery_quote_claim_refs) as refs`,
  );
  assert.deepEqual(rows.rows, [{ claims: "1", mappings: "1", refs: "2" }]);
});
