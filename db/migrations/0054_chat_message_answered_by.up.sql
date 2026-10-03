-- The model deployment (channel/model) that wrote an assistant message's
-- narrative (#183). Null for user and tool messages, for answers no model
-- wrote, and for messages saved before it was recorded.
alter table chat_messages add column answered_by text;
