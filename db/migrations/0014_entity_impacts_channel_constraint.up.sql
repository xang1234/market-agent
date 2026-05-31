alter table entity_impacts
  add constraint entity_impacts_channel_check
  check (channel in ('supply', 'demand', 'inventory', 'curve_structure', 'freight', 'policy', 'macro_fx', 'weather', 'disruption'));
