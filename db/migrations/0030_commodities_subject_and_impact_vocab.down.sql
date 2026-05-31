alter table entity_impacts
  drop constraint if exists entity_impacts_channel_check;

alter table entity_impacts
  add constraint entity_impacts_channel_check
  check (channel in ('demand', 'pricing', 'supply_chain', 'regulation', 'competition', 'balance_sheet', 'sentiment'));
