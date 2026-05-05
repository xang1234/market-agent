import { Pool } from "pg";

import type { ListingSubjectRef } from "../../market/src/subject-ref.ts";

import { createHomeServer } from "./http.ts";
import type {
  HomeQuoteProvider,
  HomeQuoteResult,
  HomeSavedScreensProvider,
} from "./secondary-types.ts";

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

// Live quote provider: fans out to GET /v1/market/quote/:listing_id and
// returns NormalizedQuote + listing_context per ref. A 404, an unavailable
// envelope, or any non-2xx for a single ref drops that ref silently — the
// home layer surfaces it via the `omitted` sidecar.
const liveQuoteProvider: HomeQuoteProvider = async (
  refs: ReadonlyArray<ListingSubjectRef>,
): Promise<ReadonlyArray<HomeQuoteResult>> => {
  if (refs.length === 0) return [];
  const settled = await Promise.allSettled(
    refs.map(async (ref) => {
      const url = new URL("/v1/market/quote", marketOrigin);
      url.searchParams.set("subject_kind", "listing");
      url.searchParams.set("subject_id", ref.id);
      const response = await fetch(url);
      if (!response.ok) {
        void response.body?.cancel();
        return null;
      }
      const body = (await response.json()) as Partial<HomeQuoteResult> & {
        unavailable?: unknown;
      };
      if (body.unavailable !== undefined || !body.quote || !body.listing_context) {
        return null;
      }
      return { quote: body.quote, listing_context: body.listing_context } as HomeQuoteResult;
    }),
  );
  const results: HomeQuoteResult[] = [];
  for (const entry of settled) {
    if (entry.status === "fulfilled" && entry.value !== null) results.push(entry.value);
  }
  return results;
};

// Dev saved-screens provider: returns []. The screener service is not yet
// user-aware (its repo is global; ScreenSubject has no user_id). Returning []
// keeps Home from leaking other users' saved screens. Replace with a delegating
// adapter once fra-aln lands.
const devListSavedScreens: HomeSavedScreensProvider = async (_user_id) => [];

const server = createHomeServer(pool, {
  quoteProvider: liveQuoteProvider,
  listSavedScreens: devListSavedScreens,
  pulse_subjects: pulseSubjects,
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
