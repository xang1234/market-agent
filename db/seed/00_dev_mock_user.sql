-- Dev-only mock user matching DEFAULT_MOCK_SESSION in
-- web/src/shell/AuthContext.tsx. The dev AuthProvider stores this UUID in
-- React state on "Sign in" but does not write to the DB itself, so the
-- FK-enforced user-scoped surfaces (watchlists, chat_threads, portfolios,
-- agents, run_activities) need this row to exist for the mock session to
-- round-trip. The `users_default_manual_watchlist` trigger then creates the
-- default manual watchlist with is_default=true automatically.
--
-- Idempotent — `npm run seed` runs on every `./scripts/dev-shell.sh up`.
-- Safe to leave in seed/: the dev shell is the only path that invokes
-- `npm run seed`; production deploys run migrations only.
INSERT INTO users (user_id, email, display_name)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'mock@dev.local',
  'Mock User'
)
ON CONFLICT (user_id) DO NOTHING;
