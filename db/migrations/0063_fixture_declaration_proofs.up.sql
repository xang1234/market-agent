alter table source_publication_attestations
  drop constraint if exists source_publication_attestations_proof_method_check;
alter table source_publication_attestations
  add constraint source_publication_attestations_proof_method_check
  check (proof_method in ('controlled_public_fetch', 'provider_publication_mapping', 'accession_bound_archive', 'fixture_declaration'));
create or replace function require_fixture_source_for_fixture_proof() returns trigger
language plpgsql
as $$
begin
  if new.proof_method = 'fixture_declaration'
     and not exists (select 1 from sources where source_id = new.source_id and provider = 'golden_fixture') then
    raise exception 'a fixture_declaration proof may only attest a golden_fixture source';
  end if;
  return new;
end;
$$;
drop trigger if exists source_publication_attestations_fixture_source on source_publication_attestations;
create trigger source_publication_attestations_fixture_source
before insert on source_publication_attestations
for each row execute function require_fixture_source_for_fixture_proof();
