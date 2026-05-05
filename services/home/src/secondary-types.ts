import type { ListingSubjectRef } from "../../market/src/subject-ref.ts";
import type { NormalizedQuote } from "../../market/src/quote.ts";
import type { ScreenSubject } from "../../screener/src/screen-subject.ts";

import type { HomeFindingCard, SubjectRef } from "./types.ts";

export type HomeListingContext = {
  ticker: string;
  mic: string;
  timezone: string;
};

export type HomeQuoteResult = {
  quote: NormalizedQuote;
  listing_context: HomeListingContext;
};

export type HomeQuoteProvider = (
  refs: ReadonlyArray<ListingSubjectRef>,
) => Promise<ReadonlyArray<HomeQuoteResult>>;

export type HomeOmittedListing = {
  listing: ListingSubjectRef;
  reason: "no_quote";
};

export type HomeQuoteRow = {
  listing: ListingSubjectRef;
  ticker: string;
  mic: string;
  price: number;
  prev_close: number;
  change_abs: number;
  change_pct: number;
  session_state: NormalizedQuote["session_state"];
  delay_class: NormalizedQuote["delay_class"];
  as_of: string;
  currency: string;
};

export type HomeMarketPulse = {
  rows: ReadonlyArray<HomeQuoteRow>;
  omitted: ReadonlyArray<HomeOmittedListing>;
};

export type HomeWatchlistMoversReason =
  | "ok"
  | "no_default_watchlist"
  | "empty_watchlist";

export type HomeWatchlistMovers = {
  reason: HomeWatchlistMoversReason;
  rows: ReadonlyArray<HomeQuoteRow>;
  omitted: ReadonlyArray<HomeOmittedListing>;
};

export type HomeAgentLastRun = {
  agent_run_log_id: string;
  status: "running" | "completed" | "failed";
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  error: string | null;
};

export type HomeAgentLatestFinding = {
  finding_id: string;
  headline: string;
  severity: "high" | "critical";
  created_at: string;
};

export type HomeAgentSummaryRow = {
  agent_id: string;
  name: string;
  enabled: true;
  last_run: HomeAgentLastRun | null;
  finding_counts: {
    total: number;
    high_or_critical: number;
    critical: number;
  };
  latest_high_or_critical_finding: HomeAgentLatestFinding | null;
};

export type HomeAgentSummaries = {
  window_hours: number;
  rows: ReadonlyArray<HomeAgentSummaryRow>;
};

export type HomeSavedScreenRow = {
  screen_id: string;
  name: string;
  filter_summary: string;
  updated_at: string;
  replay_target: SubjectRef & { kind: "screen" };
};

export type HomeSavedScreens = {
  rows: ReadonlyArray<HomeSavedScreenRow>;
};

export type HomeSummary = {
  generated_at: string;
  findings: { cards: ReadonlyArray<HomeFindingCard> };
  market_pulse: HomeMarketPulse;
  watchlist_movers: HomeWatchlistMovers;
  agent_summaries: HomeAgentSummaries;
  saved_screens: HomeSavedScreens;
};

export type HomeSavedScreensProvider = (
  user_id: string,
) => Promise<ReadonlyArray<ScreenSubject>>;

export type HomeSectionsDeps = {
  quoteProvider: HomeQuoteProvider;
  // User-scoped screen list. Home will not call ScreenRepository.list() directly
  // because the screener service is not yet user-aware (its repo is global) and
  // a direct call would leak other users' saved screens. The composition root
  // adapts whatever scoping mechanism the screener exposes today (or returns
  // [] until the screener gains a user_id column) and Home stays correct.
  listSavedScreens: HomeSavedScreensProvider;
  pulse_subjects?: ReadonlyArray<ListingSubjectRef>;
};

export const DEFAULT_HOME_PULSE_SUBJECTS: ReadonlyArray<ListingSubjectRef> = Object.freeze([]);
