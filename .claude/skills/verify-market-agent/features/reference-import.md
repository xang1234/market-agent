# Weekly reference import

The one scheduled ingestion path. It upserts about 10,000 listings from the weekly bundle, which carries names but no CIK, and must not move or duplicate existing identity.

## Sub-features

- `import-fresh` seeds an empty database.
- `import-skip` no-ops on a bundle the ledger already holds.
- `import-force` re-ingests through the upsert path.

## How to get to it (user POV)

It's a scheduled job, and has no UI. Its results show up as listings in search and screener facts.

## Driving it with scripts/verify

- **Fresh.** On an empty database, run `$V import`. The line reads `ingested` with `ingested=` matching `total=`.
- **Skip.** Run `$V import` again. It exits 3 and says `SKIPPED`.
- **Force, identity stable.** Run `$V identity save before`, `$V import --force`, `$V identity diff before`. The diff prints `identity unchanged`.
- **Spot check.** Run `$V resolve AAPL GOOGL MSFT`. Each keeps its CIK issuer.

## Gotchas

- Only a forced or first run exercises the upsert path. A skipped run proves nothing about it.
- `tickers_on_several_mics` is reported rather than failed, since a dual listing can be legitimate. Compare it with `identity diff`.
