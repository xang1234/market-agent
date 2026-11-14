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
import { companyListings, listingTimeZones } from "./perf-block.ts";
import { frozenDataMode, marketHydrationOrigin, type HydrationListing } from "./ytd-hydration.ts";

export type TurnCompany = Readonly<{ issuer_id: string; label: string }>;

/** Returns the issuers whose filings were still loading when the budget ran out. */
export type TurnHydrator = (
  companies: ReadonlyArray<TurnCompany>,
  turn: { emit: ChatTurnEmit; turnId: string },
) => Promise<ReadonlySet<string>>;

const BUDGET_MS = 15_000;
const COOLDOWN_MS = 60_000;
const NONE: ReadonlySet<string> = new Set();

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
  // Each fetch runs once at a time and starts at most once a minute, whatever
  // it found: a company SEC holds no 10-K for is not fetched every turn, and
  // one still loading is waited on again rather than fetched twice. The check
  // and the start are synchronous, so concurrent turns start one fetch.
  // ponytail: per process and never pruned; one entry per company ever named.
  const running = new Map<string, Promise<boolean>>();
  const startedAt = new Map<string, number>();
  const stateOf = (key: string): Promise<boolean> | "due" | "cooling" => {
    const live = running.get(key);
    if (live) return live;
    const last = startedAt.get(key);
    return last !== undefined && now() - last < COOLDOWN_MS ? "cooling" : "due";
  };
  const start = (keys: ReadonlyArray<string>, fetch: () => Promise<void>): Promise<boolean> => {
    const done = fetch().then(() => true, (error: unknown) => {
      logger.warn("[chat] a fetch for the turn's companies failed; the answer names the gap", error);
      return false;
    }).finally(() => {
      for (const key of keys) running.delete(key);
    });
    for (const key of keys) {
      startedAt.set(key, now());
      running.set(key, done);
    }
    return done;
  };

  return async (companies, turn) => {
    const capped = companies.slice(0, MAX_TURN_SUBJECTS);
    const origin = marketHydrationOrigin(deps.env);
    const sec = !frozenDataMode(deps.env) && Boolean(deps.env.SEC_EDGAR_USER_AGENT?.trim());
    if (capped.length === 0 || (!sec && origin === null)) return NONE;
    const ids = capped.map((company) => company.issuer_id);
    const [unfiled, unpriced] = await Promise.all([
      sec ? issuersWithoutFilings(deps.db, ids) : NONE,
      origin === null ? [] : listingsWithoutBars(deps.db, ids),
    ]);

    const filings = capped.flatMap((company) => {
      if (!unfiled.has(company.issuer_id.toLowerCase())) return [];
      const key = `sec:${company.issuer_id}`;
      const state = stateOf(key);
      if (state === "cooling") return [];
      return [{ company, done: state === "due" ? start([key], () => deps.fetchFilings(company.issuer_id)) : state }];
    });
    const priced = unpriced.flatMap((listing) => {
      const state = stateOf(`bars:${listing.id}`);
      return state === "cooling" ? [] : [{ listing, state }];
    });
    const due = priced.filter(({ state }) => state === "due").map(({ listing }) => listing);
    const batch = due.length === 0 ? [] : [start(due.map((listing) => `bars:${listing.id}`), () => deps.fetchBars(origin!, due.map(({ id, timeZone }) => ({ id, timeZone }))))];
    const prices = [...new Set([...priced.flatMap(({ state }) => (typeof state === "object" ? [state] : [])), ...batch])];
    const labelOf = new Map(capped.map((company) => [company.issuer_id.toLowerCase(), company.label]));

    const steps = [
      { tool_name: "fetch_filings", label: `Fetching filings for ${labelList(filings.map(({ company }) => company.label))}`, done: filings.map(({ done }) => done) },
      { tool_name: "load_prices", label: `Loading prices for ${labelList(priced.map(({ listing }) => labelOf.get(listing.issuer_id) ?? listing.id))}`, done: prices },
    ].filter((step) => step.done.length > 0).map((step) => ({ ...step, tool_call_id: `${step.tool_name}-${turn.turnId}` }));
    if (steps.length === 0) return NONE;
    for (const { tool_call_id, tool_name, label } of steps) turn.emit("tool.started", { tool_call_id, tool_name, label });

    const results = new Map<Promise<boolean>, boolean>();
    const all = Promise.all(steps.flatMap((step) => step.done).map((done) => done.then((ok) => results.set(done, ok))));
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([all, new Promise<void>((resolve) => { timer = setTimeout(resolve, deps.budgetMs ?? BUDGET_MS); })]);
    clearTimeout(timer);

    for (const { tool_call_id, tool_name, label, done } of steps) {
      const status = done.some((fetch) => !results.has(fetch)) ? "still_loading" : done.every((fetch) => results.get(fetch)) ? "ok" : "failed";
      turn.emit("tool.completed", { tool_call_id, tool_name, label, status });
    }
    return new Set(filings.filter(({ done }) => !results.has(done)).map(({ company }) => company.issuer_id));
  };
}

// Each company's listing (the one chat charts, perf-block.ts companyListings)
// when no daily bars are stored for it.
async function listingsWithoutBars(db: QueryExecutor, issuerIds: ReadonlyArray<string>): Promise<Array<HydrationListing & { issuer_id: string }>> {
  const listed = [...(await companyListings(db, issuerIds, new Date().toISOString()))]
    .flatMap(([issuer_id, listing]) => (listing.listing_id ? [{ issuer_id: issuer_id.toLowerCase(), id: listing.listing_id }] : []));
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
