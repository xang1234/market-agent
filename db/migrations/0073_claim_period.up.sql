-- The fiscal period a claim explains (#542), keyed as facts are: a quarter or
-- a year, and the date it ends. Both or neither: an unbound claim explains no
-- period a lookup can ask for.
alter table claims add column if not exists period_kind text;
alter table claims add column if not exists period_end date;
alter table claims drop constraint if exists claims_period_kind_check;
alter table claims add constraint claims_period_kind_check check (period_kind in ('fiscal_q', 'fiscal_y'));
alter table claims drop constraint if exists claims_period_pair;
alter table claims add constraint claims_period_pair check ((period_kind is null) = (period_end is null));
