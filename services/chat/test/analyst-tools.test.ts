import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isUnavailableRead, runAnalystTool, runRegisteredAnalystTool } from "../src/analyst-tools.ts";
import { parseCliArgs, entryLine } from "../src/analyst-tools-cli.ts";
import { statusNote } from "../src/analyst-agent.ts";
import { analystPacketEntries, mergePackets } from "../src/evidence-packet.ts";
import { citable } from "../src/render-assertions.ts";
import { fakeQuery } from "./fake-query.ts";

const NVDA = "11111111-1111-4111-8111-111111111111";
const AMD = "22222222-2222-4222-8222-222222222222";
const KO = "33333333-3333-4333-8333-333333333333";
const MU = "44444444-4444-4444-8444-444444444444";
const WDC = "55555555-5555-4555-8555-555555555555";
const AAPL = "66666666-6666-4666-8666-666666666666";
const AAPL_LISTING = "77777777-7777-4777-8777-777777777777";
const AS_OF = "2026-11-15T12:00:00.000Z";

const INTC = "88888888-8888-4888-8888-888888888888";
const AVGO = "99999999-9999-4999-8999-999999999999";
const NVDA_10K = "d0000000-0000-4000-8000-000000000001";
const INTC_10K = "d0000000-0000-4000-8000-000000000002";
const AVGO_OLD_10K = "d0000000-0000-4000-8000-000000000003";
const AVGO_NEW_10K = "d0000000-0000-4000-8000-000000000004";
const SEC = "50000000-0000-4000-8000-000000000001";
const NVDA_LINK = "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/0001045810-26-000021-index.htm";

const filing = (document_id: string, accession: string | null, published_at: string | null, link: string | null) =>
  ({ document_id, source_id: SEC, title: "10-K", accession, published_at, link });
const FILINGS: Record<string, ReturnType<typeof filing>> = {
  [NVDA_10K]: filing(NVDA_10K, "0001045810-26-000021", "2026-02-25T00:00:00.000Z", NVDA_LINK),
  [INTC_10K]: filing(INTC_10K, null, null, null),
  [AVGO_OLD_10K]: filing(AVGO_OLD_10K, "0001730168-25-000010", "2025-02-01T00:00:00.000Z", null),
  [AVGO_NEW_10K]: filing(AVGO_NEW_10K, "0001730168-26-000010", "2026-02-01T00:00:00.000Z", null),
};

const filingClaim = (claim_id: string, predicate: string, text: string, document_id = NVDA_10K, filer_issuer_id = NVDA) => ({
  claim_id,
  document_id,
  source_id: SEC,
  text_canonical: text,
  predicate,
  polarity: predicate === "risk.factor" ? "negative" : "neutral",
  effective_time: FILINGS[document_id]!.published_at,
  published_at: FILINGS[document_id]!.published_at,
  filer_issuer_id,
  filer_label: LABELS[filer_issuer_id],
  accession: FILINGS[document_id]!.accession,
  document_title: "10-K",
  link: FILINGS[document_id]!.link,
  matched: "2",
});

const LABELS: Record<string, string> = { [NVDA]: "NVDA", [AMD]: "AMD", [MU]: "MU", [WDC]: "WDC", [AAPL]: "AAPL", [INTC]: "INTC", [AVGO]: "AVGO" };

const CLAIMS = [
  filingClaim("c0000000-0000-4000-8000-000000000001", "business.description", "NVIDIA pioneered accelerated computing."),
  filingClaim("c0000000-0000-4000-8000-000000000002", "business.products", "Our products include GPUs and networking."),
  filingClaim("c0000000-0000-4000-8000-000000000003", "business.competition", "Our competitors include Advanced Micro Devices."),
  filingClaim("c0000000-0000-4000-8000-000000000004", "risk.factor", "Supply may be constrained."),
  filingClaim("c0000000-0000-4000-8000-000000000005", "business.products", "We make x86 processors.", INTC_10K, INTC),
  filingClaim("c0000000-0000-4000-8000-000000000006", "business.products", "We sold modems.", AVGO_OLD_10K, AVGO),
];
const COMPETITION_CLAIM_ID = "c0000000-0000-4000-8000-000000000003";

