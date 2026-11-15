import test, { type TestContext } from "node:test";
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
  type TenKDocument,
} from "../src/sec-10k-claims.ts";
import { parseCliArgs } from "../src/sec-10k-claims-cli.ts";
import { MemoryObjectStore } from "../src/object-store.ts";
import type { SecSubmissions } from "../src/sec-edgar.ts";
import type { QueryExecutor } from "../src/types.ts";
import { bootstrapDatabase, connectedClient, connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";

const NVDA_HTML = readFileSync(new URL("./fixtures/sec-10k/nvda.htm", import.meta.url));
const COMPETITION_LIST_ITEM =
  "suppliers and licensors of hardware and software for discrete and integrated GPUs, custom chips and other accelerated computing solutions, including solutions offered for AI, such as Advanced Micro Devices, Inc., or AMD, Huawei Technologies Co. Ltd., or Huawei, and Intel Corporation, or Intel;";
const INVENTED = "NVIDIA has no competitors in any market it serves today.";
const NO_CLAIMS = '{"claims":[]}';
const NVDA_RISK = "Delaware law and our certificate of incorporation, bylaws and agreement with Microsoft could delay or prevent a change in control.";
const RISK_REPLY = JSON.stringify({ claims: [{ predicate: "risk.factor", quote: NVDA_RISK, competitors: ["Microsoft"] }] });

test("a reply is read when every claim has its section's predicate", () => {
  assert.deepEqual(parseTenKReply('```json\n{"claims":[{"predicate":"risk.factor","quote":"q"}]}\n```', "1A"), [
    { predicate: "risk.factor", quote: "q", competitors: [] },
  ]);
  assert.equal(parseTenKReply('{"claims":[{"predicate":"risk.factor","quote":"q"}]}', "1"), null, "a risk in Item 1");
  assert.equal(parseTenKReply("Sorry, I can't help with that.", "1"), null);
  assert.deepEqual(
    parseTenKReply('{"claims":[{"predicate":"business.competition","quote":"q","competitors":null},{"predicate":"business.competition","quote":"r","competitors":["AMD",3]}]}', "1"),
    [{ predicate: "business.competition", quote: "q", competitors: [] }, { predicate: "business.competition", quote: "r", competitors: ["AMD"] }],
    "a bad competitor list costs only the competitors",
  );
});

function llmAnswering(replies: { "1"?: string; "1A"?: string }): { llm: Extract10kDeps["llm"]; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    llm: {
      complete: async (request) => {
        calls += 1;
        const item = String(request.messages[0]!.content).includes("Item 1 (Business)") ? "1" : "1A";
        return { text: replies[item] ?? NO_CLAIMS, deployment: { channel: "test", model: "test-model" } } as Awaited<ReturnType<Extract10kDeps["llm"]["complete"]>>;
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

async function nvdaDatabase(t: TestContext, prefix: string): Promise<{ client: QueryExecutor; nvda: string; databaseUrl: string }> {
  const { databaseUrl } = await bootstrapDatabase(t, prefix);
  const client = await connectedClient(t, databaseUrl);
  return { client, nvda: await seedIssuer(client, "NVIDIA Corporation", 1045810), databaseUrl };
}

async function storedTenK(client: QueryExecutor, issuerId: string, bytes: Uint8Array, objectStore = new MemoryObjectStore()): Promise<TenKDocument> {
  const doc = await storeTenK({ db: client, objectStore }, {
    issuerId, bytes, url: null, accession: null, filedDate: null, retrievedAt: "2026-02-25T00:00:00.000Z",
  });
  return { ...doc, issuerId, html: new TextDecoder().decode(bytes), effectiveTime: null };
}

const counts = async (client: QueryExecutor) => (await client.query<{ claims: number; competitors: number }>(
  `select (select count(*)::int from claims) as claims,
          (select count(*)::int from claim_arguments where role = 'competitor') as competitors`,
)).rows[0];

const dockerTest = { skip: !dockerAvailable(), timeout: 180_000 };

test("a 10-K's quoted claims are stored with their filer and resolved competitors, once", dockerTest, async (t) => {
  const { client, nvda } = await nvdaDatabase(t, "tenk-claims");
  const amd = "6d1f3c1e-5b6a-4c2e-9f0a-0a5e2b7c8d91";
  const { llm, calls } = llmAnswering({ "1": JSON.stringify({ claims: [
    { predicate: "business.competition", quote: `• ${COMPETITION_LIST_ITEM}`, competitors: ["Advanced Micro Devices", "Huawei", "Samsung"] },
    { predicate: "business.description", quote: INVENTED, competitors: [] },
  ] }), "1A": RISK_REPLY });
  const deps: Extract10kDeps = { db: client, llm, resolveCompetitor: async (name) => (name === "Advanced Micro Devices" ? amd : null) };
  const tenK = await storedTenK(client, nvda, NVDA_HTML);

  assert.deepEqual(
    await extract10kClaims(deps, tenK),
    { outcome: "extracted", extracted: 2, droppedUnquoted: 1, competitors: { resolved: 1, named: 2 }, missing: [], llmCalls: 3 },
    "Samsung is not in the quote, and a risk factor names no competitor",
  );
  const { rows: [claim] } = await client.query<{ claim_id: string; predicate: string; text_canonical: string; modality: string; attributed_to_id: string }>(
    `select claim_id::text as claim_id, predicate, text_canonical, modality, attributed_to_id::text as attributed_to_id from claims where predicate = 'business.competition'`,
  );
  assert.deepEqual({ ...claim, claim_id: undefined }, {
    claim_id: undefined, predicate: "business.competition", text_canonical: COMPETITION_LIST_ITEM, modality: "quoted", attributed_to_id: nvda,
  });
  const { rows: argued } = await client.query<{ role: string; subject_id: string }>(
    `select role, subject_id::text as subject_id from claim_arguments where claim_id = $1 order by role`,
    [claim!.claim_id],
  );
  assert.deepEqual(argued, [{ role: "competitor", subject_id: amd }, { role: "subject", subject_id: nvda }]);

  assert.deepEqual(await counts(client), { claims: 2, competitors: 1 });
  assert.equal((await extract10kClaims(deps, tenK)).outcome, "already_extracted");
  assert.equal(calls(), 3, "a second run calls no model");
  assert.deepEqual(await counts(client), { claims: 2, competitors: 1 }, "a second run adds no rows");

  await client.query(`update documents set parse_status = 'pending' where document_id = $1`, [tenK.documentId]);
  assert.equal((await extract10kClaims(deps, tenK)).extracted, 0, "a re-read stores only claims not yet stored");
  assert.deepEqual(await counts(client), { claims: 2, competitors: 1 });
});

test("two runs on one 10-K at once store its claims once", dockerTest, async (t) => {
  const { client, nvda, databaseUrl } = await nvdaDatabase(t, "tenk-race");
  const pool = await connectedPool(t, databaseUrl);
  const tenK = await storedTenK(client, nvda, NVDA_HTML);
  const { llm } = llmAnswering({ "1": JSON.stringify({ claims: [{ predicate: "business.competition", quote: COMPETITION_LIST_ITEM }] }), "1A": RISK_REPLY });
  const deps: Extract10kDeps = { db: pool, llm, resolveCompetitor: async () => null };
  const outcomes = (await Promise.all([extract10kClaims(deps, tenK), extract10kClaims(deps, tenK)])).map((result) => result.outcome).sort();
  assert.deepEqual(outcomes, ["already_extracted", "extracted"]);
  assert.deepEqual(await counts(client), { claims: 2, competitors: 0 });
});

test("a competitor resolves by the name a 10-K writes, with or without its corporate suffix", dockerTest, async (t) => {
  const { client } = await nvdaDatabase(t, "tenk-resolver");
  const amd = await seedIssuer(client, "Advanced Micro Devices, Inc.", 2488);
  const intel = await seedIssuer(client, "Intel Corp", 50863);
  assert.equal(await resolveCompetitorByName(client, "Advanced Micro Devices"), amd);
  assert.equal(await resolveCompetitorByName(client, "Intel Corporation"), intel);
  assert.equal(await resolveCompetitorByName(client, "Huawei"), null);
  await seedIssuer(client, "Acme Inc", 1);
  await seedIssuer(client, "Acme Corp", 2);
  assert.equal(await resolveCompetitorByName(client, "Acme"), null, "a name two issuers' short forms share resolves to neither");
});

test("a 10-K the model answers badly stays unread, with nothing stored", dockerTest, async (t) => {
  const { client, nvda } = await nvdaDatabase(t, "tenk-unparseable");
  const tenK = await storedTenK(client, nvda, NVDA_HTML);
  const resolveCompetitor = async () => null;
  for (const [label, replies] of [
    ["a refusal", { "1": "Sorry, I can't help with that.", "1A": RISK_REPLY }],
    ["only invented quotes", { "1": JSON.stringify({ claims: [{ predicate: "business.description", quote: INVENTED }] }), "1A": RISK_REPLY }],
    ["no claims for a found item", { "1": NO_CLAIMS, "1A": RISK_REPLY }],
  ] as const) {
    const { llm } = llmAnswering(replies);
    assert.equal((await extract10kClaims({ db: client, llm, resolveCompetitor }, tenK)).outcome, "unparseable", label);
  }
  const cut: Extract10kDeps["llm"] = { complete: async () => ({ text: '{"claims":[{"predicate":"risk.factor","quote":"Delaware', truncated: true, deployment: { channel: "test", model: "test-model" } }) as Awaited<ReturnType<Extract10kDeps["llm"]["complete"]>> };
  assert.equal((await extract10kClaims({ db: client, llm: cut, resolveCompetitor }, tenK)).outcome, "unparseable", "a reply cut at its token cap");
  assert.deepEqual(await counts(client), { claims: 0, competitors: 0 });
  const { llm } = llmAnswering({ "1": JSON.stringify({ claims: [{ predicate: "business.competition", quote: COMPETITION_LIST_ITEM }] }), "1A": RISK_REPLY });
  assert.equal((await extract10kClaims({ db: client, llm, resolveCompetitor }, tenK)).extracted, 2, "read again by the next run");
});

test("a 10-K with neither item calls no model and stays unread", dockerTest, async (t) => {
  const { client, nvda } = await nvdaDatabase(t, "tenk-no-sections");
  const tenK = await storedTenK(client, nvda, new TextEncoder().encode("<html><body><div>Our Business</div><div>We design chips.</div></body></html>"));
  const { llm, calls } = llmAnswering({});
  const result = await extract10kClaims({ db: client, llm, resolveCompetitor: async () => null }, tenK);
  assert.deepEqual([result.outcome, result.missing, calls()], ["no_sections", ["1", "1A"], 0]);
  const { rows: [status] } = await client.query<{ parse_status: string }>(`select parse_status from documents where document_id = $1`, [tenK.documentId]);
  assert.equal(status!.parse_status, "pending");
});

test("a risk factor headed by an asterisk bullet, as 3M writes them, verifies whole", dockerTest, async (t) => {
  const { client, nvda } = await nvdaDatabase(t, "tenk-asterisk");
  const risk = "The Company's results are impacted by the effects of, and changes in, worldwide economic conditions.";
  const tenK = await storedTenK(client, nvda, new TextEncoder().encode(
    `<div>Item 1A. Risk Factors</div><div>* ${risk}</div>${"<div>During 2025, the Company derived revenue abroad.</div>".repeat(25)}<div>Item 1B. Unresolved Staff Comments</div>`,
  ));
  const { llm } = llmAnswering({ "1A": JSON.stringify({ claims: [{ predicate: "risk.factor", quote: `* ${risk}` }] }) });
  const result = await extract10kClaims({ db: client, llm, resolveCompetitor: async () => null }, tenK);
  assert.deepEqual([result.outcome, result.extracted, result.missing], ["extracted", 1, ["1"]]);
  const { rows: [stored] } = await client.query<{ text_canonical: string }>(`select text_canonical from claims where document_id = $1`, [tenK.documentId]);
  assert.equal(stored!.text_canonical, risk, "stored without its bullet");
});

test("the backfill reads an issuer's latest 10-K once: a rerun fetches only the feed", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { client, nvda } = await nvdaDatabase(t, "tenk-backfill");
  const fetched: string[] = [];
  const submissions: SecSubmissions = { filings: { recent: {
    accessionNumber: ["0001045810-26-000030", "0001045810-26-000021", "0001045810-25-000023"],
    form: ["10-Q", "10-K", "10-K"],
    primaryDocument: ["nvda-20260426.htm", "nvda-20260125.htm", "nvda-20250126.htm"],
    filingDate: ["2026-05-28", "2026-02-25", "2025-02-26"],
  } } };
  const { llm, calls } = llmAnswering({ "1": JSON.stringify({ claims: [{ predicate: "business.competition", quote: COMPETITION_LIST_ITEM }] }), "1A": RISK_REPLY });
  const objectStore = new MemoryObjectStore();
  // Stored first by --file, with no accession.
  await storedTenK(client, nvda, NVDA_HTML, objectStore);
  const deps: TenKBackfillDeps = {
    db: client,
    llm,
    objectStore,
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
  assert.deepEqual(fetched, ["submissions", "nvda-20260125.htm", "submissions"], "the file's document takes the accession, so the rerun fetches no filing");
  assert.equal(calls(), 3, "the rerun calls no model");
  const { rows } = await client.query<{ provider_doc_id: string; effective_time: Date }>(
    `select distinct d.provider_doc_id, c.effective_time from claims c join documents d using (document_id)`,
  );
  assert.deepEqual(rows, [{ provider_doc_id: "0001045810-26-000021", effective_time: new Date("2026-02-25T00:00:00Z") }]);
  assert.equal((await backfillIssuer10k({ ...deps, secClient: { ...deps.secClient, fetchSubmissions: async () => ({ filings: { recent: { ...submissions.filings.recent, form: ["10-Q", "8-K", "20-F"] } } }) } }, { issuerId: nvda, cik: 1045810 })).outcome, "no_10k");
});

test("the CLI runs a backfill only when asked for one", () => {
  assert.throws(() => parseCliArgs([]), /pass one of/);
  assert.throws(() => parseCliArgs(["--file", "nvda.htm", "--backfill", "--ticker", "NVDA"]), /pass one of/);
  assert.throws(() => parseCliArgs(["--file", "nvda.htm"]), /one --ticker/);
  assert.deepEqual(parseCliArgs(["--backfill", "--ticker", "AMD", "--ticker", "KO", "--limit", "1"]), {
    file: undefined, backfill: true, tickers: ["AMD", "KO"], limit: 1, concurrency: 1,
  });
});

test("the backfill reads a 10-K the filings backfill stored from the object store, with no fetch", dockerTest, async (t) => {
  const { client, nvda } = await nvdaDatabase(t, "tenk-stored");
  const objectStore = new MemoryObjectStore();
  const source = await client.query<{ id: string }>(
    `insert into sources (provider, kind, trust_tier, license_class, retrieved_at) values ('sec_edgar', 'filing', 'primary', 'public', now()) returning source_id::text as id`,
  );
  const { blob } = await objectStore.put(NVDA_HTML);
  await client.query(
    `insert into documents (source_id, kind, provider_doc_id, title, content_hash, raw_blob_id) values ($1, 'filing', '0001045810-26-000021', '10-K', $2, $2)`,
    [source.rows[0]!.id, blob.raw_blob_id],
  );
  const fetched: string[] = [];
  const { llm } = llmAnswering({ "1": JSON.stringify({ claims: [{ predicate: "business.competition", quote: COMPETITION_LIST_ITEM }] }), "1A": RISK_REPLY });
  const result = await backfillIssuer10k({
    db: client, llm, objectStore, resolveCompetitor: async () => null,
    secClient: {
      fetchSubmissions: async () => ({ filings: { recent: { accessionNumber: ["0001045810-26-000021"], form: ["10-K"], primaryDocument: ["nvda-20260125.htm"], filingDate: ["2026-02-25"] } } }),
      fetchFiling: async (input) => {
        fetched.push(input.document);
        throw new Error("no fetch expected");
      },
    },
  }, { issuerId: nvda, cik: 1045810 });
  assert.equal(result.outcome, "extracted");
  assert.deepEqual(fetched, []);
  assert.equal((await client.query(`select 1 from documents`)).rowCount, 1, "the claims cite the stored document");
});
