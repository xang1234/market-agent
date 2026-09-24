-- Refuses to destroy certificates, results, or financial computations.
do $$
begin
  if exists (select 1 from snapshot_financial_runs)
     or exists (select 1 from financial_results)
     or exists (select 1 from computations where financial_run_id is not null) then
    raise exception 'refusing to drop financial publication records: certified history exists';
  end if;
end;
$$;

drop trigger financial_run_units_sealed_certificate on financial_run_units;
drop function check_financial_unit_certificate();
drop table snapshot_financial_runs;
drop function check_financial_certificate_unit();
drop table financial_results;
drop function guard_financial_result_update();
drop trigger computations_financial_immutable on computations;
drop function guard_financial_computation_update();
drop index computations_financial_run_uidx;
drop index computations_financial_node_uidx;
alter table computations drop constraint computations_financial_lineage;
alter table computations drop column output_hash;
alter table computations drop column definition_versions;
alter table computations drop column numeric_policy_version;
alter table computations drop column operation_version;
alter table computations drop column node_id;
alter table computations drop column financial_run_id;
