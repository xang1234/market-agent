-- Each derived proof and every proof superseding it goes; a run bound to any
-- of them would lose its proof.
do $$
declare
  doomed uuid[];
begin
  with recursive chain as (
    select precision_attestation_id from fact_precision_attestations where precision_class = 'derived_from_source_tokens'
    union
    select a.precision_attestation_id from fact_precision_attestations a join chain c on a.supersedes = c.precision_attestation_id
  )
  select coalesce(array_agg(precision_attestation_id), '{}') into doomed from chain;
  if exists (select 1 from financial_run_inputs where precision_attestation_id = any(doomed)) then
    raise exception 'financial runs bound a derived precision proof, or one superseding it; reverting 0072 would orphan its proof';
  end if;
  delete from fact_precision_attestations where precision_attestation_id = any(doomed);
end $$;

drop view current_fact_precision_attestations;
alter table fact_precision_attestations drop constraint fact_precision_attestations_derivation;
alter table fact_precision_attestations drop constraint fact_precision_attestations_precision_class_check;
alter table fact_precision_attestations add constraint fact_precision_attestations_precision_class_check
  check (precision_class in ('source_token_preserved', 'revalidated_against_source', 'legacy_unverified'));
alter table fact_precision_attestations drop column derivation;
create view current_fact_precision_attestations as
select a.*
  from fact_precision_attestations a
 where not exists (select 1 from fact_precision_attestations newer where newer.supersedes = a.precision_attestation_id);
