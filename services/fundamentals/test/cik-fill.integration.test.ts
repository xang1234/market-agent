import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { bootstrapDatabase, connectedPool, dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { fillMissingCiks, loadCompanyTickerCiks, type CikFillReport } from "../src/cik-fill.ts";
import { parseFinancialJson } from "../src/lossless-financial-json.ts";
import { hydrateSecIssuer } from "../src/sec-facts-repository.ts";
import { createSecCompanyFactsHttpFetcher } from "../src/sec-edgar-http.ts";

const COMPANY_TICKERS = JSON.stringify({
  0: { cik_str: 990611, ticker: "HELD", title: "Held" },
  1: { cik_str: 990612, ticker: "FRSH", title: "Fresh" },
  2: { cik_str: 990613, ticker: "TWNA", title: "Twin" },
  3: { cik_str: 990614, ticker: "CLS-B", title: "Classes" },
  4: { cik_str: 990615, ticker: "KNWN", title: "Known" },
  5: { cik_str: 990613, ticker: "TWNB", title: "Twin" },
  6: { cik_str: 990616, ticker: "CLS-A", title: "Classes A Trust" },
});
const noDownload = async () => assert.fail("a cached file is read, not downloaded");

type Queryable = { query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }> };
type SecRow = (db: Queryable, issuerId: string, sourceId: string) => Promise<unknown>;

const READ_BY_CIK: Record<string, SecRow> = {
  facts: (db, issuerId) => insertFact(db, issuerId, "sec_edgar"),
  filings: (db, issuerId, sourceId) =>
    db.query(
      `with document as (
         insert into documents (source_id, kind, content_hash, raw_blob_id) values ($2, 'filing', gen_random_uuid()::text, 'blob') returning document_id
       )
       insert into mentions (document_id, subject_kind, subject_id, prominence, confidence) select document_id, 'issuer', $1, 'headline', 1 from document`,
      [issuerId, sourceId],
    ),
  "Form 4 transactions": (db, issuerId, sourceId) =>
    db.query(
      `insert into insider_transactions (issuer_id, insider_name, insider_role, transaction_date, transaction_code, transaction_type, acquired_disposed, shares, source_id, accession, filed_at)
       values ($1, 'Insider', 'Director', '2026-01-02', 'P', 'purchase', 'A', 1, $2, '0000000000-26-000001', now())`,
      [issuerId, sourceId],
    ),
  "companyfacts downloads": (db, issuerId) => db.query(`insert into sec_issuer_downloads (issuer_id, newest_filed) values ($1, '2026-01-02')`, [issuerId]),
};

const RESOLVED_BY_CUSIP: Record<string, SecRow> = {
  "13F holdings": (db, issuerId, sourceId) =>
    db.query(
      `insert into institutional_holdings (filer_cik, filer_name, issuer_id, cusip, shares, value_usd, filing_period, filing_date, source_id, accession)
       values ('1', 'Filer', $1, '000000000', 1, 1, '2026-03-31', '2026-05-15', $2, '0000000000-26-000002')`,
      [issuerId, sourceId],
    ),
  "13F position claims": (db, issuerId, sourceId) =>
    db.query(
      `with document as (
         insert into documents (source_id, kind, content_hash, raw_blob_id) values ($2, 'filing', gen_random_uuid()::text, 'blob') returning document_id
       ), claim as (
         insert into claims (document_id, predicate, text_canonical, polarity, modality, reported_by_source_id, confidence, status)
         select document_id, 'position_change.new', 'Filer opened a position', 'neutral', 'asserted', $2, 1, 'extracted' from document returning claim_id
       )
       insert into claim_arguments (claim_id, subject_kind, subject_id, role) select claim_id, 'issuer', $1, 'subject' from claim`,
      [issuerId, sourceId],
    ),
};

async function insertSecSource(db: Queryable): Promise<string> {
  const { rows: [source] } = await db.query<{ source_id: string }>(
    `insert into sources (provider, kind, trust_tier, license_class, retrieved_at) values ('sec_edgar', 'filing', 'primary', 'public', now()) returning source_id::text as source_id`,
  );
  return source.source_id;
}

