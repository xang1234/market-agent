-- When a rebind (extract:earnings-releases --rebind, #542) read an explanation
-- claim to bind it to its period, bound or not. A rebind selects only claims it
-- has not read, so a release that can never bind is read once; --retry clears
-- the mark on the unbound ones so the next rebind reads them again. Null = not
-- yet read. Its own column, not enriched_at, which marks a deterministic 8-K
-- claim a batch step has processed (0038).
alter table claims add column if not exists period_read_at timestamptz;
