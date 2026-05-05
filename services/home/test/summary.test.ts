import assert from "node:assert/strict";
import test from "node:test";

import type { ScreenSubject } from "../../screener/src/screen-subject.ts";

import { getHomeSummary } from "../src/summary.ts";
import type { HomeQuoteProvider, HomeSavedScreensProvider } from "../src/secondary-types.ts";
import type { QueryExecutor } from "../src/types.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const AGENT_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const SCREEN_A = "55555555-5555-4555-a555-555555555555";

function fakeDb(handlers: ReadonlyArray<(text: string) => Record<string, unknown>[] | undefined>): QueryExecutor {
  return {
    async query<R extends Record<string, unknown>>(text: string, _values?: unknown[]) {
      for (const handle of handlers) {
        const rows = handle(text);
        if (rows !== undefined) {
          return {
            rows: rows as R[],
            command: "SELECT",
            rowCount: rows.length,
            oid: 0,
            fields: [],
          };
        }
      }
      throw new Error(`unexpected query: ${text.slice(0, 80)}`);
    },
  };
}

function emptyQuoteProvider(): HomeQuoteProvider {
  return async () => [];
}

function staticSavedScreens(rows: ReadonlyArray<ScreenSubject>): HomeSavedScreensProvider {
  return async () => rows;
}

test("getHomeSummary composes findings + four secondary sections", async () => {
  const db = fakeDb([
    (text) => (/from findings.*join agents/is.test(text) ? [] : undefined),
    (text) =>
      /from agents/i.test(text) && /agent_run_logs/i.test(text)
        ? [
            {
              agent_id: AGENT_A,
              name: "Test agent",
              agent_created_at: "2026-04-01T00:00:00.000Z",
              last_run_id: null,
              last_run_status: null,
              last_run_started_at: null,
              last_run_ended_at: null,
              last_run_duration_ms: null,
              last_run_error: null,
              finding_total: 0,
              finding_hc: 0,
              finding_critical: 0,
              latest_hc_finding_id: null,
              latest_hc_headline: null,
              latest_hc_severity: null,
              latest_hc_created_at: null,
            },
          ]
        : undefined,
    (text) =>
      /default_wl/i.test(text)
        ? [{ subject_id: null, has_watchlist: false }]
        : undefined,
  ]);
  const summary = await getHomeSummary(db, {
    quoteProvider: emptyQuoteProvider(),
    listSavedScreens: staticSavedScreens([
      {
        screen_id: SCREEN_A,
        name: "Saved screen",
        created_at: "2026-04-01T00:00:00.000Z",
        updated_at: "2026-05-05T00:00:00.000Z",
        definition: {
          universe: [],
          market: [],
          fundamentals: [],
          sort: [],
          page: { limit: 50 },
        },
      } as ScreenSubject,
    ]),
    pulseSubjects: [],
  }, {
    user_id: USER_ID,
    now: "2026-05-05T12:00:00.000Z",
  });

  assert.deepEqual(summary.findings.cards, []);
  assert.deepEqual(summary.market_pulse.rows, []);
  assert.equal(summary.watchlist_movers.reason, "no_default_watchlist");
  assert.equal(summary.agent_summaries.rows.length, 1);
  assert.equal(summary.saved_screens.rows.length, 1);
  assert.equal(summary.generated_at, "2026-05-05T12:00:00.000Z");
});

test("getHomeSummary fails fast when one section throws", async () => {
  const db = fakeDb([
    () => {
      throw new Error("synthetic db failure");
    },
  ]);
  await assert.rejects(
    getHomeSummary(db, {
      quoteProvider: emptyQuoteProvider(),
      listSavedScreens: staticSavedScreens([]),
    }, {
      user_id: USER_ID,
      now: "2026-05-05T12:00:00.000Z",
    }),
    /synthetic db failure/,
  );
});

test("getHomeSummary defaults generated_at to wall clock when no `now` is supplied", async () => {
  const db = fakeDb([() => []]);
  const before = new Date().toISOString();
  const summary = await getHomeSummary(db, {
    quoteProvider: emptyQuoteProvider(),
    listSavedScreens: staticSavedScreens([]),
  }, {
    user_id: USER_ID,
  });
  const after = new Date().toISOString();
  assert.ok(summary.generated_at >= before);
  assert.ok(summary.generated_at <= after);
});

test("getHomeSummary rejects invalid now values before querying sections", async () => {
  const db = fakeDb([
    () => {
      throw new Error("should not query");
    },
  ]);

  await assert.rejects(
    () => getHomeSummary(db, {
      quoteProvider: emptyQuoteProvider(),
      listSavedScreens: staticSavedScreens([]),
    }, {
      user_id: USER_ID,
      now: "not a date",
    }),
    /now must be a valid date/,
  );
});
