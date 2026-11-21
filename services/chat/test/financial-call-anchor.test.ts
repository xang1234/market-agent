// The exit multiple's anchor in chat (#605): AAPL's FY2017 to FY2026 10-Ks,
// trimmed from a real companyfacts download, and yfinance's split-adjusted
// closes give an anchored exit multiple, sealed with the Call. The Call still
// declines under rule 1, now for the bear case alone. A year whose capex tag
// blocks its free cash flow, or no captured closes, leaves it unanchored.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { Client } from "pg";
import { dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import type { CallContent } from "../../financial-core/src/index.ts";
import type { FinancialPool } from "../../financial-engine/src/ports.ts";
import { IDS } from "../../financial-engine/test/db-fixtures.ts";
import { backfillSecStatements } from "../../fundamentals/src/sec-statements-backfill-cli.ts";
import { secCompanyFetcher } from "../../fundamentals/test/fakes.ts";
import { aaplHistoryCompanyFacts } from "../../fundamentals/test/sec-call-inputs-fixture.ts";
import { POLYGON_MARKET_SOURCE_ID, YAHOO_FINANCE_DEV_MARKET_SOURCE_ID } from "../../market/src/provider-sources.ts";
import { verifyCalls, type CallBlock } from "../../snapshot/src/call.ts";
import { listChatMessagesForThread } from "../src/messages.ts";
import type { ChatSubjectPreResolution } from "../src/subjects.ts";
import { chatDatabase, chatHarness, completed, resolveMention } from "./financial-fixtures.ts";

// Monday 10:00 in New York: Friday 2026-11-06's close is the latest.
const CUTOFF = "2026-11-09T15:00:00.000Z";
const quiet = { log: () => {}, warn: () => {}, error: () => {} };

type Issuer = Readonly<{ ticker: string; issuer: string; listing: string; cik: number }>;
const issuer = (ticker: string, index: number, cik: number): Issuer => ({ ticker, cik, issuer: `5d000000-0000-4000-8000-0000000000${index}1`, listing: `5d000000-0000-4000-8000-0000000000${index}e` });
const AAPL = issuer("AAPL", 1, 320193);
// AAPL's history with FY2019's capex tagged only as productive assets, as NVIDIA tags its capex.
const GAPY = issuer("GAPY", 2, 900102);
// AAPL's history with no closes captured.
const NOCL = issuer("NOCL", 3, 900103);
const ISSUERS = [AAPL, GAPY, NOCL];

// yfinance's split-adjusted closes on the last session of each AAPL fiscal year and the session after it, as the
// dev capture of 2026-11-21 returned them, captured here a day before the Call.
const CLOSES: ReadonlyArray<readonly [string, string]> = [
  ["2017-09-29", "38.529998779296875"], ["2017-10-02", "38.45249938964844"],
  ["2018-09-28", "56.435001373291016"], ["2018-10-01", "56.814998626708984"],
  ["2019-09-27", "54.70500183105469"], ["2019-09-30", "55.99250030517578"],
  ["2020-09-25", "112.27999877929688"], ["2020-09-28", "114.95999908447266"],
  ["2021-09-24", "146.9199981689453"], ["2021-09-27", "145.3699951171875"],
  ["2022-09-23", "150.42999267578125"], ["2022-09-26", "150.77000427246094"],
  ["2023-09-29", "171.2100067138672"], ["2023-10-02", "173.75"],
  ["2024-09-27", "227.7899932861328"], ["2024-09-30", "233.0"],
  ["2025-09-26", "255.4600067138672"], ["2025-09-29", "254.42999267578125"],
  ["2026-09-25", "341.07000732421875"], ["2026-09-28", "338.3999938964844"],
];

const resolve = (mention: string): Promise<ChatSubjectPreResolution> => {
  const company = ISSUERS.find((entry) => entry.ticker === mention);
  return company
    ? Promise.resolve({ status: "resolved", subject_ref: { kind: "issuer", id: company.issuer }, display_label: company.ticker, handoff: { display_labels: { ticker: company.ticker } } } as unknown as ChatSubjectPreResolution)
    : resolveMention(mention);
};

// AAPL's history as another filer's: its CIK, and its own accessions.
function asFiler(company: Issuer, value: unknown = aaplHistoryCompanyFacts()): unknown {
  const accession = (text: string) => text.replaceAll("0000320193-", `${String(company.cik).padStart(10, "0")}-`);
  const copy = (entry: unknown): unknown => {
    if (typeof entry === "string") return accession(entry);
    if (Array.isArray(entry)) return entry.map(copy);
    if (entry !== null && typeof entry === "object" && Object.getPrototypeOf(entry) === Object.prototype) return Object.fromEntries(Object.entries(entry).map(([key, inner]) => [key, copy(inner)]));
    return entry;
  };
  return { ...(copy(value) as object), cik: company.cik };
}

// AAPL's history with every FY2019 PP&E capex entry, FY2019's 10-K and its two later comparatives, moved to the productive-assets tag.
function productiveAssetsIn2019(): unknown {
  const facts = asFiler(GAPY) as { facts: { "us-gaap": Record<string, { units: { USD: Array<{ end: string }> } }> } };
  const gaap = facts.facts["us-gaap"];
  const ppe = gaap.PaymentsToAcquirePropertyPlantAndEquipment!;
  gaap.PaymentsToAcquireProductiveAssets = { ...ppe, units: { USD: ppe.units.USD.filter((entry) => entry.end === "2019-09-28") } };
  gaap.PaymentsToAcquirePropertyPlantAndEquipment = { ...ppe, units: { USD: ppe.units.USD.filter((entry) => entry.end !== "2019-09-28") } };
  return facts;
}

async function seedIssuer(db: Client, pool: FinancialPool, company: Issuer, facts: unknown, closes: boolean): Promise<void> {
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, $2, $3)`, [company.issuer, `${company.ticker} Inc.`, String(company.cik)]);
  await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1, $1, 'common_stock')`, [company.issuer]);
  await db.query(`insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone) values ($1, $2, 'XNAS', $3, 'USD', 'America/New_York')`, [company.listing, company.issuer, company.ticker]);
  // AAPL's 4-for-1 split, on file before the 10-Ks are read, so a later 10-K's recast count is the same figure as the original's.
  await db.query(`insert into listing_split_coverage (listing_id, checked_at, source_id) values ($1, '2026-11-09T12:00:00Z', $2)`, [company.listing, POLYGON_MARKET_SOURCE_ID]);
  await db.query(`insert into listing_splits (listing_id, execution_date, split_from, split_to, source_id) values ($1, '2020-08-31', 1, 4, $2)`, [company.listing, POLYGON_MARKET_SOURCE_ID]);
  await db.query(
    `insert into price_observations (listing_id, source_id, kind, price_text, currency, observed_at, known_at, fetched_at, body_sha256)
     values ($1, $2, 'session_close', '342.37', 'USD', '2026-11-06T21:00:00Z', '2026-11-06T21:15:00Z', '2026-11-06T21:15:00Z', $3)`,
    [company.listing, POLYGON_MARKET_SOURCE_ID, "d".repeat(64)],
  );
  assert.deepEqual(await backfillSecStatements(pool, secCompanyFetcher(() => facts, { completed_at: "2026-11-09T06:00:00.000Z" }), [company.issuer], quiet, 10), { failures: 0 });
  if (!closes) return;
  await db.query(
    `insert into daily_close_captures (listing_id, source_id, captured_on, retrieved_at, trade_date, close_text, currency, adjustment_basis)
     select $1, $2, '2026-11-08', '2026-11-08T01:00:00Z', c.trade_date, c.close_text, 'USD', 'split_adjusted'
       from unnest($3::date[], $4::text[]) as c(trade_date, close_text)`,
    [company.listing, YAHOO_FINANCE_DEV_MARKET_SOURCE_ID, CLOSES.map(([date]) => date), CLOSES.map(([, close]) => close)],
  );
}

