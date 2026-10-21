import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { bootstrapDatabase, connectedPool, dbRoot, dockerAvailable, run } from "../../../db/test/docker-pg.ts";
import { parseFinancialJson } from "../../fundamentals/src/lossless-financial-json.ts";
import { PolygonFetchError, type PolygonCaptureFetcher } from "../src/adapters/polygon.ts";
import { capturePrices, lastTrade, sessionCloses, type CaptureListing } from "../src/price-capture-cli.ts";
import { loadLatestPriceObservations } from "../src/price-observations.ts";
import { lastRegularSessionDate } from "../src/ytd-window.ts";

const LISTING: CaptureListing = { listing_id: "38000000-0000-4000-8000-000000000001", ticker: "NVDA", timezone: "America/New_York", currency: "USD", issuer_id: "38000000-0000-4000-8000-0000000000a1" };
const LONG = "123456789.123456789123456789123456789";

/** Polygon's daily bars for sessions that start at the given instants (local midnight), as raw response text. */
function barsBody(bars: Array<{ start: string; c: string }>, requestId = "r1"): string {
  const rows = bars.map((bar) => `{"v":1.18730083541466e+08,"vw":222.2238,"o":1,"c":${bar.c},"h":2,"l":0.5,"t":${Date.parse(bar.start)},"n":5}`);
  return `{"ticker":"NVDA","queryCount":${rows.length},"resultsCount":${rows.length},"adjusted":false,"results":[${rows.join(",")}],"status":"DELAYED","request_id":"${requestId}","count":${rows.length}}`;
}

function snapshotBody(price: string, nanoseconds: string): string {
  return `{"status":"OK","request_id":"s1","ticker":{"ticker":"NVDA","lastTrade":{"p":${price},"s":100,"t":${nanoseconds},"x":4},"prevDay":{"c":118.1}}}`;
}

function evidence(text: string, completedAt: string) {
  return { json: parseFinancialJson(text), body_sha256: createHash("sha256").update(text).digest("hex"), completed_at: completedAt };
}

test("a session close is observed at 16:00 New York time on its date and known when its response arrived", () => {
  const body = barsBody([
    { start: "2024-01-05T05:00:00.000Z", c: "48.17" },
    { start: "2024-06-07T04:00:00.000Z", c: "1200.00" },
    // The fetch arrived at 15:59 on the 11th: that session was still open.
    { start: "2024-06-11T04:00:00.000Z", c: "121.5" },
  ]);
  const closes = sessionCloses(LISTING, evidence(body, "2024-06-11T19:59:00.000Z"));
  assert.deepEqual(closes.map((close) => [close.kind, close.price_text, close.observed_at, close.known_at, close.fetched_at]), [
    ["session_close", "48.17", "2024-01-05T21:00:00.000Z", "2024-06-11T19:59:00.000Z", "2024-06-11T19:59:00.000Z"],
    ["session_close", "1200.00", "2024-06-07T20:00:00.000Z", "2024-06-11T19:59:00.000Z", "2024-06-11T19:59:00.000Z"],
  ]);
  assert.equal(closes[0]!.body_sha256, createHash("sha256").update(body).digest("hex"));
  assert.equal(sessionCloses(LISTING, evidence(body, "2024-06-11T20:00:00.000Z")).at(-1)!.observed_at, "2024-06-11T20:00:00.000Z");
});

test("only unadjusted, positive closes are captured", () => {
  const adjusted = barsBody([{ start: "2024-06-07T04:00:00.000Z", c: "120" }]).replace('"adjusted":false', '"adjusted":true');
  assert.throws(() => sessionCloses(LISTING, evidence(adjusted, "2024-06-12T00:00:00.000Z")), /daily bars are not unadjusted/);
  assert.throws(() => sessionCloses(LISTING, evidence(barsBody([{ start: "2024-06-07T04:00:00.000Z", c: "0" }]), "2024-06-12T00:00:00.000Z")), /not a positive price/);
});

test("a last trade is known when its response arrived: its trade time plus the delay the fetch shows", () => {
  // 2024-06-11T20:30:00.123456789Z, in nanoseconds: beyond what a JavaScript number holds exactly.
  const body = snapshotBody("120.8899999999999999", "1718137800123456789");
  const trade = lastTrade(LISTING, evidence(body, "2024-06-11T20:45:10.000Z"));
  assert.deepEqual([trade.kind, trade.price_text, trade.observed_at, trade.known_at], ["last_trade", "120.8899999999999999", "2024-06-11T20:30:00.123Z", "2024-06-11T20:45:10.000Z"]);
  // Stamped after the response arrived, the trade cannot be placed: its known time is unknown.
  assert.equal(lastTrade(LISTING, evidence(body, "2024-06-11T20:30:00.100Z")).known_at, null);
});

