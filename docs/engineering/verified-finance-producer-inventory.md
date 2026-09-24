# Verified Finance — Baseline and Numerical Producer Inventory

Task T00 of the [verified financial-answer engine plan](../superpowers/plans/2026-09-23-verified-financial-answer-engine.md).
This file records the executable starting point and every numerical producer
reachable from the five integrated surfaces. It is a living record: later tasks
update the "Disposition" and "Covered by" columns with actual tests, not
optimistic labels.

## 1. Baseline

| Field | Value |
|---|---|
| Plan base (`feat/discovery-campaigns`) | `19c84e4f21358f99384e4f5984b9a5cc07bf480a` (verified ancestor of the implementation branch) |
| Implementation branch | `claude/charming-gauss-lhfz5s`, started from `main` at `a57b676` (merge of #108), plus a merge of the design/plan docs branch |
| Commits between plan base and `main` | `8285252` — Discovery review fixes (shortlist payload, model audit, incomplete candidates). No schema or `spec/` changes. |
| Node | `.nvmrc` = `22.19.0`; container runs `v22.22.2` |
| Frozen schema fixture | `db/test/fixtures/financial-base-19c84e4.sql` = `git show 19c84e4:spec/finance_research_db_schema.sql` (1,232 lines) |
| Last migration | `0045_discovery_quote_claim_refs` |

### 1.1 Corrections to the plan's baseline assumptions

The plan asked T00 to record where the actual tree differs from its
assumptions before editing. At both the plan base and `main`:

| Plan assumption | Actual tree | Consequence |
|---|---|---|
| Last migration is `0092_immutable_filing_evidence`; new migrations 0093–0095 | Last migration is `0045_discovery_quote_claim_refs` (90 files = 45 up/down pairs) | T05–T07 use **0046–0048** (renumbered together). |
| `db/package.json` does not exist | `db/package.json` exists (`apply:schema`, `migrate`, `seed`, `verify:schema`, `test`); CI runs `npm ci && npm test` in `db/` | DB tests may use either `npm test --prefix db` or the root Node runner. |
| `db/test/schema-migrations.test.ts`, `schema-openapi-alignment.test.ts`, `privacy-erasure.test.ts`, `background-agent-scaffold.test.ts` exist | None exist. DB tests are `apply-schema`, `chat-schema`, `discovery-schema`, `docker-pg`, `migrate`, `migration-registry`, `schema-support`, `seed` | T05–T07/T17/T28 create or substitute the equivalent tests (`migrate.test.ts` + `migration-registry.test.ts` for migration parity). |
| Canonical OpenAPI document to be located | `spec/finance_research_openapi.yaml`, aligned by `scripts/openapi-contract.test.ts` | T17/T29 reference financial HTTP schemas there and extend that alignment test. |
| `services/evidence/src/zero-export-erasure.ts`, `services/tools/src/erasure-tools.ts` | Not present | T15/T28 must first locate the real erasure/revocation writers (security gate: tests must target the production writer). |
| `services/dev-api/src/{api,main,sec-fact-writer,thesis-seal-input,thesis-finding-generator,discovery-wiring}.ts` | Not present. dev-api has `http.ts`, `local-runtime.ts`, `runtime.ts`, `thesis-adapter.ts`, `thesis-evidence.ts`, `thesis-finding.ts`, `thesis-runtime.ts`, `discovery-adapter.ts`, `discovery-http.ts`, `analyze-adapter.ts` | Later tasks map to these files. |
| `services/analyze/src/{section-seal,memo-run,run-metadata}.ts` | Not present; `runMetadata.ts`, `section-runner.ts`, `template-runner.ts`, `block-seal-input.ts` exist | T21 maps to these. |
| `web/src/blocks/{validate.ts,BlockRenderer.tsx,renderers/}` | Not present; `BlockValidator.ts`, `BlockView.tsx`, `Registry.ts`, flat renderer files | T16/T27 follow the flat layout. |

### 1.2 Baseline test results (this container)

| Suite | Command | Result |
|---|---|---|
| agents | `npm test --prefix services/agents` | 93 tests: 90 pass, 0 fail, 3 skipped (Docker-gated; daemon not persistent in this container) |
| snapshot | `npm test --prefix services/snapshot` | 110 pass, 0 fail |
| OpenAPI contract | `node --experimental-strip-types --test scripts/openapi-contract.test.ts` | 12 pass (requires `web` dependencies installed first; without them it fails with `ERR_MODULE_NOT_FOUND` for `js-yaml`) |
| web | `(cd web && npm run typecheck && npm test)` | typecheck clean; 661 pass, 0 fail |
| db harness | `node --experimental-strip-types --test db/test/docker-pg.test.ts` | 7 pass while `dockerd` was running |

`web/src/discovery/api.ts` imports `services/agents/src/exact-decimal.ts`, so the
web TypeScript build (`erasableSyntaxOnly`, `noUnusedLocals`) type-checks that
file and anything it imports. The shared exact-decimal module must therefore stay
dependency-free and pass the web compiler options.

## 2. Numerical producer inventory

Legend for **Disposition**: *engine* — migrate to the verified engine; *unsupported* —
under enforcement returns an explicit unsupported gap until the engine covers it;
*narrative* — stays non-certified and visibly labelled; *transport* — must carry only
committed values after enforcement.

### 2.1 Shared inputs and publication

| Producer / transport | Location | Current numeric handling | Disposition | Task |
|---|---|---|---|---|
| Issuer fundamentals reader | `services/fundamentals/src/issuer-fundamentals-reader.ts` | Selects active (`superseded_by is null`) facts; `numericOrNull` converts `value_num` to JS `number` | Legacy reader kept; strict decimal-string/historical reader added beside it | T08, T10 |
| SEC Company Facts adapter | `services/fundamentals/src/sec-edgar.ts` | `value_num: match.val` from parsed JSON (`number`) — income-statement oriented | Lossless parse at fetch boundary | T09 |
| Evidence fact repo | `services/evidence/src/fact-repo.ts` | Fact writes/reads | Strict input repo + attestations | T08 |
| Snapshot verifier | `services/snapshot/src/snapshot-verifier.ts` | Verifies refs/metadata; no numeric values or operands | Add DB-backed financial recomputation | T14 |
| Snapshot sealer / manifest staging / seal input | `services/snapshot/src/{snapshot-sealer,manifest-staging,seal-input}.ts` | Seals manifests | Certificate insertion in same transaction | T14, T15 |
| Block schema + web renderers | `spec/finance_research_block_schema.json`, `web/src/blocks/*` (`MetricRow`, `MetricsComparison`, `RevenueBars`, `Table`, `LabelValueCell`, `SeriesChart`, `LineChart`, `PriceTargetRange`, `AnalystConsensus`, `EpsSurprise`, `PerfComparison`) | Render model/fact values as provided | Add `financial_answer`; legacy blocks labelled legacy under enforcement | T16, T27 |

### 2.2 Chat

| Producer / transport | Location | Current numeric handling | Disposition | Task |
|---|---|---|---|---|
| Subject pre-resolution | `services/chat/src/local-runtime.ts` (`preResolveSubject`), `subjects.ts`, `subject-extraction.ts` | Single resolved subject, otherwise `screen` subject | Complete subject set or clarification | T11, T19 |
| Structured context loader (facts + quote) | `services/chat/src/local-runtime-structured.ts` | Loads issuer facts/latest quote into `structured_context` for the model | Engine inputs; raw values not surfaced pre-commit | T19, T20 |
| LLM prose composer | `services/chat/src/llm-runtime.ts` (`composeAnalystBlocksWithLlm`, `rewriteFirstRichTextBlock`) | Model writes free text replacing the first rich-text block — can emit any number | Bypassed for certified lane; optional interpretation labelled non-certified | T19 |
| Tool-call summaries | `llm-runtime.ts` (`summarizeToolCall`), `local-runtime.ts` (`writeLocalToolCallLogs`) | Tool results (including numeric facts) passed to model and logged | Transport; bind to plan/run hashes | T19, T20 |
| Thread titles | `services/chat/src/thread-title.ts` | Model-generated title may contain numbers | Transport; no draft values pre-commit | T20 |
| SSE / message persistence | `services/chat/src/{coordinator,sse,messages,http}.ts` | Streams deltas before sealing | Commit-aware publication | T20 |

### 2.3 Analyze

| Producer / transport | Location | Current numeric handling | Disposition | Task |
|---|---|---|---|---|
| Peer metrics comparison | `services/analyze/src/metrics-comparison-{emitter,materializer,block-builder,snapshot}.ts` | Materializes *derived facts* from key-stats; formats via `toFixed`; JS `number` | Engine (`peer_compare`, ratios) or unsupported; stop minting derived facts | T21 |
| Revenue bars | `services/analyze/src/revenue-bars-{emitter,block-builder,snapshot}.ts` | `Number(value_num) * Number(scale)` | Engine (`reported_metric` series) | T21 |
| Price target range | `services/analyze/src/price-target-range-emitter.ts` | Vendor estimate facts | Unsupported in certified lane (estimates are not reported facts) → narrative/legacy | T21 |
| Analyst consensus | `services/analyze/src/analyst-consensus-*.ts` | Vendor estimate facts | Unsupported in certified lane → narrative/legacy | T21 |
| Price facts | `services/analyze/src/price-fact-materializer.ts`, `current-price-source.ts` | Current quote → fact | Unsupported until market adapter proves timing/basis | T21 |
| Vendor fact helper | `services/analyze/src/vendor-fact.ts` | Writes vendor `value_num` | Legacy only | T21 |
| Seal merge | `services/analyze/src/seal-input-merge.ts` | Merges refs; takes max `as_of` | Strict merge path for certified sections | T21 |
| Section producers / runner / template runner | `services/analyze/src/{section-producers,section-runner,template-runner,runMetadata}.ts` | Orchestrates emitters + narrative | Numerical sections → engine plans | T21 |

### 2.4 Analyst grids

| Producer / transport | Location | Current numeric handling | Disposition | Task |
|---|---|---|---|---|
| `latest_market_cap` column | `services/analyst-grids/src/column-catalog.ts` | Latest active fact, `Number(row.value_num)` | Unsupported until market/share/timing proof | T22 |
| `latest_revenue`, `latest_eps_diluted` | `services/analyst-grids/src/fiscal-fact-column.ts` | Latest active fact, `format(Number(row.value_num))` | Engine (`reported_metric` at pinned cutoff) | T22 |
| Reader question column | `services/analyst-grids/src/reader-question-column.ts`, `reader-llm.ts` | Model prose over documents | Narrative (non-certified) | T22 |
| Progress counters | `services/analyst-grids/src/queries.ts`, `run-engine.ts` | Integer counts | Transport; requested/verified/gap/error counts | T22 |

### 2.5 Numerical thesis checks

| Producer / transport | Location | Current numeric handling | Disposition | Task |
|---|---|---|---|---|
| Thesis metric condition evaluation | `services/agents/src/thesis-evaluator.ts`, `thesis-types.ts` | Exact-decimal threshold compare × scale; period-end freshness | Engine `threshold` predicate, exact semantics preserved | T02, T23 |
| Thesis evidence packet | `services/dev-api/src/thesis-evidence.ts` | Reads `value_num::text`, active facts | Engine binding at cutoff | T23 |
| Findings/alerts | `services/agents/src/{finding-generator,finding-summary-blocks,alert-evaluator}.ts`, `services/dev-api/src/thesis-finding.ts` | Consume assessment transitions | Transport; meaningful-transition dedup preserved | T23 |

### 2.6 Discovery

| Producer / transport | Location | Current numeric handling | Disposition | Task |
|---|---|---|---|---|
| Financial packet provider | `services/discovery/src/providers/financials.ts` | Active facts, `value_num` as `DecimalInput` | Engine-bound packet inputs | T25 |
| Assessment numeric-token validation | `services/discovery/src/assessment-validation.ts` | Exact-decimal token checks (`parseExactDecimal`, `multiplyExactDecimals`) | Keep; add certified-result citation type | T25 |
| Metric checks in brief | `services/discovery/src/types.ts`, `validation.ts`; web `web/src/discovery/api.ts` | `isExactThresholdInput` | Versioned numerical criteria | T24 |
| Assessment/ranking/seal | `services/discovery/src/{assessment,selection,seal}.ts` | Model assessment + seal | Deterministic numerical outcomes authoritative | T26 |

## 3. Status

Only the baseline (this document and the frozen fixture) is recorded here. No
producer has been migrated; every row above remains on its legacy path.
