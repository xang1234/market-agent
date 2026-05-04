import assert from "node:assert/strict";
import test from "node:test";

import { composePortfolioOverlayRows } from "../src/overlay-composer.ts";
import type { SubjectOverlayInputs } from "../src/overlays.ts";

test("composes separate portfolio contributions onto a base subject row", () => {
  const overlays: SubjectOverlayInputs[] = [
    {
      subject_ref: { kind: "instrument", id: "AAPL" },
      contributions: [
        {
          portfolio_id: "portfolio-usd",
          portfolio_name: "US Core",
          base_currency: "USD",
          quantity: 10,
          cost_basis: 1500,
          held_state: "open",
          opened_at: "2026-01-01T00:00:00.000Z",
          closed_at: null,
        },
        {
          portfolio_id: "portfolio-eur",
          portfolio_name: "EU Mandate",
          base_currency: "EUR",
          quantity: 4,
          cost_basis: 620,
          held_state: "open",
          opened_at: "2026-02-01T00:00:00.000Z",
          closed_at: null,
        },
      ],
    },
  ];

  const rows = composePortfolioOverlayRows(
    [
      {
        subject_ref: { kind: "instrument", id: "AAPL" },
        watchlist_state: "watchlisted",
      },
    ],
    overlays,
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].base.watchlist_state, "watchlisted");
  assert.deepEqual(
    rows[0].portfolio_contributions.map((contribution) => ({
      portfolio_id: contribution.portfolio_id,
      base_currency: contribution.base_currency,
      held_state: contribution.held_state,
      quantity: contribution.quantity,
    })),
    [
      {
        portfolio_id: "portfolio-usd",
        base_currency: "USD",
        held_state: "open",
        quantity: 10,
      },
      {
        portfolio_id: "portfolio-eur",
        base_currency: "EUR",
        held_state: "open",
        quantity: 4,
      },
    ],
  );
});

test("keeps watchlist state distinct from closed holding state", () => {
  const rows = composePortfolioOverlayRows(
    [
      {
        subject_ref: { kind: "listing", id: "NASDAQ:TSLA" },
        watchlist_state: "watchlisted",
      },
    ],
    [
      {
        subject_ref: { kind: "listing", id: "NASDAQ:TSLA" },
        contributions: [
          {
            portfolio_id: "portfolio-history",
            portfolio_name: "Closed Ideas",
            base_currency: "USD",
            quantity: 0,
            cost_basis: 2000,
            held_state: "closed",
            opened_at: "2025-01-01T00:00:00.000Z",
            closed_at: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    ],
  );

  assert.equal(rows[0].base.watchlist_state, "watchlisted");
  assert.equal(rows[0].portfolio_contributions[0].held_state, "closed");
});

test("returns base rows without holdings and preserves base row order", () => {
  const rows = composePortfolioOverlayRows(
    [
      { subject_ref: { kind: "listing", id: "NYSE:IBM" }, display_name: "IBM" },
      { subject_ref: { kind: "instrument", id: "AAPL" }, display_name: "Apple" },
    ],
    [
      {
        subject_ref: { kind: "instrument", id: "AAPL" },
        contributions: [
          {
            portfolio_id: "portfolio-main",
            portfolio_name: "Main",
            base_currency: "USD",
            quantity: 2,
            cost_basis: null,
            held_state: "open",
            opened_at: null,
            closed_at: null,
          },
        ],
      },
    ],
  );

  assert.deepEqual(
    rows.map((row) => row.subject_ref),
    [
      { kind: "listing", id: "NYSE:IBM" },
      { kind: "instrument", id: "AAPL" },
    ],
  );
  assert.deepEqual(rows[0].portfolio_contributions, []);
  assert.equal(rows[1].portfolio_contributions.length, 1);
});
