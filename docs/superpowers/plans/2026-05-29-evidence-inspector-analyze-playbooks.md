# Evidence Inspector And Analyze Playbooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a universal evidence inspector for snapshot-backed refs and upgrade Analyze from a thin template form into guided analyst playbooks with run history, reruns, and memo diffing.

**Architecture:** Add one evidence-inspection service module behind a narrow HTTP endpoint, then expose it in the web shell through an inspector provider and inspectable block affordances. Add an Analyze playbook contract in `services/analyze`, wire it through `services/dev-api`, and update `web/src/pages/AnalyzePage.tsx` to drive playbook selection, runs, history, and diffs through typed client helpers.

**Tech Stack:** TypeScript, Node `--experimental-strip-types`, React 19, Vite, `pg`, existing `Block[]`, `SnapshotManifest`, Evidence, Snapshot, Analyze, Dev API, and web shell patterns.

---

## Scope Check

This plan covers two related product improvements that share the same artifact and provenance plane:

- **Universal Evidence Inspector**: backend inspection API plus web inspection drawer and block renderer affordances.
- **Guided Analyze Playbooks**: service contract, backend route wiring, web workflow, run history, rerun, and diff.

They can ship independently. Tasks 1-4 deliver a complete evidence inspector. Tasks 5-8 deliver Analyze playbooks. Task 9 verifies the combined workflow.

## Critical Implementation Decisions

- Evidence Inspection is snapshot-scoped and artifact-safe: `POST /v1/evidence/inspect`, no raw blobs/body text/content hashes, generic 404 for unavailable evidence, and only `source`, `document`, `claim`, `event`, and `fact` refs in the first backend slice.
- Analyze playbooks are curated presets over executable `AnalyzeTemplate`s. Durable run creation still requires a UUID `template_id`; `playbook_id` is metadata and UI guidance, not the executable identity.
- Analyze run metadata is the rerun/comparison contract. Store versioned `run_metadata.schema_version = 1`; old malformed metadata stays viewable but is not rerunnable.
- Run history is user-scoped, paginated, and summary-only. Open and diff flows fetch full run detail by `run_id`; history rows do not include full `blocks`.
- Run diff has two layers: a drift summary for evidence/template/playbook changes and semantic block rows keyed by `data_ref.params.playbook_section_id`; do not add a server-side diff endpoint in this slice.
- Fresh create-run requests keep singular `subject_ref`; the server stores plural `run_metadata.subject_refs` after resolving the primary subject with template-added refs. Do not add public `subject_refs` yet.
- Historical runs survive template deletion. Templates are soft-deleted for ordinary app deletion, and reruns return `409` when the active template is gone.

## File Structure

### Evidence Inspector

- Create `services/evidence/src/inspector.ts`: query-backed inspection module. It accepts `{ user_id, snapshot_id, ref }`, validates snapshot membership, and returns a normalized inspection envelope for snapshot-manifest-backed refs: `source`, `document`, `claim`, `event`, and `fact`.
- Modify `services/evidence/src/index.ts`: export the inspector types and function.
- Create `services/evidence/test/inspector.test.ts`: unit tests using a stub query executor for validation, snapshot-membership checks, and row shaping.
- Modify `services/dev-api/src/http.ts`: add an `evidence.inspect` adapter and route `POST /v1/evidence/inspect`.
- Modify `services/dev-api/src/local-runtime.ts`: wire durable local runtime inspection by delegating to `loadEvidenceInspection`.
- Modify `services/dev-api/test/http.test.ts`: endpoint tests for missing auth, invalid refs, not found, and success.
- Modify `spec/finance_research_openapi.yaml`: add the `inspectEvidence` endpoint and Evidence Inspection schemas.
- Create `web/src/evidence/inspectionClient.ts`: typed fetch helper for `/v1/evidence/inspect`.
- Create `web/src/evidence/EvidenceInspectorProvider.tsx`: shell-wide context with `openInspection`, `closeInspection`, and selected inspection state.
- Create `web/src/evidence/EvidenceInspectorDrawer.tsx`: fixed right-side drawer for inspection details.
- Create `web/src/evidence/InspectableRef.tsx`: small button/span wrapper used by renderers.
- Create `web/src/evidence/inspectableRefs.ts`: shared schema-native ref extraction helper for rendered blocks.
- Create `web/src/evidence/inspectionTypes.ts`: shared web-side types for request, response, and view-model state.
- Create `web/src/evidence/inspectableRefs.test.ts`: helper tests for metric, rich-text, source, claim, event, document, and chart refs.
- Create `web/src/evidence/inspectionClient.test.ts`: client contract tests.
- Create `web/src/evidence/EvidenceInspectorProvider.test.tsx`: open/close/fetch state tests.
- Modify `web/src/shell/WorkspaceShell.tsx`: wrap shell content in `EvidenceInspectorProvider`.
- Modify `web/src/blocks/BlockView.tsx`: pass UI-level block inspection context to rendered blocks through provider context; block inspection should display block metadata locally and route evidence refs through `/v1/evidence/inspect`.
- Modify `web/src/blocks/RichText.tsx`, `web/src/blocks/MetricRow.tsx`, `web/src/blocks/Sources.tsx`: expose inspectable refs.
- Modify relevant block tests: `web/src/blocks/richText.test.ts`, `web/src/blocks/metricRow.test.ts`, `web/src/blocks/fixtures.test.ts`.

