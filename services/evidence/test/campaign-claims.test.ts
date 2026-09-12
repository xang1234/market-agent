import assert from "node:assert/strict";
import test from "node:test";

import { campaignQuoteKey, persistCampaignQuotes } from "../src/campaign-claims.ts";
import type { QueryExecutor } from "../src/types.ts";

const DOCUMENT_ID = "11111111-1111-4111-a111-111111111111";
const SOURCE_ID = "22222222-2222-4222-a222-222222222222";
const CLAIM_ID = "33333333-3333-4333-a333-333333333333";
const QUOTE = "Grid modernization equipment sales increased during the quarter.";

test("quote keys bind the canonical document, normalized offset, and exact quote", () => {
  const first = campaignQuoteKey({ document_id: DOCUMENT_ID, document_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", normalized_start: 40, quote: QUOTE });
  const same = campaignQuoteKey({ document_id: DOCUMENT_ID, document_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", normalized_start: 40, quote: QUOTE });
  const moved = campaignQuoteKey({ document_id: DOCUMENT_ID, document_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", normalized_start: 41, quote: QUOTE });

  assert.match(first, /^sha256:[0-9a-f]{64}$/);
  assert.equal(first, same);
  assert.notEqual(first, moved);
});

test("quote persistence is retry-safe and stores the supplied exact quote", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const mappings = new Map<string, string>();
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (text.includes("from documents d join sources")) {
        return { rows: [{ source_id: SOURCE_ID, content_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }] as unknown as R[], command: "SELECT", rowCount: 1, oid: 0, fields: [] };
      }
      if (text.includes("select claim_id::text as claim_id from discovery_quote_claims")) {
        const claim_id = mappings.get(String(values?.[0]));
        return { rows: (claim_id === undefined ? [] : [{ claim_id }]) as unknown as R[], command: "SELECT", rowCount: claim_id === undefined ? 0 : 1, oid: 0, fields: [] };
      }
      if (text.includes("insert into discovery_quote_claims")) {
        mappings.set(String(values?.[0]), CLAIM_ID);
        return { rows: [{ claim_id: CLAIM_ID }] as unknown as R[], command: "INSERT", rowCount: 1, oid: 0, fields: [] };
      }
      return { rows: (text.trim().startsWith("insert into claims") ? [{ claim_id: CLAIM_ID }] : []) as unknown as R[], command: "INSERT", rowCount: 1, oid: 0, fields: [] };
    },
  };
  const input = {
    operation_key: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/research/bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb/analyst",
    request_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    quotes: [{ excerpt_id: "44444444-4444-4444-a444-444444444444", document_id: DOCUMENT_ID, source_id: SOURCE_ID, document_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", normalized_start: 40, quote: QUOTE }],
  };

  const first = await persistCampaignQuotes(db, input);
  const second = await persistCampaignQuotes(db, input);

  assert.equal(first.get("excerpt:44444444-4444-4444-a444-444444444444:" + QUOTE)?.id, CLAIM_ID);
  assert.deepEqual(second, first);
  assert.equal(queries.filter((query) => query.text.includes("insert into claims")).length, 1);
  const claimInsert = queries.find((query) => query.text.includes("insert into claims"));
  assert.ok(claimInsert);
  assert.equal(claimInsert.values?.[2], QUOTE);
  const evidenceInsert = queries.find((query) => query.text.includes("insert into claim_evidence"));
  assert.ok(evidenceInsert);
  assert.equal(String(evidenceInsert.values?.[2]).includes(QUOTE), false);
});

test("quote persistence rejects a source that does not own the canonical document before cache reuse", async () => {
  const queries: string[] = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string) {
      queries.push(text);
      if (text.includes("select claim_id::text as claim_id from discovery_quote_claims")) {
        return { rows: [{ claim_id: CLAIM_ID }] as unknown as R[], command: "SELECT", rowCount: 1, oid: 0, fields: [] };
      }
      return { rows: [] as R[], command: "SELECT", rowCount: 0, oid: 0, fields: [] };
    },
  };
  const input = {
    operation_key: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/research/bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb/analyst",
    request_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    quotes: [{
      excerpt_id: "44444444-4444-4444-a444-444444444444",
      document_id: DOCUMENT_ID,
      source_id: "55555555-5555-4555-a555-555555555555",
      document_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      normalized_start: 40,
      quote: QUOTE,
    }],
  };

  await assert.rejects(() => persistCampaignQuotes(db, input), /canonical document|source/i);
  assert.equal(queries.some((text) => text.includes("from discovery_quote_claims")), false, "identity must be checked before the quote-key cache");
});
