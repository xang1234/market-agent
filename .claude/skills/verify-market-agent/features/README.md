# market-agent verification map

The maintained source for proving user-facing behavior on the `DEV_MODE=data` stack. Read this index, then use the matching file as the recipe.

## Baseline

- `$V doctor` passes, and it reports the checkout and commit you mean to test. `$V` is `.claude/skills/verify-market-agent/scripts/verify`, run from inside that checkout.
- `$V import` has seeded the listings.
- Never drive a stack this run did not start or check with `doctor`.

## Features

| Feature | File |
|---|---|
| Issuer identity and CIK discovery | [identity-and-cik.md](identity-and-cik.md) |
| Weekly reference import | [reference-import.md](reference-import.md) |
| Analyze memo with SEC evidence | [analyze-memo.md](analyze-memo.md) |

## Reporting

Record the commit, the command, and the output for each proof. Report an unreachable path with the command tried and the unmet precondition. Never weaken a journey to make it pass.