async function insertListedIssuer(db: Queryable, issuerId: string, name: string, cik: string | null, ticker: string, mic = "XNYS"): Promise<void> {
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, $2, $3)`, [issuerId, name, cik]);
  await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1, $1, 'common_stock')`, [issuerId]);
  await db.query(`insert into listings (instrument_id, mic, ticker, trading_currency, timezone) values ($1, $3, $2, 'USD', 'America/New_York')`, [issuerId, ticker, mic]);
}

test("every issuer without a CIK takes its ticker's, except one an issuer with SEC data holds (#597)", { timeout: 120_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for CIK fill coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-cik-fill");
  const db = await connectedPool(t, databaseUrl);
  const id = (n: number) => `39000000-0000-4000-8000-0000000006${String(n).padStart(2, "0")}`;
  // The SEC issuer that holds HELD's CIK has no listing, as a frozen golden issuer has none of the import's.
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Held Inc. (SEC)', '0000990611')`, [id(0)]);
  await insertFact(db, id(0), "sec_edgar");
  // Twin B is read first, but Twin A holds the CIK's first ticker.
  const listed: ReadonlyArray<readonly [number, string, string | null, ReadonlyArray<string>]> = [
    [1, "Held Inc", null, ["HELD"]],
    [2, "Fresh Inc", null, ["FRSH"]],
    [3, "Twin B", null, ["TWNB"]],
    [4, "Twin A", null, ["TWNA"]],
    [5, "Classes Inc", null, ["CLS-A", "CLS-B"]],
    [6, "Known Inc", "990615", ["KNWN"]],
    [7, "Nobody Inc", null, ["NOPE"]],
  ];
  for (const [n, name, cik, tickers] of listed) {
    await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, $2, $3)`, [id(n), name, cik]);
    await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1, $1, 'common_stock')`, [id(n)]);
    for (const ticker of tickers) {
      await db.query(`insert into listings (instrument_id, mic, ticker, trading_currency, timezone) values ($1, 'XNAS', $2, 'USD', 'America/New_York')`, [id(n), ticker]);
    }
  }
  const file = join(await mkdtemp(join(tmpdir(), "cik-fill-")), "company_tickers.json");
  await writeFile(file, COMPANY_TICKERS);
  const ciks = await loadCompanyTickerCiks(file, noDownload);
  const logged: string[] = [];
  const log = { error: (line: string) => logged.push(line) };

  assert.deepEqual(await fillMissingCiks(db, ciks, log), { filled: 3, reassigned: 0, held_with_data: 1, already_set: 1, skipped_duplicate: 1, unmatched: 1 });
  const stored = await db.query(`select legal_name, cik from issuers order by legal_name`);
  assert.deepEqual(stored.rows, [
    { legal_name: "Classes Inc", cik: "990614" },
    { legal_name: "Fresh Inc", cik: "990612" },
    { legal_name: "Held Inc", cik: null },
    { legal_name: "Held Inc. (SEC)", cik: "0000990611" },
    { legal_name: "Known Inc", cik: "990615" },
    { legal_name: "Nobody Inc", cik: null },
    { legal_name: "Twin A", cik: "990613" },
    { legal_name: "Twin B", cik: null },
  ]);
  assert.deepEqual(logged, [
    `HELD: CIK 990611 stays on issuer ${id(0)}, which holds SEC facts; not moved`,
    `TWNB: CIK 990613 goes to TWNA's issuer ${id(4)}; not attached`,
  ]);

  assert.deepEqual(
    await fillMissingCiks(db, ciks, log),
    { filled: 0, reassigned: 0, held_with_data: 1, already_set: 4, skipped_duplicate: 1, unmatched: 1 },
    "a rerun fills nothing more",
  );
});

test("a downloaded company_tickers.json is cached for a day, then downloaded again", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "cik-fill-cache-")), "company_tickers.json");
  let downloads = 0;
  const download = async () => {
    downloads += 1;
    return parseFinancialJson(COMPANY_TICKERS);
  };
  const downloaded = await loadCompanyTickerCiks(file, download);
  assert.deepEqual([...downloaded], [["HELD", "990611"], ["FRSH", "990612"], ["TWNA", "990613"], ["CLS-B", "990614"], ["KNWN", "990615"], ["TWNB", "990613"], ["CLS-A", "990616"]]);
  assert.deepEqual(await loadCompanyTickerCiks(file, noDownload), downloaded);
  assert.deepEqual(await loadCompanyTickerCiks(file, download, Date.now() + 86_460_000), downloaded, "a day and a minute later");
  assert.equal(downloads, 2);
});

