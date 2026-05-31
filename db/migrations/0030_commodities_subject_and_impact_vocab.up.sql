alter type subject_kind add value if not exists 'commodity';
alter type subject_kind add value if not exists 'benchmark';
alter type subject_kind add value if not exists 'contract';
alter type subject_kind add value if not exists 'curve';
alter type subject_kind add value if not exists 'region';
alter type subject_kind add value if not exists 'delivery_point';
alter type subject_kind add value if not exists 'asset';
alter type subject_kind add value if not exists 'producer';
alter type subject_kind add value if not exists 'route';
alter type subject_kind add value if not exists 'market_theme';

alter type impact_horizon add value if not exists '1d';
alter type impact_horizon add value if not exists '1w';
alter type impact_horizon add value if not exists '1m';
alter type impact_horizon add value if not exists '3m';

alter table entity_impacts
  drop constraint if exists entity_impacts_channel_check;

alter table entity_impacts
  add constraint entity_impacts_channel_check
  check (channel in ('supply', 'demand', 'inventory', 'curve_structure', 'freight', 'policy', 'macro_fx', 'weather', 'disruption'));