// Each filer's chosen 10-K per item, as loadFilingItemReads returns it.
const READS: Record<string, Record<string, { document: string; state: string; item_state?: object; newer?: { document: string; state: string } }>> = {
  [NVDA]: { "1": { document: NVDA_10K, state: "read" }, "1A": { document: NVDA_10K, state: "cut", item_state: { state: "cut", prompts: 11, of: 13 } } },
  [INTC]: { "1": { document: INTC_10K, state: "read" }, "1A": { document: INTC_10K, state: "unread" } },
  [AVGO]: {
    "1": { document: AVGO_OLD_10K, state: "read", newer: { document: AVGO_NEW_10K, state: "unread" } },
    "1A": { document: AVGO_OLD_10K, state: "cut", item_state: { state: "cut", prompts: 3, of: 9 }, newer: { document: AVGO_NEW_10K, state: "not_found" } },
  },
  [KO]: {},
};

function stackDb(seen: Array<{ text: string; values?: unknown[] }> = []) {
  return {
    query: fakeQuery((text, values) => {
      seen.push({ text, values });
      if (text.includes("with filers as")) {
        const [issuers, role, items] = values as [string[], string, string[]];
        const filers = role === "competitor" ? (issuers.includes(AMD) ? [NVDA] : []) : issuers;
        const filed = filers.filter((filer) => items.some((item) => READS[filer]?.[item]));
        return {
          rows: filers.flatMap((filer) => items.flatMap((item) => {
            const read = READS[filer]?.[item];
            if (!read) return [];
            const newer = read.newer && { ...FILINGS[read.newer.document], state: read.newer.state };
            return [{ filer_issuer_id: filer, filer_label: LABELS[filer], item, state: read.state, item_state: read.item_state ?? { state: read.state }, filing: FILINGS[read.document], newer: newer ?? null, filed }];
          })),
        };
      }
      if (text.includes("with chosen as")) {
        const [issuers, role, predicates, , , , documents, patterns] = values as [string[], string, string[], unknown, unknown, string[], string[], string[]];
        return {
          rows: CLAIMS.filter((claim) => {
            const at = documents.indexOf(claim.document_id);
            const named = role === "competitor" ? issuers.includes(AMD) && claim.claim_id === COMPETITION_CLAIM_ID : issuers.includes(claim.filer_issuer_id);
            return at >= 0 && named && predicates.includes(claim.predicate) && claim.predicate.startsWith(patterns[at]!.slice(0, -1));
          }),
        };
      }
      if (text.includes("with evidenced as")) {
        const peer = (id: string, market_cap_source_id: string | null) => ({ issuer_id: id, label: LABELS[id], industry: "Semiconductors", industry_source_id: `ind-${LABELS[id]}`, market_cap_source_id });
        return { rows: values?.[0] === MU ? [peer(MU, null), peer(WDC, "cap-WDC")] : [] };
      }
      if (text.includes("from consensus_captures cc")) return { rows: values?.[0] === AAPL ? CONSENSUS : [] };
      if (text.includes("from non_gaap_reconciliations r")) return { rows: values?.[0] === NVDA ? RELEASES : values?.[0] === INTC ? [RELEASES[2]] : [] };
      if (text.includes("jsonb_array_elements")) {
        const refs = JSON.parse(String(values?.[0])) as Array<{ kind: string; id: string }>;
        return { rows: refs.map((ref, i) => ({ ord: i + 1, issuer_id: ref.id === AAPL_LISTING ? AAPL : ref.kind === "issuer" && LABELS[ref.id] ? ref.id : null })) };
      }
      if (text.includes("as label")) return { rows: (values?.[0] as string[]).map((id) => ({ issuer_id: id, label: LABELS[id] ?? (id === KO ? "KO" : null) })) };
      throw new Error(`unexpected query: ${text.slice(0, 60)}`);
    }),
  };
}

