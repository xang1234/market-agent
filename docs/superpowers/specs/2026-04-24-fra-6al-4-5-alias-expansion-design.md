# fra-6al.4.5 Alias Expansion Across Identity Levels

## Context

`fra-6al.4.4` added issuer legal-name and former-name lookup. Today both paths return issuer candidates only. That is too narrow for common-name aliases such as `Google`, where users may expect both the canonical issuer and tradable listings, but broad expansion can also make precise legal-name searches noisy.

## Decision

Legal-name matches stay issuer-only. Former-name matches are treated as aliases/common names and expand to the issuer plus active related listing candidates.

This rule keeps exact legal-name hits deterministic while making aliases explicit about identity ambiguity. The resolver must not silently choose a share class or listing when an alias can plausibly mean issuer-level identity or a tradable subject.

## Candidate Rules

- `match_reason === "legal_name"` returns issuer candidates only.
- `match_reason === "former_name"` returns the issuer candidate and active listing candidates for that issuer.
- Active listing filtering follows existing ticker semantics: include listings where `active_from is null or active_from <= now()` and `active_to is null or active_to > now()`.
- Multiple listings or share classes remain separate candidates.
- Duplicate candidates are collapsed by `{kind}:{id}`, preserving the highest-confidence candidate.
- A single legal-name issuer hit may resolve.
- Alias expansion that yields issuer plus listing candidates returns `ambiguous`, normally with `issuer_vs_listing`.

## Confidence

Existing name confidence constants remain the base:

- Legal-name issuer: `CONFIDENCE_NAME_LEGAL`
- Alias issuer: `CONFIDENCE_NAME_FORMER`

Expanded listing candidates should rank below the alias issuer candidate. That preserves issuer-level alias intent while still surfacing tradable targets without collapsing identity distinctions.

## Data Flow

1. Normalize the input with the existing Unicode-aware `normalizeNameForLookup`.
2. Fetch legal-name and former-name rows from the current issuer-name CTE.
3. Filter rows in Node with the same normalizer.
4. Dedupe issuer name rows, preserving legal-name over alias for the same issuer.
5. Build issuer candidates.
6. For matched alias rows only, fetch active listings for the matched issuers.
7. Merge and dedupe candidates.
8. Return `resolved` only for a single issuer-only candidate; otherwise return `ambiguous`.

## Tests

Add resolver tests that prove:

- A legal-name match such as `Apple Inc.` still resolves to the issuer only.
- A common alias such as `Google` for `Alphabet Inc.` returns issuer plus listing candidates and does not silently pick one.
- A multi-listing alias returns all active listing candidates.

## Out of Scope

- Indexed alias lookup remains tracked by `fra-6al.4.6`.
- A first-class alias table with per-alias target kinds is not added here.
- Instrument expansion is not added unless the current schema can identify a useful instrument candidate without guessing. Listings are enough for the current Google/common-name verification case.
