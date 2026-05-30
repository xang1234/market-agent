alter table analyze_templates
  add column deleted_at timestamptz;

alter table analyze_template_runs
  drop constraint if exists analyze_template_runs_template_id_fkey;

alter table analyze_template_runs
  add constraint analyze_template_runs_template_id_fkey
  foreign key (template_id) references analyze_templates(template_id);

alter table analyze_template_runs
  add column playbook_id text,
  add column run_metadata jsonb not null default '{}'::jsonb;

drop index if exists analyze_template_runs_template_created_idx;

create index analyze_template_runs_template_created_idx
  on analyze_template_runs(template_id, created_at desc, run_id desc);

create index analyze_templates_user_template_idx
  on analyze_templates(user_id, template_id);

create index analyze_template_runs_playbook_created_idx
  on analyze_template_runs(playbook_id, created_at desc)
  where playbook_id is not null;