const CONSENSUS = [
  { capture_id: "e0000000-0000-4000-8000-000000000001", source_id: "00000000-0000-4000-a000-000000000015", provider: "finviz_dev_consensus", captured_on: "2026-11-14", field_key: "eps_next_y", raw_value: "8.49", unit: "usd_per_share", fiscal_period: null },
  { capture_id: "e0000000-0000-4000-8000-000000000002", source_id: "00000000-0000-4000-a000-000000000015", provider: "finviz_dev_consensus", captured_on: "2026-11-14", field_key: "target_price", raw_value: "290.50", unit: "usd", fiscal_period: null },
  { capture_id: "e0000000-0000-4000-8000-000000000003", source_id: "00000000-0000-4000-a000-000000000015", provider: "finviz_dev_consensus", captured_on: "2026-11-14", field_key: "recommendation_mean", raw_value: "2.10", unit: "recommendation_1_to_5", fiscal_period: null },
];

const reconciliation = (measure_key: string, gaap: number, non_gaap: number, adjustments: Array<[string, number]> = []) => ({
  exhibit: "EX-99.1", measure_key, gaap: { label: `GAAP ${measure_key}`, value_num: gaap }, non_gaap: { label: `Non-GAAP ${measure_key}`, value_num: non_gaap },
  adjustments: adjustments.map(([label, value_num]) => ({ label, value_num })), unit: "currency", scale: "millions",
});
const RELEASES = [
  {
    document_id: "f0000000-0000-4000-8000-000000000001", source_id: "f1000000-0000-4000-8000-000000000001", accession: "0001045810-25-000230", form: "8-K",
    filed_on: "2025-11-19", quarter_end: "2025-10-26",
    revenue: { exhibit: "EX-99.1", label: "Revenue", value_num: 57_006, scale: "millions" },
    reconciliations: [
      reconciliation("gross_profit", 41_849, 42_147, [["Stock-based compensation expense (B)", 178], ["Other (C)", -2]]),
      reconciliation("operating_expenses", 5_839, 4_325, [["Stock-based compensation expense (B)", -1_474]]),
      reconciliation("operating_income", 36_010, 37_822),
      reconciliation("net_income", 31_910, 33_366, [["Income tax impact of non-GAAP adjustments (D)", -356]]),
      reconciliation("eps_diluted", 1.3, 1.36),
    ],
  },
  {
    document_id: "f0000000-0000-4000-8000-000000000002", source_id: "f1000000-0000-4000-8000-000000000002", accession: "0001045810-25-000200", form: "8-K/A",
    filed_on: "2025-08-27", quarter_end: "2025-07-27", revenue: null, reconciliations: [],
  },
  {
    document_id: "f0000000-0000-4000-8000-000000000003", source_id: "f1000000-0000-4000-8000-000000000003", accession: "0001045810-25-000100",
    filed_on: "2025-05-28", quarter_end: null, revenue: null, reconciliations: [],
  },
];

const NVDA_FILING = `10-K, accession 0001045810-26-000021, filed 2026-02-25, ${NVDA_LINK}`;

test("a company profile is the filer's business claims from its 10-K", async () => {
  const result = await runAnalystTool(stackDb(), "get_company_profile", { issuer_ids: [NVDA], as_of: AS_OF });
  assert.deepEqual(analystPacketEntries([result]).map(entryLine), [
    `C1\tbusiness.description\tNVDA\t${NVDA_FILING}\tclaim=c0000000-0000-4000-8000-000000000001\tNVIDIA pioneered accelerated computing.`,
    `C2\tbusiness.products\tNVDA\t${NVDA_FILING}\tclaim=c0000000-0000-4000-8000-000000000002\tOur products include GPUs and networking.`,
    `C3\tbusiness.competition\tNVDA\t${NVDA_FILING}\tclaim=c0000000-0000-4000-8000-000000000003\tOur competitors include Advanced Micro Devices.`,
  ]);
});

test("a competitor read of AMD returns NVDA's competition claim, labelled as NVDA's", async () => {
  const result = await runAnalystTool(stackDb(), "get_claims", { issuer_ids: [AMD], as_of: AS_OF, role: "competitor" });
  const [entry, ...others] = analystPacketEntries([result]);
  assert.deepEqual(others.map((other) => [other.kind, other.company, other.text.endsWith("11 of 13 prompts, so claims from the rest of it are missing")]), [["filing_read", "NVDA", true]],
    "NVDA's cut Item 1A might name AMD too");
  assert.equal(entry?.kind, "claim");
  assert.equal(entry?.company, "NVDA");
  assert.equal(entry?.text, "Our competitors include Advanced Micro Devices.");
});