test("a ticker SEC knows fills only an issuer listed on a US exchange", { timeout: 120_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for CIK fill coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-cik-fill-us");
  const db = await connectedPool(t, databaseUrl);
  const id = (n: number) => `39000000-0000-4000-8000-0000000007${String(n).padStart(2, "0")}`;
  // Ordered so the London issuer is read first and would claim the CIK before the US one.
  const listed: ReadonlyArray<readonly [number, string, string, string, string]> = [
    [1, "Anglo American plc", "XLON", "AAL", "GBP"],
    [2, "American Airlines Group Inc", "XNAS", "AAL", "USD"],
    [3, "London Only plc", "XLON", "ONLY", "GBP"],
  ];
  for (const [n, name, mic, ticker, currency] of listed) {
    await db.query(`insert into issuers (issuer_id, legal_name) values ($1, $2)`, [id(n), name]);
    await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1, $1, 'common_stock')`, [id(n)]);
    await db.query(
      `insert into listings (instrument_id, mic, ticker, trading_currency, timezone) values ($1, $2, $3, $4, 'Europe/London')`,
      [id(n), mic, ticker, currency],
    );
  }
  const ciks = new Map([["AAL", "6201"], ["ONLY", "990616"]]);

  assert.deepEqual(await fillMissingCiks(db, ciks, { error: (line: string) => assert.fail(line) }), {
    filled: 1,
    reassigned: 0,
    held_with_data: 0,
    already_set: 0,
    skipped_duplicate: 0,
    unmatched: 0,
  });
  const stored = await db.query(`select legal_name, cik from issuers order by legal_name`);
  assert.deepEqual(stored.rows, [
    { legal_name: "American Airlines Group Inc", cik: "6201" },
    { legal_name: "Anglo American plc", cik: null },
    { legal_name: "London Only plc", cik: null },
  ]);
});

test("a CIK an earlier fill gave another of its tickers' issuers moves to the issuer of its first ticker (#680)", { timeout: 120_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for CIK fill coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-cik-fill-move");
  const db = await connectedPool(t, databaseUrl);
  const id = (n: number) => `39000000-0000-4000-8000-0000000008${String(n).padStart(2, "0")}`;
  await insertListedIssuer(db, id(1), "JPMorgan Alerian MLP Index ETN", "19617", "AMJB");
  await insertListedIssuer(db, id(2), "JPMorgan Chase & Co", null, "JPM");
  // None of this was read by AMJB's CIK: the reference import's facts, and 13F rows resolved by CUSIP.
  await insertFact(db, id(1), "xang1234_stock_screener");
  const sourceId = await insertSecSource(db);
  for (const insert of Object.values(RESOLVED_BY_CUSIP)) await insert(db, id(1), sourceId);
  const ciks = new Map([["JPM", "19617"], ["AMJB", "19617"]]);
  const logged: string[] = [];
  const log = { error: (line: string) => logged.push(line) };

  assert.deepEqual(await fillMissingCiks(db, ciks, log), { filled: 0, reassigned: 1, held_with_data: 0, already_set: 1, skipped_duplicate: 0, unmatched: 0 });
  const stored = await db.query(`select legal_name, cik from issuers order by legal_name`);
  assert.deepEqual(stored.rows, [
    { legal_name: "JPMorgan Alerian MLP Index ETN", cik: null },
    { legal_name: "JPMorgan Chase & Co", cik: "19617" },
  ]);
  assert.deepEqual(logged, [`JPM: CIK 19617 moved from issuer ${id(1)} to issuer ${id(2)}`]);

  assert.deepEqual(
    await fillMissingCiks(db, ciks, log),
    { filled: 0, reassigned: 0, held_with_data: 0, already_set: 1, skipped_duplicate: 1, unmatched: 0 },
    "a rerun moves nothing back",
  );
});

test("a CIK stays on an issuer that holds any kind of SEC data read by it", { timeout: 120_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for CIK fill coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-cik-fill-held");
  const db = await connectedPool(t, databaseUrl);
  const id = (n: number) => `39000000-0000-4000-8000-0000000009${String(n).padStart(2, "0")}`;
  const sourceId = await insertSecSource(db);
  const kinds = Object.keys(READ_BY_CIK);
  const ciks = new Map([...kinds.map((_, n) => [`OWN${n}`, String(990700 + n)] as const), ...kinds.map((_, n) => [`HLD${n}`, String(990700 + n)] as const)]);
  for (const [n, kind] of kinds.entries()) {
    await insertListedIssuer(db, id(10 + n), `HLD${n}`, String(990700 + n), `HLD${n}`);
    await insertListedIssuer(db, id(20 + n), `OWN${n}`, null, `OWN${n}`);
    await READ_BY_CIK[kind](db, id(10 + n), sourceId);
  }
  const logged: string[] = [];

  assert.deepEqual(await fillMissingCiks(db, ciks, { error: (line: string) => logged.push(line) }), {
    filled: 0,
    reassigned: 0,
    held_with_data: kinds.length,
    already_set: kinds.length,
    skipped_duplicate: 0,
    unmatched: 0,
  });
  assert.deepEqual(logged, kinds.map((kind, n) => `OWN${n}: CIK ${990700 + n} stays on issuer ${id(10 + n)}, which holds SEC ${kind}; not moved`));
  const { rows } = await db.query(`select count(*)::int as held from issuers where cik is not null and legal_name like 'HLD%'`);
  assert.deepEqual(rows, [{ held: kinds.length }]);
});

test("the issuer that holds a CIK keeps it on a tie, and one that holds another CIK stands aside", { timeout: 120_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for CIK fill coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-cik-fill-election");
  const db = await connectedPool(t, databaseUrl);
  const id = (n: number) => `39000000-0000-4000-8000-0000000010${String(n).padStart(2, "0")}`;
  // Two issuers list TIE on two US exchanges, and the one read first holds no CIK.
  await insertListedIssuer(db, id(1), "Tie Bundle Issuer", null, "TIE");
  await insertListedIssuer(db, id(2), "Tie Resolver Issuer", "990800", "TIE", "XNAS");
  // OTH ranks first for 990801, but its issuer already holds another CIK.
  await insertListedIssuer(db, id(3), "Other Holder", "990899", "OTH");
  await insertListedIssuer(db, id(4), "Next In Line", null, "NXT");
  const ciks = new Map([["TIE", "990800"], ["OTH", "990801"], ["NXT", "990801"]]);
  const logged: string[] = [];

  assert.deepEqual(await fillMissingCiks(db, ciks, { error: (line: string) => logged.push(line) }), {
    filled: 1,
    reassigned: 0,
    held_with_data: 0,
    already_set: 2,
    skipped_duplicate: 1,
    unmatched: 0,
  });
  const stored = await db.query(`select legal_name, cik from issuers order by legal_name`);
  assert.deepEqual(stored.rows, [
    { legal_name: "Next In Line", cik: "990801" },
    { legal_name: "Other Holder", cik: "990899" },
    { legal_name: "Tie Bundle Issuer", cik: null },
    { legal_name: "Tie Resolver Issuer", cik: "990800" },
  ]);
  assert.deepEqual(logged, [`TIE: CIK 990800 goes to TIE's issuer ${id(2)}; not attached`]);
});

