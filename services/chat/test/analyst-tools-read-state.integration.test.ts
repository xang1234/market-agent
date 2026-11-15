import test from "node:test";
import assert from "node:assert/strict";

import { runAnalystTool, type AnalystToolResult } from "../src/analyst-tools.ts";
import { analystPacketEntries } from "../src/evidence-packet.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";

type State = "read" | "cut" | "unread" | "not_found" | null;
const STATES: State[] = ["read", "cut", "unread", "not_found", null];
const PAIRS: Array<[State, State]> = STATES.flatMap((older) => STATES.map((newer) => [older, newer] as [State, State]));
const ITEMS = ["1", "1A"] as const;
const PREDICATE = { "1": "business.products", "1A": "risk.factor" } as const;
const SOURCE = "e4444444-4444-4444-8444-444444444444";
const AS_OF = "2026-11-15T00:00:00Z";
const issuer = (k: number) => `e1111111-1111-4111-8111-${String(k).padStart(12, "0")}`;
const doc = (k: number, filing: "old" | "new") => `e5555555-5555-4555-8555-${(filing === "old" ? "1" : "2") + String(k).padStart(11, "0")}`;
// Issuer k's (older, newer) item states: every pair for Item 1, a shuffle of them for Item 1A.
const caseOf = (k: number) => ({ "1": PAIRS[k]!, "1A": PAIRS[(k * 7 + 3) % 25]! });

// The rule: the latest 10-K whose item was read or cut, else the newest; the
// newer one is named when it left the item unread.
function expected([older, newer]: [State, State]) {
  const served = (state: State) => state === "read" || state === "cut";
  const chosen = served(newer) || !served(older) ? "new" : "old";
  const state = (chosen === "new" ? newer : older) ?? "not_sectioned";
  return { chosen, state, newer: chosen === "old" ? (newer ?? "not_sectioned") : null, claims: served(state as State) };
}

async function seedFiling(db: Awaited<ReturnType<typeof connectedClient>>, k: number, filing: "old" | "new", filed: string, states: Record<string, State>) {
  const readState = Object.fromEntries(ITEMS.flatMap((item) => states[item] === null ? [] : [[item, states[item] === "cut" ? { state: "cut", prompts: 11, of: 13 } : { state: states[item] }]]));
  await db.query(
    `insert into documents (document_id, source_id, kind, title, provider_doc_id, published_at, content_hash, raw_blob_id, parse_status, created_at, read_state)
     values ($1::uuid, $2, 'filing', '10-K', $3, $4::timestamptz, $5, $5, 'parsed', $4::timestamptz, $6::jsonb)`,
    [doc(k, filing), SOURCE, `acc-${k}-${filing}`, filed, `h-${k}-${filing}`, Object.keys(readState).length > 0 ? JSON.stringify(readState) : null],
  );
  await db.query(`insert into mentions (document_id, subject_kind, subject_id, prominence, confidence) values ($1, 'issuer', $2, 'headline', 1)`, [doc(k, filing), issuer(k)]);
}

async function seedClaim(db: Awaited<ReturnType<typeof connectedClient>>, k: number, filing: "old" | "new", filed: string, item: (typeof ITEMS)[number]) {
  const { rows: [claim] } = await db.query<{ claim_id: string }>(
    `insert into claims (document_id, predicate, text_canonical, polarity, modality, reported_by_source_id, attributed_to_type, attributed_to_id, confidence, status, created_at)
     values ($1, $2, $3, 'neutral', 'quoted', $4, 'issuer', $5, 0.9, 'extracted', $6::timestamptz) returning claim_id::text`,
    [doc(k, filing), PREDICATE[item], `${k}-${filing}-${item}`, SOURCE, issuer(k), filed],
  );
  await db.query(`insert into claim_arguments (claim_id, subject_kind, subject_id, role) values ($1, 'issuer', $2, 'subject')`, [claim!.claim_id, issuer(k)]);
  await db.query(`insert into claim_evidence (claim_id, document_id, locator, confidence) values ($1, $2, $3, 1)`, [claim!.claim_id, doc(k, filing), JSON.stringify({ item, start: 1, end: 5 })]);
}