test("consensus is each value labelled an attributed expectation with its capture date", async () => {
  const result = await runAnalystTool(stackDb(), "get_analyst_consensus", { issuer_ids: [AAPL], as_of: AS_OF });
  assert.deepEqual(analystPacketEntries([result]).map((entry) => [entry.id, entry.company, entry.text]), [
    ["C1", "AAPL", "attributed consensus: Finviz EPS next year, captured 2026-11-14: 8.49 USD per share"],
    ["C2", "AAPL", "attributed consensus: Finviz target price, captured 2026-11-14: 290.50 USD"],
    ["C3", "AAPL", "attributed consensus: Finviz mean recommendation score (recommendation_mean, on a 1 to 5 scale), captured 2026-11-14: 2.10"],
  ]);
  assert.doesNotMatch(analystPacketEntries([result]).map((entry) => entry.text).join("\n"), /buy|sell|hold/i, "ADR 0005: no stance words in a factual label");
});

test("non-GAAP history is each quarter's reconciled figures and each add-back's count of quarters, citing the releases", async () => {
  const result = await runAnalystTool(stackDb(), "get_non_gaap_history", { issuer_ids: [NVDA], as_of: AS_OF });
  assert.equal(result.status, "ok");
  assert.deepEqual(analystPacketEntries([result]).map((entry) => [entry.id, entry.company, entry.predicate, entry.text]), [
    ["C1", "NVDA", "non_gaap.quarter", "non-GAAP reconciliation for the quarter ended 2025-10-26 (8-K accession 0001045810-25-000230, filed 2025-11-19): diluted EPS GAAP 1.30, non-GAAP 1.36, a spread of 0.06; operating income GAAP 36,010, non-GAAP 37,822 in millions; operating margin on revenue of 57,006 in millions, GAAP 63.2%, non-GAAP 66.3%, a spread of 3.2 percentage points; stock-based compensation added back 1,652 in millions (gross profit and operating expenses lines), 5.0% of non-GAAP net income of 33,366"],
    ["C2", "NVDA", "non_gaap.quarter", "non-GAAP reconciliation for the quarter ended 2025-07-27 (8-K/A accession 0001045810-25-000200, filed 2025-08-27): no GAAP to non-GAAP reconciliation could be read from the release"],
    ["C3", "NVDA", "non_gaap.add_back", "non-GAAP add-back \"stock-based compensation\": in 1 of the 2 latest quarters on file (2025-10-26); recurring means in 5 or more of the last 8 quarters, which this is not"],
    ["C4", "NVDA", "non_gaap.add_back", "non-GAAP add-back \"Other\": in 1 of the 2 latest quarters on file (2025-10-26); recurring means in 5 or more of the last 8 quarters, which this is not"],
    ["C5", "NVDA", "non_gaap.add_back", "non-GAAP add-back \"income tax effects\": in 1 of the 2 latest quarters on file (2025-10-26); recurring means in 5 or more of the last 8 quarters, which this is not"],
  ]);
  const [quarter, , category] = analystPacketEntries([result]);
  assert.equal("source_id" in quarter! && quarter.source_id, RELEASES[0]!.source_id, "a quarter cites its release");
  assert.deepEqual("sources" in category! && category.sources, [{ source_id: RELEASES[0]!.source_id, company: "NVDA", what: "source" }], "a category cites each release it is in");
  assert.match(statusNote(result, "NVDA") ?? "", /1 stored earnings release could not be dated to a quarter/);
  const packet = mergePackets({ engine: [], analyst: [result], figuresAskedFor: [], notes: [], labels: new Map(), cutoff: AS_OF });
  assert.deepEqual(packet.claims.filter((claim) => !citable(claim)).map((claim) => claim.id), [], "every quarter and add-back opens its release");
  assert.doesNotMatch(analystPacketEntries([result]).map((entry) => entry.text).join("\n"), /\b(?:buy|sell|hold|aggressive|quality|concern)/i, "ADR 0005: counts, never a stance");
  assert.deepEqual(await runAnalystTool(stackDb(), "get_non_gaap_history", { issuer_ids: [KO], as_of: AS_OF }), { tool: "get_non_gaap_history", status: "no_releases" });
  // Releases read but none dated: said as such, never as no release on file.
  const undated = await runAnalystTool(stackDb(), "get_non_gaap_history", { issuer_ids: [INTC], as_of: AS_OF });
  assert.equal(undated.status, "ok");
  assert.equal(statusNote(undated, "INTC"), "INTC: 1 stored earnings release could not be dated to a quarter, so its reconciliation is not shown.");
});

