do $$
begin
  if exists (select 1 from grid_cells where financial_run_id is not null) then
    raise exception 'refusing to drop certified grid cells';
  end if;
  if exists (select 1 from grid_cells group by grid_row_id, column_key having count(*) > 1) then
    raise exception 'refusing to restore one cell per column key: a run has repeated column instances';
  end if;
end;
$$;

drop index grid_cells_financial_unit_uidx;
alter table grid_cells drop constraint grid_cells_financial_certificate;
alter table grid_cells drop constraint grid_cells_financial_lineage;
alter table grid_cells drop column financial_block;
alter table grid_cells drop column certificate_digest;
alter table grid_cells drop column financial_unit_id;
alter table grid_cells drop column financial_run_id;
alter table grid_cells drop constraint grid_cells_row_instance_key;
alter table grid_cells add constraint grid_cells_grid_row_id_column_key_key unique (grid_row_id, column_key);
alter table grid_cells drop column column_instance_id;
alter table grid_runs drop column financial_mode;
alter table grid_runs drop column column_instances;