// An ETN issuer holds CIK 990900 with no SEC data yet, and the CIK's first ticker is its parent's (#680).
const ETN = "39000000-0000-4000-8000-000000001101";
const PARENT = "39000000-0000-4000-8000-000000001102";
const FALLBACK_SOURCE_ID = "39000000-0000-4000-8000-000000001103";
const ETN_CIKS = new Map([["PRNT", "990900"], ["ETNX", "990900"]]);
const tenK = { accn: "0000990900-26-000001", fy: 2025, fp: "FY", form: "10-K", filed: "2026-02-01", start: "2025-01-01", end: "2025-12-31" };
const ETN_COMPANY_FACTS = JSON.stringify({
  cik: 990900,
  entityName: "Parent Co",
  facts: {
    "us-gaap": {
      Revenues: { label: "", description: "", units: { USD: [{ ...tenK, val: 500 }] } },
      NetIncomeLoss: { label: "", description: "", units: { USD: [{ ...tenK, val: 70 }] } },
    },
  },
});

async function etnAndParent(t: test.TestContext, name: string) {
  const { databaseUrl } = await bootstrapDatabase(t, name);
  const db = await connectedPool(t, databaseUrl);
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  await insertListedIssuer(db, ETN, "Parent Alerian ETN", "990900", "ETNX");
  await insertListedIssuer(db, PARENT, "Parent Co", null, "PRNT");
  return db;
}