test("every pair of older and newer item states gives the latest read filing's claims, its state, and a packet entry naming any gap", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "chat-analyst-read-matrix");
  const db = await connectedClient(t, databaseUrl);
  await db.query(`insert into sources (source_id, provider, kind, canonical_url, trust_tier, license_class, retrieved_at) values ($1, 'sec_edgar', 'filing', 'https://www.sec.gov/x', 'primary', 'public', now())`, [SOURCE]);
  for (let k = 0; k < PAIRS.length; k += 1) {
    await db.query(`insert into issuers (issuer_id, legal_name) values ($1, $2)`, [issuer(k), `Issuer ${k}`]);
    for (const [filing, index, filed] of [["old", 0, "2025-02-01"], ["new", 1, "2026-02-01"]] as const) {
      const states = { "1": caseOf(k)["1"][index], "1A": caseOf(k)["1A"][index] };
      await seedFiling(db, k, filing, filed, states);
      for (const item of ITEMS) if (states[item] === "read" || states[item] === "cut") await seedClaim(db, k, filing, filed, item);
    }
  }

  const mismatches: string[] = [];
  for (let k = 0; k < PAIRS.length; k += 1) {
    for (const [tool, predicates, items] of [
      ["get_company_profile", undefined, ["1"]],
      ["get_claims", undefined, ["1", "1A"]],
      ["get_claims", ["risk.factor"], ["1A"]],
    ] as const) {
      const result = await runAnalystTool(db, tool, { issuer_ids: [issuer(k)], as_of: AS_OF, ...(predicates ? { predicates } : {}) }) as Extract<AnalystToolResult, { reads: unknown }>;
      const tag = `k=${k} ${tool}${predicates ? "(risk)" : ""} 1=${caseOf(k)["1"].join("/")} 1A=${caseOf(k)["1A"].join("/")}`;
      const want = items.map((item) => ({ item, ...expected(caseOf(k)[item]) }));
      const check = (what: string, got: unknown, wanted: unknown) => {
        try { assert.deepEqual(got, wanted); } catch { mismatches.push(`${tag}: ${what} ${JSON.stringify(got)}, want ${JSON.stringify(wanted)}`); }
      };
      check("reads", result.reads.map((read) => ({
        item: read.item, chosen: read.filing.document_id === doc(k, "old") ? "old" : "new", state: read.state, newer: read.newer_unread?.state ?? null, cut: read.cut,
      })), want.map(({ item, chosen, state, newer }) => ({ item, chosen, state, newer, cut: state === "cut" ? { prompts: 11, of: 13 } : null })));
      const claims = want.filter((item) => item.claims).map((item) => `${k}-${item.chosen}-${item.item}`).sort();
      check("claims", ("claims" in result ? result.claims.map((claim) => claim.text_canonical) : []).sort(), claims);
      const full = want.every((item) => item.state === "read" && item.newer === null);
      check("status", result.status, claims.length > 0 ? "ok" : full ? (tool === "get_company_profile" ? "no_business_claims" : "no_claims") : "incomplete_read");
      const entries = analystPacketEntries([result]).flatMap((entry) => entry.kind === "filing_read" ? [entry] : []);
      check("filing_read entries", entries.map((entry) => ({
        item: entry.item, state: entry.state, document: entry.document_id, source: entry.source_id, newer: entry.newer_unread?.document_id ?? null, cut_said: /read in part, 11 of 13 prompts/.test(entry.text),
      })), want.filter((item) => item.state !== "read" || item.newer !== null).map((item) => ({
        item: item.item, state: item.state, document: doc(k, item.chosen as "old" | "new"), source: SOURCE, newer: item.newer === null ? null : doc(k, "new"), cut_said: item.state === "cut",
      })));
    }
  }
  assert.deepEqual(mismatches, []);
});

