# Expand listing/instrument universes to their issuer when matching evidence

**Status:** accepted

Agents, watchlists, and other "universes" store `SubjectRef`s at whatever kind the user supplied — most commonly `listing` (the `/symbol/` UI and the default manual watchlist are listing-centric). Evidence claims, however, are attached at the subject the source data identifies — for SEC filings that is the `issuer` (resolved from the filer CIK). The agent delta query matches `claim_arguments` to a universe on an **exact** `(subject_kind, subject_id)` join with no bridging (`services/evidence/src/local-runtime-evidence.ts:101-104`). The result is a silent miss: an agent watching a listing never sees issuer-attributed evidence.

**Decision:** Evidence matching expands a universe's `listing` and `instrument` refs to also include their owning `issuer` in the `subject_refs` set before the `claim_arguments` join. New SEC insider/8-K claims therefore attach to the `issuer` only; listing/instrument universes still match them via the expansion. We do **not** widen `SubjectKind`, and we do **not** fan claims out across every listing at ingest time.

## Considered options

- **Per-ingest fan-out (rejected):** attach `claim_arguments` to the issuer *and* every active listing on each filing. Keeps the change inside the SEC epic but pays a permanent write-amplification cost on every ingest and leaves the latent gap unfixed for existing IR/news claims.
- **Issuer-only link, no expansion (rejected):** simplest, but breaks the flagship behavior ("agents raise insider findings") for the common listing-universe case.

## Consequences

- Fixes the gap once for **all** evidence (insider, 8-K, issuer-IR, news), so listing-based agents retroactively begin matching issuer-attributed claims — an intended behavior change that will increase findings for existing agents; cover it with tests before release.
- The expansion lives in the shared evidence delta path, so it is exercised by every agent run, not just the SEC slices. Belongs to its own issue, sequenced ahead of the Form 4 / 8-K agent-surfacing acceptance criteria.
