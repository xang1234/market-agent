-- Minimal source registry. Each row is a provider/kind classifier used by facts.source_id
-- before individual documents are ingested. Fixed UUIDs anchor ON CONFLICT idempotency —
-- gen_random_uuid() defaults would silently duplicate rows on re-seed.
-- source_kind in ('filing', 'press_release', 'transcript', 'article', 'research_note', 'social_post', 'upload', 'internal', 'reference_data', 'market_data')
-- trust_tier in ('primary', 'secondary', 'tertiary', 'user')

insert into sources (source_id, provider, kind, canonical_url, trust_tier, license_class, retrieved_at) values
  ('00000000-0000-4000-a000-000000000001', 'sec_edgar',     'filing',        'https://www.sec.gov/cgi-bin/browse-edgar', 'primary',   'public',   '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-a000-000000000002', 'sec_edgar',     'press_release', 'https://www.sec.gov/cgi-bin/browse-edgar', 'primary',   'public',   '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-a000-000000000003', 'issuer_ir',     'press_release', null,                                       'primary',   'public',   '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-a000-000000000004', 'issuer_ir',     'transcript',    null,                                       'secondary', 'public',   '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-a000-000000000005', 'yahoo_finance', 'article',       'https://finance.yahoo.com',                'tertiary',  'free',     '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-a000-000000000006', 'internal',      'internal',      null,                                       'primary',   'internal', '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-a000-000000000007', 'user_upload',   'upload',        null,                                       'user',      'user',     '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-a000-000000000008', 'polygon_reference', 'reference_data', 'https://api.polygon.io/v3/reference/tickers', 'primary', 'licensed', '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-a000-000000000009', 'polygon_market',    'market_data',    'https://api.polygon.io',                      'primary', 'licensed', '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-a000-00000000000a', 'yahoo_finance_dev_reference', 'reference_data', 'https://finance.yahoo.com', 'tertiary', 'free_dev', '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-a000-00000000000b', 'yahoo_finance_dev_market',    'market_data',    'https://finance.yahoo.com', 'tertiary', 'free_dev', '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-a000-00000000000c', 'finviz_dev_reference',        'reference_data', 'https://finviz.com',        'tertiary', 'free_dev', '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-a000-00000000000d', 'gdelt_article_discovery',     'article',        'https://api.gdeltproject.org/api/v2/doc/doc', 'tertiary', 'ephemeral', '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-a000-00000000000e', 'openfigi_reference',          'reference_data', 'https://api.openfigi.com/v3/mapping',         'secondary', 'free',   '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-a000-00000000000f', 'gleif_reference',             'reference_data', 'https://api.gleif.org/api/v1/lei-records',     'primary',   'public', '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-a000-000000000010', 'nasdaq_trader_reference',     'reference_data', 'https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt', 'primary', 'public', '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-a000-000000000011', 'stooq_market',                'market_data',    'https://stooq.com/q/d/l/',                    'tertiary',  'free',   '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-a000-000000000012', 'xang1234_stock_screener',     'reference_data', 'https://github.com/xang1234/stock-screener/releases/download/weekly-reference-data', 'tertiary', 'free', '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-a000-000000000013', 'xang1234_stock_screener',     'market_data',    'https://github.com/xang1234/stock-screener/releases/download/daily-price-data',     'tertiary', 'free', '2000-01-01T00:00:00Z')
on conflict (source_id) do nothing;
