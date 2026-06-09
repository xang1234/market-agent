create table research_grids (
  grid_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(user_id) on delete cascade,
  name text not null,
  description text,
  universe_spec jsonb not null,
  column_specs jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (created_at <= updated_at)
);

create table grid_runs (
  grid_run_id uuid primary key default gen_random_uuid(),
  grid_id uuid not null references research_grids(grid_id) on delete cascade,
  user_id uuid not null references users(user_id) on delete cascade,
  status text not null check (status in ('pending','running','partial','completed','failed')),
  as_of timestamptz not null,
  cell_total integer not null default 0,
  cell_done integer not null default 0,
  dropped_row_count integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table grid_rows (
  grid_row_id uuid primary key default gen_random_uuid(),
  grid_run_id uuid not null references grid_runs(grid_run_id) on delete cascade,
  row_number integer not null,
  subject_ref jsonb not null,
  period_context jsonb,
  status text not null check (status in ('pending','resolved','failed')),
  created_at timestamptz not null default now(),
  unique (grid_run_id, row_number)
);

create table grid_cells (
  grid_cell_id uuid primary key default gen_random_uuid(),
  grid_row_id uuid not null references grid_rows(grid_row_id) on delete cascade,
  grid_run_id uuid not null references grid_runs(grid_run_id) on delete cascade,
  column_key text not null,
  status text not null check (status in ('pending','ok','missing_data','no_coverage','error')),
  display jsonb,
  snapshot_id uuid references snapshots(snapshot_id),
  primary_ref jsonb,
  coverage_flag text,
  computed_at timestamptz,
  unique (grid_row_id, column_key)
);

create index research_grids_user_idx on research_grids(user_id);
create index grid_runs_grid_idx on grid_runs(grid_id, started_at desc);
create index grid_rows_run_idx on grid_rows(grid_run_id);
create index grid_cells_row_idx on grid_cells(grid_row_id);
create index grid_cells_snapshot_idx on grid_cells(snapshot_id);
