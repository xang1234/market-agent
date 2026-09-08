# Living investment theses

Approved direction: the user selected idea 1 from the project improvement review.

## Product

A single-company agent can own a versioned thesis containing 1–5 explicit conditions. Each condition states what the user believes, what would disconfirm it, and the expected horizon. Conditions are editable before saving. A model can suggest narrative conditions from the user's thesis; suggestions have no side effects until saved. Optional numerical conditions compare one existing financial metric with an explicit threshold, unit, reporting period, and freshness limit.

After each manual or scheduled run, the agent presents supported, challenged, or unresolved conditions with explanations and inspectable evidence. Model unavailability is a failed assessment, never fabricated support. Missing eligible evidence produces unresolved. Original assessments remain attached to their original thesis version. Repeated identical evidence is quiet; changed evidence and amendments are reassessed. New supported/challenged states generate ordinary Home findings and use the existing alert rules. Unchanged states and unresolved assessments remain visible in the assessment history without noisy alerts.

Analyze provides a Monitor this thesis handoff carrying the company and editable memo text to the Agents form. Saving a thesis is an explicit user action. Existing agents without structured conditions retain their current workflow.

## Scope and implementation boundaries

Extend services/agents, services/dev-api, and the existing web Agents/Analyze surfaces. No new service, framework, broker integration, or data provider. First version is single-company only to prevent mixing companies' evidence. Numerical comparisons operate only on available authoritative facts and do not infer numerical values from narrative claims. Narrative evaluation sees structured claims, never raw documents. All narrative citations must belong to the supplied evidence packet.

A new thesis version captures the agent's thesis text, canonical issuer subject, and conditions. Saving takes an expected version and locks the agent to prevent lost updates. Editing a versioned agent's subject or thesis through the legacy editor is rejected; users edit its thesis through the new panel. Access is always scoped by the agent owner.

Assessment records contain the version, run, snapshot, input fingerprint, model/prompt version, and condition results. Version plus fingerprint is unique. Immediate repetitions of the current packet reuse the recorded assessment. The input fingerprint includes a previous-assessment transition suffix so an A→B→A evidence recurrence produces a new history entry. The fingerprint includes condition/version identity, evidence IDs, model configuration identity where available, and the assessment date to recheck freshness. Stale conclusions are not carried forward as new evidence. No model calls run inside a database transaction. Version-currentness is checked under the agent lock before assessment side effects.

Evidence snapshots and assessment history must be committed with findings and watermarks in the existing transaction. Inspector authorization includes owner-visible thesis assessments. The record stores citations, not private raw documents. Agent deletion cascades its versions and assessments; erasure follows existing agent ownership deletion.

## User interface

Add a selected-agent thesis panel with readable editor fields, optional metric checks, draft suggestions, save, condition statuses, assessment time/model/method, version history, and inspectable fact/claim citations. Show clear empty, saving, conflict, unavailable, and missing-data states. Refresh on completed manual runs. Requests must not leak stale data after switching agents or users. Analyze handoff uses the existing company identity and never asks users to type a UUID.

## Shared contracts

`ThesisCondition = { condition_id: string; statement: string; falsifier: string; horizon: string; metric?: { metric_key: string; unit: string; period_kind: 'point'|'fiscal_q'|'fiscal_y'|'ttm'; operator: 'gte'|'lte'; threshold: number; max_age_days: number } }`.

`ThesisVersion = { thesis_version_id: string; agent_id: string; version: number; thesis: string; subject_ref: {kind:'issuer';id:string}; conditions: ThesisCondition[]; created_at: string }`.

`ConditionAssessment = { condition_id: string; status: 'supported'|'challenged'|'unresolved'; reason: string; claim_refs: string[]; fact_refs: string[]; method: 'metric'|'model'|'no_evidence' }`.

`ThesisAssessment = { assessment_id: string; thesis_version_id: string; run_id: string; snapshot_id: string; input_hash: string; results: ConditionAssessment[]; model_version: string|null; prompt_version: string; assessed_at: string }`.

GET `/v1/agents/:id/thesis` -> `{thesis: ThesisVersion|null, versions: ThesisVersion[], assessments: ThesisAssessment[], metrics: {metric_key:string;label:string;unit:string;period_kind:string}[]}` (latest 20 assessments, latest 20 versions). PUT same route body `{expected_version:number, thesis:string, conditions:ThesisCondition[]}` -> `{thesis:ThesisVersion}`. POST `/v1/agents/:id/thesis/draft` body `{thesis:string}` -> `{conditions:ThesisCondition[]}`. 401 unauthenticated, 404 non-owned/missing agent, 400 malformed, 409 stale version or incompatible universe, 503 unavailable model/runtime.

## Acceptance

1. Opposing narrative conditions can receive opposite assessments from the same cited evidence; polarity alone does not determine the answer.
2. Unsupported/foreign citations, malformed results, missing condition rows, and duplicate condition rows fail validation.
3. No eligible evidence => unresolved; stale/wrong-unit/wrong-period facts never support a metric check. Finite values are compared in declared units using scale.
4. New evidence, amended evidence, changed thesis versions, and freshness expiry trigger assessment; identical packets do not duplicate findings.
5. A thesis edit during a run prevents old-version side effects. Cross-user reads/writes and source inspection are denied.
6. Save/reload, draft/edit/save, run/inspect, and Analyze handoff work in the web UI.
7. Tests cover parser/evaluator behavior, real database persistence and transactional integration, HTTP authorization, and UI actions; web build and lint pass.
