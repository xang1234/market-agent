# Task 5 implementation report

## Delivered

- Independent Analyst and Skeptic assessment prompts use the same bounded packet. The Skeptic never receives Analyst output, and each model response is schema-validated before use.
- Cached raw role responses are revalidated against a newly loaded visible packet before quote persistence. Only normalized, validated role checkpoints are written.
- Excerpt citations must be canonical normalized 20–1,000 character source substrings. `canonicalCampaignQuotes` derives the canonical document offset from the excerpt offset plus the unique normalized match position; repeated source spans fail closed. `discovery_quote_claims` records the deterministic document/hash/offset/quote key and durable source-linked quote claim.
- Narrative criteria require independent agreement. Deterministic metric criteria use the shared evaluator and reject wrong currency, unit, period, scale, finite value, or freshness. Unknown financial context remains unknown and valuation is not ranked.
- Current primary evidence from both role exposure conclusions, a completed counter-search, and independent document-family evidence gate eligibility. Ranking uses exposure, evidence strength, business quality, then issuer UUID; it does not use valuation.
- Assessment commit acquires user/run/candidate locks, checks the live lease and current evidence visibility, seals through the same transaction client, then writes candidate assessment and snapshot together. Failed provenance verification rolls both back. A matching repeated completion returns the existing sealed snapshot without creating another one.

## Acceptance coverage

| Requirement / edge case | Test |
| --- | --- |
| Independent same-packet roles; Skeptic has no Analyst output; bounded prompt | `services/discovery/test/assessment-runner.test.ts` — `role prompts give Analyst and Skeptic the same packet without Analyst output` |
| Raw response validation, repair using original request identity, no third attempt | `assessment-runner.test.ts` — `assessment repairs...`; `an invalid repair stops...` |
| Control `operation_in_progress` propagates | `assessment-runner.test.ts` — `control errors propagate...` |
| Reload and revalidate before quote persistence/checkpoint | `assessment-runner.test.ts` — `reloaded evidence is revalidated...` |
| Fake/out-of-packet citation; malformed/duplicate/missing criteria | `assessment.test.ts` — `validator rejects a citation...`; `strict role validation...`; `skeptic output requires...` |
| Exact quote mismatch, canonical nonzero offset, ambiguous repeat rejection | `assessment.test.ts` — `strict role validation...`; `quote-claims.test.ts` (discovery) |
| Exact quote claim persistence and retry-safe idempotency | `services/evidence/test/campaign-claims.test.ts` |
| Unsupported prose numbers; fact dates/period numerics allowed only when cited | `assessment.test.ts` — `strict role validation...`; `numerical prose may refer...` |
| Narrative disagreement, both evidence-backed required failures | `assessment.test.ts` — `narrative disagreement...`; `two evidence-backed...` |
| Deterministic wrong currency/unit/scale/nonfinite/period/freshness facts | `assessment.test.ts` — `metric criteria use only canonical finite facts...` |
| Empty primary, stale/undated primary, both-role primary exposure, counter-search | `assessment.test.ts` — `primary evidence...`; `stale or undated...`; `completed counter-search...` |
| Distinct evidence families and syndication deduplication | `assessment.test.ts` — `second current substantive...`; `syndicated copy...` |
| 0/3/25 eligible candidates, UUID tie-break, valuation excluded | `services/discovery/test/selection.test.ts` |
| Source revocation prevents candidate mutation | `services/discovery/test/assessment-repo.test.ts` — `source revocation...` |
| Normalized checkpoint is separate from raw provider response | `assessment-repo.test.ts` — `validated role checkpoint...` |
| Matching repeated commit is idempotent | `assessment-repo.test.ts` — `repeated matching completion...` |
| Evidence-backed exclusion seals | `services/discovery/test/seal.test.ts` — `evidence-backed exclusion...` |
| Same-transaction snapshot verifier and atomic rollback in a real database | `services/discovery/test/assessment-repo.integration.test.ts` — `assessment sealing verifies real snapshot provenance and rolls back an invalid seal` |
| Consolidated schema, migration/rollback, and legacy 0042 upgrade | `db/test/discovery-schema.test.ts` |

## Verification

- Focused discovery assessment/prompt/ranking tests: 23 passed.
- Focused discovery sealing/commit/checkpoint tests: 7 passed.
- Evidence quote-ledger tests: 2 passed.
- Real PostgreSQL assessment commit integration: 1 passed. It first rejects a missing tool-log provenance reference and leaves candidate/snapshot unmodified, then succeeds after the matching tool log is inserted.
- Snapshot sealer/verifier/manifest tests: 80 passed.
- Agents thesis evaluator/types tests: 19 passed.
- Migration registry tests: 5 passed; its two Docker-gated apply-schema tests were skipped by their availability predicate.
- Discovery schema checks passed across runs: fresh consolidated schema and migration rollback passed in `/private/tmp/task5-discovery-schema-1.log`; legacy 0042 upgrade passed in `/private/tmp/discovery-task5-schema-upgrade-tmpfs.log`.

