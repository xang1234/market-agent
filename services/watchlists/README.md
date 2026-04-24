# Watchlists

Tracking bead: `fra-6al.6.1` (P0.4b default manual watchlist + membership CRUD).

This service owns the HTTP surface for the implicit default manual watchlist.
Each user has exactly one manual watchlist — provisioned on user insert by the
`0003_default_manual_watchlist` migration trigger. This bead does **not**
cover create/rename/delete list endpoints; that work is tracked in `fra-wlc`.

## Endpoints

All requests require `x-user-id` (UUID v4). Authentication is stubbed at this
phase; `fra-6al.6.3` will wire the real inline auth interrupt.

- `GET /v1/watchlists/default/members` → `{ members: [{ subject_ref, created_at }] }`
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
