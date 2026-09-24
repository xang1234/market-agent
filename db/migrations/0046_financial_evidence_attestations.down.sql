-- Refuses to destroy proof history. Production rollback stops new writers via
-- feature modes; this down path is only for empty development databases.
do $$
begin
  if exists (select 1 from source_publication_attestations)
     or exists (select 1 from fact_precision_attestations)
     or exists (select 1 from fact_financial_contexts) then
    raise exception 'refusing to drop financial evidence attestations: proof history exists';
  end if;
end;
$$;

drop view current_fact_precision_attestations;
drop view current_source_publication_attestations;
drop function normalized_content_hash(text);
drop table fact_financial_contexts;
drop table fact_precision_attestations;
drop table source_publication_attestations;
drop index facts_fact_source_uidx;
drop function prevent_financial_record_update();
