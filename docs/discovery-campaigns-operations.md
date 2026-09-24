# Discovery campaigns: safe rollout and operations

Discovery campaigns are an evidence-backed research workflow. They produce a
shortlist for review, not an investment forecast. A candidate is visible only
with its current source access and its sealed evidence snapshot. Model output is
never accepted without packet-bound citations.

## Release gate

`DISCOVERY_ENABLED=false` is the shipped default. Keep it false until all
deterministic checks pass and a human reviewer records ten assessment reviews
below. The release rule is at least nine acceptable reviews out of ten, zero
fabricated exposure claims, and 100% deterministic validity for citation,
identity, ownership, and budget checks. The human evaluation is pending; this
document does not assert a reviewer, a verdict, or a 9/10 result.

Review one primary and one counter source for each recorded assessment from the
three candidate-bearing fixture paths. Confirm that the cited text supports the
exposure statement, that the candidate is correctly identified and owned, and
that the counterargument is useful. The fixture assessment IDs, candidate IDs,
and source IDs below are stable review inputs, not human verdicts. Record the reviewer, verdict
(`acceptable` or `reject`), and a concise reason. A rejection for unsupported
exposure keeps the feature disabled until corrected and re-reviewed.

| # | Fixture / assessment ID | Fixture candidate ID | Primary / counter source refs | Reviewer | Verdict | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `power-infrastructure/northern-transformer` | `90000000-0000-4000-8000-000000000011` | `a2000000-0000-4000-8000-000000000011` / `a2000000-0000-4000-8000-000000000012` | Pending | Pending | Pending |
| 2 | `power-infrastructure/grid-coil-works` | `90000000-0000-4000-8000-000000000012` | `a2000000-0000-4000-8000-000000000013` / `a2000000-0000-4000-8000-000000000014` | Pending | Pending | Pending |
| 3 | `power-infrastructure/transmission-relay` | `90000000-0000-4000-8000-000000000013` | `a2000000-0000-4000-8000-000000000015` / `a2000000-0000-4000-8000-000000000016` | Pending | Pending | Pending |
| 4 | `industrial-automation/famous-consumer-platform` | `90000000-0000-4000-8000-000000000021` | `a2000000-0000-4000-8000-000000000021` / `a2000000-0000-4000-8000-000000000022` | Pending | Pending | Pending |
| 5 | `industrial-automation/legacy-conveyor` | `90000000-0000-4000-8000-000000000022` | `a2000000-0000-4000-8000-000000000023` / `a2000000-0000-4000-8000-000000000024` | Pending | Pending | Pending |
| 6 | `industrial-automation/manual-factory` | `90000000-0000-4000-8000-000000000023` | `a2000000-0000-4000-8000-000000000025` / `a2000000-0000-4000-8000-000000000026` | Pending | Pending | Pending |
| 7 | `supply-disruption/resilience-components` | `90000000-0000-4000-8000-000000000031` | `a2000000-0000-4000-8000-000000000031` / `a2000000-0000-4000-8000-000000000032` | Pending | Pending | Pending |
| 8 | `supply-disruption/qualified-supply` | `90000000-0000-4000-8000-000000000032` | `a2000000-0000-4000-8000-000000000033` / `a2000000-0000-4000-8000-000000000034` | Pending | Pending | Pending |
| 9 | `supply-disruption/local-production` | `90000000-0000-4000-8000-000000000033` | `a2000000-0000-4000-8000-000000000035` / `a2000000-0000-4000-8000-000000000036` | Pending | Pending | Pending |
| 10 | `supply-disruption/overseas-component-risk` | `90000000-0000-4000-8000-000000000034` | `a2000000-0000-4000-8000-000000000037` / `a2000000-0000-4000-8000-000000000038` | Pending | Pending | Pending |

## Configuration and readiness

Set configuration in the deployment secret store or an untracked `.env.dev`.
Do not put provider keys, model keys, or endpoint credentials in snapshots,
fixtures, reports, logs intended for sharing, or this document.

| Setting | Purpose |
| --- | --- |
| `DISCOVERY_ENABLED` | Explicit feature and worker gate. It defaults to `false`. |
| `DISCOVERY_WORKER_MODULE` | Absolute path to the deployment-owned module exporting `createDiscoveryWorkerDeps()`. It constructs the user-scoped Brave search, identity, evidence, financial, and model adapters. |
| `DISCOVERY_WORKER_POLL_MS` | Worker poll period; default `1000`, accepted range `1` through `60000`. |
| `DISCOVERY_SEARCH_API_KEY` | Credential for the configured Brave search adapter. |
| `LLM_CHANNELS` or the existing `LITELLM_*` / `LLM_*` settings | Existing model provider and model-routing configuration. |
| `SEC_EDGAR_USER_AGENT` and configured reference providers | Existing primary-source and reference adapters used by the worker composition. |

