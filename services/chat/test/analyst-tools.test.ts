import test from "node:test";
import assert from "node:assert/strict";

import { runAnalystTool, runRegisteredAnalystTool } from "../src/analyst-tools.ts";
import { parseCliArgs, entryLine } from "../src/analyst-tools-cli.ts";
import { analystPacketEntries } from "../src/evidence-packet.ts";
import { fakeQuery } from "./fake-query.ts";

const NVDA = "11111111-1111-4111-8111-111111111111";
const AMD = "22222222-2222-4222-8222-222222222222";
const KO = "33333333-3333-4333-8333-333333333333";
const MU = "44444444-4444-4444-8444-444444444444";
const WDC = "55555555-5555-4555-8555-555555555555";
const AAPL = "66666666-6666-4666-8666-666666666666";
const AAPL_LISTING = "77777777-7777-4777-8777-777777777777";
const AS_OF = "2026-11-15T12:00:00.000Z";

const filingClaim = (claim_id: string, predicate: string, text: string) => ({
  claim_id,
  document_id: "d0000000-0000-4000-8000-000000000001",
  source_id: "50000000-0000-4000-8000-000000000001",
  text_canonical: text,
  predicate,
  polarity: predicate === "risk.factor" ? "negative" : "neutral",
  effective_time: new Date("2026-02-25T00:00:00Z"),
  published_at: new Date("2026-02-25T00:00:00Z"),
  filer_issuer_id: NVDA,
  filer_label: "NVDA",
  accession: "0001045810-26-000021",
  document_title: "10-K",
  matched: "2",
});

const PROFILE = [
  filingClaim("c0000000-0000-4000-8000-000000000001", "business.description", "NVIDIA pioneered accelerated computing."),
  filingClaim("c0000000-0000-4000-8000-000000000002", "business.products", "Our products include GPUs and networking."),
];
const COMPETITION = filingClaim("c0000000-0000-4000-8000-000000000003", "business.competition", "Our competitors include Advanced Micro Devices.");

const CONSENSUS = [
  { capture_id: "e0000000-0000-4000-8000-000000000001", source_id: "00000000-0000-4000-a000-000000000015", provider: "finviz_dev_consensus", captured_on: "2026-11-14", field_key: "eps_next_y", raw_value: "8.49", fiscal_period: null },
  { capture_id: "e0000000-0000-4000-8000-000000000002", source_id: "00000000-0000-4000-a000-000000000015", provider: "finviz_dev_consensus", captured_on: "2026-11-14", field_key: "target_price", raw_value: "290.50", fiscal_period: null },
];

const LABELS: Record<string, string> = { [NVDA]: "NVDA", [AMD]: "AMD", [MU]: "MU", [WDC]: "WDC", [AAPL]: "AAPL" };

function stackDb(seen: Array<{ text: string; values?: unknown[] }> = []) {
  return {
    query: fakeQuery((text, values) => {
      seen.push({ text, values });
      if (text.includes("with filers as")) {
        const [issuers, role, predicates] = values as [string[], string, string[]];
        if (role === "competitor") return { rows: issuers.includes(AMD) && predicates.includes("business.competition") ? [COMPETITION] : [] };
        return { rows: issuers.includes(NVDA) ? PROFILE.filter((claim) => predicates.includes(claim.predicate)) : [] };
      }
      if (text.includes("select industry from issuers")) return { rows: [{ industry: values?.[0] === MU ? "Semiconductors" : null }] };
      if (text.includes("from issuers peer")) return { rows: [{ issuer_id: WDC }] };
      if (text.includes("from consensus_captures cc")) return { rows: values?.[0] === AAPL ? CONSENSUS : [] };
      if (text.includes("jsonb_array_elements")) {
        const refs = JSON.parse(String(values?.[0])) as Array<{ kind: string; id: string }>;
        return { rows: refs.map((ref, i) => ({ ord: i + 1, issuer_id: ref.id === AAPL_LISTING ? AAPL : ref.kind === "issuer" && LABELS[ref.id] ? ref.id : null })) };
      }
      if (text.includes("as label")) return { rows: (values?.[0] as string[]).map((id) => ({ issuer_id: id, label: LABELS[id] })) };
      throw new Error(`unexpected query: ${text.slice(0, 60)}`);
    }),
  };
}

test("a company profile is the filer's business claims from its 10-K", async () => {
  const result = await runAnalystTool(stackDb(), "get_company_profile", { issuer_ids: [NVDA], as_of: AS_OF });
  assert.deepEqual(analystPacketEntries([result]).map(entryLine), [
    "C1\tbusiness.description\tNVDA\t10-K, accession 0001045810-26-000021, filed 2026-02-25\tclaim=c0000000-0000-4000-8000-000000000001\tNVIDIA pioneered accelerated computing.",
    "C2\tbusiness.products\tNVDA\t10-K, accession 0001045810-26-000021, filed 2026-02-25\tclaim=c0000000-0000-4000-8000-000000000002\tOur products include GPUs and networking.",
  ]);
});

test("a competitor read of AMD returns NVDA's competition claim, labelled as NVDA's", async () => {
  const result = await runAnalystTool(stackDb(), "get_claims", { issuer_ids: [AMD], as_of: AS_OF, role: "competitor" });
  const [entry, ...others] = analystPacketEntries([result]);
  assert.deepEqual(others, []);
  assert.equal(entry?.kind, "claim");
  assert.equal(entry?.company, "NVDA");
  assert.equal(entry?.text, "Our competitors include Advanced Micro Devices.");
});

test("consensus is each value labelled an attributed expectation with its capture date", async () => {
  const result = await runAnalystTool(stackDb(), "get_analyst_consensus", { issuer_ids: [AAPL], as_of: AS_OF });
  assert.deepEqual(analystPacketEntries([result]).map((entry) => [entry.id, entry.company, entry.text]), [
    ["C1", "AAPL", "attributed consensus: Finviz EPS next year, captured 2026-11-14: 8.49"],
    ["C2", "AAPL", "attributed consensus: Finviz target price, captured 2026-11-14: 290.50"],
  ]);
});

test("each tool says when no stored source exists, as a typed status", async () => {
  const db = stackDb();
  assert.deepEqual(await runAnalystTool(db, "get_company_profile", { issuer_ids: [KO], as_of: AS_OF }), { tool: "get_company_profile", status: "no_business_claims" });
  assert.deepEqual(await runAnalystTool(db, "get_claims", { issuer_ids: [KO], as_of: AS_OF }), { tool: "get_claims", status: "no_claims" });
  assert.deepEqual(await runAnalystTool(db, "get_analyst_consensus", { issuer_ids: [KO], as_of: AS_OF }), { tool: "get_analyst_consensus", status: "no_consensus" });
  assert.deepEqual(await runAnalystTool(db, "get_peer_set", { issuer_ids: [KO], as_of: AS_OF }), { tool: "get_peer_set", status: "no_peers", reason: "no_industry" });
});

test("a peer set is the resolver's same-industry peers, named", async () => {
  const result = await runAnalystTool(stackDb(), "get_peer_set", { issuer_ids: [MU], as_of: AS_OF });
  assert.deepEqual(analystPacketEntries([result]).map((entry) => entry.text), ["WDC is MU's peer 1 of 1 in its industry (Semiconductors), by market cap"]);
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
