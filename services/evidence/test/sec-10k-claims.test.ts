import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  backfillIssuer10k,
  extract10kClaims,
  parseTenKReply,
  resolveCompetitorByName,
  storeTenK,
  TEN_K_PREDICATES,
  type Extract10kDeps,
  type TenKBackfillDeps,
  type TenKDocument,
} from "../src/sec-10k-claims.ts";
import { checkFiler, filerCik, parseCliArgs, summaryLine } from "../src/sec-10k-claims-cli.ts";
import { loadLocalRuntimeEvidence } from "../src/local-runtime-evidence.ts";
import { MemoryObjectStore } from "../src/object-store.ts";
import type { SecSubmissions } from "../src/sec-edgar.ts";
import type { QueryExecutor } from "../src/types.ts";
import { bootstrapDatabase, connectedClient, connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";

const NVDA_HTML = readFileSync(new URL("./fixtures/sec-10k/nvda.htm", import.meta.url));
const COMPETITION_LIST_ITEM =
  "suppliers and licensors of hardware and software for discrete and integrated GPUs, custom chips and other accelerated computing solutions, including solutions offered for AI, such as Advanced Micro Devices, Inc., or AMD, Huawei Technologies Co. Ltd., or Huawei, and Intel Corporation, or Intel;";
// The item before the list's last, joined to it by "and".
const TESLA_LIST_ITEM =
  "suppliers of hardware and software for SoC products that are used in servers or embedded into automobiles, autonomous machines, and gaming devices, such as Ambarella, Inc., AMD, Broadcom, Intel, Qualcomm Incorporated, Renesas Electronics Corporation, and Samsung, or companies with internal teams designing SoC products for their own products and services, such as Tesla, Inc.; and";
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
    { predicate: "business.competition", quote: TESLA_LIST_ITEM, competitors: ["Tesla, Inc."] },
    { predicate: "business.description", quote: INVENTED, competitors: [] },
  ] }), "1A": RISK_REPLY });
  const deps: Extract10kDeps = { db: client, llm, resolveCompetitor: async (name) => (name === "Advanced Micro Devices" ? amd : null) };
  const tenK = await storedTenK(client, nvda, NVDA_HTML);

  assert.deepEqual(
    await extract10kClaims(deps, tenK),
    { outcome: "extracted", extracted: 3, droppedUnquoted: 1, competitors: { resolved: 1, named: 3 }, missing: [], unread: [], cut: [], llmCalls: 3 },
    "Samsung is not in the quote, and a risk factor names no competitor",
  );
  const { rows: [claim] } = await client.query<{ claim_id: string; predicate: string; text_canonical: string; modality: string; attributed_to_id: string }>(
    `select claim_id::text as claim_id, predicate, text_canonical, modality, attributed_to_id::text as attributed_to_id from claims where predicate = 'business.competition' and text_canonical = $1`,
    [COMPETITION_LIST_ITEM],
  );
  assert.deepEqual({ ...claim, claim_id: undefined }, {
    claim_id: undefined, predicate: "business.competition", text_canonical: COMPETITION_LIST_ITEM, modality: "quoted", attributed_to_id: nvda,
  });
  const { rows: argued } = await client.query<{ role: string; subject_id: string }>(
    `select role, subject_id::text as subject_id from claim_arguments where claim_id = $1 order by role`,
    [claim!.claim_id],
  );
  assert.deepEqual(argued, [{ role: "competitor", subject_id: amd }, { role: "subject", subject_id: nvda }]);

  assert.deepEqual(await counts(client), { claims: 3, competitors: 1 });
  assert.equal((await extract10kClaims(deps, tenK)).outcome, "already_extracted");
  assert.equal(calls(), 3, "a second run calls no model");
  assert.deepEqual(await counts(client), { claims: 3, competitors: 1 }, "a second run adds no rows");

  await client.query(`update documents set parse_status = 'pending' where document_id = $1`, [tenK.documentId]);
  assert.equal((await extract10kClaims(deps, tenK)).outcome, "already_extracted");
  assert.equal(calls(), 3, "a reset by hand reads no item that has claims");
  assert.deepEqual(await counts(client), { claims: 3, competitors: 1 });
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

