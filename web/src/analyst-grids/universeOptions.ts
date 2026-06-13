import { authenticatedJson, type FetchImpl } from "../http/authFetch.ts";
import { listSavedScreens } from "../screener/savedScreens.ts";

export type UniverseOption = { id: string; label: string };

// The id-based universe sources whose ids name an object the user owns —
// rendered as pickers in the GridBuilder (peers takes a ticker instead).
export type PickerUniverseSource = "watchlist" | "portfolio" | "screen";

export type UniverseOptions = Record<PickerUniverseSource, UniverseOption[]>;

export const EMPTY_UNIVERSE_OPTIONS: UniverseOptions = Object.freeze({
  watchlist: [],
  portfolio: [],
  screen: [],
});

// Loads the user's watchlists, portfolios, and saved screens for the universe
// pickers. Sources fail independently: one downed service costs its picker
// its options (with a console warning), not the whole Grids page.
export async function fetchUniverseOptions(args: {
  userId: string;
  fetchImpl?: FetchImpl;
}): Promise<UniverseOptions> {
  const [watchlist, portfolio, screen] = await Promise.all([
    authenticatedJson<{ watchlists: Array<{ watchlist_id: string; name: string }> }>("/v1/watchlists", args)
      .then((body) => body.watchlists.map((w) => ({ id: w.watchlist_id, label: w.name })))
      .catch(emptyWithWarning("watchlists")),
    authenticatedJson<{ portfolios: Array<{ portfolio_id: string; name: string }> }>("/v1/portfolios", args)
      .then((body) => body.portfolios.map((p) => ({ id: p.portfolio_id, label: p.name })))
      .catch(emptyWithWarning("portfolios")),
    listSavedScreens(args)
      .then((screens) => screens.map((s) => ({ id: s.screen_id, label: s.name })))
      .catch(emptyWithWarning("screens")),
  ]);
  return { watchlist, portfolio, screen };
}

function emptyWithWarning(label: string) {
  return (error: unknown): UniverseOption[] => {
    console.warn(`analyst-grids: failed to load ${label} for the universe picker`, error);
    return [];
  };
}
