drop trigger if exists source_publication_attestations_fixture_source on source_publication_attestations;
drop function if exists require_fixture_source_for_fixture_proof();
alter table source_publication_attestations
  drop constraint if exists source_publication_attestations_proof_method_check;
alter table source_publication_attestations
  add constraint source_publication_attestations_proof_method_check
  check (proof_method in ('controlled_public_fetch', 'provider_publication_mapping', 'accession_bound_archive'));