Raw red/green evidence is retained under `/private/tmp`, including `task5-assessment-red.log`, `task5-selection-red.log`, `task5-campaign-claims-red.log`, `task5-assessment-runner-red.log`, `task5-seal-red.log`, `task5-assessment-repo-red.log`, `task5-quote-offset-red.log`, `task5-reload-before-persist-red.log`, `task5-repeat-commit-red.log`, and their corresponding green logs.

The first broad schema retry encountered Docker storage exhaustion (`initdb: No space left on device in pg_wal`), not a schema assertion failure. The targeted 0042 retry used a temporary 256MB tmpfs PGDATA only for its disposable `discovery-schema-*` container and passed; no shared container was altered.

The final direct TypeScript check produced no diagnostics in Task 5 files. It remains nonzero because of existing transitive diagnostics in the shared DB harness, evidence, snapshot, tools, and `services/evidence/src/sec-edgar.ts:463`; raw output is `/private/tmp/task5-tsc-final.log`.

## Integration note for Task 6 / Task 7

Task 6 should compose `WorkerDeps.persistQuotes(lease, packet, raw, request)` by calling `canonicalCampaignQuotes(raw, packet)` and then `persistCampaignQuotes` with `request.operation_key` and `request.request_hash`. It must pass the current reloaded packet and the same `AssessmentQuoteRequest` to `AssessmentContext.persistQuotes(raw, packet, request)`. Task 7’s deletion reachability must include `discovery_quote_claims` and its `claim_id`, `document_id`, and `source_id` dependencies.

## Review fix round 1

- The quote ledger now locks and verifies the live, non-deleted document and its source in the same transaction before looking up a quote-key mapping. Both source identity and the canonical content hash must match the submitted quote.
- Canonical quote selection now looks for another occurrence at `index + 1`, so an overlapping repeat is rejected rather than given the first occurrence's locator.
- Numeric support now compares complete tokens. Signed, decimal, and grouped values are parsed as numbers only after their full literal grammar is validated; calendar dates remain exact date tokens. This rejects `2` from `2026` and `25` from `125` without rejecting valid formatted numerals.

### Review-fix evidence

- RED: `node --experimental-strip-types --test --test-name-pattern='numerical prose preserves signed' services/discovery/test/assessment.test.ts` failed as expected before the parser change. Raw log: `/private/tmp/task5-round1-numeric-red.log`.
- GREEN: the same focused numeric test passed after the parser change. Raw log: `/private/tmp/task5-round1-numeric-green.log`.
- Focused units passed: `node --experimental-strip-types --test services/discovery/test/assessment.test.ts services/discovery/test/quote-claims.test.ts services/evidence/test/campaign-claims.test.ts` — 20 passed. Raw log: `/private/tmp/task5-round1-focused-units.log`.
- Real PostgreSQL quote-ledger integration passed: `PATH=/private/tmp/discovery-test-bin:$PATH node --experimental-strip-types --test services/evidence/test/campaign-claims.integration.test.ts` — 1 passed. Its temporary Docker wrapper adds a 256MB tmpfs only for disposable `discovery-schema-*` and `discovery-campaign-claims-*` containers. Raw log: `/private/tmp/task5-round1-campaign-claims-integration.log`.
- Direct TypeScript check used `/Users/admin/Documents/Work/market-agent/.worktrees/discovery-campaigns-spec/web/node_modules/.bin/tsc`. It found no diagnostics in Task 5 files, but remains nonzero for existing `db/test/docker-pg.ts` diagnostics. Raw log: `/private/tmp/task5-round1-tsc.log`.

### Self-review

- The document identity check precedes every cache lookup and uses the transaction executor, so a stale source/hash cannot return an otherwise valid existing mapping.
- Overlap detection covers non-overlapping and overlapping duplicate quote locations.
- The numeric tokenizer cannot accept number substrings inside larger literals; tests cover `2`/`2026`, `25`/`125`, signed decimals, grouped decimals, and zero-padded dates.

## Review fix round 2

