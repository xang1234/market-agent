-- fra-4ut: close the addThemeMembership race and add covering indexes for the
-- list ORDER BY. The unique constraint is the conflict target for
-- INSERT ... ON CONFLICT DO NOTHING RETURNING in services/themes/src/theme-repo.ts.
alter table theme_memberships
  add constraint theme_memberships_theme_subject_unique
  unique (theme_id, subject_kind, subject_id);

create index theme_memberships_theme_score_idx
  on theme_memberships(theme_id, score desc nulls last, effective_at asc);
create index theme_memberships_subject_score_idx
  on theme_memberships(subject_kind, subject_id, score desc nulls last, effective_at asc);

-- The new covering indexes lead with the same column as the originals and
-- subsume their WHERE-only role, so the singletons are redundant.
drop index if exists theme_memberships_theme_idx;
drop index if exists theme_memberships_subject_idx;