### Analyze Playbooks

- Create `services/analyze/src/playbook.ts`: built-in playbook definitions, request resolver, and validation helpers.
- Create `services/analyze/src/runMetadata.ts`: versioned run metadata schema, parser, serializer, and rerun compatibility helpers.
- Modify `services/analyze/src/index.ts`: export playbook and run metadata APIs.
- Create `services/analyze/test/playbook.test.ts`: unit tests for built-ins, request resolution, source-category defaults, and section layout.
- Create `services/analyze/test/runMetadata.test.ts`: unit tests for schema v1 serialization, parsing, and unsupported metadata handling.
- Modify `services/dev-api/src/http.ts`: add `GET /v1/analyze/playbooks`, `GET /v1/analyze/runs`, `GET /v1/analyze/runs/{runId}`, `POST /v1/analyze/runs/{runId}/rerun`, and accept `playbook_id` on `POST /v1/analyze/runs`.
- Modify `services/dev-api/src/local-runtime.ts`: include playbook metadata in generated memo blocks and run payloads.
- Modify `services/dev-api/test/http.test.ts`: playbook route, run creation, run listing, and user scoping tests.
- Modify `spec/finance_research_openapi.yaml`: add Analyze playbook, rerun, and run-history contracts and extend run metadata schemas.
- Create `web/src/analyze/playbooks.ts`: web-side client helpers and view model helpers.
- Create `web/src/analyze/runHistory.ts`: list, detail, rerun, and diff helpers.
- Create `web/src/analyze/runDiff.test.ts`: deterministic diff tests over `Block[]`.
- Modify `web/src/pages/AnalyzePage.tsx`: replace thin template picker with playbook picker, section preview, source policy controls, run history, rerun, and diff.
- Modify `web/src/pages/workflowSurfaces.test.tsx`: render and workflow tests for guided playbooks.

---

## Task Files

- [Task 1: Evidence Inspection Service Module](./2026-05-29-evidence-inspector-analyze-playbooks/task-1-evidence-inspection-service-module.md)
- [Task 2: Evidence Inspection HTTP Route](./2026-05-29-evidence-inspector-analyze-playbooks/task-2-evidence-inspection-http-route.md)
- [Task 3: Web Evidence Inspector Shell](./2026-05-29-evidence-inspector-analyze-playbooks/task-3-web-evidence-inspector-shell.md)
- [Task 4: Inspectable Block Renderers](./2026-05-29-evidence-inspector-analyze-playbooks/task-4-inspectable-block-renderers.md)
- [Task 5: Analyze Playbook And Run Metadata Service Contract](./2026-05-29-evidence-inspector-analyze-playbooks/task-5-analyze-playbook-and-run-metadata-service-contract.md)
- [Task 6: Dev API Playbook Routes And Run Metadata](./2026-05-29-evidence-inspector-analyze-playbooks/task-6-dev-api-playbook-routes-and-run-metadata.md)
- [Task 7: Guided Analyze Web Workflow](./2026-05-29-evidence-inspector-analyze-playbooks/task-7-guided-analyze-web-workflow.md)
- [Task 8: Durable Analyze Playbook Persistence](./2026-05-29-evidence-inspector-analyze-playbooks/task-8-durable-analyze-playbook-persistence.md)
- [Task 9: Combined Verification And Documentation](./2026-05-29-evidence-inspector-analyze-playbooks/task-9-combined-verification-and-documentation.md)