- Scientific notation is now recognized as a complete numeric literal. Numeric values are compared using a compact, lossless significand-and-decimal-exponent key, so a cited `1e3` supports `1000` without converting either source literal through floating point.
- Distinct unsafe integers retain their full digit strings; `9007199254740992` cannot support `9007199254740993`.
- Calendar dates remain exact tokens. Scientific exponents and effective decimal exponents are bounded to ±10,000, and more than 1,000 numerical literals in a checked text fail closed. The parser never expands a scientific value into a long decimal string.

### Review-fix evidence

- RED: `node --experimental-strip-types --test --test-name-pattern='scientific notation has lossless|numeric prose fails closed' services/discovery/test/assessment.test.ts` failed before the parser change. It reproduced unsupported `1e3` acceptance, unsafe-integer conflation, and missing scientific support. Raw log: `/private/tmp/task5-round2-numeric-red.log`.
- GREEN: the same focused regressions passed after the parser change. Raw log: `/private/tmp/task5-round2-numeric-green.log`.
- Affected discovery assessment coverage passed: `node --experimental-strip-types --test services/discovery/test/assessment.test.ts` — 16 passed. Raw log: `/private/tmp/task5-round2-assessment-final.log`.
- Direct source/test TypeScript check passed with `/Users/admin/Documents/Work/market-agent/.worktrees/discovery-campaigns-spec/web/node_modules/.bin/tsc`. Raw log: `/private/tmp/task5-round2-tsc-final.log`.

### Self-review

- Literal identity for claims and excerpts uses only validated strings and bounded decimal arithmetic; `Number()` is not used to compare source textual numerals.
- A supported scientific literal and its equivalent decimal form share a compact key, while different unsafe integers and signed values do not.
- Exponent bounds and the token cap reject adversarial input before any unbounded decimal expansion. Existing signed, grouped, decimal, and date regressions remain green.

## Review fix round 3

- The candidate scanner now treats `_` as part of a numeric-looking run and boundary. Unsupported underscore-separated literals are passed to the strict grammar as one token and fail closed, rather than being split into separately supportable fragments.
- Scanner boundaries also cover malformed underscore numerals adjacent to letters. This prevents a prefix or suffix from hiding the unsupported literal while retaining the explicit grammar for valid signed, grouped, decimal, scientific, and calendar-date values.

### Review-fix evidence

- RED: `node --experimental-strip-types --test --test-name-pattern='unrecognized whole literals' services/discovery/test/assessment.test.ts` failed before the scanner change. It accepted `1_000` using unrelated `1` and `0` source values. Raw log: `/private/tmp/task5-round3-numeric-red.log`.
- GREEN: the same regression passed after the scanner change. It covers `1_000`, repeated underscores, and letter-prefixed/suffixed forms. Raw log: `/private/tmp/task5-round3-numeric-green.log`.
- Affected discovery assessment coverage passed: `node --experimental-strip-types --test services/discovery/test/assessment.test.ts` — 17 passed. Raw log: `/private/tmp/task5-round3-assessment.log`.
- Direct source/test TypeScript check passed with `/Users/admin/Documents/Work/market-agent/.worktrees/discovery-campaigns-spec/web/node_modules/.bin/tsc`. Raw log: `/private/tmp/task5-round3-tsc.log`.

### Self-review

- Unrecognized underscore forms produce one invalid candidate and cannot become an empty token list or a collection of independently cited fragments.
- Existing signed, grouped, decimal, scientific, unsafe-integer, and exact-date regressions remain covered by the focused assessment suite.

## Review fix round 4

- `numericTokens` now keeps a byte-sized coverage map for ASCII digits. Calendar-date matches mark their digits; each complete numeric candidate marks its digits only after the strict literal grammar accepts it. A final linear scan fails closed when any digit was not covered, before `assertNumbersSupported` can accept an empty token list.
- The malformed-run regression table covers the review bypasses `_1_000`, `+_1_000`, and `_.1_000`, plus related prefix, sign, decimal-point, exponent, repeated-underscore, and chained-operator forms. They cannot reuse separate cited `1` and `0` tokens.

### Review-fix evidence

- Inherited RED coverage: `node --experimental-strip-types --test --test-name-pattern='numeric prose rejects malformed numeric runs' services/discovery/test/assessment.test.ts` was recorded as failing before the digit-coverage invariant. The prior temporary log paths named in the handoff were no longer present in this resumed shell, so no unavailable raw output is claimed here.
- GREEN command: `node --experimental-strip-types --test services/discovery/test/assessment.test.ts`
  - Raw result: exit 0; 17 tests passed, 0 failed, 0 skipped, 0 todo; duration 1075.43125 ms.
