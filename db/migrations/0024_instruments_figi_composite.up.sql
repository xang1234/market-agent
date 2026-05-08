create unique index if not exists instruments_figi_composite_idx
  on instruments(figi_composite)
  where figi_composite is not null;
