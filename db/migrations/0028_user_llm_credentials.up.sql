create table if not exists user_llm_credentials (
  user_id uuid not null references users(user_id) on delete cascade,
  role text not null check (role in ('summary', 'analyst', 'reader')),
  provider_id text not null check (length(provider_id) > 0),
  model text not null check (length(model) > 0),
  base_url text,
  reasoning_effort text check (reasoning_effort in ('off', 'low', 'medium', 'high', 'max')),
  key_ciphertext bytea,
  key_iv bytea,
  key_auth_tag bytea,
  key_fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, role),
  constraint user_llm_credentials_key_parts_consistent check (
    (key_ciphertext is null and key_iv is null and key_auth_tag is null)
    or (key_ciphertext is not null and key_iv is not null and key_auth_tag is not null)
  )
);