// Each key the value has that its registry schema closes out, or lacks that it requires.
type Schema = { properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean; items?: Schema };
function schemaGaps(value: unknown, schema: Schema, path = "$"): string[] {
  if (Array.isArray(value)) return schema.items ? value.flatMap((item, n) => schemaGaps(item, schema.items!, `${path}[${n}]`)) : [];
  if (value === null || typeof value !== "object" || !schema.properties) return [];
  const record = value as Record<string, unknown>;
  return [
    ...(schema.required ?? []).filter((key) => !(key in record)).map((key) => `${path}.${key} missing`),
    ...Object.keys(record).flatMap((key) => schema.properties![key]
      ? schemaGaps(record[key], schema.properties![key]!, `${path}.${key}`)
      : schema.additionalProperties === false ? [`${path}.${key} not in schema`] : []),
  ];
}

test("non-GAAP history's result has exactly the fields its registry output schema names", async () => {
  const registry = JSON.parse(readFileSync(new URL("../../../spec/finance_research_tool_registry.json", import.meta.url), "utf8")) as { tools: Array<{ name: string; output_json_schema: Schema }> };
  const schema = registry.tools.find((tool) => tool.name === "get_non_gaap_history")!.output_json_schema;
  const result = await runAnalystTool(stackDb(), "get_non_gaap_history", { issuer_ids: [NVDA], as_of: AS_OF });
  assert.deepEqual(schemaGaps(result, schema), []);
});

test("each tool says when no stored source exists, as a typed status", async () => {
  const db = stackDb();
  const profile = await runAnalystTool(db, "get_company_profile", { issuer_ids: [KO], as_of: AS_OF });
  assert.deepEqual(profile, { tool: "get_company_profile", status: "no_filing", reads: [], truncated: false, no_filing: [{ issuer_id: KO, label: "KO" }] });
  assert.deepEqual(analystPacketEntries([profile]).map(entryLine), [`C1\tfiling.none\tKO\tissuer=${KO}\tKO has no 10-K on file, so no business or risk factor claims from one`],
    "no 10-K on file is said, not taken for a filing read in full that holds none");
  assert.equal((await runAnalystTool(db, "get_claims", { issuer_ids: [KO], as_of: AS_OF })).status, "no_filing");
  assert.equal((await runAnalystTool(db, "get_claims", { issuer_ids: [KO, INTC], as_of: AS_OF, predicates: ["business.description"] })).status, "incomplete_read",
    "INTC read Item 1 in full and holds no description, but KO has no 10-K to read");
  assert.equal((await runAnalystTool(db, "get_claims", { issuer_ids: [KO], as_of: AS_OF, role: "competitor" })).status, "no_claims", "no stored claim names KO as a competitor");
  assert.deepEqual(await runAnalystTool(db, "get_analyst_consensus", { issuer_ids: [KO], as_of: AS_OF }), { tool: "get_analyst_consensus", status: "no_consensus" });
  assert.deepEqual(await runAnalystTool(db, "get_peer_set", { issuer_ids: [KO], as_of: AS_OF }), { tool: "get_peer_set", status: "no_peers", reason: "no_industry" });
});

test("a peer set is the resolver's same-industry peers, named", async () => {
  const result = await runAnalystTool(stackDb(), "get_peer_set", { issuer_ids: [MU], as_of: AS_OF });
  assert.deepEqual(analystPacketEntries([result]).map((entry) => entry.kind === "peer" && [entry.text, entry.sources.map((source) => source.source_id)]), [
    ["WDC shares MU's industry (Semiconductors)", ["ind-MU", "ind-WDC", "cap-WDC"]],
  ], "a peer cites both industries' sources and the market cap fact it is ranked by");
});

