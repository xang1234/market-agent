-- fra-4ut: close the addThemeMembership race and add covering indexes for the
-- list ORDER BY. The unique constraint is the conflict target for
-- INSERT ... ON CONFLICT DO NOTHING RETURNING in services/themes/src/theme-repo.ts.

-- Dedupe legacy duplicate rows before enforcing the constraint. The
-- race this migration is fixing could already have produced
-- duplicates in environments that ran the prior schema, and the alter
-- table below would hard-fail on those rows. Keep the row with the
-- lexicographically smallest theme_membership_id per
-- (theme_id, subject_kind, subject_id) tuple — uuids from
-- gen_random_uuid() are not time-ordered, so this is an arbitrary
-- but deterministic tiebreaker. We accept the data loss on the
-- columns that diverge between duplicates (rationale_claim_ids,
-- score, effective_at) since the race that produced them already
-- meant the application couldn't distinguish "the" membership row.
delete from theme_memberships m
 using theme_memberships keeper
 where keeper.theme_id = m.theme_id
   and keeper.subject_kind = m.subject_kind
   and keeper.subject_id = m.subject_id
   and keeper.theme_membership_id < m.theme_membership_id;

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
