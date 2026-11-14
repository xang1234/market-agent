// Fetches what a turn's companies lack before the turn reads them: SEC
// filings for a company with none on file, and daily bars for one whose
// listing has none stored, so a ticker named in chat is answered from its own
// data without first opening its page. Both fetches run together inside one
// budget per turn; one still running past it keeps running and stores what it
// gets, and the turn answers from what is stored by then. A frozen data mode
// fetches nothing (ytd-hydration.ts), and SEC is fetched only with a user agent.

import type { QueryExecutor } from "../../shared/src/http.ts";
import { labelList, MAX_TURN_SUBJECTS, type ChatTurnEmit } from "./coordinator.ts";
import { issuersWithoutFilings } from "./financial-runtime.ts";
import { companyListings, listingsForComparison, listingTimeZones } from "./perf-block.ts";
import { frozenDataMode, marketHydrationOrigin, type HydrationListing } from "./ytd-hydration.ts";

// `listing_id` is the listing the turn named the company by, when it named one.
export type TurnCompany = Readonly<{ issuer_id: string; label: string; listing_id?: string }>;

/**
 * Returns the issuers, lowercased, whose filings are still loading: a fetch
 * still running at the budget, or one that failed within the last minute.
 * What is stored so far is answered from; the answer says the rest is loading.
 */
export type TurnHydrator = (
  companies: ReadonlyArray<TurnCompany>,
  turn: { emit: ChatTurnEmit; turnId: string },
) => Promise<ReadonlySet<string>>;

const BUDGET_MS = 15_000;
const COOLDOWN_MS = 60_000;
const NONE: ReadonlySet<string> = new Set();

// One fetch, shared by every key it covers. `outcome` is unset while it runs.
type Fetch = { at: number; settled: Promise<void>; outcome?: "done" | "failed" };

