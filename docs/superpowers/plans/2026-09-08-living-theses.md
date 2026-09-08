# Living Theses Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or inline execution for tightly coupled integration. Steps use checkbox syntax.

**Goal:** Make the approved thesis monitoring feature usable end to end.
**Architecture:** Versioned thesis and assessment modules in services/agents; existing dev API supplies scoped endpoints and runtime; existing web surfaces supply editing and inspection.
**Tech Stack:** Existing TypeScript, Node >=22.19, PostgreSQL, React. No new dependencies.
**Spec:** docs/superpowers/specs/2026-09-08-living-theses-design.md

## Global Constraints

- First version is single-company only to prevent mixing companies' evidence.
- Numerical comparisons operate only on available authoritative facts and do not infer numerical values from narrative claims.
- Narrative evaluation sees structured claims, never raw documents.
- All narrative citations must belong to the supplied evidence packet.
- No model calls run inside a database transaction.
- Access is always scoped by the agent owner.
- Existing agents without structured conditions retain their current workflow.

## Task 1: Thesis contracts, persistence and evaluation

**Files:** Create services/agents/src/thesis-types.ts, thesis-repo.ts, thesis-evaluator.ts; db/migrations/0039_living_theses.up.sql and .down.sql; corresponding services/agents/test/thesis-*.test.ts. Do not edit existing runtime, API, or web files.

**Interfaces:** Use the exact shared types in the spec. Export `parseThesisConditions(value:unknown):ThesisCondition[]` and `ThesisValidationError`, `ThesisConflictError`, `ThesisNotFoundError` from thesis-types.ts. Export from thesis-repo.ts:
```ts
getCurrentThesis(db:QueryExecutor, agentId:string):Promise<ThesisVersion|null>;
saveThesis(db:QueryExecutor,input:{agent_id:string;user_id:string;expected_version:number;thesis:string;subject_ref:{kind:'issuer';id:string};conditions:ThesisCondition[]}):Promise<ThesisVersion>;
loadThesisHistory(db:QueryExecutor,input:{agent_id:string;user_id:string}):Promise<{thesis:ThesisVersion|null;versions:ThesisVersion[];assessments:ThesisAssessment[]}>;
findThesisAssessment(db:QueryExecutor,versionId:string,inputHash:string):Promise<ThesisAssessment|null>;
recordThesisAssessment(tx:QueryExecutor,input:Omit<ThesisAssessment,'assessment_id'|'assessed_at'>):Promise<ThesisAssessment>;
```
Save must transact and lock the owned agent, compare latest version to expected, insert a version, and synchronize agents.thesis. record runs inside caller's existing transaction; tables named `agent_thesis_versions`, `agent_thesis_assessments`. Assessment unique on `(thesis_version_id,input_hash)` and FK deletion cascades appropriately.

Evaluator interfaces:
```ts
type ThesisLlm={complete(input:{messages:ReadonlyArray<{role:'system'|'user'|'assistant';content:string}>;temperature?:number;maxTokens?:number}):Promise<{text:string;deployment?:{channel:string;model:string}}>};
type ThesisFact={fact_id:string;metric_key:string;value_num:number;scale:number;unit:string;period_kind:string;period_end:string|null;as_of:string;source_id:string};
type ThesisClaim={claim_id:string;text_canonical:string;[key:string]:unknown};
evaluateThesis(input:{thesis:ThesisVersion;claims:ReadonlyArray<ThesisClaim>;facts:ReadonlyArray<ThesisFact>;as_of:string;llm:ThesisLlm|null}):Promise<{results:ConditionAssessment[];model_version:string|null}>;
draftThesisConditions(llm:ThesisLlm,thesis:string):Promise<ThesisCondition[]>;
```
Export `THESIS_PROMPT_VERSION`. Narrative result JSON is `{results:[{condition_id,status,reason,claim_refs}]}` and all narrative conditions must occur exactly once; only supplied IDs allowed; support/challenge requires at least one citation. Empty claims produce unresolved without model invocation; a missing model when claims exist throws. Numerical checks select the latest eligible exact metric/unit/period, reject stale/nonfinite values and use value_num * scale. They report a non-numerical reason and fact_refs. Strict validation lengths: 1–5 conditions, UUID IDs unique, statement/falsifier 8–500 trimmed chars, horizon 1–120, metric_key and unit 1–100, finite threshold, integer max_age_days 1–730. Draft produces 3 narrative condition suggestions from the thesis, generated IDs server-side; do not persist.

