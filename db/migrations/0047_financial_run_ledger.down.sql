-- Refuses to destroy run history; production rollback uses feature modes.
do $$
begin
  if exists (select 1 from financial_runs)
     or exists (select 1 from financial_plans)
     or exists (select 1 from financial_definition_versions) then
    raise exception 'refusing to drop the financial run ledger: run history exists';
  end if;
end;
$$;

drop table financial_run_events;
drop table financial_run_inputs;
drop table financial_run_units;
drop table financial_runs;
drop table financial_plans;
drop table financial_definition_versions;
drop function guard_financial_run_unit_update();
drop function guard_financial_run_update();
