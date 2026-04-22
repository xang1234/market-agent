-- Minimal source registry. Each row is a provider/kind classifier used by facts.source_id
-- before individual documents are ingested. Fixed UUIDs anchor ON CONFLICT idempotency —
-- gen_random_uuid() defaults would silently duplicate rows on re-seed.
-- source_kind in ('filing', 'press_release', 'transcript', 'article', 'research_note', 'social_post', 'upload', 'internal')
-- trust_tier in ('primary', 'secondary', 'tertiary', 'user')

insert into sources (source_id, provider, kind, canonical_url, trust_tier, license_class, retrieved_at) values
  ('00000000-0000-4000-a000-000000000001', 'sec_edgar',     'filing',        'https://www.sec.gov/cgi-bin/browse-edgar', 'primary',   'public',   '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-a000-000000000002', 'sec_edgar',     'press_release', 'https://www.sec.gov/cgi-bin/browse-edgar', 'primary',   'public',   '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-a000-000000000003', 'issuer_ir',     'press_release', null,                                       'primary',   'public',   '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-a000-000000000004', 'issuer_ir',     'transcript',    null,                                       'secondary', 'public',   '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-a000-000000000005', 'yahoo_finance', 'article',       'https://finance.yahoo.com',                'tertiary',  'free',     '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-a000-000000000006', 'internal',      'internal',      null,                                       'primary',   'internal', '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-a000-000000000007', 'user_upload',   'upload',        null,                                       'user',      'user',     '2000-01-01T00:00:00Z')
on conflict (source_id) do nothing;
