import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { bootstrapDatabase, connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { fillMissingCiks, loadCompanyTickerCiks } from "../src/cik-fill.ts";
import { parseFinancialJson } from "../src/lossless-financial-json.ts";

const COMPANY_TICKERS = JSON.stringify({
  0: { cik_str: 990611, ticker: "HELD", title: "Held" },
  1: { cik_str: 990612, ticker: "FRSH", title: "Fresh" },
  2: { cik_str: 990613, ticker: "TWNA", title: "Twin" },
  3: { cik_str: 990613, ticker: "TWNB", title: "Twin" },
  4: { cik_str: 990614, ticker: "CLS-B", title: "Classes" },
  5: { cik_str: 990615, ticker: "KNWN", title: "Known" },
});
const noDownload = async () => assert.fail("a cached file is read, not downloaded");

test("every issuer without a CIK takes its ticker's, except one another issuer holds (#597)", { timeout: 120_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for CIK fill coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-cik-fill");
  const db = await connectedPool(t, databaseUrl);
  const id = (n: number) => `39000000-0000-4000-8000-0000000006${String(n).padStart(2, "0")}`;
  // The SEC issuer that holds HELD's CIK has no listing, as a frozen golden issuer has none of the import's.
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Held Inc. (SEC)', '0000990611')`, [id(0)]);
  const listed: ReadonlyArray<readonly [number, string, string | null, ReadonlyArray<string>]> = [
    [1, "Held Inc", null, ["HELD"]],
    [2, "Fresh Inc", null, ["FRSH"]],
    [3, "Twin A", null, ["TWNA"]],
    [4, "Twin B", null, ["TWNB"]],
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

  assert.deepEqual(await fillMissingCiks(db, ciks, log), { filled: 3, already_set: 1, skipped_duplicate: 2, unmatched: 1 });
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
    `HELD: CIK 990611 belongs to issuer ${id(0)}; not attached`,
    `TWNB: CIK 990613 belongs to issuer ${id(3)}; not attached`,
  ]);

  assert.deepEqual(await fillMissingCiks(db, ciks, log), { filled: 0, already_set: 4, skipped_duplicate: 2, unmatched: 1 }, "a rerun fills nothing more");
});

test("a downloaded company_tickers.json is cached for a day, then downloaded again", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "cik-fill-cache-")), "company_tickers.json");
  let downloads = 0;
  const download = async () => {
    downloads += 1;
    return parseFinancialJson(COMPANY_TICKERS);
  };
  const downloaded = await loadCompanyTickerCiks(file, download);
  assert.deepEqual([...downloaded], [["HELD", "990611"], ["FRSH", "990612"], ["TWNA", "990613"], ["TWNB", "990613"], ["CLS-B", "990614"], ["KNWN", "990615"]]);
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
