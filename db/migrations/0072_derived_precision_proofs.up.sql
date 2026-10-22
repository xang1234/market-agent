-- A derived quarter's precision proof is its derivation over its inputs'
-- tokens (#481); raw_token holds their exact sum. Nothing is backfilled.
alter table fact_precision_attestations add column if not exists derivation jsonb;
alter table fact_precision_attestations drop constraint if exists fact_precision_attestations_precision_class_check;
alter table fact_precision_attestations add constraint fact_precision_attestations_precision_class_check
  check (precision_class in ('source_token_preserved', 'revalidated_against_source', 'legacy_unverified', 'derived_from_source_tokens'));
alter table fact_precision_attestations drop constraint if exists fact_precision_attestations_derivation;
alter table fact_precision_attestations add constraint fact_precision_attestations_derivation
  check ((precision_class = 'derived_from_source_tokens') = (derivation is not null) and (derivation is null or jsonb_typeof(derivation) = 'object'));

create or replace view current_fact_precision_attestations as
select a.*
  from fact_precision_attestations a
 where not exists (select 1 from fact_precision_attestations newer where newer.supersedes = a.precision_attestation_id);
