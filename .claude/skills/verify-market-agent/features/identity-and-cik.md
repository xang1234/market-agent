# Issuer identity and CIK discovery

Searching a ticker gives one subject on one issuer, and a ticker imported without a CIK gains one, so fundamentals have coverage.

## Sub-features

- `resolve-known` resolves a ticker that has a CIK.
- `cik-fill` fills the CIK on the existing issuer, without a second listing or issuer.
- `other-mic` keeps the listing when Polygon's MIC differs from the bundle's (SPY: ARCX against XNYS).

## How to get to it (user POV)

Type a ticker in the search box. The web calls `POST /v1/subjects/resolve` per keystroke.

## Driving it with scripts/verify

Preconditions: the baseline, and a Polygon key in `.env.dev`. Pick tickers still marked `NO CIK` with `$V resolve`, because a fill only happens once per database.

- **Identity held.** Run `$V identity save before`, then `$V resolve AMD`, then `$V identity diff before`. The diff shows no `apple_issuers` or duplicate-ticker change.
- **CIK filled.** The `resolve` output shows AMD on its original issuer name with a number, not `NO CIK`.
- **Other MIC.** Run `$V resolve SPY`. It prints one row, on `XNYS`, with CIK 884394.
- **Fundamentals.** Open `/symbol/listing:<id>/overview` for the filled ticker in the browser. Stats load instead of a missing-coverage state.

## Gotchas

- Discovery on a CIK-less ticker runs at most once a minute per resolver process, and a restart resets that. A ticker that stays `NO CIK` right after a failure may just be waiting.
- `identity diff` moves when a resolve adds a ticker the database didn't hold, as with NVDA on a stack with no import. Run this recipe after an import, on tickers it seeded.
- Polygon calls aren't logged. Prove call counts with `services/resolver/test/http.test.ts`.
