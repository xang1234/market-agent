import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  backfillIssuer10k,
  extract10kClaims,
  parseTenKReply,
  resolveCompetitorByName,
  storeTenK,
  type Extract10kDeps,
  type TenKBackfillDeps,
} from "../src/sec-10k-claims.ts";
import { MemoryObjectStore } from "../src/object-store.ts";
import type { SecSubmissions } from "../src/sec-edgar.ts";
import type { QueryExecutor } from "../src/types.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";

const NVDA_HTML = readFileSync(new URL("./fixtures/sec-10k/nvda.htm", import.meta.url));
// NVIDIA's Item 1 names its competitors in a bulleted list item, which ends in
// a semicolon and so is no sentence.
const COMPETITION =
  "suppliers and licensors of hardware and software for discrete and integrated GPUs, custom chips and other accelerated computing solutions, including solutions offered for AI, such as Advanced Micro Devices, Inc., or AMD, Huawei Technologies Co. Ltd., or Huawei, and Intel Corporation, or Intel;";
const INVENTED = "NVIDIA has no competitors in any market it serves today.";

test("a reply is read when every claim has its section's predicate", () => {
  assert.deepEqual(parseTenKReply('```json\n{"claims":[{"predicate":"risk.factor","quote":"q"}]}\n```', "1A"), [
    { predicate: "risk.factor", quote: "q", competitors: [] },
  ]);
  assert.equal(parseTenKReply('{"claims":[{"predicate":"risk.factor","quote":"q"}]}', "1"), null, "a risk in Item 1");
  assert.equal(parseTenKReply('{"claims":[{"predicate":"business.products","quote":"q","competitors":"AMD"}]}', "1"), null);
  assert.equal(parseTenKReply("Sorry, I can't help with that.", "1"), null);
});

// A model that answers Item 1 with `item1` and Item 1A with no claims.
function scriptedLlm(item1: string): { llm: Extract10kDeps["llm"]; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    llm: {
      complete: async (request) => {
        calls += 1;
        const business = String(request.messages[0]!.content).includes("Item 1 (Business)");
        return { text: business ? item1 : '{"claims":[]}', deployment: { channel: "test", model: "test-model" } } as Awaited<ReturnType<Extract10kDeps["llm"]["complete"]>>;
      },
    },
  };
}

