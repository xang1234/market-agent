-- A financial run records the source classes its authority allowed when it was
-- reserved (#444). Binding uses that grant on every attempt, and the seal
-- re-checks each bound input's class against it. Every surface allowed SEC
-- filings only until #444 step 4, so a run reserved before this migration was
-- granted exactly that. The grant is immutable like the run's plan and policies.
alter table financial_runs add column allowed_source_classes text[] not null default '{sec_filing}'
  constraint financial_runs_allowed_source_classes check (
    cardinality(allowed_source_classes) > 0
    and allowed_source_classes <@ array['sec_filing', 'issuer_disclosure', 'licensed_fundamentals', 'market_data']::text[]
  );
alter table financial_runs alter column allowed_source_classes drop default;

create or replace function guard_financial_run_update() returns trigger
language plpgsql
as $$
begin
  if (new.user_id, new.parent_kind, new.parent_id, new.parent_version, new.request_key, new.request_hash,
      new.plan_id, new.feature_mode, new.knowledge_cutoff, new.policies, new.allowed_source_classes, new.replay_of_run_id, new.created_at)
     is distinct from
     (old.user_id, old.parent_kind, old.parent_id, old.parent_version, old.request_key, old.request_hash,
      old.plan_id, old.feature_mode, old.knowledge_cutoff, old.policies, old.allowed_source_classes, old.replay_of_run_id, old.created_at) then
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
