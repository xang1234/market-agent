import { Pool } from "pg";

import type { ListingSubjectRef } from "../../market/src/subject-ref.ts";
import { createPostgresScreenRepository } from "../../screener/src/screen-repository.ts";

import { createLiveQuoteProvider } from "./dev-quote-provider.ts";
import { createHomeServer } from "./http.ts";
import type { HomeSavedScreensProvider } from "./secondary-types.ts";

const host = process.env.HOME_HOST ?? "127.0.0.1";
const port = Number(process.env.HOME_PORT ?? "4334");
const databaseUrl = process.env.DATABASE_URL;
const marketOrigin = process.env.MARKET_ORIGIN ?? "http://127.0.0.1:4321";
const pulseRaw = process.env.HOME_PULSE_TICKERS ?? "AAPL,MSFT,GOOGL";

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for home dev server");
}

const pulseTickers = pulseRaw
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const pool = new Pool({ connectionString: databaseUrl });
const pulseSubjects = await loadPulseSubjects(pool, pulseTickers);

// Drops per-ref failures/timeouts silently; Home exposes missing quotes via `omitted`.
const liveQuoteProvider = createLiveQuoteProvider(marketOrigin);

const screenRepository = createPostgresScreenRepository(pool);
const devListSavedScreens: HomeSavedScreensProvider = (user_id) => screenRepository.listForUser(user_id);

const server = createHomeServer(pool, {
  quoteProvider: liveQuoteProvider,
  listSavedScreens: devListSavedScreens,
  pulseSubjects,
});

server.listen(port, host, () => {
  console.log(
    `home listening on http://${host}:${port} (market=${marketOrigin}, pulse_tickers=${pulseTickers.join(",")}, pulse_subjects=${pulseSubjects.length})`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  });
}

type PulseListingRow = {
  listing_id: string;
  ticker: string;
  mic: string;
};

async function loadPulseSubjects(
  db: Pool,
  tickers: ReadonlyArray<string>,
): Promise<ReadonlyArray<ListingSubjectRef>> {
  const normalizedTickers = Array.from(new Set(tickers.map((ticker) => ticker.toUpperCase())));
  if (normalizedTickers.length === 0) return Object.freeze([]);

  const result = await db.query<PulseListingRow>(
    `select l.listing_id::text as listing_id,
            l.ticker,
            l.mic
       from listings l
      where upper(l.ticker) = any($1::text[])
        and l.active_to is null
      order by array_position($1::text[], upper(l.ticker)), l.mic, l.listing_id`,
    [normalizedTickers],
  );
  const found = new Set(result.rows.map((row) => row.ticker.toUpperCase()));
  const missing = normalizedTickers.filter((ticker) => !found.has(ticker));
  if (missing.length > 0) {
    console.warn(`HOME_PULSE_TICKERS missing DB-backed listings: ${missing.join(",")}`);
  }

  return Object.freeze(
    result.rows.map((row) => Object.freeze({ kind: "listing" as const, id: row.listing_id })),
  );
}
