create index documents_parent_idx
  on documents(parent_document_id)
  where parent_document_id is not null;

create index documents_conversation_idx
  on documents(conversation_id)
  where conversation_id is not null;
