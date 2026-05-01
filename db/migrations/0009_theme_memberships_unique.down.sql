create index theme_memberships_theme_idx on theme_memberships(theme_id);
create index theme_memberships_subject_idx on theme_memberships(subject_kind, subject_id);

drop index if exists theme_memberships_subject_score_idx;
drop index if exists theme_memberships_theme_score_idx;

alter table theme_memberships
  drop constraint if exists theme_memberships_theme_subject_unique;