const REFUSAL = "Sorry, I can't help with that.";

test("a 10-K the model answers badly stays unread, with nothing stored", dockerTest, async (t) => {
  const { client, nvda } = await nvdaDatabase(t, "tenk-unparseable");
  const tenK = await storedTenK(client, nvda, NVDA_HTML);
  const resolveCompetitor = async () => null;
  for (const [label, replies] of [
    ["a refusal", { "1": REFUSAL, "1A": REFUSAL }],
    ["only invented quotes", { "1": JSON.stringify({ claims: [{ predicate: "business.description", quote: INVENTED }] }), "1A": JSON.stringify({ claims: [{ predicate: "risk.factor", quote: INVENTED }] }) }],
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

const parseStatus = async (client: QueryExecutor, documentId: string) =>
  (await client.query<{ parse_status: string }>(`select parse_status from documents where document_id = $1`, [documentId])).rows[0]!.parse_status;
const BODY = "<div>During 2025, the Company derived revenue abroad.</div>".repeat(25);
const OWN_RISK = "Our results depend on a small number of customers for most of our revenue.";
const DESCRIPTION = "We design memory chips for data centers and phones.";

test("an item the model answers badly stays unread while the other is stored, and a rerun asks only about it", dockerTest, async (t) => {
  const { client, nvda } = await nvdaDatabase(t, "tenk-unread-item");
  const tenK = await storedTenK(client, nvda, NVDA_HTML);
  const resolveCompetitor = async () => null;
  const refused = llmAnswering({ "1": REFUSAL, "1A": RISK_REPLY });
  const first = await extract10kClaims({ db: client, llm: refused.llm, resolveCompetitor }, tenK);
  assert.deepEqual([first.outcome, first.extracted, first.unread, refused.calls()], ["extracted", 1, ["1"], 3]);
  assert.equal(await parseStatus(client, tenK.documentId), "failed");

  const answered = llmAnswering({ "1": JSON.stringify({ claims: [{ predicate: "business.competition", quote: COMPETITION_LIST_ITEM }] }), "1A": RISK_REPLY });
  const rerun = await extract10kClaims({ db: client, llm: answered.llm, resolveCompetitor }, tenK);
  assert.deepEqual([rerun.outcome, rerun.extracted, rerun.unread, answered.calls()], ["extracted", 1, [], 1], "only Item 1's prompt is asked again");
  assert.equal(await parseStatus(client, tenK.documentId), "parsed");
  assert.deepEqual(await counts(client), { claims: 2, competitors: 0 });
});

test("a 10-K is read in at most 12 model calls, and an item cut short is counted", dockerTest, async (t) => {
  const { client, nvda } = await nvdaDatabase(t, "tenk-call-cap");
  const longRisks = `<div>${OWN_RISK}</div>${"<div>Supply of our products depends on third parties we do not control and cannot replace quickly.</div>".repeat(8_000)}`;
  const tenK = await storedTenK(client, nvda, new TextEncoder().encode(`<div>Item 1. Business</div><div>${DESCRIPTION}</div>${BODY}<div>Item 1A. Risk Factors</div>${longRisks}<div>Item 1B. Unresolved Staff Comments</div>`));
  const { llm, calls } = llmAnswering({
    "1": JSON.stringify({ claims: [{ predicate: "business.description", quote: DESCRIPTION }] }),
    "1A": JSON.stringify({ claims: [{ predicate: "risk.factor", quote: OWN_RISK }] }),
  });
  const result = await extract10kClaims({ db: client, llm, resolveCompetitor: async () => null }, tenK);
  assert.deepEqual([result.outcome, result.extracted, result.cut, result.llmCalls, calls()], ["extracted", 2, [{ item: "1A", prompts: 11, of: 13 }], 12, 12]);
  const { rows } = await client.query<{ status: string }>(`select status from tool_call_logs where tool_name = 'extract_10k_claims'`);
  assert.deepEqual(rows, [{ status: "partial" }]);
  const evidence = await client.query<{ item: string; cut: unknown }>(`select locator->>'item' as item, locator->'cut' as cut from claim_evidence order by 1`);
  assert.deepEqual(evidence.rows, [{ item: "1", cut: null }, { item: "1A", cut: { prompts: 11, of: 13 } }], "the stored claims say how far a cut item was read");
});

test("two stores of one 10-K's bytes at once keep one source", dockerTest, async (t) => {
  const { client, nvda, databaseUrl } = await nvdaDatabase(t, "tenk-store-race");
  const pool = await connectedPool(t, databaseUrl);
  const objectStore = new MemoryObjectStore();
  const input = { issuerId: nvda, bytes: NVDA_HTML, url: null, accession: null, filedDate: null, retrievedAt: "2026-11-15T00:00:00.000Z" };
  const [a, b] = await Promise.all([storeTenK({ db: pool, objectStore }, input), storeTenK({ db: pool, objectStore }, input)]);
  assert.deepEqual(a, b);
  const { rows: [sources] } = await client.query<{ n: number }>(`select count(*)::int as n from sources`);
  assert.equal(sources!.n, 1);
});

test("a superseded 10-K is not read again", dockerTest, async (t) => {
  const { client, nvda } = await nvdaDatabase(t, "tenk-superseded");
  const tenK = await storedTenK(client, nvda, NVDA_HTML);
  await client.query(`update documents set parse_status = 'superseded' where document_id = $1`, [tenK.documentId]);
  const { llm, calls } = llmAnswering({ "1": JSON.stringify({ claims: [{ predicate: "business.competition", quote: COMPETITION_LIST_ITEM }] }), "1A": RISK_REPLY });
  const result = await extract10kClaims({ db: client, llm, resolveCompetitor: async () => null }, tenK);
  assert.deepEqual([result.outcome, calls()], ["already_extracted", 0]);
  assert.deepEqual(await counts(client), { claims: 0, competitors: 0 });
});

test("a 10-K with neither item is recorded failed, rechecked with no fetch or model call, and read once the parser finds an item", dockerTest, async (t) => {
  const { client, nvda } = await nvdaDatabase(t, "tenk-no-sections");
  const unsectioned = new TextEncoder().encode(`<html><body><div>Our Business</div><div>${DESCRIPTION}</div>${BODY}</body></html>`);
  const objectStore = new MemoryObjectStore();
  const { llm, calls } = llmAnswering({ "1": JSON.stringify({ claims: [{ predicate: "business.description", quote: DESCRIPTION }] }) });
  const fetched: string[] = [];
  const deps: TenKBackfillDeps = {
    db: client, llm, objectStore, resolveCompetitor: async () => null,
    secClient: {
      fetchSubmissions: async () => ({ filings: { recent: { accessionNumber: ["0001045810-26-000021"], form: ["10-K"], primaryDocument: ["nvda-20260125.htm"], filingDate: ["2026-02-25"] } } }),
      fetchFiling: async (input) => {
        fetched.push(input.document);
        return { bytes: unsectioned, contentType: "text/html", retrievedAt: "2026-11-15T00:00:00.000Z", url: `https://www.sec.gov/${input.document}` };
      },
    },
  };
  for (const run of ["first", "rerun"]) {
    const result = await backfillIssuer10k(deps, { issuerId: nvda, cik: 1045810 });
    assert.deepEqual([result.outcome, "missing" in result && result.missing, calls()], ["no_sections", ["1", "1A"], 0], run);
  }
  assert.deepEqual(fetched, ["nvda-20260125.htm"], "the rerun reads the stored bytes");
  const { rows: [doc] } = await client.query<{ document_id: string; source_id: string }>(`select document_id::text as document_id, source_id::text as source_id from documents`);
  assert.equal(await parseStatus(client, doc!.document_id), "failed");

  const asALearnedParserSeesIt = { documentId: doc!.document_id, sourceId: doc!.source_id, issuerId: nvda, effectiveTime: null, html: `<div>Item 1. Business</div><div>${DESCRIPTION}</div>${BODY}` };
  const read = await extract10kClaims(deps, asALearnedParserSeesIt);
  assert.deepEqual([read.outcome, read.extracted, read.missing, calls()], ["extracted", 1, ["1A"], 1]);
});

test("a 10-K read in part is recorded failed, and a rerun reads only the item it newly finds", dockerTest, async (t) => {
  const { client, nvda } = await nvdaDatabase(t, "tenk-partial");
  const { llm, calls } = llmAnswering({
    "1": JSON.stringify({ claims: [{ predicate: "business.description", quote: DESCRIPTION }] }),
    "1A": JSON.stringify({ claims: [{ predicate: "risk.factor", quote: OWN_RISK }] }),
  });
  const deps: Extract10kDeps = { db: client, llm, resolveCompetitor: async () => null };
  const tenK = await storedTenK(client, nvda, new TextEncoder().encode(`<div>Item 1. Business</div><div>${DESCRIPTION}</div>${BODY}<div>Item 2. Properties</div>`));
  const summary = async () => {
    const result = await extract10kClaims(deps, tenK);
    return [result.outcome, result.extracted, result.missing, calls(), await parseStatus(client, tenK.documentId)];
  };
  assert.deepEqual(await summary(), ["extracted", 1, ["1A"], 1, "failed"]);
  assert.deepEqual(await summary(), ["already_extracted", 0, ["1A"], 1, "failed"], "Item 1 is not read again");

  tenK.html = `<div>Item 1. Business</div><div>${DESCRIPTION}</div>${BODY}<div>Item 1A. Risk Factors</div><div>${OWN_RISK}</div>${BODY}<div>Item 2. Properties</div>`;
  assert.deepEqual(await summary(), ["extracted", 1, [], 2, "parsed"], "a parser that finds Item 1A reads only Item 1A");
  assert.deepEqual(await counts(client), { claims: 2, competitors: 0 });
});

test("a risk factor headed by an asterisk or middle-dot bullet, as 3M writes them, verifies whole", dockerTest, async (t) => {
  const { client, nvda } = await nvdaDatabase(t, "tenk-asterisk");
  const risk = "The Company's results are impacted by the effects of, and changes in, worldwide economic conditions.";
  for (const bullet of ["*", "&#183;"]) {
    const tenK = await storedTenK(client, nvda, new TextEncoder().encode(
      `<div>Item 1A. Risk Factors</div><div>${bullet} ${risk}</div>${`<div>During 2025, the Company derived revenue abroad (${bullet}).</div>`.repeat(25)}<div>Item 1B. Unresolved Staff Comments</div>`,
    ));
    const { llm } = llmAnswering({ "1A": JSON.stringify({ claims: [{ predicate: "risk.factor", quote: risk }] }) });
    const result = await extract10kClaims({ db: client, llm, resolveCompetitor: async () => null }, tenK);
    assert.deepEqual([result.outcome, result.extracted, result.missing], ["extracted", 1, ["1"]], bullet);
    const { rows: [stored] } = await client.query<{ text_canonical: string }>(`select text_canonical from claims where document_id = $1`, [tenK.documentId]);
    assert.equal(stored!.text_canonical, risk, "stored without its bullet");
  }
});

test("a 10-K extracted from a file takes its filing's accession and date from the backfill", dockerTest, async (t) => {
  const { client, nvda } = await nvdaDatabase(t, "tenk-adopt");
  const objectStore = new MemoryObjectStore();
  const tenK = await storedTenK(client, nvda, NVDA_HTML, objectStore);
  const { llm } = llmAnswering({ "1": JSON.stringify({ claims: [{ predicate: "business.competition", quote: COMPETITION_LIST_ITEM }] }), "1A": RISK_REPLY });
  assert.equal((await extract10kClaims({ db: client, llm, resolveCompetitor: async () => null }, tenK)).outcome, "extracted");
  await storeTenK({ db: client, objectStore }, {
    issuerId: nvda, bytes: NVDA_HTML, url: "https://www.sec.gov/x", accession: "0001045810-26-000021", filedDate: "2026-02-25", retrievedAt: "2026-11-15T00:00:00.000Z",
  });
  const { rows } = await client.query<{ provider_doc_id: string; published_at: Date; effective_time: Date; canonical_url: string }>(
    `select distinct d.provider_doc_id, d.published_at, c.effective_time, s.canonical_url
       from documents d join claims c using (document_id) join sources s on s.source_id = d.source_id`,
  );
  const filed = new Date("2026-02-25T00:00:00Z");
  assert.deepEqual(rows, [{ provider_doc_id: "0001045810-26-000021", published_at: filed, effective_time: filed, canonical_url: "https://www.sec.gov/x" }]);
});

test("a --file run on a 10-K the backfill stored but could not read dates its claims by the filing", dockerTest, async (t) => {
  const { client, nvda } = await nvdaDatabase(t, "tenk-file-after-backfill");
  const objectStore = new MemoryObjectStore();
  await storeTenK({ db: client, objectStore }, {
    issuerId: nvda, bytes: NVDA_HTML, url: "https://www.sec.gov/x", accession: "0001045810-26-000021", filedDate: "2026-02-25", retrievedAt: "2026-11-15T00:00:00.000Z",
  });
  const tenK = await storedTenK(client, nvda, NVDA_HTML, objectStore);
  const { llm } = llmAnswering({ "1": JSON.stringify({ claims: [{ predicate: "business.competition", quote: COMPETITION_LIST_ITEM }] }), "1A": RISK_REPLY });
  assert.equal((await extract10kClaims({ db: client, llm, resolveCompetitor: async () => null }, tenK)).outcome, "extracted");
  const { rows } = await client.query<{ effective_time: Date }>(`select distinct effective_time from claims`);
  assert.deepEqual(rows, [{ effective_time: new Date("2026-02-25T00:00:00Z") }]);
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

test("the first paragraph of a longer list item is no item", dockerTest, async (t) => {
  const { client, nvda } = await nvdaDatabase(t, "tenk-list-fragment");
  const body = "<div>During 2025, the Company derived revenue abroad.</div>".repeat(25);
  const tenK = await storedTenK(client, nvda, new TextEncoder().encode(
    `<div>Item 1. Business</div><ul><li><p>Our products compete with Advanced Micro Devices,</p><p>but only in the discontinued legacy segment.</p></li></ul>${body}<div>Item 2. Properties</div>`,
  ));
  const { llm } = llmAnswering({ "1": JSON.stringify({ claims: [
    { predicate: "business.competition", quote: "Our products compete with Advanced Micro Devices,", competitors: ["Advanced Micro Devices"] },
    { predicate: "business.description", quote: "During 2025, the Company derived revenue abroad." },
  ] }) });
  const result = await extract10kClaims({ db: client, llm, resolveCompetitor: async () => null }, tenK);
  assert.deepEqual([result.outcome, result.extracted, result.droppedUnquoted], ["extracted", 1, 1]);

  const items = await storedTenK(client, nvda, new TextEncoder().encode(
    `<div>Item 1. Business</div><ul><li><p>suppliers of GPUs, such as AMD;</p><p>but only in the discontinued legacy segment.</p></li><li><p>suppliers of networking products, such as Arista Networks</p></li></ul>${body}<div>Item 2. Properties</div>`,
  ));
  const { llm: listed } = llmAnswering({ "1": JSON.stringify({ claims: [
    { predicate: "business.competition", quote: "suppliers of GPUs, such as AMD;" },
    { predicate: "business.competition", quote: "suppliers of GPUs, such as AMD; but only in the discontinued legacy segment." },
    { predicate: "business.competition", quote: "suppliers of networking products, such as Arista Networks" },
  ] }) });
  const read = await extract10kClaims({ db: client, llm: listed, resolveCompetitor: async () => null }, items);
  assert.deepEqual([read.extracted, read.droppedUnquoted], [2, 1], "a whole <li> verifies with or without an end mark; its first paragraph does not");
});

test("a competitor counts only as a proper name, written as the quote writes it", dockerTest, async (t) => {
  const { client, nvda } = await nvdaDatabase(t, "tenk-competitor-case");
  const body = "<div>During 2025, the Company derived revenue abroad.</div>".repeat(25);
  const quote = "We compete for target customers with Intel and with makers of custom chips.";
  const tenK = await storedTenK(client, nvda, new TextEncoder().encode(`<div>Item 1. Business</div><div>${quote}</div>${body}<div>Item 2. Properties</div>`));
  const { llm } = llmAnswering({ "1": JSON.stringify({ claims: [{ predicate: "business.competition", quote, competitors: ["Target", "target", "custom", "INTEL", "Intel"] }] }) });
  const ids: Record<string, string> = { Intel: "8b1f3c1e-5b6a-4c2e-9f0a-0a5e2b7c8d91" };
  const named: string[] = [];
  const resolveCompetitor = async (name: string) => {
    named.push(name);
    return ids[name] ?? null;
  };
  const result = await extract10kClaims({ db: client, llm, resolveCompetitor }, tenK);
  assert.deepEqual([result.competitors, named], [{ resolved: 1, named: 1 }, ["Intel"]]);
});

test("a competitor counts only when the quote names it as a whole word", dockerTest, async (t) => {
  const { client, nvda } = await nvdaDatabase(t, "tenk-competitor-word");
  const body = "<div>During 2025, the Company derived revenue abroad.</div>".repeat(25);
  const quote = "We compete with providers of metaverse platforms and with Intel's foundry.";
  const patents = "We compete on intellectual property with other chip designers.";
  const tenK = await storedTenK(client, nvda, new TextEncoder().encode(`<div>Item 1. Business</div><div>${quote}</div><div>${patents}</div>${body}<div>Item 2. Properties</div>`));
  const { llm } = llmAnswering({ "1": JSON.stringify({ claims: [
    { predicate: "business.competition", quote, competitors: ["Meta", "Intel", "Intel's foundry"] },
    { predicate: "business.competition", quote: patents, competitors: ["Intel"] },
  ] }) });
  const ids: Record<string, string> = { Meta: "7a1f3c1e-5b6a-4c2e-9f0a-0a5e2b7c8d91", Intel: "8b1f3c1e-5b6a-4c2e-9f0a-0a5e2b7c8d91" };
  const result = await extract10kClaims({ db: client, llm, resolveCompetitor: async (name) => ids[name] ?? null }, tenK);
  assert.deepEqual(result.competitors, { resolved: 1, named: 2 }, "metaverse names no Meta, and intellectual property no Intel");
  const { rows } = await client.query<{ subject_id: string }>(`select subject_id::text as subject_id from claim_arguments where role = 'competitor'`);
  assert.deepEqual(rows, [{ subject_id: ids.Intel }]);
});

test("the backfill's summary counts each outcome, and 10-Ks read in part", () => {
  assert.equal(
    summaryLine([
      { outcome: "extracted", missing: [] },
      { outcome: "extracted", missing: ["1A"] },
      { outcome: "no_sections", missing: ["1", "1A"] },
      { outcome: "already_extracted", missing: ["1A"] },
      { outcome: "failed" },
      { outcome: "extracted", missing: [], unread: ["1"], cut: [{ item: "1A", prompts: 11, of: 13 }] },
      { outcome: "unparseable", missing: [], unread: ["1", "1A"] },
    ]),
    "done: extracted=3 partial=2 no_sections=1 already_extracted=1 failed=1 unread=1 cut=1 unparseable=1",
  );
  assert.equal(summaryLine([]), "done: no issuers");
});

test("the CLI runs a backfill only when asked for one", () => {
  assert.throws(() => parseCliArgs([]), /pass one of/);
  assert.throws(() => parseCliArgs(["--file", "nvda.htm", "--backfill", "--ticker", "NVDA"]), /pass one of/);
  assert.throws(() => parseCliArgs(["--file", "nvda.htm"]), /one --ticker/);
  assert.deepEqual(parseCliArgs(["--backfill", "--ticker", "AMD", "--ticker", "KO", "--limit", "1"]), {
    file: undefined, accession: null, filed: null, backfill: true, tickers: ["AMD", "KO"], limit: 1, concurrency: 1,
  });
});

test("a --file run takes the filing's accession and filed date", () => {
  const file = ["--file", "nvda.htm", "--ticker", "NVDA"];
  assert.deepEqual(parseCliArgs([...file, "--accession", "0001045810-26-000021", "--filed", "2026-02-25"]), {
    file: "nvda.htm", accession: "0001045810-26-000021", filed: "2026-02-25", backfill: false, tickers: ["NVDA"], limit: Infinity, concurrency: 1,
  });
  assert.throws(() => parseCliArgs([...file, "--accession", "0001045810-26-000021"]), /go together/);
  assert.throws(() => parseCliArgs([...file, "--accession", "000104581026000021", "--filed", "2026-02-25"]), /--accession takes/);
  for (const day of ["2026-02-30", "2026-13-45", "26-02-25"]) assert.throws(() => parseCliArgs([...file, "--accession", "0001045810-26-000021", "--filed", day]), /--filed takes/, day);
  assert.throws(() => parseCliArgs(["--backfill", "--accession", "0001045810-26-000021", "--filed", "2026-02-25"]), /go with --file/);
});

test("a 10-K names its own filer on its cover page", () => {
  assert.equal(filerCik(NVDA_HTML.toString("utf8")), 1045810);
  assert.equal(filerCik('<ix:nonNumeric contextRef="c-1" name="dei:EntityCentralIndexKey" id="f-31"><span>0000723125</span></ix:nonNumeric>'), 723125, "markup inside the tag");
  assert.equal(filerCik("<ix:nonNumeric name='dei:EntityCentralIndexKey' contextRef='c-1'>\n  0000723125\n</ix:nonNumeric>"), 723125, "single quotes");
  assert.equal(filerCik("<div>Item 1. Business</div>"), null);
});

test("a --file run refuses another filer's 10-K, and warns when it cannot check", () => {
  const nvda = NVDA_HTML.toString("utf8");
  assert.equal(checkFiler(nvda, "NVDA", "0001045810"), null);
  assert.throws(() => checkFiler(nvda, "MU", "0000723125"), /filed by CIK 1045810, not MU's 723125/);
  assert.equal(checkFiler("<div>Item 1. Business</div>", "NVDA", "0001045810"), "filer check skipped: the file has no dei:EntityCentralIndexKey");
  assert.equal(checkFiler(nvda, "NVDA", null), "filer check skipped: NVDA has no CIK");
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

// A model that quotes the first whole sentences of each prompt, under each of
// the item's predicates in turn.
const quotingLlm: Extract10kDeps["llm"] = {
  complete: async (request) => {
    const item = String(request.messages[0]!.content).includes("Item 1 (Business)") ? "1" : "1A";
    const sentences = String(request.messages[1]!.content).split(/(?<=\.) (?=[A-Z])/).filter((sentence) => sentence.length >= 80 && sentence.length <= 400);
    const predicates = TEN_K_PREDICATES[item];
    const claims = sentences.slice(0, 12).map((quote, n) => ({ predicate: predicates[n % predicates.length], quote, competitors: [] }));
    return { text: JSON.stringify({ claims }), deployment: { channel: "test", model: "test-model" } } as Awaited<ReturnType<Extract10kDeps["llm"]["complete"]>>;
  },
};

async function seedEightKClaims(client: QueryExecutor, issuerId: string): Promise<void> {
  const { rows: [source] } = await client.query<{ id: string }>(
    `insert into sources (provider, kind, trust_tier, license_class, retrieved_at) values ('sec_edgar', 'filing', 'primary', 'public', now()) returning source_id::text as id`,
  );
  const releases = [
    ["management.explanation.gross_margin", "2025-08-27T00:00:00Z"],
    ["guidance.revenue", "2025-11-19T00:00:00Z"],
    ["kpi.commentary", "2025-11-19T00:00:00Z"],
    ["material_event.material_event", "2026-01-10T00:00:00Z"],
    ["insider.transaction", "2026-02-01T00:00:00Z"],
  ];
  for (const [n, [predicate, at]] of releases.entries()) {
    const { rows: [document] } = await client.query<{ id: string }>(
      `insert into documents (source_id, kind, title, content_hash, raw_blob_id, published_at) values ($1, 'filing', '8-K', $2, $2, $3) returning document_id::text as id`,
      [source!.id, `sha256:eight-k-${n}`, at],
    );
    const { rows: [claim] } = await client.query<{ id: string }>(
      `insert into claims (document_id, predicate, text_canonical, polarity, modality, reported_by_source_id, effective_time, confidence, status)
       values ($1, $2, $3, 'neutral', 'asserted', $4, $5, 0.9, 'extracted') returning claim_id::text as id`,
      [document!.id, predicate, `NVIDIA's 8-K statement number ${n}.`, source!.id, at],
    );
    await client.query(`insert into claim_arguments (claim_id, subject_kind, subject_id, role) values ($1, 'issuer', $2, 'subject')`, [claim!.id, issuerId]);
  }
}

test("a 10-K's claims enter an evidence read only when the read names their predicates", dockerTest, async (t) => {
  const { client, nvda } = await nvdaDatabase(t, "tenk-evidence-read");
  await seedEightKClaims(client, nvda);
  const subject_refs = [{ kind: "issuer" as const, id: nvda }];
  const chatRoute = { predicate_prefixes: ["management.explanation.", "guidance.", "kpi.", "material_event."], effective_from: "2025-01-01T00:00:00Z" };
  const ids = (evidence: Awaited<ReturnType<typeof loadLocalRuntimeEvidence>>) => evidence.claims.map((claim) => claim.claim_id);
  const unselected = async () => ids(await loadLocalRuntimeEvidence(client, { subject_refs }));
  const chat = async () => ids(await loadLocalRuntimeEvidence(client, { subject_refs, selection: chatRoute, limit: 6 }));
  const [unselectedBefore, chatBefore] = [await unselected(), await chat()];

  const doc = await storeTenK({ db: client, objectStore: new MemoryObjectStore() }, {
    issuerId: nvda, bytes: NVDA_HTML, url: null, accession: "0001045810-26-000021", filedDate: "2026-02-25", retrievedAt: "2026-11-15T00:00:00.000Z",
  });
  await extract10kClaims({ db: client, llm: quotingLlm, resolveCompetitor: async () => null }, { ...doc, issuerId: nvda, html: NVDA_HTML.toString("utf8"), effectiveTime: "2026-02-25T00:00:00Z" });
  const { rows: stored } = await client.query<{ predicate: string; n: number }>(
    `select predicate, count(*)::int as n from claims where document_id = $1 group by 1 order by 1`,
    [doc.documentId],
  );
  assert.deepEqual(stored.map((row) => row.predicate), Object.values(TEN_K_PREDICATES).flat().sort(), "the 10-K stores claims of every predicate");

  await t.test("a read with no selection returns the 8-K claims it did before the 10-K", async () => {
    assert.deepEqual(await unselected(), unselectedBefore);
  });
  await t.test("a chat route's read fills its leftover slots with no 10-K claim", async () => {
    assert.deepEqual(await chat(), chatBefore);
  });
  await t.test("a read naming risk.factor gets every risk factor and no business claim", async () => {
    const risks = await loadLocalRuntimeEvidence(client, { subject_refs, selection: { predicate_prefixes: ["risk.factor"], effective_from: null }, limit: 100 });
    const predicates = risks.claims.map((claim) => claim.predicate);
    assert.equal(predicates.filter((predicate) => predicate === "risk.factor").length, stored.find((row) => row.predicate === "risk.factor")!.n);
    assert.deepEqual(predicates.filter((predicate) => predicate.startsWith("business.")), []);
  });
  await t.test("a read that pins a 10-K claim by id gets it", async () => {
    const { rows: [pinned] } = await client.query<{ id: string }>(`select claim_id::text as id from claims where document_id = $1 limit 1`, [doc.documentId]);
    const read = await loadLocalRuntimeEvidence(client, { subject_refs, selection: chatRoute, first_claim_ids: [pinned!.id] });
    assert.equal(read.claims[0]!.claim_id, pinned!.id);
  });
});