- [x] Write behavioral tests first. Include opposing thesis assessments with controlled LLM responses, invented citations, omitted/duplicate results, empty evidence, metric threshold boundary, stale/wrong-unit/wrong-period and scale handling.
- [x] Run `node --experimental-strip-types --test test/thesis-*.test.ts` and confirm failure before implementation.
- [x] Implement contracts, SQL migration, repository and evaluator with focused modules. Use existing evidence transaction helper for save, no nested transactions for record.
- [x] Add real PostgreSQL tests using db/test/docker-pg.ts for version conflict, ownership, history and duplicate assessment persistence.
- [x] Run agents tests, commit only task files, record red/green evidence and concerns in report.

## Task 2: HTTP and runtime integration

**Files:** New services/dev-api/src/thesis-adapter.ts, thesis-evidence.ts, thesis-finding.ts and thesis-runtime.ts; modify http.ts and local-runtime.ts; evidence/inspector.ts authorization and local-runtime-evidence.ts cutoff; consolidated schema; integration and HTTP tests. Parent owns this task.
**Consumes:** Task 1's exact contracts. **Produces:** The three routes in the spec and version-aware agent execution.

- [x] Write route tests for 401/404/409/400 and successful versioned edit. The malformed-body test must fail before production routes are added.
- [x] Add optional `theses` adapter to DevApiAdapters, attach database-backed adapter in createServiceDevApiAdapters, route requests after authentication. Derive canonical single issuer from existing agent universe, never trust a client-supplied owner or subject.
- [x] Add runtime wrapper that loads current thesis once and selects thesis stages or the unchanged legacy stages. Bounded packet: at most 100 claims and the eligible facts for numerical condition keys. Load complete current active packet, not only never-seen claims; exclude superseded, deleted, private foreign and future evidence.
- [x] In analyze, fingerprint packet, look for persisted result, otherwise call evaluateThesis outside transaction. In side effects lock owned agent and verify current version, seal packet with tool/model provenance, persist result, compare prior states, emit only new supported/challenged states as findings. Derive relevance from matched condition rather than a fixed score. No duplicated findings on packet retry.
- [x] Extend inspector visibility to owned assessment snapshots. Ensure references exist in snapshot and are still permitted by evidence rules.
- [x] Integration-test save/run/repeat/change/version-edit conflict and source inspection using controlled model responses and real DB. Run current agents/dev-api/evidence related suites.

## Task 3: User interface and Analyze handoff

**Files:** New web/src/agents/thesisTypes.ts, thesisClient.ts, ThesisPanel.tsx and tests; modify AgentsPage.tsx and AnalyzePage.tsx; add focused handoff helper/test.
**Consumes:** Shared HTTP wire contract in spec. **Produces:** Editable conditions, optional metric checks, draft, assessment inspection and handoff.

- [ ] Write UI behavior tests for save payload, draft remains editable, failed request, switching agent, condition evidence click and Analyze handoff.
- [ ] Implement panel with accessible labels and existing styling. The GET response additionally includes optional `metrics: {metric_key:string;label:string;unit:string;period_kind:string}[]`, scoped available fact definitions. Select numeric checks through these human-readable labels and units, never require typing metric keys. Scope requests by user and agent; abort/ignore stale responses. Reset on selection. 20-item histories are bounded; label older versions on historical assessments. Use existing EvidenceInspector hook with snapshot and claim/fact refs.
- [ ] Mount panel for selected agent and refresh it after manual run completion. Refresh roster text after thesis save. Existing agent editing must guide versioned thesis edits to the new panel.
- [ ] Add Monitor this thesis action to completed single-company Analyze runs. Navigate with editable carried company/memo context; prefill Agents form without an automatic save. The user creates agent then drafts/saves its conditions.
- [ ] Run focused UI tests then web typecheck/lint/build and commit task files.

## Completion

- [ ] Review complete branch for source attribution, authorization, transactions, missing-data behavior and UI continuity.
- [ ] Update CONTEXT.md and README.md with supported flow and limitations, close tracking issue, create issues only for required follow-ups.
- [ ] Run relevant suites and real DB integration; capture genuine environmental skips as limitations.
- [ ] Rebase on current origin/main, synchronize beads, push feat/living-theses, verify branch tracking and clean worktree. Preserve unrelated original checkout changes.
