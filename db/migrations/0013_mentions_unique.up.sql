with duplicate_mentions as (
  select
    (array_agg(mention_id order by mention_id))[1] as keeper_id,
    document_id,
    subject_kind,
    subject_id,
    prominence,
    sum(mention_count) as mention_count,
    max(confidence) as confidence
  from mentions
  group by document_id, subject_kind, subject_id, prominence
  having count(*) > 1
)
update mentions m
   set mention_count = duplicate_mentions.mention_count,
       confidence = duplicate_mentions.confidence
  from duplicate_mentions
 where m.mention_id = duplicate_mentions.keeper_id;

delete from mentions m
using (
  select
    (array_agg(mention_id order by mention_id))[1] as keeper_id,
    document_id,
    subject_kind,
    subject_id,
    prominence
  from mentions
  group by document_id, subject_kind, subject_id, prominence
  having count(*) > 1
) duplicate_mentions
where m.document_id = duplicate_mentions.document_id
  and m.subject_kind = duplicate_mentions.subject_kind
  and m.subject_id = duplicate_mentions.subject_id
  and m.prominence = duplicate_mentions.prominence
  and m.mention_id <> duplicate_mentions.keeper_id;

create unique index mentions_document_subject_prominence_idx
  on mentions(document_id, subject_kind, subject_id, prominence);
