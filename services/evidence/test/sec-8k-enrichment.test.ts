import test from "node:test";
import assert from "node:assert/strict";

import {
  enrich8kClaim,
  findEnrich8kCandidates,
  parseEnrichmentDescription,
  type Enrich8kDeps,
} from "../src/sec-8k-enrichment.ts";
import type { QueryExecutor } from "../src/types.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";

const ACME_CIK = 320193;

// A fake LLM router: returns a fixed completion; records the prompt for assertions.
function fakeLlm(text: string): { llm: Enrich8kDeps["llm"]; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    llm: {
      complete: async (req) => {
        calls.push(req.messages.map((m) => m.content).join("\n"));
        return { text, deployment: { channel: "test", model: "test-model" } };
      },
    },
  };
}

function fakeSec(filingText: string): Enrich8kDeps["secClient"] {
  return {
    fetchFiling: async (input: { accession_number: string }) => ({
      bytes: new TextEncoder().encode(filingText),
      contentType: "text/plain",
      retrievedAt: "2026-06-15T00:00:00.000Z",
      url: `https://www.sec.gov/Archives/edgar/data/320193/x/${input.accession_number}.txt`,
    }),
  } as unknown as Enrich8kDeps["secClient"];
}

// Seed a deterministic 8-K material-event claim (as persist8kFiling writes it) and
// return its claim_id. Reuses the given issuer when issuerId is provided.
async function seed8kClaim(
  client: { query: QueryExecutor["query"] },
  opts: { issuerId?: string; accession: string; eventType: string; enriched?: boolean },
): Promise<{ claimId: string; issuerId: string }> {
  let issuerId = opts.issuerId;
  if (!issuerId) {
    const r = await client.query<{ id: string }>(
      `insert into issuers (legal_name, cik) values ('Acme Inc', $1) returning issuer_id::text as id`,
      [String(ACME_CIK).padStart(10, "0")],
    );
    issuerId = r.rows[0]!.id;
  }
  const src = await client.query<{ id: string }>(
    `insert into sources (provider, kind, trust_tier, license_class, retrieved_at)
     values ('sec_edgar', 'filing', 'primary', 'public', now()) returning source_id::text as id`,
  );
  const sourceId = src.rows[0]!.id;
  const doc = await client.query<{ id: string }>(
    `insert into documents (source_id, kind, provider_doc_id, content_hash, raw_blob_id)
     values ($1, 'filing', $2, $3, $4) returning document_id::text as id`,
    [sourceId, opts.accession, `h-${opts.accession}`, `sha256:${opts.accession}`],
  );
  const docId = doc.rows[0]!.id;
  const claim = await client.query<{ id: string }>(
    `insert into claims
       (document_id, predicate, text_canonical, polarity, modality, reported_by_source_id,
        attributed_to_type, attributed_to_id, confidence, status, enriched_at)
     values ($1, $2, $3, 'neutral', 'asserted', $4, 'issuer', $5, 0.9, 'extracted', $6)
     returning claim_id::text as id`,
    [
      docId,
      `material_event.${opts.eventType}`,
      `Material event reported via 8-K: ${opts.eventType.replace(/_/g, " ")}.`,
      sourceId,
      issuerId,
      opts.enriched ? new Date("2026-06-14T00:00:00Z").toISOString() : null,
    ],
  );
  const claimId = claim.rows[0]!.id;
  await client.query(`insert into claim_arguments (claim_id, subject_kind, subject_id, role) values ($1, 'issuer', $2, 'subject')`, [
    claimId,
    issuerId,
  ]);
  return { claimId, issuerId };
}

test("parseEnrichmentDescription handles plain JSON, fenced JSON, and rejects junk", () => {
  assert.equal(parseEnrichmentDescription('{"description":"Acme restated FY24."}'), "Acme restated FY24.");
  assert.equal(parseEnrichmentDescription('```json\n{"description":"X"}\n```'), "X");
  assert.equal(parseEnrichmentDescription('{"description":""}'), "");
  assert.equal(parseEnrichmentDescription("not json"), null);
  assert.equal(parseEnrichmentDescription('{"foo":"bar"}'), null, "missing description field");
  assert.equal(parseEnrichmentDescription('{"description":42}'), null, "non-string description");
});

