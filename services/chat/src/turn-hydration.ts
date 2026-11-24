// Fetches what a turn's companies lack before the turn reads them: SEC
// filings for a company with none on file, and daily bars for one whose
// listing has none stored, so a ticker named in chat is answered from its own
// data without first opening its page. A turn that charts a YTD window has
// every company's bars fetched to the window's cutoff (#232). Both fetches run
// together inside one budget per turn; one still running past it keeps
// running and stores what it gets, and the turn answers from what is stored by
// then. A frozen data mode fetches nothing (ytd-hydration.ts), and SEC is
// fetched only with a user agent.

import type { QueryExecutor } from "../../shared/src/http.ts";
import { failed, type Outcome } from "../../shared/src/outcome.ts";
import { labelList, MAX_TURN_SUBJECTS, type ChatTurnEmit } from "./coordinator.ts";
import { issuersWithoutFilings } from "./financial-runtime.ts";
import { companyListings, listingsForComparison, listingTimeZones } from "./perf-block.ts";
import { frozenDataMode, marketHydrationOrigin, ytdRequestRange, type HydrationListing } from "./ytd-hydration.ts";

// `listing_id` is the listing the turn named the company by, when it named
// one. A company with no label (an auto-selected peer) is named by its listing.
export type TurnCompany = Readonly<{ issuer_id: string; label?: string; listing_id?: string }>;

/**
 * Returns the issuers, lowercased, whose filings are still loading (with
 * `pricesOnly`, whose prices are): a fetch still running at the budget, or
 * one that failed within the last minute. What is stored so far is answered
 * from; the answer says the rest is loading.
 */
export type TurnHydrator = (
  companies: ReadonlyArray<TurnCompany>,
  // `ytdCutoff`: the cutoff of the YTD window the turn charts, if it charts one.
  // `pricesOnly`: fetch no filings, as for a price read (#678).
  turn: { emit: ChatTurnEmit; turnId: string; ytdCutoff?: string; pricesOnly?: boolean },
) => Promise<ReadonlySet<string>>;

const BUDGET_MS = 15_000;
const COOLDOWN_MS = 60_000;
// ponytail: an empty answer changes when the market next closes (prices) or
// the company next files (filings) at the earliest; six hours stands in for either.
const EMPTY_COOLDOWN_MS = 6 * 60 * 60_000;
const NONE: ReadonlySet<string> = new Set();

// One fetch, shared by every key it covers. `outcomes` holds, once it
// settles, each subject's: the company's for filings, each listing's for prices.
type Fetch = { at: number; settled: Promise<void>; outcomes?: ReadonlyMap<string, Outcome<unknown>> };

// A settled fetch failed when it failed for any subject: it is retried whole.
function state(entry: Fetch): "running" | "failed" | "done" {
  if (entry.outcomes === undefined) return "running";
  return [...entry.outcomes.values()].some((outcome) => outcome.status === "failed") ? "failed" : "done";
}