test("an older 10-K that read Item 1A and found none, under a newer one that left it unread, is an incomplete read", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "chat-analyst-empty-newer-unread");
  const db = await connectedClient(t, databaseUrl);
  await db.query(`insert into sources (source_id, provider, kind, canonical_url, trust_tier, license_class, retrieved_at) values ($1, 'sec_edgar', 'filing', 'https://www.sec.gov/x', 'primary', 'public', now())`, [SOURCE]);
  await db.query(`insert into issuers (issuer_id, legal_name) values ($1, 'X Corp')`, [issuer(0)]);
  await seedFiling(db, 0, "old", "2025-02-01", { "1": null, "1A": "read" });
  await seedFiling(db, 0, "new", "2026-02-01", { "1": null, "1A": "unread" });
  const result = await runAnalystTool(db, "get_claims", { issuer_ids: [issuer(0)], as_of: AS_OF, predicates: ["risk.factor"] });
  assert.deepEqual([result.status, "reads" in result && result.reads.map((read) => [read.state, read.newer_unread?.state])], ["incomplete_read", [["read", "unread"]]],
    "the older filing read in full is not the whole story while the newer one is unread");
});

test("a 10-K filed before the cutoff but read after it is not yet extracted at the cutoff, never read in full with none", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "chat-analyst-extracted-after");
  const db = await connectedClient(t, databaseUrl);
  await db.query(`insert into sources (source_id, provider, kind, canonical_url, trust_tier, license_class, retrieved_at) values ($1, 'sec_edgar', 'filing', 'https://www.sec.gov/x', 'primary', 'public', now())`, [SOURCE]);
  await db.query(`insert into issuers (issuer_id, legal_name) values ($1, 'NVIDIA Corp'), ($2, 'Broadcom Inc')`, [issuer(0), issuer(1)]);
  // NVDA's only 10-K, filed in February and stored and read in November, as the fixture CLI does.
  await seedFiling(db, 0, "new", "2026-02-25", { "1": "read", "1A": "read" });
  await db.query(`update documents set created_at = '2026-11-15T07:00:00Z' where document_id = $1`, [doc(0, "new")]);
  for (const item of ITEMS) await seedClaim(db, 0, "new", "2026-11-15T07:00:00Z", item);
  // AVGO's 2025 10-K was read in 2025; its 2026 one was stored in February and read in November.
  await seedFiling(db, 1, "old", "2025-02-01", { "1": "read", "1A": null });
  await seedClaim(db, 1, "old", "2025-02-01", "1");
  await seedFiling(db, 1, "new", "2026-02-01", { "1": "read", "1A": null });
  await seedClaim(db, 1, "new", "2026-11-15T07:00:00Z", "1");

  const profile = (k: number, as_of: string) => runAnalystTool(db, "get_company_profile", { issuer_ids: [issuer(k)], as_of });
  const shown = (result: AnalystToolResult) => [
    result.status,
    "reads" in result && result.reads.map((read) => [read.filing.document_id, read.state, read.newer_unread?.state ?? null]),
    analystPacketEntries([result]).map((entry) => entry.text),
  ];
  assert.deepEqual(shown(await profile(0, "2026-09-01T00:00:00Z")), [
    "incomplete_read",
    [[doc(0, "new"), "not_yet_extracted", null]],
    ["NVIDIA Corp's 10-K, accession acc-0-new, filed 2026-02-25, https://www.sec.gov/x: Item 1 (business) was not read by the cutoff, so no claims from it are on file"],
  ], "on the frozen 2026-09-01 clock NVDA's claims are not yet known, and the read says so");
  assert.equal((await profile(0, "2026-11-16T00:00:00Z")).status, "ok", "after the read the claims are served");
  assert.deepEqual(shown(await profile(1, "2026-09-01T00:00:00Z")).slice(0, 2), ["ok", [[doc(1, "old"), "read", "not_yet_extracted"]]],
    "AVGO's 2025 10-K serves Item 1, naming the 2026 one read after the cutoff");
  const risks = await runAnalystTool(db, "get_claims", { issuer_ids: [issuer(0)], as_of: "2026-09-01T00:00:00Z", predicates: ["risk.factor"] });
  assert.equal(risks.status, "incomplete_read", "nor do NVDA's risk factors read as none");
});

