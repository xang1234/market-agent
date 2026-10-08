import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer, type AddressInfo } from "node:net";

import type { BarsRequest, MarketDataAdapter } from "../../market/src/adapter.ts";
import { available, unavailable } from "../../market/src/availability.ts";
import { normalizedBars } from "../../market/src/bar.ts";
import { createPostgresMarketCacheRepository } from "../../market/src/cache-repository.ts";
import { createCachedMarketDataAdapter } from "../../market/src/cached-adapter.ts";
import { createMarketServer } from "../../market/src/http.ts";
import { createPostgresListingRepository } from "../../market/src/listings.ts";
import { zonedDateStartUtcIso } from "../../market/src/range-canonicalization.ts";
import { ytdYear } from "../../market/src/ytd-window.ts";
import { displayedFigures } from "../src/fact-blocks.ts";
import { analystToolRuntime, closeLocalRuntimePoolForTests } from "../src/local-runtime.ts";
import { loadPerfComparisonBlocks } from "../src/perf-block.ts";
import { createThread } from "../src/threads-repo.ts";
import { hydrateYtdBars } from "../src/ytd-hydration.ts";
import { bootstrapDatabase, connectedPool, dockerAvailable, registerLifoCleanup } from "../../../db/test/docker-pg.ts";
import { GOLDEN_AS_OF, GOLDEN_COMPANIES, MARKET_SOURCE_ID, seedGoldenDataset } from "./golden/dataset.ts";

const company = (ticker: string) => GOLDEN_COMPANIES.find((candidate) => candidate.ticker === ticker)!;
const NY = "America/New_York";
const LISTINGS = [
  { id: company("NVDA").listing_id, label: "NVDA", timeZone: NY },
  { id: company("AMD").listing_id, label: "AMD", timeZone: NY },
];

// A provider with split-adjusted weekday closes: 100 (NVDA) or 50 (AMD) before
// the current year, 20% higher in it. Counts its calls.
function fakeProvider(yearStart: string) {
  let calls = 0;
  const adapter: MarketDataAdapter = {
    providerName: "polygon",
    sourceId: MARKET_SOURCE_ID,
    async getQuote(request) {
      return unavailable({ reason: "missing_coverage", listing: request.listing, source_id: MARKET_SOURCE_ID, as_of: GOLDEN_AS_OF, retryable: false });
    },
    async getBars(request: BarsRequest) {
      calls += 1;
      const base = request.listing.id === LISTINGS[0].id ? 100 : 50;
      const bars = [];
      for (let day = new Date(request.range.start); day.getTime() < Date.parse(request.range.end); day.setUTCDate(day.getUTCDate() + 1)) {
        const ts = zonedDateStartUtcIso(day.toISOString().slice(0, 10), NY);
        if (Date.parse(ts) < Date.parse(request.range.start) || Date.parse(ts) >= Date.parse(request.range.end)) continue;
        if (new Date(ts).getUTCDay() === 0 || new Date(ts).getUTCDay() === 6) continue;
        const close = ts < yearStart ? base : base * 1.2;
        bars.push({ ts, open: close, high: close, low: close, close, volume: 1 });
      }
      return available(normalizedBars({
        listing: request.listing,
        interval: request.interval,
        range: request.range,
        bars,
        as_of: bars.at(-1)!.ts,
        delay_class: "eod",
        currency: "USD",
        source_id: MARKET_SOURCE_ID,
        adjustment_basis: "split_adjusted",
      }));
    },
  };
  return { adapter, calls: () => calls };
}

