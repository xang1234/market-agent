# Resolver

Tracking bead: `fra-6al.3` (P0.3 Identity & resolver service).

This package owns the deterministic boundary that converts lookup input
(user text, provider-origin identity records) into canonical finance
identity outputs: `issuer`, `instrument`, `listing`, or a typed `SubjectRef`.

## Current scope: `fra-6al.3.1` — resolver envelope

Types and constructors for the three-outcome response envelope that every
resolver call must return:

- `resolved` — one canonical target chosen confidently.
- `ambiguous` — multiple plausible targets; ranked candidates are returned
  without silently picking one.
- `not_found` — input normalizable but not mappable to a supported target.

No lookup, normalization, or HTTP wiring lives here yet — those are
`fra-6al.3.2`, `fra-6al.3.3`, `fra-6al.3.4` respectively.

## Usage

```ts
import { resolved, ambiguous, notFound, isResolved } from "./src/envelope.ts";

const envelope = ambiguous({
  candidates: [
    { subject_ref: { kind: "listing", id: "..." }, display_name: "GOOG", confidence: 0.55 },
    { subject_ref: { kind: "listing", id: "..." }, display_name: "GOOGL", confidence: 0.45 },
  ],
  ambiguity_axis: "multiple_listings",
});

if (isResolved(envelope)) {
  // envelope.subject_ref, envelope.canonical_kind are typed here
}
```

The constructor functions enforce invariants the TypeScript compiler can't:

- `confidence` must be a finite number in `[0, 1]`.
- `ambiguous` requires `>= 2` candidates; single-candidate or empty lists
  must use `resolved` or `not_found` instead.
- Candidates must be sorted by `confidence` descending.
- A `resolved` envelope's `alternatives` must not out-rank the chosen target.

## Tests

```bash
cd services/resolver
npm test
```
