do $$
begin
  if exists (select 1 from financial_run_inputs where price_observation_id is not null) then
    raise exception 'financial runs bound share prices; reverting 0069 would drop certified inputs';
  end if;
end $$;
alter table financial_run_inputs drop constraint financial_run_inputs_binding;
alter table financial_run_inputs drop column price_observation_id;
alter table financial_run_inputs add constraint financial_run_inputs_binding check (
  (binding_status = 'bound' and fact_id is not null and publication_attestation_id is not null
     and precision_attestation_id is not null and bound_payload is not null and payload_hash is not null and gap_reason is null)
  or (binding_status = 'gap' and gap_reason is not null and bound_payload is null and payload_hash is null)
);
drop table price_observations;
