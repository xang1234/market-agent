drop table fact_review_actions;

alter table fact_review_queue
  drop constraint fact_review_queue_review_metadata_chk;

alter table fact_review_queue
  drop column fact_id,
  drop column reviewed_at,
  drop column reviewed_by;
