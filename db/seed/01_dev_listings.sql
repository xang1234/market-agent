-- Dev-only issuer/instrument/listing rows for the same five tickers held in
-- services/market/src/dev-fixtures.ts (DEV_LISTINGS). Listing UUIDs match
-- exactly so cross-service identity is consistent: the market service's
-- in-process snapshots, frontend direct-link URLs (/symbol/listing:<uuid>),
-- and the resolver's DB-backed typeahead all anchor on the same listing_id.
--
-- Without these rows, services/resolver/src/flow.ts returns
-- {subjects:[],unresolved:["AAPL"]} for any typed ticker, which silently
-- breaks "Add symbol" in the watchlist sidebar and any other resolver-driven
-- subject lookup.
--
-- Idempotent — safe to re-run on every `./scripts/dev-shell.sh up`.
-- Production paths run migrations only, never `npm run seed`, so these dev
-- fixtures stay out of prod.

INSERT INTO issuers (issuer_id, legal_name, cik, domicile, sector, industry)
VALUES
  ('11111111-1111-4111-9111-111111111111', 'Apple Inc.',            '0000320193', 'US', 'Technology',             'Consumer Electronics'),
  ('22222222-2222-4222-9222-222222222222', 'Microsoft Corporation', '0000789019', 'US', 'Technology',             'Software—Infrastructure'),
  ('33333333-3333-4333-9333-333333333333', 'Alphabet Inc.',         '0001652044', 'US', 'Communication Services', 'Internet Content & Information'),
  ('44444444-4444-4444-9444-444444444444', 'Tesla, Inc.',           '0001318605', 'US', 'Consumer Cyclical',      'Auto Manufacturers'),
  ('55555555-5555-4555-9555-555555555555', 'NVIDIA Corporation',    '0001045810', 'US', 'Technology',             'Semiconductors')
ON CONFLICT (issuer_id) DO NOTHING;

INSERT INTO instruments (instrument_id, issuer_id, asset_type)
VALUES
  ('11111111-1111-4111-b111-111111111111', '11111111-1111-4111-9111-111111111111', 'common_stock'),
  ('22222222-2222-4222-b222-222222222222', '22222222-2222-4222-9222-222222222222', 'common_stock'),
  ('33333333-3333-4333-b333-333333333333', '33333333-3333-4333-9333-333333333333', 'common_stock'),
  ('44444444-4444-4444-b444-444444444444', '44444444-4444-4444-9444-444444444444', 'common_stock'),
  ('55555555-5555-4555-b555-555555555555', '55555555-5555-4555-9555-555555555555', 'common_stock')
ON CONFLICT (instrument_id) DO NOTHING;

INSERT INTO listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone)
VALUES
  ('11111111-1111-4111-a111-111111111111', '11111111-1111-4111-b111-111111111111', 'XNAS', 'AAPL',  'USD', 'America/New_York'),
  ('22222222-2222-4222-a222-222222222222', '22222222-2222-4222-b222-222222222222', 'XNAS', 'MSFT',  'USD', 'America/New_York'),
  ('33333333-3333-4333-a333-333333333333', '33333333-3333-4333-b333-333333333333', 'XNAS', 'GOOGL', 'USD', 'America/New_York'),
  ('44444444-4444-4444-a444-444444444444', '44444444-4444-4444-b444-444444444444', 'XNAS', 'TSLA',  'USD', 'America/New_York'),
  ('55555555-5555-4555-a555-555555555555', '55555555-5555-4555-b555-555555555555', 'XNAS', 'NVDA',  'USD', 'America/New_York')
ON CONFLICT (listing_id) DO NOTHING;
