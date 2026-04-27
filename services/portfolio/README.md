# Portfolio

Tracking beads: `fra-cw0.9.1` (Portfolio model with required `base_currency`)
and `fra-cw0.9.2` (PortfolioHolding bound to canonical market identity).
Overlay-input read models (`fra-cw0.9.3`) extend this surface in a follow-up.

## Scope (spec §3.16, §4.2.1)

`Portfolio` is a user-owned research container — **not** a brokerage account
surrogate. Holdings track held exposure for overlays and monitoring; this
bead does **not** model margin, tax lots, fees, settlement, cash ledgers, or
order history.

Contracts enforced here:

- `Portfolio.base_currency` is required at create time and defines the
  reporting currency for any later cost basis or overlay totals. It is a
  reporting/comparison assumption, not proof that the underlying listing
  trades in that currency.
- `PortfolioHolding.subject_ref` must bind to canonical market identity:
  `kind` is restricted to `instrument` or `listing` only. The DB column
  accepts the full polymorphic `subject_kind` enum (shared with
  `watchlist_members`, `theme_memberships`, etc.); the holding-specific
  allowlist lives in application code (`HOLDING_SUBJECT_KINDS`). Attempts
  to hold a `theme`, `macro_topic`, `portfolio`, `screen`, or `issuer`
  return 400.
- `subject_id` must be a UUID v4, so raw ticker strings (`"AAPL"`) cannot
  reach the persistence layer.
- `cost_basis`, `opened_at`, `closed_at` are optional. When `cost_basis` is
  present it is interpreted in the portfolio's `base_currency`; this layer
  does not model FX, transaction currencies, or fee-adjusted basis.

## Endpoints

All requests require an `x-user-id` header (UUID v4). Authentication is
stubbed for this phase, matching the watchlists service.

Portfolios:

- `POST /v1/portfolios` with `{ name, base_currency }` → `201` / `400`
- `GET  /v1/portfolios` → `{ portfolios: [...] }` (caller-scoped)
- `GET  /v1/portfolios/:portfolio_id` → `{ portfolio }` or `404`
- `DELETE /v1/portfolios/:portfolio_id` → `204` or `404`

Holdings (scoped under a portfolio the caller owns):

- `POST /v1/portfolios/:portfolio_id/holdings` with
  `{ subject_ref: { kind: "instrument" | "listing", id }, quantity, cost_basis?, opened_at?, closed_at? }`
  → `201` / `400` / `404` (cross-user portfolio access returns `404`).
- `GET  /v1/portfolios/:portfolio_id/holdings` → `{ holdings: [...] }`
- `DELETE /v1/portfolios/:portfolio_id/holdings/:portfolio_holding_id` → `204` / `404`

Deleting a portfolio cascades to its holdings (FK `on delete cascade`).

## Dev

```bash
cd services/portfolio
npm test                          # requires Docker for Postgres integration
DATABASE_URL=... npm run dev      # defaults to 127.0.0.1:4333
```
