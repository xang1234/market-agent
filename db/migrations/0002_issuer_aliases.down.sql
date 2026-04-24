drop trigger if exists issuers_refresh_aliases on issuers;
drop function if exists refresh_issuer_aliases();
drop function if exists normalize_issuer_alias_name(text);
drop table if exists issuer_aliases;
