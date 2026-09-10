alter table discovery_attempts
  add column reserved_worker_id text,
  add column reserved_lease_epoch bigint check (reserved_lease_epoch is null or reserved_lease_epoch >= 0),
  add column model_role text check (model_role is null or model_role in ('analyst','skeptic')),
  add constraint discovery_attempts_initial_model_role
    check ((model_initial and model_role is not null) or (not model_initial and model_role is null));