test("a subject left out by the filer limit is a truncated read, never an issuer with no 10-K", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "chat-analyst-filer-cap");
  const db = await connectedClient(t, databaseUrl);
  await db.query(`insert into sources (source_id, provider, kind, canonical_url, trust_tier, license_class, retrieved_at) values ($1, 'sec_edgar', 'filing', 'https://www.sec.gov/x', 'primary', 'public', now())`, [SOURCE]);
  for (let k = 0; k < 21; k += 1) {
    await db.query(`insert into issuers (issuer_id, legal_name) values ($1, $2)`, [issuer(k), `Issuer ${String(k).padStart(2, "0")}`]);
    await seedFiling(db, k, "new", "2026-02-01", { "1": null, "1A": "read" });
  }
  const read = async (n: number) => {
    const result = await runAnalystTool(db, "get_claims", { issuer_ids: Array.from({ length: n }, (_, k) => issuer(k)), as_of: AS_OF, predicates: ["risk.factor"] });
    assert.ok("reads" in result);
    return [result.status, result.reads.length, result.truncated, result.no_filing, analystPacketEntries([result]).filter((entry) => entry.kind === "no_filing").length];
  };
  assert.deepEqual(await read(20), ["no_claims", 20, false, [], 0], "twenty filers fit the limit and were read in full");
  assert.deepEqual(await read(21), ["incomplete_read", 20, true, [], 0], "the twenty-first has a 10-K the limit left unread");
});

test("another user's private claim does not change whether a 10-K item was extracted by the cutoff", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "chat-analyst-private-state");
  const db = await connectedClient(t, databaseUrl);
  const owner = "e6666666-6666-4666-8666-666666666666";
  const privateSource = "e7777777-7777-4777-8777-777777777777";
  await db.query(`insert into users (user_id, email) values ($1, 'owner@example.invalid')`, [owner]);
  await db.query(
    `insert into sources (source_id, provider, kind, canonical_url, trust_tier, license_class, retrieved_at, user_id)
     values ($1, 'sec_edgar', 'filing', 'https://www.sec.gov/x', 'primary', 'public', now(), null),
            ($2, 'upload', 'reference_data', null, 'secondary', 'private', now(), $3)`,
    [SOURCE, privateSource, owner],
  );
  await db.query(`insert into issuers (issuer_id, legal_name) values ($1, 'Qualcomm Inc')`, [issuer(0)]);
  await seedFiling(db, 0, "new", "2026-02-01", { "1": "read", "1A": null });
  await seedClaim(db, 0, "new", "2027-01-01", "1");
  const profile = async (user_id: string | null) => {
    const result = await runAnalystTool(db, "get_company_profile", { issuer_ids: [issuer(0)], as_of: AS_OF, user_id });
    return [result.status, "reads" in result && result.reads.map((read) => read.state)];
  };
  assert.deepEqual(await profile(null), ["incomplete_read", ["not_yet_extracted"]]);

  const { rows: [early] } = await db.query<{ claim_id: string }>(
    `insert into claims (document_id, predicate, text_canonical, polarity, modality, reported_by_source_id, attributed_to_type, attributed_to_id, confidence, status, created_at)
     values ($1, 'business.products', 'private early', 'neutral', 'quoted', $2, 'issuer', $3, 0.9, 'extracted', '2026-02-01') returning claim_id::text`,
    [doc(0, "new"), privateSource, issuer(0)],
  );
  await db.query(`insert into claim_arguments (claim_id, subject_kind, subject_id, role) values ($1, 'issuer', $2, 'subject')`, [early!.claim_id, issuer(0)]);
  assert.deepEqual(await profile(null), ["incomplete_read", ["not_yet_extracted"]], "the anonymous read ignores the private claim");
  assert.deepEqual(await profile("e8888888-8888-4888-8888-888888888888"), ["incomplete_read", ["not_yet_extracted"]], "so does another user's");

  await db.query(`update claims set reported_by_source_id = $1, created_at = '2027-01-01'`, [privateSource]);
  assert.deepEqual(await profile(null), ["no_business_claims", ["read"]], "a private claim alone, even a later one, does not make the item look unextracted to others");
});
