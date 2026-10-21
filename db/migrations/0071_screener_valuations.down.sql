do $$
begin
  if exists (select 1 from financial_runs where parent_kind = 'screener_valuation_run') then
    raise exception 'refusing to drop certified screener valuations: screener runs exist';
  end if;
end $$;

drop table screener_certified_valuations;
drop table screener_valuation_runs;
delete from users where user_id = '00000000-0000-4000-8000-0000000005ee';

alter table financial_run_units drop constraint financial_run_units_unit_kind_check;
alter table financial_run_units add constraint financial_run_units_unit_kind_check
  check (unit_kind in ('chat_section', 'analyze_section', 'grid_cell', 'thesis_condition', 'discovery_assessment'));
alter table financial_runs drop constraint financial_runs_parent_kind_check;
alter table financial_runs add constraint financial_runs_parent_kind_check
  check (parent_kind in ('chat_thread', 'analyze_memo_run', 'analyst_grid_run', 'thesis_version', 'discovery_run'));
