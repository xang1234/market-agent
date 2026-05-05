import { HomeFindingFeedError, listHomeFindingCards } from "./finding-feed-repo.ts";
import { rankHomeCards } from "./ranker.ts";
import { getHomeAgentSummaries } from "./agent-summaries.ts";
import { getHomeMarketPulse } from "./market-pulse.ts";
import { getHomeSavedScreens } from "./saved-screens.ts";
import { getHomeWatchlistMovers } from "./watchlist-movers.ts";
import type { HomeSectionsDeps, HomeSummary } from "./secondary-types.ts";
import type { QueryExecutor } from "./types.ts";

export type GetHomeSummaryRequest = {
  user_id: string;
  now?: string | Date;
  finding_limit?: number;
  movers_limit?: number;
  saved_screens_limit?: number;
  agent_window_hours?: number;
};

export async function getHomeSummary(
  db: QueryExecutor,
  deps: HomeSectionsDeps,
  request: GetHomeSummaryRequest,
): Promise<HomeSummary> {
  const generated_at = resolveNow(request.now);

  const [findingCards, market_pulse, watchlist_movers, agent_summaries, saved_screens] = await Promise.all([
    listHomeFindingCards(db, { user_id: request.user_id, limit: request.finding_limit }),
    getHomeMarketPulse({
      pulse_subjects: deps.pulseSubjects,
      quoteProvider: deps.quoteProvider,
    }),
    getHomeWatchlistMovers(db, {
      user_id: request.user_id,
      quoteProvider: deps.quoteProvider,
      limit: request.movers_limit,
    }),
    getHomeAgentSummaries(db, {
      user_id: request.user_id,
      window_hours: request.agent_window_hours,
      now: generated_at,
    }),
    getHomeSavedScreens({
      user_id: request.user_id,
      listSavedScreens: deps.listSavedScreens,
      limit: request.saved_screens_limit,
    }),
  ]);

  const cards = rankHomeCards(findingCards, { now: generated_at });

  return Object.freeze({
    generated_at,
    findings: Object.freeze({ cards }),
    market_pulse,
    watchlist_movers,
    agent_summaries,
    saved_screens,
  });
}

function resolveNow(value: string | Date | undefined): string {
  if (value === undefined) return new Date().toISOString();
  const resolved = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(resolved.getTime())) {
    throw new HomeFindingFeedError("now must be a valid date");
  }
  return resolved.toISOString();
}