API readiness and worker readiness are different. The API can save a campaign,
approved brief, and run record through the authenticated `/v1/discovery/*`
routes. A worker can execute a queued run only when `DISCOVERY_ENABLED=true`,
the composition module exists, and that module can create its configured
providers. An absent model, search, or reference provider is surfaced as an
unavailable readiness/configuration condition; it must not silently use paid or
live fallback providers. Run the worker only after those dependencies are ready.

The `npm run worker` command is intentionally inert while the feature flag is
false. With the flag true, it rejects a missing or malformed composition module
at startup and leaves a clear `discovery-worker` log entry. This is a readiness
failure, not a reason to replace configuration with fixture data.

## Local operation

1. Copy `.env.dev.example` to an untracked `.env.dev`, keep
   `DISCOVERY_ENABLED=false`, and configure existing model/reference settings
   only in local secrets.
2. Start the normal group with `./scripts/dev-shell.sh up`. It reports
   `discovery off feature disabled` by default.
3. For an authorized local worker check, set the flag and the deployment-owned
   composition module, then use `./scripts/dev-shell.sh up` or run
   `npm run worker` inside `services/discovery`.
4. Use `./scripts/dev-shell.sh status` to inspect API services and the worker
   PID/log state. Use `./scripts/dev-shell.sh down` to stop dev services; it
   cleans up the worker PID with the other shell-owned processes and uses
   `compose stop`, preserving local database data.

Normal CI runs recorded synthetic fixtures and placeholder credentials only.
It does not run paid/live provider smoke tests. Any live smoke test is an
explicit, separate, manually authorized deployment check.

## Limits, recovery, and failures

Each provider attempt has a 30-second abortable timeout. A complete run has a
45-minute deadline. The model input cap is **64,000 serialized input
characters**, and the model output cap is **10,000 output tokens**. These are
not input-token limits. Initial, fallback, and repair attempts share the
metered attempt ledger; a malformed response or timeout cannot create an
unbounded retry path.

The worker checkpoints stages and fenced leases. After a restart, a replacement
worker resumes from the durable checkpoint and does not replay already committed
work. A provider call whose result was lost after dispatch is recorded as an
`unknown` attempt outcome. Treat it as charged and investigate the provider/log
record before manual recovery; do not assume it is safe to reissue. Cancellation
is durable and produces a `cancelled` terminal run. Budget or isolated provider
failure may produce `partial` with the completed work and coverage gaps retained
for inspection.

If a configuration error occurs, leave the feature off, correct the deployment
configuration, and start a new worker. Do not add permissive model/search
fallbacks or copy credentials into durable campaign data.

## Rollback

1. Set `DISCOVERY_ENABLED=false` and stop the discovery worker. Confirm no
   worker PID remains and that no run has a live lease.
2. Preserve campaign, attempt, event, quote, and snapshot evidence long enough
   for audit/recovery according to the normal retention policy.
3. Only then apply an approved schema rollback. Never roll back discovery
   schema while queued or running work can be claimed.
4. Re-enable only after the migration state, adapters, readiness, deterministic
   evaluation, and the human release table are verified again.

## Acceptance evidence map

| Spec sections | Implemented evidence |
| --- | --- |
| 1–2 | Tasks 1, 6, 7, and 8 persist versioned campaigns/briefs/runs; Task 10 full-path HTTP fixture test verifies approve → run → inspect. |
| 3 | Tasks 3, 5, and 8 enforce packet-bound citation, evidence, and dimension gates; Task 10 verifies fabricated-citation rejection and sealed snapshots. |
| 4 | Tasks 3, 4, 6, and 8 implement coverage/selection; Task 10 covers source dedupe, misleading-company exclusion, empty results, and stable rank. |
| 5 | Tasks 2, 4, 5, 6, and 9 provide role and learning behavior; Task 10 uses recorded analyst and skeptic responses. |
| 6 | Tasks 1, 2, 6, 8, and 10 enforce metering, retries, terminal states, exact input/output caps, timeout abort, partial, resume, and cancellation. |
| 7 | Tasks 1–3, 6, 7, and 10 provide provider/worker architecture; this runbook defines configuration and default-off deployment. |
| 8 | Tasks 1, 2, 6, and 7 provide ownership/version/fenced recovery; Task 10 verifies foreign-user denial and restart recovery. |
| 9 | Tasks 3, 5, 7, and 9 enforce source verification/lifecycle; Task 10 verifies snapshots and current authorized reads. |
| 10 | Task 7 supplies routes/DTOs; Task 10 verifies authenticated handler routing and OpenAPI inheritance. |
| 11 | Tasks 8 and 9 provide UI/handoffs; Task 10 regression checks preserve API/worker operations. |
| 12 | All tasks define exclusions; Task 10 checks famous unrelated and counterevidenced candidates remain excluded. |
| 13 | Deterministic Task 10 suites pass; the required human assessment table above remains pending. |
| 14 | Global caps, no-live-CI rule, default-off gate, and deployment rollback are documented and checked here. |
