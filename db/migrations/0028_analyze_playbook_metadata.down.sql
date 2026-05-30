drop index if exists analyze_template_runs_playbook_created_idx;
drop index if exists analyze_templates_user_template_idx;

drop index if exists analyze_template_runs_template_created_idx;
create index analyze_template_runs_template_created_idx
  on analyze_template_runs(template_id, created_at desc);

alter table analyze_template_runs
  drop constraint if exists analyze_template_runs_template_id_fkey;

alter table analyze_template_runs
  add constraint analyze_template_runs_template_id_fkey
  foreign key (template_id) references analyze_templates(template_id) on delete cascade;

alter table analyze_template_runs
  drop column if exists run_metadata,
  drop column if exists playbook_id;

alter table analyze_templates
  drop column if exists deleted_at;