test("the last regular session is the last weekday whose 16:00 close the cutoff has passed", () => {
  assert.equal(lastRegularSessionDate("2024-06-12T14:00:00.000Z", "America/New_York"), "2024-06-11");
  assert.equal(lastRegularSessionDate("2024-06-12T20:00:00.000Z", "America/New_York"), "2024-06-12");
  assert.equal(lastRegularSessionDate("2024-06-15T16:00:00.000Z", "America/New_York"), "2024-06-14");
  assert.equal(lastRegularSessionDate("2024-06-17T13:00:00.000Z", "America/New_York"), "2024-06-14");
});

test("price capture records exact tokens once and reads the latest known by a cutoff", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for price observation coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "market-price-capture");
  const seed = run("npm", ["run", "seed", "--", "--database-url", databaseUrl], { cwd: dbRoot, env: { DATABASE_URL: databaseUrl } });
  assert.equal(seed.status, 0, seed.stderr || seed.stdout);
  const db = await connectedPool(t, databaseUrl);
  await db.query(`insert into issuers (issuer_id, legal_name) values ($1, 'NVIDIA')`, [LISTING.issuer_id]);
  await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1, $2, 'common_stock')`, [LISTING.listing_id, LISTING.issuer_id]);
  await db.query(
    `insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone) values ($1, $1, 'XNAS', 'NVDA', 'USD', 'America/New_York')`,
    [LISTING.listing_id],
  );

  const quiet = { log() {}, error() {} };
  const bars = [{ start: "2024-06-07T04:00:00.000Z", c: LONG }, { start: "2024-06-10T04:00:00.000Z", c: "142.0700" }];
  const fetcher = (barsText: string, completedAt: string, snapshot: string | null = null): PolygonCaptureFetcher => async (path) => {
    if (path.startsWith("/v2/snapshot/")) {
      if (snapshot === null) throw new PolygonFetchError(403, "polygon: HTTP 403");
      return { body: new TextEncoder().encode(snapshot), completed_at: completedAt };
    }
    assert.match(path, /^\/v2\/aggs\/ticker\/NVDA\/range\/1\/day\/2024-06-04\/2024-06-11\?adjusted=false&/u);
    return { body: new TextEncoder().encode(barsText), completed_at: completedAt };
  };
  const clock = () => new Date("2024-06-11T15:00:00.000Z");
  const stored = async () => (await db.query(`select observation_id::text, price_text, to_char(known_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as known_at
                                                from price_observations order by observed_at, known_at`)).rows;

  assert.deepEqual(await capturePrices(db, fetcher(barsBody(bars), "2024-06-11T15:00:00.000Z"), [LISTING.listing_id], { log: quiet, clock }), { failures: 0 });
  const first = await stored();
  assert.deepEqual(first.map((row) => [row.price_text, row.known_at]), [[LONG, "2024-06-11T15:00:00.000Z"], ["142.0700", "2024-06-11T15:00:00.000Z"]]);

  // The same closes again, in a response with another request id: nothing new, and the first proof stands.
  assert.deepEqual(await capturePrices(db, fetcher(barsBody(bars, "r2"), "2024-06-11T15:05:00.000Z"), [LISTING.listing_id], { log: quiet, clock }), { failures: 0 });
  assert.deepEqual(await stored(), first);

  const latest = await loadLatestPriceObservations(db, LISTING.listing_id, "2024-06-11T15:00:00.000Z");
  assert.deepEqual([latest.latest_by_source.map((row) => [row.price_text, row.observed_at]), latest.unknown_publication], [[["142.0700", "2024-06-10T20:00:00.000Z"]], false]);
  assert.deepEqual((await loadLatestPriceObservations(db, LISTING.listing_id, "2024-06-11T14:59:59.999Z")).latest_by_source, []);

  // A revised close is a new row known later; a cutoff between the two reads the original.
  const revised = [bars[0]!, { start: "2024-06-10T04:00:00.000Z", c: "142.08" }];
  await capturePrices(db, fetcher(barsBody(revised, "r3"), "2024-06-11T16:00:00.000Z", snapshotBody("142.1", "1718136000000000000")), [LISTING.listing_id], { log: quiet, clock });
  assert.deepEqual((await loadLatestPriceObservations(db, LISTING.listing_id, "2024-06-11T15:30:00.000Z")).latest_by_source.map((row) => row.price_text), ["142.0700"]);
  // The snapshot's trade at 20:00Z was stamped after its response arrived at 16:00Z, so it has no known time.
  const later = await loadLatestPriceObservations(db, LISTING.listing_id, "2024-06-11T21:00:00.000Z");
  assert.deepEqual([later.latest_by_source.map((row) => row.price_text), later.unknown_publication], [["142.08"], true]);

  assert.deepEqual(await capturePrices(db, fetcher(barsBody(bars), "2024-06-11T15:00:00.000Z"), ["38000000-0000-4000-8000-00000000ffff"], { log: quiet, clock }), { failures: 1 });
});
