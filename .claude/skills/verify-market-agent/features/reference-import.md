# Weekly reference import

The one scheduled ingestion path. It upserts about 10,000 listings from the weekly bundle, which carries names but no CIK, and must not move or duplicate existing identity.

## Sub-features

- `import-fresh` seeds an empty database.
- `import-skip` no-ops on a bundle the ledger already holds.
- `import-force` re-ingests through the upsert path.

## How to get to it (user POV)

It's a scheduled job, and has no UI. Its results show up as listings in search and screener facts.

## Driving it with scripts/verify

- **Fresh.** On an empty database, run `$V import`. The line reads `ingested` with `ingested=` matching `total=`, and the `fill-ciks:` line after it shows most issuers `filled`.
- **Skip.** Run `$V import` again. It exits 3 and says `SKIPPED`.
- **Force, identity stable.** Run `$V identity save before`, `$V import --force`, `$V identity diff before`. The diff prints `identity unchanged`.
- **Spot check.** Run `$V resolve AAPL GOOGL MSFT`. Each keeps its CIK issuer.

## Gotchas

- Only a forced or first run exercises the upsert path. A skipped run proves nothing about it.
- The CIK fill runs after a skipped import too. A rerun prints `filled=0`. On 2026-11-13 a fresh import of 10,054 listings filled 5,947 issuers, skipped 71 whose CIK another issuer held (mostly ETN and ETF sponsors filing many products under one CIK), and left 4,009 unmatched, mostly ETFs.
- `tickers_on_several_mics` is reported rather than failed, since a dual listing can be legitimate. Compare it with `identity diff`.
