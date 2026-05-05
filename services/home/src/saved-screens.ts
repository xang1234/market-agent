import { assertUuid } from "../../market/src/validators.ts";
import type { ScreenSubject } from "../../screener/src/screen-subject.ts";

import { HomeFindingFeedError } from "./finding-feed-repo.ts";
import type {
  HomeSavedScreenRow,
  HomeSavedScreens,
  HomeSavedScreensProvider,
} from "./secondary-types.ts";

export const DEFAULT_HOME_SAVED_SCREENS_LIMIT = 5;
export const MAX_HOME_SAVED_SCREENS_LIMIT = 20;

export type GetHomeSavedScreensRequest = {
  user_id: string;
  listSavedScreens: HomeSavedScreensProvider;
  limit?: number;
};

export async function getHomeSavedScreens(
  request: GetHomeSavedScreensRequest,
): Promise<HomeSavedScreens> {
  assertUuid(request.user_id, "user_id");
  const limit = resolveLimit(request.limit);
  const screens = await request.listSavedScreens(request.user_id);
  const sorted = [...screens].sort(byUpdatedAtDesc);
  const rows = sorted.slice(0, limit).map(toRow);
  return Object.freeze({ rows: Object.freeze(rows) });
}

function byUpdatedAtDesc(a: ScreenSubject, b: ScreenSubject): number {
  return b.updated_at.localeCompare(a.updated_at);
}

function toRow(screen: ScreenSubject): HomeSavedScreenRow {
  return Object.freeze({
    screen_id: screen.screen_id,
    name: screen.name,
    filter_summary: filterSummary(screen),
    updated_at: screen.updated_at,
    replay_target: Object.freeze({ kind: "screen", id: screen.screen_id }),
  });
}

function filterSummary(screen: ScreenSubject): string {
  const definition = screen.definition;
  const counts = {
    universe: definition.universe.length,
    market: definition.market.length,
    fundamentals: definition.fundamentals.length,
  };
  const total = counts.universe + counts.market + counts.fundamentals;
  if (total === 0) return "no filters";
  const dimensions = (["universe", "market", "fundamentals"] as const).filter(
    (dim) => counts[dim] > 0,
  );
  const filterWord = total === 1 ? "filter" : "filters";
  return `${total} ${filterWord} · ${dimensions.join(", ")}`;
}

function resolveLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_HOME_SAVED_SCREENS_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new HomeFindingFeedError("limit must be a positive integer");
  }
  return Math.min(limit, MAX_HOME_SAVED_SCREENS_LIMIT);
}