const row = (call: CallContent, id: string) => [...call.facts, ...call.assumptions, ...call.requires].find((entry) => entry.id === id)!;

test("the exit multiple's anchor in chat", { timeout: 600_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat Call coverage");
    return;
  }
  const { db, pool } = await chatDatabase(t, "chat-call-anchor");
  for (const seed of ["metrics.sql", "sources.sql"]) await db.query(await readFile(join(workspaceRoot, "db", "seed", seed), "utf8"));
  await db.query(`insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at) values ($1, 'polygon_market', 'market_data', 'primary', 'licensed', now()) on conflict (source_id) do nothing`, [POLYGON_MARKET_SOURCE_ID]);
  await seedIssuer(db, pool, AAPL, aaplHistoryCompanyFacts(), true);
  await seedIssuer(db, pool, GAPY, productiveAssetsIn2019(), true);
  await seedIssuer(db, pool, NOCL, asFiler(NOCL), false);

  const ask = async (question: string) => {
    const threadId = randomUUID();
    await db.query(`insert into chat_threads (thread_id, user_id) values ($1, $2)`, [threadId, IDS.owner]);
    const harness = chatHarness(pool, { model: null, resolveMention: resolve, clock: () => new Date(CUTOFF) });
    const done = completed((await harness.run({ threadId, userId: IDS.owner, userIntent: question })).events);
    const message = (await listChatMessagesForThread(pool, { thread_id: threadId, user_id: IDS.owner }))!.messages.find((candidate) => candidate.message_id === done.message_id)!;
    return { threadId, block: (message.blocks as unknown as CallBlock[])[0]! };
  };

  await t.test("AAPL: FY2017 to FY2026 EV/FCF anchors the exit multiple at the 17.33x cap, and rule 1 now names only the bear case", async () => {
    const { threadId, block } = await ask("Make a Call on AAPL");
    const call = block.call;
    const anchored = row(call, "anchored_exit_multiple");
    assert.deepEqual([anchored.kind, anchored.figure.text], ["agent_assumption", "17.33x"]);
    assert.equal(
      anchored.basis,
      "anchored: the lowest of today's multiple 36.15x, the FY2017 to FY2026 median EV/FCF 25.85x (range 15.61x to 38.47x) and 17.33x, the multiple whose implied perpetual growth at your 10% required return is 4%. Each year's EV is its last close on or before its fiscal year end times its diluted weighted-average shares on the closes' split basis, less its net cash.",
    );
    // FY2017's operating cash flow is the 64,225M its later 10-Ks restated it to, and FY2017 to FY2019's shares are
    // their 10-Ks' pre-split counts times the 4-for-1 split, the closes' basis. Net cash in FY2017 and FY2018 is
    // negative: AAPL tagged its marketable securities then as available-for-sale, which net_cash.v1 does not map.
    assert.deepEqual(anchored.citations.map((citation) => citation.text), [
      "FY2017: 17.48x, (close 38.53 on 2017-09-29 × 21,006,768,000 shares − net cash USD -95,391,000,000) ÷ free cash flow USD 51,774,000,000",
      "FY2018: 18.98x, (close 56.44 on 2018-09-28 × 20,000,436,000 shares − net cash USD -88,570,000,000) ÷ free cash flow USD 64,121,000,000",
      "FY2019: 15.61x, (close 54.71 on 2019-09-27 × 18,595,652,000 shares − net cash USD 97,851,000,000) ÷ free cash flow USD 58,896,000,000",
      "FY2020: 25.74x, (close 112.28 on 2020-09-25 × 17,528,214,000 shares − net cash USD 79,394,000,000) ÷ free cash flow USD 73,365,000,000",
      "FY2021: 25.95x, (close 146.92 on 2021-09-24 × 16,864,919,000 shares − net cash USD 65,797,000,000) ÷ free cash flow USD 92,953,000,000",
      "FY2022: 21.60x, (close 150.43 on 2022-09-23 × 16,325,819,000 shares − net cash USD 49,040,000,000) ÷ free cash flow USD 111,443,000,000",
      "FY2023: 26.67x, (close 171.21 on 2023-09-29 × 15,812,547,000 shares − net cash USD 51,011,000,000) ÷ free cash flow USD 99,584,000,000",
      "FY2024: 31.80x, (close 227.79 on 2024-09-27 × 15,408,095,000 shares − net cash USD 50,021,000,000) ÷ free cash flow USD 108,807,000,000",
      "FY2025: 38.47x, (close 255.46 on 2025-09-26 × 15,004,697,000 shares − net cash USD 33,763,000,000) ÷ free cash flow USD 98,767,000,000",
      "FY2026: 36.48x, (close 341.07 on 2026-09-25 × 14,720,306,000 shares − net cash USD 56,824,000,000) ÷ free cash flow USD 136,056,000,000",
      "yfinance split-adjusted daily closes, captured 2026-11-08; dev only, never certified",
    ]);
    // A separate float bisection of ADR 0006's V(g) at X = 52/3 and d = 0.277% gives 22.46%.
    assert.deepEqual([row(call, "exit_multiple").figure.text, row(call, "required_growth").figure.text, row(call, "required_growth_anchored").figure.text], ["36.15x", "7.3% a year", "22.5% a year"]);
    assert.deepEqual(row(call, "bear_case").figure, { kind: "outcome", outcome: "unanchored", reason_code: null, text: "Not anchored" });
    assert.deepEqual(call.stance, {
      kind: "declined",
      rule: 1,
      text: "Declined under rule 1: the exit multiple is anchored, but the bear case is not, so no stance is stated.",
      reasons: [{ cites: "bear_case", text: "No bear case is anchored yet, so the bear value per share is not computed." }],
    });
    assert.deepEqual(await verifyCalls([block], threadId, pool), [], "the seal regenerates the anchor");
  });

  await t.test("the closes are sealed with the Call: a newer capture by the cutoff fails the seal and makes another fingerprint", async () => {
    const first = await ask("Make a Call on AAPL");
    await db.query(
      `insert into daily_close_captures (listing_id, source_id, captured_on, retrieved_at, trade_date, close_text, currency, adjustment_basis)
       select listing_id, source_id, '2026-11-09', '2026-11-09T01:00:00Z', trade_date, case when trade_date = '2019-09-27' then '60' else close_text end, currency, adjustment_basis
         from daily_close_captures where listing_id = $1 and captured_on = '2026-11-08'`,
      [AAPL.listing],
    );
    assert.deepEqual(await verifyCalls([first.block], first.threadId, pool), [{ block_id: first.block.id, reason: "block" }]);
    const { block } = await ask("Make a Call on AAPL");
    assert.notEqual(block.call.inputs.fingerprint, first.block.call.inputs.fingerprint);
    assert.match(row(block.call, "anchored_exit_multiple").citations[2]!.text, /^FY2019: \d+\.\d\dx, \(close 60\.00 on 2019-09-27 /u);
    await db.query(`delete from daily_close_captures where listing_id = $1 and captured_on = '2026-11-09'`, [AAPL.listing]);
    // A capture retrieved after the cutoff is not one the Call could have read.
    await db.query(
      `insert into daily_close_captures (listing_id, source_id, captured_on, retrieved_at, trade_date, close_text, currency, adjustment_basis)
       select listing_id, source_id, '2026-11-10', '2026-11-10T01:00:00Z', trade_date, '70', currency, adjustment_basis
         from daily_close_captures where listing_id = $1 and captured_on = '2026-11-08'`,
      [AAPL.listing],
    );
    const later = (await ask("Make a Call on AAPL")).block.call;
    assert.deepEqual([later.inputs.fingerprint, row(later, "anchored_exit_multiple")], [first.block.call.inputs.fingerprint, row(first.block.call, "anchored_exit_multiple")]);
  });

  await t.test("a year whose capex tag blocks its free cash flow leaves the exit multiple unanchored, and rule 1 names both anchors", async () => {
    const { call } = (await ask("Make a Call on GAPY")).block;
    assert.deepEqual(row(call, "anchored_exit_multiple").figure, {
      kind: "outcome",
      outcome: "unanchored",
      reason_code: null,
      text: "Not anchored: only 9 of the last 10 fiscal years have an EV/FCF multiple. FY2019: free cash flow not certified (blocked_dependency, blocked_by_dependency).",
    });
    assert.equal(row(call, "required_growth_anchored").figure.text, "Not computed: the exit multiple is not anchored.");
    assert.deepEqual([call.stance.rule, call.stance.text, call.stance.reasons.map((reason) => reason.cites)], [
      1, "Declined under rule 1: neither the exit multiple nor the bear case is anchored, so no stance is stated.", ["anchored_exit_multiple", "bear_case"],
    ]);
  });

  await t.test("with no closes captured the exit multiple is unanchored", async () => {
    const { call } = (await ask("Make a Call on NOCL")).block;
    assert.equal(row(call, "anchored_exit_multiple").figure.text, "Not anchored: no closes are captured for the listing by the Call's cutoff.");
    assert.deepEqual(call.stance.reasons.map((reason) => reason.cites), ["anchored_exit_multiple", "bear_case"]);
  });
});
