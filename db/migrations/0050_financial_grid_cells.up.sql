-- Frozen grid runs and certified grid cells. A run freezes its column
-- instances (id, key, params, order) when it starts, so an edit to the grid
-- during execution cannot change what the run computes. Cells are keyed by
-- column instance: two instances of one column key with different params are
-- different cells. A verified numerical cell carries its financial run, unit,
-- certificate, and sealed block, written by the finalization transaction that
-- seals it.

alter table grid_runs add column column_instances jsonb check (column_instances is null or jsonb_typeof(column_instances) = 'array');
alter table grid_runs add column financial_mode text check (financial_mode in ('shadow', 'enforce'));

alter table grid_cells add column column_instance_id text;
update grid_cells set column_instance_id = column_key;
alter table grid_cells alter column column_instance_id set not null;
alter table grid_cells drop constraint grid_cells_grid_row_id_column_key_key;
alter table grid_cells add constraint grid_cells_row_instance_key unique (grid_row_id, column_instance_id);

alter table grid_cells add column financial_run_id uuid;
alter table grid_cells add column financial_unit_id text;
alter table grid_cells add column certificate_digest text check (certificate_digest is null or certificate_digest ~ '^[0-9a-f]{64}$');
alter table grid_cells add column financial_block jsonb;
alter table grid_cells add constraint grid_cells_financial_lineage check (
  (financial_run_id is null and financial_unit_id is null and certificate_digest is null and financial_block is null)
  or (financial_run_id is not null and financial_unit_id is not null and certificate_digest is not null and snapshot_id is not null
      and jsonb_typeof(financial_block) = 'object' and financial_block->>'kind' = 'financial_answer')
);
alter table grid_cells add constraint grid_cells_financial_certificate
  foreign key (snapshot_id, financial_run_id, financial_unit_id) references snapshot_financial_runs(snapshot_id, run_id, unit_id);
create unique index grid_cells_financial_unit_uidx on grid_cells(financial_run_id, financial_unit_id) where financial_run_id is not null;