test("enrich8kClaim augments the deterministic claim in place and logs the LLM call", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "8k-enrich");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  const { claimId } = await seed8kClaim(client, { accession: "0000320193-26-000080", eventType: "restatement" });

  const narrative = "Acme Inc will restate its FY2024 financial statements due to revenue-recognition errors.";
  const { llm, calls } = fakeLlm(`{"description":"${narrative}"}`);
  const deps: Enrich8kDeps = { db, llm, secClient: fakeSec("<SEC-DOCUMENT>Item 4.02 Non-Reliance ... restatement details ...</SEC-DOCUMENT>") };

  const outcome = await enrich8kClaim(deps, {
    claimId,
    eventType: "restatement",
    accession: "0000320193-26-000080",
    issuerCik: ACME_CIK,
  });
  assert.equal(outcome, "enriched");
  assert.match(calls[0]!, /restatement/, "the event type + filing text reach the prompt");

  const claim = await client.query<{ text_canonical: string; enriched_at: string | null }>(
    `select text_canonical, enriched_at from claims where claim_id = $1`,
    [claimId],
  );
  assert.equal(claim.rows[0]!.text_canonical, narrative, "claim text augmented with the LLM narrative");
  assert.notEqual(claim.rows[0]!.enriched_at, null, "enriched_at stamped");

  const logged = await client.query<{ n: number }>(`select count(*)::int as n from tool_call_logs where tool_name = 'enrich_8k'`);
  assert.equal(logged.rows[0]!.n, 1, "the LLM call is recorded as a tool_call_log for provenance");
});

test("findEnrich8kCandidates returns only high-severity, un-enriched claims", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "8k-enrich-candidates");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  const { issuerId } = await seed8kClaim(client, { accession: "0000320193-26-000081", eventType: "restatement" }); // high-sev, un-enriched ✓
  await seed8kClaim(client, { issuerId, accession: "0000320193-26-000082", eventType: "officer_change" }); // low-sev ✗
  await seed8kClaim(client, { issuerId, accession: "0000320193-26-000083", eventType: "bankruptcy", enriched: true }); // already enriched ✗

  const candidates = await findEnrich8kCandidates(db);
  assert.equal(candidates.length, 1, "only the un-enriched high-severity claim");
  assert.equal(candidates[0]!.eventType, "restatement");
  assert.equal(candidates[0]!.accession, "0000320193-26-000081");
  assert.equal(candidates[0]!.issuerCik, ACME_CIK);
});

test("enrich8kClaim leaves the claim untouched on unparseable LLM output, and is idempotent", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "8k-enrich-guard");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  const { claimId } = await seed8kClaim(client, { accession: "0000320193-26-000084", eventType: "delisting" });
  const original = (await client.query<{ t: string }>(`select text_canonical as t from claims where claim_id = $1`, [claimId])).rows[0]!.t;

  // Unparseable → no update, no enriched_at.
  const bad = await enrich8kClaim(
    { db, llm: fakeLlm("the company is in trouble").llm, secClient: fakeSec("<SEC-DOCUMENT>...</SEC-DOCUMENT>") },
    { claimId, eventType: "delisting", accession: "0000320193-26-000084", issuerCik: ACME_CIK },
  );
  assert.equal(bad, "unparseable");
  const afterBad = await client.query<{ t: string; e: string | null }>(`select text_canonical as t, enriched_at as e from claims where claim_id = $1`, [claimId]);
  assert.equal(afterBad.rows[0]!.t, original, "deterministic text preserved on unparseable output");
  assert.equal(afterBad.rows[0]!.e, null, "not marked enriched on failure → still a candidate for retry");

  // Enrich, then confirm it drops out of the candidate set (idempotency).
  await enrich8kClaim(
    { db, llm: fakeLlm('{"description":"Acme received a delisting notice from Nasdaq."}').llm, secClient: fakeSec("x") },
    { claimId, eventType: "delisting", accession: "0000320193-26-000084", issuerCik: ACME_CIK },
  );
  const remaining = await findEnrich8kCandidates(db);
  assert.equal(remaining.length, 0, "an enriched claim is no longer a candidate");
});