async function seedIssuer(client: QueryExecutor, name: string, cik: number): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into issuers (legal_name, cik) values ($1, $2) returning issuer_id::text as id`,
    [name, String(cik).padStart(10, "0")],
  );
  return rows[0]!.id;
}

const counts = async (client: QueryExecutor) => (await client.query<{ claims: number; competitors: number }>(
  `select (select count(*)::int from claims) as claims,
          (select count(*)::int from claim_arguments where role = 'competitor') as competitors`,
)).rows[0];

test("a 10-K's quoted claims are stored with their filer and resolved competitors, once", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "tenk-claims");
  const client = await connectedClient(t, databaseUrl);
  const nvda = await seedIssuer(client, "NVIDIA Corporation", 1045810);
  const amd = "6d1f3c1e-5b6a-4c2e-9f0a-0a5e2b7c8d91";
  await client.query(`insert into issuers (issuer_id, legal_name) values ($1, 'Advanced Micro Devices, Inc.')`, [amd]);
  const { llm, calls } = scriptedLlm(JSON.stringify({ claims: [
    { predicate: "business.competition", quote: `• ${COMPETITION}`, competitors: ["Advanced Micro Devices", "Huawei", "Samsung"] },
    { predicate: "business.description", quote: INVENTED, competitors: [] },
  ] }));
  const deps: Extract10kDeps = { db: client, llm, resolveCompetitor: async (name) => (name === "Advanced Micro Devices" ? amd : null) };
  const doc = await storeTenK({ db: client, objectStore: new MemoryObjectStore() }, {
    issuerId: nvda, bytes: NVDA_HTML, url: null, accession: null, filedDate: null, retrievedAt: "2026-02-25T00:00:00.000Z",
  });
  const tenK = { ...doc, issuerId: nvda, html: NVDA_HTML.toString("utf8"), effectiveTime: null };

  const result = await extract10kClaims(deps, tenK);
  // "Samsung" is not in the quote, so it is no competitor of it.
  assert.deepEqual(result, { outcome: "extracted", extracted: 1, droppedUnquoted: 1, competitors: { resolved: 1, named: 2 }, missing: [], llmCalls: 3 });
  const { rows: [claim] } = await client.query<{ claim_id: string; predicate: string; text_canonical: string; modality: string; attributed_to_id: string }>(
    `select claim_id::text as claim_id, predicate, text_canonical, modality, attributed_to_id::text as attributed_to_id from claims`,
  );
  assert.deepEqual({ ...claim, claim_id: undefined }, {
    claim_id: undefined, predicate: "business.competition", text_canonical: COMPETITION, modality: "quoted", attributed_to_id: nvda,
  });
  const { rows: argued } = await client.query<{ role: string; subject_id: string }>(
    `select role, subject_id::text as subject_id from claim_arguments where claim_id = $1 order by role`,
    [claim!.claim_id],
  );
  assert.deepEqual(argued, [{ role: "competitor", subject_id: amd }, { role: "subject", subject_id: nvda }]);

  // A second run reads nothing and adds nothing.
  assert.deepEqual(await counts(client), { claims: 1, competitors: 1 });
  assert.equal((await extract10kClaims(deps, tenK)).outcome, "already_extracted");
  assert.equal(calls(), 3);
  assert.deepEqual(await counts(client), { claims: 1, competitors: 1 });

  // The CLI's resolver finds an issuer by the name a 10-K writes.
  await seedIssuer(client, "Intel Corp", 50863);
  assert.equal(await resolveCompetitorByName(client, "Advanced Micro Devices"), amd);
  assert.ok(await resolveCompetitorByName(client, "Intel Corporation"));
  assert.equal(await resolveCompetitorByName(client, "Huawei"), null);
});

test("a 10-K the model answers badly stays unread, with nothing stored", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "tenk-unparseable");
  const client = await connectedClient(t, databaseUrl);
  const nvda = await seedIssuer(client, "NVIDIA Corporation", 1045810);
  const doc = await storeTenK({ db: client, objectStore: new MemoryObjectStore() }, {
    issuerId: nvda, bytes: NVDA_HTML, url: null, accession: null, filedDate: null, retrievedAt: "2026-02-25T00:00:00.000Z",
  });
  const tenK = { ...doc, issuerId: nvda, html: NVDA_HTML.toString("utf8"), effectiveTime: null };
  const resolveCompetitor = async () => null;
  for (const reply of ["Sorry, I can't help with that.", JSON.stringify({ claims: [{ predicate: "business.description", quote: INVENTED }] })]) {
    const { llm } = scriptedLlm(reply);
    assert.equal((await extract10kClaims({ db: client, llm, resolveCompetitor }, tenK)).outcome, "unparseable", reply);
  }
  assert.deepEqual(await counts(client), { claims: 0, competitors: 0 });
  const { llm } = scriptedLlm(JSON.stringify({ claims: [{ predicate: "business.competition", quote: COMPETITION }] }));
  assert.equal((await extract10kClaims({ db: client, llm, resolveCompetitor }, tenK)).extracted, 1, "read again by the next run");

  // A 10-K with neither item calls no model, and stays unread.
  const indexed = new TextEncoder().encode("<html><body><div>Our Business</div><div>We design chips.</div></body></html>");
  const other = await storeTenK({ db: client, objectStore: new MemoryObjectStore() }, {
    issuerId: nvda, bytes: indexed, url: null, accession: null, filedDate: null, retrievedAt: "2026-02-25T00:00:00.000Z",
  });
  const { llm: unused, calls } = scriptedLlm('{"claims":[]}');
  const result = await extract10kClaims({ db: client, llm: unused, resolveCompetitor }, { ...other, issuerId: nvda, html: new TextDecoder().decode(indexed), effectiveTime: null });
  assert.deepEqual([result.outcome, result.missing, calls()], ["no_sections", ["1", "1A"], 0]);
  const { rows: [status] } = await client.query<{ parse_status: string }>(`select parse_status from documents where document_id = $1`, [other.documentId]);
  assert.equal(status!.parse_status, "pending");

  // 3M heads each risk factor with an asterisk, a bullet no sentence starts after.
  const risk = "The Company's results are impacted by the effects of, and changes in, worldwide economic conditions.";
  const starred = new TextEncoder().encode(
    `<div>Item 1A. Risk Factors</div><div>* ${risk}</div>${"<div>During 2025, the Company derived revenue abroad.</div>".repeat(25)}<div>Item 1B. Unresolved Staff Comments</div>`,
  );
  const starredDoc = await storeTenK({ db: client, objectStore: new MemoryObjectStore() }, {
    issuerId: nvda, bytes: starred, url: null, accession: null, filedDate: null, retrievedAt: "2026-02-25T00:00:00.000Z",
  });
  const { llm: risks } = scriptedLlm('{"claims":[]}');
  const riskLlm: Extract10kDeps["llm"] = { complete: async (request) => ({ ...(await risks.complete(request)), text: JSON.stringify({ claims: [{ predicate: "risk.factor", quote: `* ${risk}` }] }) }) };
  const read = await extract10kClaims({ db: client, llm: riskLlm, resolveCompetitor }, { ...starredDoc, issuerId: nvda, html: new TextDecoder().decode(starred), effectiveTime: null });
  assert.deepEqual([read.outcome, read.extracted, read.missing], ["extracted", 1, ["1"]]);
  const { rows: [stored] } = await client.query<{ text_canonical: string }>(`select text_canonical from claims where document_id = $1`, [starredDoc.documentId]);
  assert.equal(stored!.text_canonical, risk);
});

test("the backfill reads an issuer's latest 10-K once: a rerun fetches only the feed", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "tenk-backfill");
  const client = await connectedClient(t, databaseUrl);
  const nvda = await seedIssuer(client, "NVIDIA Corporation", 1045810);
  const fetched: string[] = [];
  const submissions: SecSubmissions = { filings: { recent: {
    accessionNumber: ["0001045810-26-000030", "0001045810-26-000021", "0001045810-25-000023"],
    form: ["10-Q", "10-K", "10-K"],
    primaryDocument: ["nvda-20260426.htm", "nvda-20260125.htm", "nvda-20250126.htm"],
    filingDate: ["2026-05-28", "2026-02-25", "2025-02-26"],
  } } };
  const { llm, calls } = scriptedLlm(JSON.stringify({ claims: [{ predicate: "business.competition", quote: COMPETITION }] }));
  const deps: TenKBackfillDeps = {
    db: client,
    llm,
    objectStore: new MemoryObjectStore(),
    resolveCompetitor: async () => null,
    secClient: {
      fetchSubmissions: async () => {
        fetched.push("submissions");
        return submissions;
      },
      fetchFiling: async (input) => {
        fetched.push(input.document);
        return { bytes: NVDA_HTML, contentType: "text/html", retrievedAt: "2026-11-15T00:00:00.000Z", url: `https://www.sec.gov/${input.document}` };
      },
    },
  };
  const first = await backfillIssuer10k(deps, { issuerId: nvda, cik: 1045810 });
  assert.equal(first.outcome, "extracted");
  const second = await backfillIssuer10k(deps, { issuerId: nvda, cik: 1045810 });
  assert.equal(second.outcome, "already_extracted");
  assert.deepEqual(fetched, ["submissions", "nvda-20260125.htm", "submissions"]);
  assert.equal(calls(), 3);
  const { rows } = await client.query<{ provider_doc_id: string; effective_time: Date }>(
    `select d.provider_doc_id, c.effective_time from claims c join documents d using (document_id)`,
  );
  assert.deepEqual(rows, [{ provider_doc_id: "0001045810-26-000021", effective_time: new Date("2026-02-25T00:00:00Z") }]);
  assert.equal((await backfillIssuer10k({ ...deps, secClient: { ...deps.secClient, fetchSubmissions: async () => ({ filings: { recent: { ...submissions.filings.recent, form: ["10-Q", "8-K", "20-F"] } } }) } }, { issuerId: nvda, cik: 1045810 })).outcome, "no_10k");
});
