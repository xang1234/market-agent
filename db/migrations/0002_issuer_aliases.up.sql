create table issuer_aliases (
  issuer_alias_id uuid primary key default gen_random_uuid(),
  issuer_id uuid not null references issuers(issuer_id) on delete cascade,
  raw_name text not null,
  normalized_name text not null,
  match_reason text not null check (match_reason in ('legal_name', 'former_name')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index issuer_aliases_normalized_name_idx on issuer_aliases(normalized_name);
create unique index issuer_aliases_unique_idx on issuer_aliases(issuer_id, match_reason, raw_name);

insert into issuer_aliases (issuer_id, raw_name, normalized_name, match_reason)
select issuer_id,
       legal_name,
       btrim(regexp_replace(regexp_replace(lower(legal_name), '[^[:alnum:][:space:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g')),
       'legal_name'
  from issuers
on conflict do nothing;

insert into issuer_aliases (issuer_id, raw_name, normalized_name, match_reason)
select i.issuer_id,
       former_name.value,
       btrim(regexp_replace(regexp_replace(lower(former_name.value), '[^[:alnum:][:space:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g')),
       'former_name'
  from issuers i
  cross join lateral jsonb_array_elements_text(i.former_names) as former_name(value)
on conflict do nothing;