- Affected TypeScript command: `/Users/admin/Documents/Work/market-agent/.worktrees/discovery-campaigns-spec/web/node_modules/.bin/tsc --noEmit --target es2023 --module nodenext --moduleResolution nodenext --allowImportingTsExtensions --erasableSyntaxOnly --types node --skipLibCheck services/discovery/src/assessment-validation.ts services/discovery/test/assessment.test.ts`
  - Raw result: exit 0; no diagnostics.

### Self-review

- The invariant is O(n) in the checked text plus existing regexp work and stores one byte per character; it does not add a parser, dependency, or numerical-comparison behavior.
- Valid signed/grouped decimals, lossless scientific values, unsafe-integer distinction, and exact calendar dates remain exercised by the 17 focused assessment tests.
- The final scan covers digits that the candidate scanner intentionally cannot start on after `_`, `+`, or `-`, closing the prior fail-open empty-token path. It cannot mark a malformed candidate because marking occurs only after `canonicalNumericLiteral` succeeds.

## Quality review fixes: durable resume and fact freshness

- `AssessmentRoleProgress` and `loadValidatedRoleProgress` provide the typed durable resume boundary. A checkpoint contains normalized claim/fact citations only, the original role request hash, and the original model-packet hash. The assessment runner reloads current evidence and revalidates a stored checkpoint before it can invoke any missing role.
- `AssessmentQuoteRequest` carries the immutable role, operation key, request hash, and original packet hash through `AssessmentContext.persistQuotes` and `WorkerDeps.persistQuotes`. Quote persistence therefore does not reconstruct an identity from a packet that changed after the model request.
- A newly validated Analyst response is revalidated against a freshly loaded packet, normalized through persisted quote claims, revalidated again, and saved before the independent Skeptic request. A resume runs only the missing role. The Skeptic prompt remains derived from the original packet and never includes Analyst output.
- `createAssessmentCommitter` now rereads every cited fact in its lease/candidate transaction before sealing. It requires the exact fact ID/source ID mapping, visible source access, and null `invalidated_at` and `superseded_by`; any stale or absent fact aborts before snapshot creation or candidate mutation.

### Quality-fix verification

- RED: `node --experimental-strip-types --test --test-name-pattern='persisted Analyst checkpoint resumes|resumed checkpoint cannot authorize' services/discovery/test/assessment-runner.test.ts` failed before the runner change. The first failure observed no Analyst checkpoint after a Skeptic `operation_in_progress`; the second showed resume beginning with an Analyst call.
- GREEN: `node --experimental-strip-types --test services/discovery/test/assessment-runner.test.ts` — 8 passed. The new resume regression saves a normalized Analyst checkpoint before the nonterminal Skeptic failure, preserves the Analyst and Skeptic original request identities across quote persistence/reload, and confirms the resumed model sees only the Skeptic role. The revocation regression confirms that fresh claim visibility rejects a stored checkpoint before any model dispatch.
- RED: `PATH=/private/tmp/discovery-test-bin:$PATH node --experimental-strip-types --test --test-name-pattern='invalidated or superseded' services/discovery/test/assessment-repo.integration.test.ts` failed before the fact-currentness query with `Missing expected rejection` after an invalidated cited fact was committed.
- GREEN: the same disposable-PostgreSQL regression passed after the query. It invalidates a real cited fact, then supersedes that same fact, and verifies after each attempt that the candidate remains `researching` with no snapshot. The temporary Docker wrapper adds a 256MB tmpfs only to the `discovery-campaigns-*` container used by this test.
- Focused unit coverage: `node --experimental-strip-types --test services/discovery/test/assessment-runner.test.ts services/discovery/test/assessment-repo.test.ts` — 12 passed.
- Focused integration coverage: `PATH=/private/tmp/discovery-test-bin:$PATH node --experimental-strip-types --test services/discovery/test/assessment-repo.integration.test.ts` — 2 passed.
- Affected direct TypeScript check used `web/node_modules/.bin/tsc --noEmit --target es2023 --module nodenext --moduleResolution nodenext --allowImportingTsExtensions --erasableSyntaxOnly --types node --skipLibCheck` over the changed discovery source/tests. It reports only existing transitive diagnostics in `db/test/docker-pg.ts`, `services/discovery/test/db-fixture.ts`, and snapshot modules; it reports none in the Task 5 files.

### Task 6 composition

Task 6 must pass the leased `loadValidatedRoleProgress` callback and the original model packet into `AssessmentContext`. It must bind `WorkerDeps.persistQuotes` directly to `AssessmentQuoteRequest` rather than recomputing request or packet hashes. Current-source authorization comes from the freshly reloaded packet during assessment; the persisted checkpoint is only a normalized output and immutable request binding.
