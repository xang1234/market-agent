-- The Yahoo dev fundamentals source shared the GDELT registry row's id, so its
-- analyst facts and the memos citing them read as GDELT. GDELT ingest creates a
-- source row per article and never writes that id, so every use of it outside
-- the row itself is Yahoo's. A snapshot's manifest and the blocks citing it move
-- together: the inspector looks a block's source ref up in that manifest. Only a
-- whole JSON string matches, so prose quoting the id stays as written. A chat
-- row keeps its content_hash: that is compared only with its own stored value.
insert into sources (source_id, provider, kind, canonical_url, trust_tier, license_class, retrieved_at) values
  ('00000000-0000-4000-a000-000000000014', 'yahoo_finance_dev_fundamentals', 'reference_data', 'https://finance.yahoo.com', 'tertiary', 'free_dev', '2000-01-01T00:00:00Z')
on conflict (source_id) do nothing;

update facts
   set source_id = '00000000-0000-4000-a000-000000000014', updated_at = now()
 where source_id = '00000000-0000-4000-a000-00000000000d';

update snapshots
   set source_ids = replace(source_ids::text, '"00000000-0000-4000-a000-00000000000d"', '"00000000-0000-4000-a000-000000000014"')::jsonb
 where source_ids ? '00000000-0000-4000-a000-00000000000d';

update analyze_template_runs
   set blocks = replace(blocks::text, '"00000000-0000-4000-a000-00000000000d"', '"00000000-0000-4000-a000-000000000014"')::jsonb
 where blocks::text like '%"00000000-0000-4000-a000-00000000000d"%';

update chat_messages
   set blocks = replace(blocks::text, '"00000000-0000-4000-a000-00000000000d"', '"00000000-0000-4000-a000-000000000014"')::jsonb
 where blocks::text like '%"00000000-0000-4000-a000-00000000000d"%';

update citation_logs
   set source_id = '00000000-0000-4000-a000-000000000014'
 where source_id = '00000000-0000-4000-a000-00000000000d';
