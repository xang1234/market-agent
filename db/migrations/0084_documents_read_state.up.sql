-- How far each item of a 10-K was read (services/evidence/src/sec-10k-claims.ts),
-- keyed by item: {"1": {"state": "read"}, "1A": {"state": "cut", "prompts": 11,
-- "of": 13}}, with state one of read, unread, cut and not_found. Null for
-- documents that are no 10-K, and for a 10-K not yet sectioned.
alter table documents add column read_state jsonb check (read_state is null or jsonb_typeof(read_state) = 'object');