// Fundamentals' lookup of the ETN's FY2025 income statement, by its CIK.
function hydrateEtn(db: Awaited<ReturnType<typeof connectedPool>>, duringDownload: () => Promise<void> = async () => {}) {
  const clock = () => new Date("2026-03-01T00:00:00.000Z");
  const fetcher = createSecCompanyFactsHttpFetcher({
    userAgent: "market-agent-test test@example.invalid",
    fetchImpl: async (url) => {
      if (!String(url).includes("companyfacts")) return new Response("", { status: 404 });
      await duringDownload();
      return new Response(ETN_COMPANY_FACTS, { status: 200 });
    },
    clock,
  });
  return hydrateSecIssuer(db, { issuerId: ETN, fiscal_year: 2025, fiscal_period: "FY", fetcher, sourceId: FALLBACK_SOURCE_ID, clock, logger: { warn: () => {} } });
}

async function secDataByIssuer(db: Queryable) {
  return (await db.query(
    `select legal_name, cik,
            exists (select 1 from facts f where f.subject_id = iss.issuer_id) as facts,
            exists (select 1 from sec_issuer_downloads d where d.issuer_id = iss.issuer_id) as download
       from issuers iss order by legal_name`,
  )).rows;
}

async function untilWaitingOnLock(db: Queryable): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const { rows: [row] } = await db.query<{ waiting: boolean }>(
      `select exists (select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock') as waiting`,
    );
    if (row!.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("nothing waited on a lock");
}

const NO_FILL: CikFillReport = { filled: 0, reassigned: 0, held_with_data: 0, already_set: 0, skipped_duplicate: 0, unmatched: 0 };

test("a download for an issuer whose CIK the fill moves before it stores stores nothing (#685)", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for CIK fill coverage");
    return;
  }
  const db = await etnAndParent(t, "fin-cik-fill-mid-download");
  const logged: string[] = [];
  let fill: CikFillReport | undefined;
  const sources = async () => (await db.query<{ n: number }>(`select count(*)::int as n from sources`)).rows[0]!.n;
  const sourcesBefore = await sources();

  const statement = await hydrateEtn(db, async () => {
    fill = await fillMissingCiks(db, ETN_CIKS, { error: (line: string) => logged.push(line) });
  });

  assert.deepEqual(fill, { ...NO_FILL, reassigned: 1, already_set: 1 });
  assert.deepEqual(logged, [`PRNT: CIK 990900 moved from issuer ${ETN} to issuer ${PARENT}`]);
  assert.deepEqual(await secDataByIssuer(db), [
    { legal_name: "Parent Alerian ETN", cik: null, facts: false, download: false },
    { legal_name: "Parent Co", cik: "990900", facts: false, download: false },
  ]);
  assert.equal(await sources(), sourcesBefore, "no source row either");
  assert.equal(statement, null);
});

test("the fill waits for a download storing under the CIK, then leaves the CIK with its data (#685)", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for CIK fill coverage");
    return;
  }
  const db = await etnAndParent(t, "fin-cik-fill-waits");
  const logged: string[] = [];
  let fill: Promise<CikFillReport> | undefined;
  // The fill starts while the download's facts are written but not committed.
  const commitAfterFillWaits = {
    query: db.query.bind(db),
    connect: async () => {
      const client = await db.connect();
      return {
        query: async (text: string, values?: unknown[]) => {
          if (text === "commit" && fill === undefined) {
            fill = fillMissingCiks(db, ETN_CIKS, { error: (line: string) => logged.push(line) });
            await untilWaitingOnLock(db);
          }
          return client.query(text, values);
        },
        release: (destroy?: boolean | Error) => client.release(destroy),
      };
    },
  };

  assert.notEqual(await hydrateEtn(commitAfterFillWaits as unknown as typeof db), null);

  assert.deepEqual(await fill, { ...NO_FILL, held_with_data: 1, already_set: 1 });
  assert.deepEqual(logged, [`PRNT: CIK 990900 stays on issuer ${ETN}, which holds SEC facts, companyfacts downloads; not moved`]);
  assert.deepEqual(await secDataByIssuer(db), [
    { legal_name: "Parent Alerian ETN", cik: "990900", facts: true, download: true },
    { legal_name: "Parent Co", cik: null, facts: false, download: false },
  ]);
});

