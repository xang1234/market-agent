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

create function normalize_issuer_alias_name(alias_name text) returns text
language sql
immutable
as $$
  select btrim(
    regexp_replace(
      regexp_replace(lower(alias_name), '[^[:alnum:][:space:]]+', ' ', 'g'),
      '[[:space:]]+',
      ' ',
      'g'
    )
  );
$$;

create function refresh_issuer_aliases() returns trigger
language plpgsql
as $$
begin
  delete from issuer_aliases where issuer_id = new.issuer_id;

  insert into issuer_aliases (issuer_id, raw_name, normalized_name, match_reason)
  select new.issuer_id,
         new.legal_name,
         normalize_issuer_alias_name(new.legal_name),
         'legal_name'
   where normalize_issuer_alias_name(new.legal_name) <> ''
  on conflict do nothing;

  insert into issuer_aliases (issuer_id, raw_name, normalized_name, match_reason)
  select new.issuer_id,
         former_name.raw_name,
         normalize_issuer_alias_name(former_name.raw_name),
         'former_name'
    from (
      select value #>> '{}' as raw_name
        from jsonb_array_elements(new.former_names) as former_name(value)
       where jsonb_typeof(value) = 'string'
    ) as former_name
   where normalize_issuer_alias_name(former_name.raw_name) <> ''
  on conflict do nothing;

  return new;
end;
$$;

create trigger issuers_refresh_aliases
after insert or update of legal_name, former_names on issuers
for each row execute function refresh_issuer_aliases();

insert into issuer_aliases (issuer_id, raw_name, normalized_name, match_reason)
select issuer_id,
       legal_name,
       normalize_issuer_alias_name(legal_name),
       'legal_name'
  from issuers
 where normalize_issuer_alias_name(legal_name) <> ''
on conflict do nothing;

insert into issuer_aliases (issuer_id, raw_name, normalized_name, match_reason)
select i.issuer_id,
       former_name.raw_name,
       normalize_issuer_alias_name(former_name.raw_name),
       'former_name'
  from issuers i
  cross join lateral (
    select value #>> '{}' as raw_name
      from jsonb_array_elements(i.former_names) as former_name(value)
     where jsonb_typeof(value) = 'string'
  ) as former_name
 where normalize_issuer_alias_name(former_name.raw_name) <> ''
on conflict do nothing;
