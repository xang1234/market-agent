import test from "node:test";
import assert from "node:assert/strict";

import { loadPerfComparisonBlocks } from "../src/perf-block.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { GOLDEN_AS_OF, GOLDEN_COMPANIES, MARKET_SOURCE_ID, seedGoldenDataset } from "./golden/dataset.ts";

const company = (ticker: string) => GOLDEN_COMPANIES.find((candidate) => candidate.ticker === ticker)!;
const NVDA = company("NVDA");
const AMD = company("AMD");
const LISTINGS = [{ id: NVDA.listing_id, label: "NVDA" }, { id: AMD.listing_id, label: "AMD" }];

test("an unrelated cached range cannot change the requested YTD window (#192)", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for YTD window coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "chat-ytd-window");
  const client = await connectedClient(t, databaseUrl);
  await seedGoldenDataset(client);
  const typed = client as unknown as Parameters<typeof loadPerfComparisonBlocks>[0];
  const ytd = () =>
    loadPerfComparisonBlocks(typed, { listings: LISTINGS, snapshotId: "64000000-0000-4000-8000-0000000000cf", asOf: GOLDEN_AS_OF, window: "ytd" });
  const before = await ytd();

  // A newer, shorter NVDA range (fetched later, ending later) with other prices.
  const { rows } = await client.query<{ bar_range_id: string }>(
    `insert into market_bar_ranges
       (listing_id, source_id, provider, interval, adjustment_basis, range_start, range_end,
        as_of, delay_class, currency, fetched_at, expires_at)
     values ($1::uuid, $2::uuid, 'polygon', '1d', 'split_adjusted', '2026-08-03T04:00:00Z', $3::timestamptz,
             $3::timestamptz, 'eod', 'USD', $3::timestamptz, $3::timestamptz + interval '100 years')
     returning bar_range_id::text as bar_range_id`,
    [NVDA.listing_id, MARKET_SOURCE_ID, GOLDEN_AS_OF],
  );
  await client.query(
    `insert into market_bars (bar_range_id, ts, open, high, low, close, volume)
     values ($1::uuid, '2026-08-03T04:00:00Z', 1, 1, 1, 1, 1), ($1::uuid, '2026-08-31T04:00:00Z', 9, 9, 9, 9, 1)`,
    [rows[0]!.bar_range_id],
  );
  const after = await ytd();

  const chart = after[0];
  assert.equal(chart?.kind, "perf_comparison");
  assert.equal(chart.default_range, "YTD 2026: 2025-12-31 close to 2026-08-31 close");
  const used = (chart.provenance_series_specs as Array<{ bar_range_id: string }>).map((spec) => spec.bar_range_id);
  assert.ok(!used.includes(rows[0]!.bar_range_id), "the short range does not reach back over the year-end");
  assert.deepEqual(after, before, "same window, values, and references as before the unrelated range");

  // Ranges stored from New York's Dec 24 (05:00Z) reach back over the year-end too.
  const fromChristmasEve: string[] = [];
  for (const [listingId, base] of [[NVDA.listing_id, 100], [AMD.listing_id, 50]] as const) {
    const { rows: [range] } = await client.query<{ bar_range_id: string }>(
      `insert into market_bar_ranges
         (listing_id, source_id, provider, interval, adjustment_basis, range_start, range_end,
          as_of, delay_class, currency, fetched_at, expires_at)
       values ($1::uuid, $2::uuid, 'polygon', '1d', 'split_adjusted', '2025-12-24T05:00:00Z', $3::timestamptz,
               $3::timestamptz, 'eod', 'USD', $3::timestamptz + interval '1 second', $3::timestamptz + interval '100 years')
       returning bar_range_id::text as bar_range_id`,
      [listingId, MARKET_SOURCE_ID, GOLDEN_AS_OF],
    );
    fromChristmasEve.push(range!.bar_range_id);
    await client.query(
      `insert into market_bars (bar_range_id, ts, open, high, low, close, volume)
       values ($1::uuid, '2025-12-31T05:00:00Z', $2, $2, $2, $2, 1), ($1::uuid, '2026-08-31T04:00:00Z', $3, $3, $3, $3, 1)`,
      [range!.bar_range_id, base, base * 1.2],
    );
  }
  const refreshed = (await ytd())[0];
  assert.equal(refreshed?.kind, "perf_comparison");
  assert.deepEqual((refreshed.provenance_series_specs as Array<{ bar_range_id: string }>).map((spec) => spec.bar_range_id), fromChristmasEve);
  const lines = refreshed.series as Array<{ points: Array<{ y: number }> }>;
  assert.ok(lines.every((line) => Math.abs(line.points.at(-1)!.y - 20) < 1e-9));
});
