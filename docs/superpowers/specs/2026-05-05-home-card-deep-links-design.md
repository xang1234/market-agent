# Home Card Deep Links Design

## Scope

This spec covers `fra-525`: deterministic Home card deep-link metadata and route helpers for symbol detail, theme, and Analyze destinations. It does not implement the full Home UI feed layout, market pulse, right rail, or secondary Home sections.

## Decision

Home cards route only through explicit destination metadata. No headline parsing or summary-text heuristics determine navigation. If destination metadata is missing or malformed, the card has no link and carries a structured reason.

## Service Contract

Extend `HomeFindingCard` with:

```ts
destination: HomeCardDestination
```

Destination variants:

```ts
| { kind: "symbol"; subject_ref: SubjectRef; tab: "overview" | "financials" | "earnings" | "holders" | "signals" }
| { kind: "theme"; subject_ref: SubjectRef & { kind: "theme" } }
| { kind: "analyze"; subject_ref: SubjectRef; intent: "memo" | "compare" | "general" }
| { kind: "none"; reason: string }
```

`finding-feed-repo` reads optional destination metadata from the finding row as `preferred_surface`. Current production `findings` rows do not yet have that column, so the repository selects `null as preferred_surface` until a later migration or producer bead adds it. Tests can still pass row fixtures with explicit `preferred_surface` to prove the parser and card contract. Missing metadata maps to `{ kind: "none", reason: "missing_destination" }`.

## Frontend Contract

Add `web/src/home/deepLinks.ts` with pure helpers:

- `homeCardPath(destination)` converts destination metadata into a route string or `null`.
- `symbol` destinations use `/symbol/:subjectRef/:tab`.
- `analyze` destinations use existing `analyzePathForSubject(subject_ref, intent)`.
- `theme` destinations return `null` with current routes because the app has no canonical theme route yet.
- `none` destinations return `null`.

## Validation

Invalid symbol tabs, Analyze intents, malformed subject refs, and non-theme theme destinations fail loudly in the service parser. This keeps bad producer metadata from silently sending users to the wrong surface.

## Testing

- A finding row with `preferred_surface: { kind: "symbol", tab: "earnings", subject_ref }` produces a Home card destination with the same tab and subject.
- Missing `preferred_surface` produces `kind: "none"` and `reason: "missing_destination"`.
- Invalid symbol tabs are rejected.
- `homeCardPath` maps symbol earnings destinations to `/symbol/<encoded-ref>/earnings`.
- `homeCardPath` maps Analyze memo destinations to `/analyze?subject=kind:id&intent=memo`.
- Theme and none destinations are non-links until a canonical theme route exists.

## Self-Review

- Placeholder scan: no placeholders remain.
- Scope check: service metadata and frontend route helper only; no Home UI layout work.
- Ambiguity check: missing metadata, invalid metadata, theme behavior, and tab selection are explicit.
