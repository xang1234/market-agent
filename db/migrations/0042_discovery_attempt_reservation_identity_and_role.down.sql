alter table discovery_attempts
  drop constraint if exists discovery_attempts_initial_model_role,
  drop column if exists model_role,
  drop column if exists reserved_lease_epoch,
  drop column if exists reserved_worker_id;
