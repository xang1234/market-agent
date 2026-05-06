# Watchlists

Tracking beads: `fra-6al.6.1` (P0.4b default manual watchlist + membership
CRUD) and `fra-wlc` (named watchlist list-management CRUD).

This service owns the HTTP surface for user watchlists. Each user gets one
implicit default manual watchlist provisioned on user insert by the
`0003_default_manual_watchlist` migration trigger. Users may also create
additional named lists; the default is identified by `is_default` and cannot
be deleted.

## Endpoints

All requests require `x-user-id` (UUID v4). Authentication is stubbed at this
phase; `fra-6al.6.3` will wire the real inline auth interrupt.

- `GET /v1/watchlists/default/members` → `{ members: [{ subject_ref, created_at }] }`
- `GET /v1/watchlists` → `{ watchlists: [...] }` with the default list first
- `POST /v1/watchlists` with `{ name, mode, membership_spec? }` → created list
- `PATCH /v1/watchlists/{watchlist_id}` with `{ name }` → renamed list
- `DELETE /v1/watchlists/{watchlist_id}` → `204` for non-default lists
  - `409` when attempting to delete the implicit default list
- `POST /v1/watchlists/default/members` with `{ subject_ref: { kind, id } }`
  - `201 { status: "created", member }` on first add
  - `200 { status: "already_present", member }` on idempotent repeat
- `DELETE /v1/watchlists/default/members/{subject_kind}/{subject_id}` → `204`
  - `404` if the member is not present

`subject_ref.kind` must be one of the canonical `SubjectKind` values
(`issuer`, `instrument`, `listing`, `theme`, `macro_topic`, `portfolio`,
`screen`). Membership is idempotent at the `(watchlist_id, subject_kind,
subject_id)` tuple, enforced by the schema's unique constraint.

## Dev

```bash
cd services/watchlists
npm test                 # requires Docker for Postgres integration
DATABASE_URL=... npm run dev    # defaults to 127.0.0.1:4313
```