export function createTurnHydrator(deps: {
  db: QueryExecutor;
  env: NodeJS.ProcessEnv;
  fetchFilings(issuerId: string): Promise<void>;
  fetchBars(origin: string, listings: ReadonlyArray<HydrationListing>): Promise<void>;
  budgetMs?: number;
  now?: () => number;
  logger?: Pick<Console, "warn">;
}): TurnHydrator {
  const now = deps.now ?? Date.now;
  const logger = deps.logger ?? console;
  // Each fetch runs once at a time and, in this process, starts at most once
  // a minute per company or listing: a later turn waits on one still running,
  // and one that finished or failed is not started again until the minute is
  // up. The check and the start are synchronous, so concurrent turns start one.
  // ponytail: per process and never pruned; one entry per company ever named.
  const fetches = new Map<string, Fetch>();
  const start = (keys: ReadonlyArray<string>, fetch: () => Promise<void>): Fetch => {
    const entry: Fetch = { at: now(), settled: Promise.resolve() };
    // The minute runs from when a fetch settles, so one that fails late still cools down.
    entry.settled = fetch().then(() => { entry.outcome = "done"; entry.at = now(); }, (error: unknown) => {
      logger.warn("[chat] a fetch for the turn's companies failed; the answer names the gap", error);
      entry.outcome = "failed";
      entry.at = now();
    });
    for (const key of keys) fetches.set(key, entry);
    return entry;
  };
  // The fetch a turn reads for a key: one running, or one a minute ago.
  const current = (key: string): Fetch | undefined => {
    const entry = fetches.get(key);
    return entry && (entry.outcome === undefined || now() - entry.at < COOLDOWN_MS) ? entry : undefined;
  };

  return async (companies, turn) => {
    const capped = companies.slice(0, MAX_TURN_SUBJECTS).map((company) => ({ ...company, issuer_id: company.issuer_id.toLowerCase() }));
    const origin = marketHydrationOrigin(deps.env);
    const sec = !frozenDataMode(deps.env) && Boolean(deps.env.SEC_EDGAR_USER_AGENT?.trim());
    if (capped.length === 0 || (!sec && origin === null)) return NONE;
    const ids = capped.map((company) => company.issuer_id);
    const [unfiled, unpriced] = await Promise.all([
      sec ? issuersWithoutFilings(deps.db, ids) : NONE,
      origin === null ? [] : listingsWithoutBars(deps.db, capped),
    ]);

    // A company is fetched when it has no filings on file, or its last fetch
    // failed (it may have stored only some years); one with a fetch running
    // is waited on even once some of its years are stored.
    const filings = !sec ? [] : capped.flatMap((company) => {
      const key = `sec:${company.issuer_id}`;
      const entry = current(key);
      if (entry) return [{ company, entry }];
      return unfiled.has(company.issuer_id) || fetches.get(key)?.outcome === "failed"
        ? [{ company, entry: start([key], () => deps.fetchFilings(company.issuer_id)) }]
        : [];
    });
    const priced = unpriced.flatMap((listing) => {
      const entry = current(`bars:${listing.id}`);
      return entry?.outcome === undefined ? [{ listing, entry }] : [];
    });
    const due = priced.flatMap(({ listing, entry }) => (entry ? [] : [listing]));
    const batch = due.length === 0 ? [] : [start(due.map((listing) => `bars:${listing.id}`), () => deps.fetchBars(origin!, due.map(({ id, timeZone }) => ({ id, timeZone }))))];
    const labelOf = new Map(capped.map((company) => [company.issuer_id, company.label]));
    const running = filings.filter(({ entry }) => entry.outcome === undefined);

    const steps = [
      { tool_name: "fetch_filings", label: `Fetching filings for ${labelList(running.map(({ company }) => company.label))}`, fetches: running.map(({ entry }) => entry) },
      { tool_name: "load_prices", label: `Loading prices for ${labelList(priced.map(({ listing }) => labelOf.get(listing.issuer_id) ?? listing.id))}`, fetches: [...priced.flatMap(({ entry }) => entry ?? []), ...batch] },
    ].filter((step) => step.fetches.length > 0).map((step) => ({ ...step, tool_call_id: `${step.tool_name}-${turn.turnId}` }));
    for (const { tool_call_id, tool_name, label } of steps) turn.emit("tool.started", { tool_call_id, tool_name, label });

    if (steps.length > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.all(steps.flatMap((step) => step.fetches.map((fetch) => fetch.settled))),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, deps.budgetMs ?? BUDGET_MS); }),
      ]);
      clearTimeout(timer);
    }

    for (const { tool_call_id, tool_name, label, fetches: done } of steps) {
      const status = done.some((fetch) => fetch.outcome === undefined) ? "still_loading" : done.every((fetch) => fetch.outcome === "done") ? "ok" : "failed";
      turn.emit("tool.completed", { tool_call_id, tool_name, label, status });
    }
    return new Set(filings.filter(({ entry }) => entry.outcome !== "done").map(({ company }) => company.issuer_id));
  };
}

// Each company's listing the chart reads (perf-block.ts priceListingsForTurn):
// the one the turn named, else its first active by ticker, when no daily bars
// are stored for it.
async function listingsWithoutBars(db: QueryExecutor, companies: ReadonlyArray<TurnCompany>): Promise<Array<HydrationListing & { issuer_id: string }>> {
  const ids = companies.map((company) => company.issuer_id);
  const named = new Map(companies.flatMap((company) => (company.listing_id ? [[company.issuer_id, { listing_id: company.listing_id.toLowerCase(), label: company.label }] as const] : [])));
  const listed = [...listingsForComparison(ids, named, await companyListings(db, ids, new Date().toISOString()))]
    .flatMap(([issuer_id, listing]) => (listing.listing_id ? [{ issuer_id, id: listing.listing_id }] : []));
  if (listed.length === 0) return [];
  const { rows } = await db.query<{ listing_id: string }>(
    `select listing.id::text as listing_id
       from unnest($1::uuid[]) as listing(id)
      where not exists (select 1 from market_bar_ranges r where r.listing_id = listing.id and r.interval = '1d')`,
    [listed.map((listing) => listing.id)],
  );
  const bare = new Set(rows.map((row) => row.listing_id));
  const zones = await listingTimeZones(db, listed);
  return listed.filter((listing) => bare.has(listing.id)).map((listing) => ({ ...listing, timeZone: zones.get(listing.id) ?? "UTC" }));
}
