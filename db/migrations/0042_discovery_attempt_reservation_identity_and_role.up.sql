alter table discovery_attempts
  add column reserved_worker_id text,
  add column reserved_lease_epoch bigint check (reserved_lease_epoch is null or reserved_lease_epoch >= 0),
  add column model_role text check (model_role is null or model_role in ('analyst','skeptic'));

-- Existing role labels are not inferable from operation text, so retain their
-- outcomes and charges while clearing the unprovable protected designation.
update discovery_attempts set model_initial=false where model_initial;

-- Fence every pre-provenance live run before converting its reservation to a
-- durable unknown outcome. This invalidates an old worker before it can write.
with legacy_runs as (
  select distinct run_id from discovery_attempts where run_id is not null and outcome='reserved'
)
update discovery_runs r
set lease_epoch=lease_epoch+1,lease_owner=null,lease_expires_at=now()
from legacy_runs l where r.run_id=l.run_id;

update discovery_attempts
set outcome='unknown',completed_at=coalesce(completed_at,now())
where run_id is not null and outcome='reserved' and reserved_worker_id is null and reserved_lease_epoch is null;

alter table discovery_attempts
  add constraint discovery_attempts_initial_model_role
    check ((model_initial and model_role is not null) or (not model_initial and model_role is null));
