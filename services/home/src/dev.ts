import { Pool } from "pg";

import type { ListingSubjectRef } from "../../market/src/subject-ref.ts";

import { createLiveQuoteProvider } from "./dev-quote-provider.ts";
import { createHomeServer } from "./http.ts";
import type { HomeSavedScreensProvider } from "./secondary-types.ts";

const host = process.env.HOME_HOST ?? "127.0.0.1";
const port = Number(process.env.HOME_PORT ?? "4334");
const databaseUrl = process.env.DATABASE_URL;
const marketOrigin = process.env.MARKET_ORIGIN ?? "http://127.0.0.1:4321";
const pulseRaw = process.env.HOME_PULSE_LISTINGS ?? "";

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for home dev server");
}

const pulseSubjects: ReadonlyArray<ListingSubjectRef> = pulseRaw
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
  .map((id) => Object.freeze({ kind: "listing" as const, id }));

const pool = new Pool({ connectionString: databaseUrl });

// Drops per-ref failures/timeouts silently; Home exposes missing quotes via `omitted`.
const liveQuoteProvider = createLiveQuoteProvider(marketOrigin);

// Dev saved-screens provider: returns []. The screener service is not yet
// user-aware (its repo is global; ScreenSubject has no user_id). Returning []
// keeps Home from leaking other users' saved screens. Replace with a delegating
// adapter once fra-aln lands.
const devListSavedScreens: HomeSavedScreensProvider = async (_user_id) => [];

const server = createHomeServer(pool, {
  quoteProvider: liveQuoteProvider,
  listSavedScreens: devListSavedScreens,
  pulseSubjects,
});

server.listen(port, host, () => {
  console.log(
    `home listening on http://${host}:${port} (market=${marketOrigin}, pulse_subjects=${pulseSubjects.length})`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  });
}
