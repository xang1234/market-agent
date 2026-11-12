-- How long an assistant answer's turn worked, and when each plan event of
-- it was emitted (services/chat/src/work-summary.ts), so the answer keeps its
-- "Worked for" line after a reload. Null for user and tool messages, and for
-- answers saved before it was recorded.
alter table chat_messages add column work_summary jsonb;