test("a live YTD request with an empty cache fetches, stores, and seals the window; a repeat reuses the cache (#232)", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for YTD hydration coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "chat-ytd-hydration");
  const pool = await connectedPool(t, databaseUrl);
  const client = await pool.connect();
  try {
    await seedGoldenDataset(client as never);
  } finally {
    client.release();
  }
  // An empty price cache: only the listings and companies stay.
  await pool.query(`delete from market_bars`);
  await pool.query(`delete from market_bar_ranges`);

  // A live turn, now: the provider's prices step up 20% at this year's start.
  const yearStart = zonedDateStartUtcIso(`${ytdYear(new Date().toISOString(), NY)}-01-01`, NY);
  const provider = fakeProvider(yearStart);
  const cache = createPostgresMarketCacheRepository(pool);
  const server = createMarketServer({
    adapter: createCachedMarketDataAdapter({ provider: provider.adapter, cache }),
    listings: createPostgresListingRepository(pool),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  registerLifoCleanup(t, () => new Promise<void>((resolve) => server.close(() => resolve())));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const chart = async (asOf: string) =>
    (await loadPerfComparisonBlocks(pool, { listings: LISTINGS, snapshotId: "64000000-0000-4000-8000-0000000000d1", asOf, window: "ytd" }))[0];

  await hydrateYtdBars({ origin, listings: LISTINGS, now: new Date().toISOString() });
  assert.equal(provider.calls(), 2, "one provider fetch per company");

  // The cutoff is taken after the fetch (as local-runtime does), so the stored
  // bars are inside it.
  const cutoff = new Date().toISOString();
  const drawn = await chart(cutoff);
  assert.equal(drawn?.kind, "perf_comparison");
  assert.match(String(drawn.default_range), /^YTD \d{4}: \d{4}-12-\d{2} close to \d{4}-\d{2}-\d{2} close/);
  const lines = drawn.series as Array<{ points: Array<{ y: number }> }>;
  assert.ok(lines.every((line) => Math.abs(line.points.at(-1)!.y - 20) < 1e-9));

  // Asking again reuses what the first ask stored.
  await hydrateYtdBars({ origin, listings: LISTINGS, now: new Date().toISOString() });
  assert.equal(provider.calls(), 2, "the repeat ask is served from the cache");
});

test("a live YTD turn whose refresh fails names the stale cached window as a gap, and quotes none of its returns (#256)", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for YTD hydration coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "chat-ytd-stale");
  const pool = await connectedPool(t, databaseUrl);
  const client = await pool.connect();
  try {
    await seedGoldenDataset(client as never);
  } finally {
    client.release();
  }
  const userId = "10000000-0000-4000-8000-000000000256";
  await pool.query(`insert into users (user_id, email) values ($1::uuid, 'stale-ytd@chat.example.test')`, [userId]);
  const thread = await createThread(pool as never, userId, { title: "Stale YTD" });

  // Live mode with the market service down: nothing listens on the port, so the
  // YTD refresh fails and only the golden window, ending 2026-08-31, is stored.
  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const port = (closed.address() as AddressInfo).port;
  await new Promise<void>((resolve) => closed.close(() => resolve()));
  setEnv(t, {
    CHAT_DATABASE_URL: databaseUrl,
    MARKET_ORIGIN: `http://127.0.0.1:${port}`,
    DEV_NO_KEYS: undefined,
    DEV_MODE: undefined,
    DEV_PROFILE: undefined,
    // No answer model: the blocks are the subject, and no live model is called.
    LLM_CHANNELS: undefined,
    LITELLM_MODEL: undefined,
    LITELLM_FALLBACK_MODELS: undefined,
    LLM_SETTINGS_ENV_FILE: undefined,
  });
  registerLifoCleanup(t, () => closeLocalRuntimePoolForTests());

  const subject = (ticker: string) => {
    const ref = { kind: "issuer" as const, id: company(ticker).issuer_id };
    return { status: "resolved", subject_ref: ref, handoff: { subject_ref: ref, context: {} } };
  };
  const result = await analystToolRuntime({
    threadId: thread.thread_id,
    runId: "20000000-0000-4000-8000-000000000256",
    turnId: "30000000-0000-4000-8000-000000000256",
    userId,
    bundleId: "single_subject_analysis",
    userIntent: "Compare NVDA with AMD YTD",
    emit: (() => ({})) as never,
    subjectPreResolution: subject("NVDA") as never,
    subjectPreResolutions: [subject("NVDA"), subject("AMD")] as never,
  });

  // The turn's cutoff is now, more than a week after the window's 2026-08-31
  // end, so the cached window is not this year to date. (From 2027 the gap is
  // the missing year-end baseline instead; either way no stale chart.)
  assert.equal(result.blocks.some((block) => block.kind === "perf_comparison"), false);
  assert.match(JSON.stringify(result.blocks), /Year-to-date price performance is not shown: /);
  // The rest of the answer stands, and the narrative is offered no price return.
  assert.ok(result.blocks.some((block) => block.kind === "metrics_comparison"));
  assert.deepEqual(displayedFigures(result.blocks).filter((figure) => figure.metric === "Price return"), []);
});

function setEnv(t: TestContext, values: Record<string, string | undefined>): void {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  const apply = (entries: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(entries)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  apply(values);
  registerLifoCleanup(t, () => apply(previous));
}