export function createTurnHydrator(deps: {
  db: QueryExecutor;
  env: NodeJS.ProcessEnv;
  fetchFilings(issuerId: string): Promise<Outcome<unknown>>;
  // Each listing's outcome.
  fetchBars(origin: string, listings: ReadonlyArray<HydrationListing>, cutoff: string): Promise<ReadonlyMap<string, Outcome<unknown>>>;
  budgetMs?: number;
  now?: () => number;
  logger?: Pick<Console, "warn">;
}): TurnHydrator {
  const now = deps.now ?? Date.now;
  const logger = deps.logger ?? console;
  // Each fetch runs once at a time and, in this process, starts at most once
  // a minute per key: a later turn waits on one still running,
  // and one that finished or failed is not started again until the minute is
  // up. The check and the start are synchronous, so concurrent turns start one.
  // ponytail: per process and never pruned; one entry per company or comparison ever named.
  const fetches = new Map<string, Fetch>();
  // A listing the market had no bars for over a range, and when that answer
  // came: it is not asked for that range again for EMPTY_COOLDOWN_MS (#665).
  // ponytail: per process and never pruned, as `fetches` is.
  const noBarsAt = new Map<string, number>();
  // A fetch that rejects failed for each of its subjects.
  const start = (keys: ReadonlyArray<string>, subjects: ReadonlyArray<string>, fetch: () => Promise<ReadonlyMap<string, Outcome<unknown>>>): Fetch => {
    const entry: Fetch = { at: now(), settled: Promise.resolve() };
    // The minute runs from when a fetch settles, so one that fails late still cools down.
    entry.settled = fetch().catch((error: unknown) => new Map(subjects.map((id) => [id, failed(error)] as const))).then((outcomes) => {
      const causes = new Set([...outcomes.values()].flatMap((outcome) => (outcome.status === "failed" ? [outcome.cause] : [])));
      if (causes.size > 0) logger.warn("[chat] a fetch for the turn's companies failed; the answer names the gap", ...causes);
      entry.outcomes = outcomes;
      entry.at = now();
    });
    for (const key of keys) fetches.set(key, entry);
    return entry;
  };
  // The fetch a turn reads for a key: one running, or one a minute ago.
  const current = (key: string): Fetch | undefined => {
    const entry = fetches.get(key);
    return entry && (state(entry) === "running" || now() - entry.at < COOLDOWN_MS) ? entry : undefined;
  };

  return async (companies, turn) => {
    const capped = companies.slice(0, MAX_TURN_SUBJECTS).map((company) => ({ ...company, issuer_id: company.issuer_id.toLowerCase() }));
    const origin = marketHydrationOrigin(deps.env);
    const sec = !turn.pricesOnly && !frozenDataMode(deps.env) && Boolean(deps.env.SEC_EDGAR_USER_AGENT?.trim());
    if (capped.length === 0 || (!sec && origin === null)) return NONE;
    const ids = capped.map((company) => company.issuer_id);
    const cutoff = turn.ytdCutoff ?? new Date().toISOString();
    const [unfiled, listed] = await Promise.all([
      sec ? issuersWithoutFilings(deps.db, ids) : NONE,
      origin === null ? [] : listingsToPrice(deps.db, capped, cutoff, turn.ytdCutoff === undefined),
    ]);
    // The range a listing is requested over: hydrateYtdBars asks for its YTD window.
    const rangeKey = (listing: HydrationListing) => {
      const range = ytdRequestRange(cutoff, listing.timeZone);
      return `${listing.id}@${range.start}/${range.end}`;
    };
    const ytdKey = (listings: ReadonlyArray<HydrationListing>) => `ytd:${listings.map(rangeKey).sort().join(",")}`;
    const unpriced = listed.filter((listing) => !(now() - (noBarsAt.get(rangeKey(listing)) ?? -Infinity) < EMPTY_COOLDOWN_MS));

    // A company is fetched when it has no filings on file, or its last fetch
    // failed (it may have stored only some years); one with a fetch running
    // is waited on even once some of its years are stored. One a fetch left
    // with none on file is not fetched again for EMPTY_COOLDOWN_MS (#688).
    const filings = !sec ? [] : capped.flatMap((company) => {
      const key = `sec:${company.issuer_id}`;
      const entry = current(key);
      if (entry) return [{ company, entry }];
      const last = fetches.get(key);
      if (last?.outcomes?.get(company.issuer_id)?.status === "empty" && now() - last.at < EMPTY_COOLDOWN_MS) return [];
      return unfiled.has(company.issuer_id) || (last !== undefined && state(last) === "failed")
        ? [{ company, entry: start([key], [company.issuer_id], async () => new Map([[company.issuer_id, await deps.fetchFilings(company.issuer_id)]])) }]
        : [];
    });
    // A charted YTD window is one fetch of the whole comparison, keyed by the
    // range each listing is requested over: the chart needs every listing's
    // window on one basis, and hydrateYtdBars falls back to the next basis
    // only for the listings it is given. Otherwise each bare listing is its own.
    const units = turn.ytdCutoff === undefined
      ? unpriced.map((listing) => ({ key: `bars:${listing.id}`, listings: [listing] }))
      : unpriced.length === 0 ? [] : [{ key: ytdKey(unpriced), listings: unpriced }];
    const priced = units.flatMap((unit) => {
      const entry = current(unit.key);
      return entry === undefined || state(entry) === "running" ? [{ ...unit, entry }] : [];
    });
    const due = priced.filter(({ entry }) => !entry);
    const dueListings = due.flatMap((unit) => unit.listings);
    const batch = due.length === 0 ? [] : [start(due.map(({ key }) => key), dueListings.map((listing) => listing.id), async () => {
      const outcomes = await deps.fetchBars(origin!, dueListings.map(({ id, timeZone }) => ({ id, timeZone })), cutoff);
      const noBars = dueListings.filter((listing) => outcomes.get(listing.id)?.status === "empty");
      const anyFailed = [...outcomes.values()].some((outcome) => outcome.status === "failed");
      // The listings answered empty are held though another failed. The
      // comparison's next turn leaves them out, so it is the failed rest's
      // key that must still cool down for the minute.
      for (const listing of dueListings) {
        if (noBars.includes(listing)) noBarsAt.set(rangeKey(listing), now());
        else if (!anyFailed) noBarsAt.delete(rangeKey(listing));
      }
      if (anyFailed && turn.ytdCutoff !== undefined && noBars.length > 0) {
        fetches.set(ytdKey(dueListings.filter((listing) => !noBars.includes(listing))), fetches.get(due[0]!.key)!);
      }
      return outcomes;
    })];
    const listingLabel = new Map(unpriced.map((listing) => [listing.issuer_id, listing.label]));
    const labelOf = new Map(capped.map((company) => [company.issuer_id, company.label ?? listingLabel.get(company.issuer_id) ?? company.issuer_id]));
    const running = filings.filter(({ entry }) => state(entry) === "running");

    const pricedListings = priced.flatMap(({ listings }) => listings);
    const steps = [
      { tool_name: "fetch_filings", noun: "filings", label: `Fetching filings for ${labelList(running.map(({ company }) => labelOf.get(company.issuer_id)!))}`, fetches: running.map(({ entry }) => entry), subjects: running.map(({ company }) => ({ id: company.issuer_id, issuer_id: company.issuer_id })) },
      { tool_name: "load_prices", noun: "prices", label: `Loading prices for ${labelList(pricedListings.map((listing) => labelOf.get(listing.issuer_id)!))}`, fetches: [...priced.flatMap(({ entry }) => entry ?? []), ...batch], subjects: pricedListings },
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

    for (const { tool_call_id, tool_name, noun, label, fetches: done, subjects } of steps) {
      // A fetch that stored nothing for a company failed for it, and says which
      // (#665, #688); one that failed in part names none, as it is retried whole.
      const empty = subjects.filter((subject) => done.some((fetch) => state(fetch) === "done" && fetch.outcomes?.get(subject.id)?.status === "empty"));
      const status = done.some((fetch) => state(fetch) === "running") ? "still_loading" : done.every((fetch) => state(fetch) === "done") && empty.length === 0 ? "ok" : "failed";
      const shown = status !== "still_loading" && empty.length > 0 ? `No ${noun} found for ${labelList(empty.map((subject) => labelOf.get(subject.issuer_id)!))}` : label;
      turn.emit("tool.completed", { tool_call_id, tool_name, label: shown, status });
    }
    if (turn.pricesOnly) {
      return new Set(units.filter(({ key }) => fetches.has(key) && state(fetches.get(key)!) !== "done").flatMap(({ listings }) => listings.map((listing) => listing.issuer_id)));
    }
    return new Set(filings.filter(({ entry }) => state(entry) !== "done").map(({ company }) => company.issuer_id));
  };
}

// Each company's listing the chart reads (perf-block.ts priceListingsForTurn):
// the one the turn named, else its first active by ticker at the cutoff; with
// `bareOnly`, only a listing with no daily bars stored.
async function listingsToPrice(
  db: QueryExecutor,
  companies: ReadonlyArray<TurnCompany>,
  cutoff: string,
  bareOnly: boolean,
): Promise<Array<HydrationListing & { issuer_id: string; label: string }>> {
  const ids = companies.map((company) => company.issuer_id);
  const named = new Map(companies.flatMap((company) => (company.listing_id ? [[company.issuer_id, { listing_id: company.listing_id.toLowerCase(), label: company.label ?? company.listing_id }] as const] : [])));
  const listed = [...listingsForComparison(ids, named, await companyListings(db, ids, cutoff))]
    .flatMap(([issuer_id, listing]) => (listing.listing_id ? [{ issuer_id, id: listing.listing_id, label: listing.label }] : []));
  if (listed.length === 0) return [];
  const bare = bareOnly ? new Set((await db.query<{ listing_id: string }>(
    `select listing.id::text as listing_id
       from unnest($1::uuid[]) as listing(id)
      where not exists (select 1 from market_bar_ranges r where r.listing_id = listing.id and r.interval = '1d')`,
    [listed.map((listing) => listing.id)],
  )).rows.map((row) => row.listing_id)) : null;
  const due = bare === null ? listed : listed.filter((listing) => bare.has(listing.id));
  const zones = await listingTimeZones(db, due);
  return due.map((listing) => ({ ...listing, timeZone: zones.get(listing.id) ?? "UTC" }));
}