test("risk factors from a 10-K whose Item 1A was never read are an incomplete read, not a filing that states none", async () => {
  const result = await runAnalystTool(stackDb(), "get_claims", { issuer_ids: [INTC], as_of: AS_OF, predicates: ["risk.factor"] });
  assert.equal(result.status, "incomplete_read");
  assert.deepEqual(analystPacketEntries([result]).map(entryLine), [
    `C1\tfiling.item_read\tINTC\tdocument=${INTC_10K}\tstate=unread\tINTC's 10-K: Item 1A (risk factors) was not read, so no claims from it are on file`,
  ]);
  const all = await runAnalystTool(stackDb(), "get_claims", { issuer_ids: [INTC], as_of: AS_OF });
  assert.deepEqual(analystPacketEntries([all]).map((entry) => [entry.kind, entry.predicate]), [["claim", "business.products"], ["filing_read", "filing.item_read"]],
    "a read with claims from Item 1 still says Item 1A was not read");
});

test("a cut Item 1A serves its claims and says how far it was read", async () => {
  const result = await runAnalystTool(stackDb(), "get_claims", { issuer_ids: [NVDA], as_of: AS_OF, predicates: ["risk.factor"] });
  assert.deepEqual(analystPacketEntries([result]).map((entry) => entry.text), [
    "Supply may be constrained.",
    `NVDA's ${NVDA_FILING}: Item 1A (risk factors) was read in part, 11 of 13 prompts, so claims from the rest of it are missing`,
  ]);
});

test("a profile read from an older 10-K names the newer one whose Item 1 was not read", async () => {
  const result = await runAnalystTool(stackDb(), "get_company_profile", { issuer_ids: [AVGO], as_of: AS_OF });
  assert.equal(result.status, "ok");
  assert.deepEqual(analystPacketEntries([result]).map(entryLine), [
    "C1\tbusiness.products\tAVGO\t10-K, accession 0001730168-25-000010, filed 2025-02-01\tclaim=c0000000-0000-4000-8000-000000000006\tWe sold modems.",
    `C2\tfiling.item_read\tAVGO\tdocument=${AVGO_OLD_10K}\tstate=read\tnewer=${AVGO_NEW_10K}\tnewer_state=unread\tAVGO's Item 1 (business) claims come from its 10-K, accession 0001730168-25-000010, filed 2025-02-01. In its newer 10-K, accession 0001730168-26-000010, filed 2026-02-01, Item 1 (business) was not read`,
  ]);
});

test("a cut item read from an older 10-K says both that it was cut and that the newer one left it unread", async () => {
  const result = await runAnalystTool(stackDb(), "get_claims", { issuer_ids: [AVGO], as_of: AS_OF, predicates: ["risk.factor"] });
  assert.equal(result.status, "incomplete_read");
  assert.deepEqual(analystPacketEntries([result]).map(entryLine), [
    `C1\tfiling.item_read\tAVGO\tdocument=${AVGO_OLD_10K}\tstate=cut\tnewer=${AVGO_NEW_10K}\tnewer_state=not_found\tAVGO's Item 1A (risk factors) claims come from its 10-K, accession 0001730168-25-000010, filed 2025-02-01, where Item 1A (risk factors) was read in part, 3 of 9 prompts, so claims from the rest of it are missing. In its newer 10-K, accession 0001730168-26-000010, filed 2026-02-01, Item 1A (risk factors) was not found in the filing`,
  ]);
});

