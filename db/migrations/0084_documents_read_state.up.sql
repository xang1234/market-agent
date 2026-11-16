-- How far each item of a 10-K was read (services/evidence/src/sec-10k-claims.ts).
-- It is keyed by item, as in {"1": {"state": "read"}, "1A": {"state": "cut",
-- "prompts": 11, "of": 13}}. Each state is read, unread, cut or not_found. Null
-- for a document that is not a 10-K, and for a 10-K not yet sectioned.
alter table documents add column read_state jsonb check (read_state is null or jsonb_typeof(read_state) = 'object');

-- Before this column, a 10-K item counted as read once its claims had evidence,
-- so those items stay read and are not asked again.
update documents d
   set read_state = r.read_state
  from (select document_id, jsonb_object_agg(item, '{"state": "read"}'::jsonb) as read_state
          from (select distinct document_id, locator->>'item' as item
                  from claim_evidence
                 where locator->>'text_basis' = 'sec_10k_item_canonical_text.v1') items
         group by document_id) r
 where d.document_id = r.document_id;