test("the fill waits for a download that has checked the CIK but stored nothing yet (#685)", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for CIK fill coverage");
    return;
  }
  const db = await etnAndParent(t, "fin-cik-fill-waits-on-check");
  let fill: Promise<CikFillReport> | undefined;
  // The fill starts right after the download's CIK check, before its first row: only the check's own lock holds it.
  const fillAfterCheck = {
    query: db.query.bind(db),
    connect: async () => {
      const client = await db.connect();
      return {
        query: async (text: string, values?: unknown[]) => {
          const result = await client.query(text, values);
          if (text.includes("for share") && fill === undefined) {
            fill = fillMissingCiks(db, ETN_CIKS, { error: () => undefined });
            await untilWaitingOnLock(db);
          }
          return result;
        },
        release: (destroy?: boolean | Error) => client.release(destroy),
      };
    },
  };

  assert.notEqual(await hydrateEtn(fillAfterCheck as unknown as typeof db), null);

  assert.deepEqual(await fill, { ...NO_FILL, held_with_data: 1, already_set: 1 });
  assert.deepEqual((await secDataByIssuer(db)).map((row) => row.cik), ["990900", null]);
});

test("a fill that lists an issuer before another fill attaches its CIK leaves the CIK as attached", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for CIK fill coverage");
    return;
  }
  const db = await etnAndParent(t, "fin-cik-fill-concurrent");
  const logged: string[] = [];
  const log = { error: (line: string) => logged.push(line) };
  let first: CikFillReport | undefined;
  // The second fill lists the issuers, then the first runs to its commit.
  const listedBeforeFirstFill = {
    query: async (text: string, values?: unknown[]) => {
      const listed = await db.query(text, values);
      first ??= await fillMissingCiks(db, ETN_CIKS, log);
      return listed;
    },
    connect: () => db.connect(),
  };

  const second = await fillMissingCiks(listedBeforeFirstFill as unknown as typeof db, ETN_CIKS, log);

  assert.deepEqual(first, { ...NO_FILL, reassigned: 1, already_set: 1 });
  assert.deepEqual(second, { ...NO_FILL, already_set: 2 });
  assert.deepEqual(logged, [`PRNT: CIK 990900 moved from issuer ${ETN} to issuer ${PARENT}`]);
  assert.deepEqual((await secDataByIssuer(db)).map(({ legal_name, cik }) => [legal_name, cik]), [
    ["Parent Alerian ETN", null],
    ["Parent Co", "990900"],
  ]);
});

async function insertFact(db: Queryable, issuerId: string, provider: string): Promise<void> {
  const { rows } = await db.query(
    `with metric as (
       insert into metrics (metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class)
       values ('revenue', 'Revenue', 'currency', 'sum', 'higher_is_better', 'gaap')
       returning metric_id
     ), source as (
       insert into sources (provider, kind, trust_tier, license_class, retrieved_at)
       values ($2, 'filing', 'primary', 'public', now())
       returning source_id
     )
     insert into facts (subject_kind, subject_id, metric_id, period_kind, period_end, fiscal_year, fiscal_period,
                        value_num, unit, currency, scale, as_of, observed_at, source_id, method, verification_status, freshness_class, coverage_level, confidence)
     select 'issuer', $1, metric_id, 'fiscal_y', '2025-12-31', 2025, 'FY', 1, 'currency', 'USD', 1, now(), now(), source_id, 'reported', 'authoritative', 'filing_time', 'full', 1
       from metric, source
     returning fact_id`,
    [issuerId, provider],
  );
  assert.equal(rows.length, 1);
}
