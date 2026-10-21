do $$
begin
  if exists (select 1 from financial_runs where allowed_source_classes <> '{sec_filing}') then
    raise exception 'financial runs recorded a grant beyond SEC filings; reverting 0070 would drop it';
  end if;
end $$;

create or replace function guard_financial_run_update() returns trigger
language plpgsql
as $$
begin
  if (new.user_id, new.parent_kind, new.parent_id, new.parent_version, new.request_key, new.request_hash,
      new.plan_id, new.feature_mode, new.knowledge_cutoff, new.policies, new.replay_of_run_id, new.created_at)
     is distinct from
     (old.user_id, old.parent_kind, old.parent_id, old.parent_version, old.request_key, old.request_hash,
      old.plan_id, old.feature_mode, old.knowledge_cutoff, old.policies, old.replay_of_run_id, old.created_at) then
    raise exception 'financial_runs identity, plan, and policy columns are immutable';
  end if;
  if old.execution_state in ('completed', 'failed', 'cancelled') and new.execution_state is distinct from old.execution_state then
    raise exception 'financial run % is terminal (%)', old.run_id, old.execution_state;
  end if;
  if new.lease_epoch < old.lease_epoch then
    raise exception 'financial run lease epochs never decrease';
  end if;
  return new;
end;
$$;

alter table financial_runs drop column allowed_source_classes;
