delete from fact_review_actions where review_id in (select review_id from fact_review_queue where kind = 'release_figure');
delete from fact_review_queue where kind = 'release_figure';
alter table fact_review_queue drop constraint fact_review_queue_review_metadata_chk;
alter table fact_review_queue drop column release_figure_id;
alter table fact_review_queue drop column kind;
alter table fact_review_queue add constraint fact_review_queue_review_metadata_chk check (
  (
    status = 'queued'
    and reviewed_by is null
    and reviewed_at is null
    and fact_id is null
  ) or (
    status = 'reviewed'
    and reviewed_by is not null
    and length(btrim(reviewed_by)) > 0
    and reviewed_at is not null
    and fact_id is not null
  ) or (
    status = 'dismissed'
    and reviewed_by is not null
    and length(btrim(reviewed_by)) > 0
    and reviewed_at is not null
    and fact_id is null
  )
);
drop table earnings_release_figures;
drop table earnings_release_quarters;
alter table claims drop column figures_read_at;
