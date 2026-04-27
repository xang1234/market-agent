# Portfolio

Tracking bead: `fra-cw0.9.1` (P1.5 — Portfolio model with required
`base_currency`). Holdings (`fra-cw0.9.2`) and overlay-input read models
(`fra-cw0.9.3`) are separate child beads under the `fra-cw0.9` parent and
extend this surface; this service intentionally stops at portfolio identity.

## Scope (spec §3.16, §4.2.1)

`Portfolio` is a user-owned research container — **not** a brokerage account
surrogate. The only contract here:

- `Portfolio.base_currency` is required at create time and defines the
  reporting currency for any later cost basis or overlay totals.
- `base_currency` is a reporting/comparison assumption, not proof that the
  underlying listing trades in that currency, and not a full FX accounting
  model.
- This bead does **not** model holdings, margin, tax lots, fees, settlement,
  cash ledgers, or order history.

## Endpoints

All requests require an `x-user-id` header (UUID v4). Authentication is
stubbed for this phase, matching the watchlists service.

- `POST /v1/portfolios` with `{ name, base_currency }`
  - `201 { portfolio }` on success
  - `400` if `name` is missing/empty/too long, or if `base_currency` is
    missing or not a 3-letter ISO 4217 code
- `GET  /v1/portfolios` → `{ portfolios: [...] }` (caller-scoped)
- `GET  /v1/portfolios/:portfolio_id` → `{ portfolio }` or `404`
- `DELETE /v1/portfolios/:portfolio_id` → `204` or `404`

`base_currency` is enforced both at the API contract boundary
(`assertPortfolioCreateInput`) and by the database schema
(`portfolios.base_currency text not null`). The contract layer makes a
missing field surface as a 400 rather than a 500 from a NOT NULL violation.

## Dev

```bash
cd services/portfolio
npm test                          # requires Docker for Postgres integration
DATABASE_URL=... npm run dev      # defaults to 127.0.0.1:4333
```
