-- The research scope an assistant message answered (#206): route, companies,
-- facets, fiscal year and price window, so a follow-up keeps what it does not
-- change. Null for user and tool messages, and for messages saved before it
-- was recorded.
alter table chat_messages add column research_scope jsonb;