test("a registry call reads its subject's issuer at the turn's cutoff, and refuses arguments it cannot read", async () => {
  const seen: Array<{ text: string; values?: unknown[] }> = [];
  const db = stackDb(seen);
  const consensus = await runRegisteredAnalystTool(db, "get_analyst_consensus", { subject_ref: { kind: "listing", id: AAPL_LISTING } }, { as_of: AS_OF });
  assert.equal(consensus.status, "ok");
  assert.deepEqual(seen.find((query) => query.text.includes("consensus_captures cc"))?.values?.slice(0, 2), [AAPL, AS_OF]);
  assert.deepEqual(
    await runRegisteredAnalystTool(db, "get_claims", { subject_refs: [{ kind: "issuer", id: NVDA }], role: "customer" }, { as_of: AS_OF }),
    { tool: "get_claims", status: "invalid_arguments", reason: "role is subject or competitor" },
  );
  assert.deepEqual(
    await runRegisteredAnalystTool(db, "get_peer_set", { subject_ref: { kind: "issuer", id: MU }, criteria: "size", n: 5 }, { as_of: AS_OF }),
    { tool: "get_peer_set", status: "invalid_arguments", reason: "peers are chosen by industry only" },
  );
  assert.equal((await runRegisteredAnalystTool(db, "get_peer_set", { subject_ref: { kind: "issuer", id: MU }, criteria: "industry", n: 5 }, { as_of: AS_OF })).status, "ok");
  assert.deepEqual(
    await runRegisteredAnalystTool(db, "get_peer_set", { subject_ref: { kind: "issuer", id: MU }, criteria: "industry", n: 50 }, { as_of: AS_OF }),
    { tool: "get_peer_set", status: "invalid_arguments", reason: "n is a whole number from 1 to 20" },
  );
  assert.deepEqual(
    await runRegisteredAnalystTool(db, "get_claims", { subject_refs: [{ kind: "issuer", id: NVDA }, { kind: "issuer", id: KO }] }, { as_of: AS_OF }),
    { tool: "get_claims", status: "no_subject", reason: "a subject_ref names no stored issuer" },
  );
  assert.deepEqual(
    await runRegisteredAnalystTool(db, "get_company_profile", { subject_ref: { kind: "issuer", id: KO } }, { as_of: AS_OF }),
    { tool: "get_company_profile", status: "no_subject", reason: "a subject_ref names no stored issuer" },
  );
});

test("the CLI reads a date as of its end and refuses a predicate no tool serves", () => {
  assert.deepEqual(parseCliArgs(["get_claims", "nvda", "--as-of", "2000-01-01", "--predicate", "risk.factor"]), {
    tool: "get_claims",
    ticker: "NVDA",
    runs: 1,
    input: { as_of: "2000-01-01T23:59:59.999Z", predicates: ["risk.factor"] },
  });
  assert.throws(() => parseCliArgs(["get_claims", "NVDA", "--predicate", "guidance.revenue"]), /--predicate takes/);
});

test("a lost database degrades a read to unavailable; a bug in the code or its SQL throws", () => {
  const coded = (message: string, code: string) => Object.assign(new Error(message), { code });
  assert.deepEqual([
    isUnavailableRead(new Error("Connection terminated unexpectedly")),
    isUnavailableRead(coded("connect ECONNREFUSED 127.0.0.1:5432", "ECONNREFUSED")),
    isUnavailableRead(coded("duplicate key value violates unique constraint", "23505")),
    isUnavailableRead(coded("the database system is shutting down", "57P03")),
    isUnavailableRead(coded('column "titel" does not exist', "42703")),
    isUnavailableRead(coded("invalid input syntax for type uuid", "22P02")),
    isUnavailableRead(new TypeError("Cannot read properties of undefined")),
  ], [true, true, false, true, false, false, false]);
});

test("a registry call refuses a filter no tool reads, and an empty predicate list", async () => {
  const db = stackDb();
  assert.deepEqual(
    await runRegisteredAnalystTool(db, "get_claims", { subject_refs: [{ kind: "issuer", id: NVDA }], since: "2020-01-01" }, { as_of: AS_OF }),
    { tool: "get_claims", status: "invalid_arguments", reason: "since not supported" },
  );
  assert.equal((await runRegisteredAnalystTool(db, "get_claims", { subject_refs: [{ kind: "issuer", id: NVDA }], predicates: [] }, { as_of: AS_OF })).status, "invalid_arguments");
  assert.equal((await runRegisteredAnalystTool(db, "get_company_profile", { query: "what does NVDA do", subject_ref: { kind: "issuer", id: NVDA } }, { as_of: AS_OF })).status, "ok");
  assert.deepEqual(
    await runRegisteredAnalystTool(db, "get_company_profile", { subject_ref: { kind: "issuer", id: NVDA }, role: "competitor" }, { as_of: AS_OF }),
    { tool: "get_company_profile", status: "invalid_arguments", reason: "role not supported" },
  );
});
