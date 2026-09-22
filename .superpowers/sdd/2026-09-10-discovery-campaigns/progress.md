# SDD ledger — plan: docs/superpowers/plans/2026-09-10-discovery-campaigns.md

Implementation base: 3ab90e3. Branch feat/discovery-campaigns. User requests all subagents gpt-5.6-terra / xhigh.

## Preflight task checks
| Task | Internal consistency |
|---|---|
| 1 | Files, tests and deliverable agree: canonical types, validation, repository, fixtures. |
| 2 | Files, tests and deliverable agree: OperationRunner, CampaignModel, controlled router. |
| 3 | Files, tests and deliverable agree: Providers and EvidencePacket. |
| 4 | Files, tests and deliverable agree: DiscoveryPool and cohort. |
| 5 | Files, tests and deliverable agree: normalized decisions and commitAssessment. |
| 6 | Files, tests and deliverable agree: worker, checkpoints and lease. |
| 7 | Files, tests and deliverable agree: DiscoveryService and authorized views. |
| 8 | Files, tests and deliverable agree: campaign UI and API client. |
| 9 | Files, tests and deliverable agree: learning, exports and handoffs. |
| 10 | Files, tests and deliverable agree: integrated release gates. |

## Shared interface/file checks
| Tasks | Producer → consumer / shared boundary | Result |
|---|---|---|
| 1, 2 | canonical types, validation, repository, fixtures → task 2 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 1, 3 | canonical types, validation, repository, fixtures → task 3 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 1, 4 | canonical types, validation, repository, fixtures → task 4 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 1, 5 | canonical types, validation, repository, fixtures → task 5 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 1, 6 | canonical types, validation, repository, fixtures → task 6 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 1, 7 | canonical types, validation, repository, fixtures → task 7 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 1, 8 | canonical types, validation, repository, fixtures → task 8 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 1, 9 | canonical types, validation, repository, fixtures → task 9 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 1, 10 | canonical types, validation, repository, fixtures → task 10 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 2, 3 | OperationRunner, CampaignModel, controlled router → task 3 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 2, 4 | OperationRunner, CampaignModel, controlled router → task 4 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 2, 5 | OperationRunner, CampaignModel, controlled router → task 5 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 2, 6 | OperationRunner, CampaignModel, controlled router → task 6 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 2, 7 | OperationRunner, CampaignModel, controlled router → task 7 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 2, 10 | OperationRunner, CampaignModel, controlled router → task 10 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 3, 4 | Providers and EvidencePacket → task 4 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 3, 5 | Providers and EvidencePacket → task 5 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 3, 6 | Providers and EvidencePacket → task 6 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 3, 10 | Providers and EvidencePacket → task 10 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 4, 6 | DiscoveryPool and cohort → task 6 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 4, 10 | DiscoveryPool and cohort → task 10 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 5, 6 | normalized decisions and commitAssessment → task 6 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 5, 7 | normalized decisions and commitAssessment → task 7 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 5, 9 | normalized decisions and commitAssessment → task 9 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 5, 10 | normalized decisions and commitAssessment → task 10 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 6, 7 | worker, checkpoints and lease → task 7 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 6, 10 | worker, checkpoints and lease → task 10 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 7, 8 | DiscoveryService and authorized views → task 8 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 7, 9 | DiscoveryService and authorized views → task 9 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 7, 10 | DiscoveryService and authorized views → task 10 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 8, 9 | campaign UI and API client → task 9 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 8, 10 | campaign UI and API client → task 10 | Companion contract is canonical; shared edits sequenced and reviewed. |
| 9, 10 | learning, exports and handoffs → task 10 | Companion contract is canonical; shared edits sequenced and reviewed. |

## Rulings
Ruling: Execute implementation tasks sequentially with fresh subagents and task review, despite optional plan parallelism — the selected skill forbids concurrent implementers in one checkout — cost if wrong: longer elapsed time, no product scope change.
Ruling: All implementers and reviewers use gpt-5.6-terra with xhigh effort — explicit user preference supersedes skill model-tier guidance — cost if wrong: difficult findings may need additional review cycles.
Ruling: Documentation-only wording records the prior planning task, not an implementation prohibition — the user now explicitly authorized implementation — cost if wrong: reversible code on the dedicated feature branch.
Ruling: Human release evaluation remains a deployment gate; implement and test the full feature but keep it disabled until a human records the requested assessment review — an agent must not impersonate that reviewer — cost if wrong: activation is delayed.

## Progress
Tasks 1–10: pending.

Epic fra-jibi; task issues fra-jibi.1 through fra-jibi.10 created. Task1 in progress, agent /root/discovery_task1, BASE 3ab90e3. Baseline tests in progress before implementation.

Ruling: Add required request_hash to reserveAttempt input — durable request identity is required by the spec but missing from the proposed signature — cost if wrong: downstream callers need the explicit hash field.
Ruling: Validate metric shape with canonical thesis parser and metric_key existence against the metrics registry at brief save — no static thesis catalog exists, and absent company facts must remain unknown — cost if wrong: registry-supported but unavailable facts produce unresolved criteria.
Baseline: web typecheck and lint exit0; pre-existing useGridRun.ts:52 missing hook dependency warning. Dependency install reported existing audit findings; no dependency upgrades in scope.

Baseline database: npm ci --ignore-scripts && npm test, escalated Docker access, 54 pass/0 fail/0 skip, exit0 (292.7s). Task1 released to implement.

Baseline LLM: npm test, 23 pass/0 fail/0 skip, exit0.

Baseline web: npm test, 595 pass/0 fail/0 skip, exit0; full output web-baseline.log. Existing affected service dependencies installed using pinned locks.

Task1 implemented: 3b68b92; implementer reports18 pass/0 fail/0 skip. Review agent /root/discovery_review1 examining review-3ab90e3..3b68b92.diff. Not yet complete.
Task2 preflight: installed @earendil-works/pi-ai0.78.0 types.d.ts supports optional AbortSignal; providers/openai-completions.js forwards it to actual provider. No SDK upgrade required.

Task1 review: needs fixes (contract, request identity, phase budgets, ranks, deletion lock, fixtures). Fix round1 starting from3b68b92.
Ruling: Fix user-before-campaign deletion lock in Task1; keep snapshot/log reachability and user-erasure integration in Task7 where the plan explicitly assigns their files — Task1 has no snapshots yet and dependent lifecycle integration must be reviewed before release — cost if wrong: cleanup remains incomplete until Task7, feature stays disabled.
Task7 mandatory carry-forward: review1 erasure finding, discovery-owned snapshot/log cleanup and shared reachability checks; do not mark full feature complete without verification.

Task1: fix round1/5 implemented3b68b92..86cceaf;25 pass/0 fail/0 skip and strict contract compilation pass; scoped reviewer /root/discovery_review1_fix1 pending. Raw output task-1-round1-tests.log.

Task 1: complete (commits3ab90e3..86cceaf, review clean). Task7 cleanup obligation retained.
Task2: in progress; BASE86cceaf, issue fra-jibi.2.

Reviewed Task1 checkpoint pushed to origin/feat/discovery-campaigns at86cceaf.
Ruling: Require request_hash on OperationRunner.run/providerAttempt and CampaignModel.complete; add explicit attempt_number for repair — stable logical identity and a persisted second-attempt boundary are missing from proposed ports — cost if wrong: downstream callers must provide explicit identity/repair metadata. Raw cached responses are revalidated by role consumers; fallback and repair cannot create a third dispatch.
Task2 agent: /root/discovery_task2, model gpt-5.6-terra, effort xhigh.

Ruling: Task2 may extend attempt-repo and existing attempt schema with explicit initial-role metadata to enforce deadline and remaining initial-assessment floor under the reservation lock — split checks would race — cost if wrong: more storage metadata and migration changes, all covered by Task2 review.

Ruling: Keep timeout ownership in OperationRunner and allow executeAttempt dispatch(signal?) to forward its composed signal through router/client — avoids a second router timeout policy and preserves old dispatch() callbacks — cost if wrong: callback interface needs an optional signal and adapter regression tests.

Task2 implemented at1b9a4f8; review /root/discovery_review2 pending, package review-86cceaf..1b9a4f8.diff. Report/logs saved. Final focused restart regression passed after self-review fix. Task5 must revalidate cached role response before requesting bounded explicit repair2.

Task2 review needs fixes: Critical live duplicate reservation treated as unknown; Important protected initial floor must be per candidate and role. Fix round1 starts1b9a4f8. Pi SDK default transport retries verified0. Minor raw restart log NUL bytes to clean by rewriting valid complete output.
Ruling: Persist reservation ownership and unique initial role identity where required — distinguish a live duplicate from a prior-lease interruption and protect each candidate Analyst/Skeptic slot — cost if wrong: narrow additional schema/interface fields, reviewed with real concurrency regressions.

Task2 fix checkpoint: live-duplicate/role protection2 pass; recovery/fallback/research-error4 pass. Pending final checks/commit/re-review.
Task6 carry-forward: operation_in_progress is non-fallback, preserves checkpoint/candidate; stale operation recovery requires claimNextRun new epoch.
Task7 carry-forward: reuse OperationRunner with a discriminated draft scope, rather than copy metering. Lease scope loads run limits; draft scope uses fixed30s timeout and existing draft token/rate repository. Review this extension in Task7.

Task2: fix round1/5 implemented1b9a4f8..a47bb02; budget11/model-contract7/schema2/LLM-controls13 pass, typecheck pass, raw log regenerated NUL0. Scoped reviewer /root/discovery_review2_fix1 pending.

Task2 fix round1 review: original findings addressed, two new Important upgrade defects: model_initial legacy rows fail new role constraint; legacy reserved ownership NULL prevents recovery. Fix round2 pending froma47bb02.
Ruling: Migration must not invent legacy Analyst/Skeptic roles; retain charges, clear unproven initial-role designation, and fence affected run leases before classifying legacy reservations unknown — safe upgrade and bounded resume without role fabrication — cost if wrong: conservative reserved capacity may make old in-flight runs partial, recorded as a migration limitation.

Task2: fix round2/5 implementeda47bb02..6ae18f4; populated schema3/recovery5/model-contract7 pass plus source typecheck; scoped review pending.

Task 2: complete (commits86cceaf..6ae18f4, review clean after2 fix rounds).
Task3: in progress, BASE6ae18f4, issue fra-jibi.3.

Task3 agent /root/discovery_task3, Terra xhigh.
Ruling: SearchInput carries explicit operation key/hash/phase/candidate, SearchResult carries hits and hits_truncated; analogous adapter contexts allowed where required — original array-only/search-index port cannot meter correct phases or report overflow — cost if wrong: explicit downstream caller changes in Task4–6.
Task6/7 provider ownership check: user-scoped evidence/financial factories must be built per lease.user_id; never share one user provider instance process-wide. Task3 to document exact factory interfaces.
Reviewed Task2 checkpoint pushed at6ae18f4.

Ruling: FinancialReadResult exposes facts, missing_fields and coverage_gaps; other adapters carry explicit ProviderOperation, and discovery/assessment contexts carry run_id — array-only financial results cannot express missing data and callers need stable run-scoped keys — cost if wrong: downstream context/result changes, no product scope change.

Task3 metadata correction: PacketFact now retains canonical currency:string|null, satisfying existing source-unit/currency requirements; no aggregation added.

Task3 checkpoint:7 discovery-adapter and4 public-fetch tests green. Controller found SecEdgarClientConfig.fetch injection seam; requested pinned metered FetchLike transport for fetchSubmissions/filings, retaining parser/rate/user-agent. SEC discovery is required Task3 scope and cannot be deferred. JSON allowed only as bounded SEC metadata, not primary textual evidence.

Task3 implemented1ec8494; reviewer /root/discovery_review3 pending. Elevated evidence505/0/1(opt-in live SEC), resolver131/0/0; final focused discovery11/evidence14 pass. Strict affected-source compile: no changed-file diagnostics; transitive existing event-repo.ts317/sec-edgar.ts463 errors documented. Per-user factories mandatory Task6/7.

Task3 review checkpoint: Critical hex IPv4-mapped IPv6 private address bypass; Important persisted IR attestation missing on reload. Await full review before fixround1; not complete.

Task3 review: three open findings, fixround1/5 dispatched to originalimplementer from1ec8494. Also bound IR index discovery and honor remaining six-document capacity; no minors. Lease-user factory composition remains Task6/7 verified callsite obligation.

2026-09-12 resumed after user interruption. Original Task3 agent unavailable; fresh Terra xhigh /root/discovery_task3_resume continues fixround1 from1ec8494 plus preserved two uncommitted regression tests. No implementation restart.

Task3 fixround1/5 implemented1ec8494..342f65d, all3findings claimed fixed. RealPG evidence18/discovery5 pass, strictsource existingtransitive diagnostics only. Scopedreview /root/discovery_review3_fix1 pending.

Task 3: complete (commits6ae18f4..342f65d, reviewclean after1fixround). Threefindings addressed, nonewbreakage.
Task4 inprogress BASE342f65d, issuefra-jibi.4.

Reviewed Task3 checkpoint pushed342f65d. Task4 agent /root/discovery_task4 Terra xhigh.

Ruling: Keep Scout pool creation and cohort selection separate from cohort persistence; Task6 calls existing repo.commitCohort before research — Task6 already owns stage sequencing and avoids a duplicate Scout callback — cost if wrong: persistence ordering remains unverified until the Task6 integration test, feature stays disabled.

Ruling: Add required DiscoveryContext.canUseExisting(candidate) authorization callback before existing-record use — candidate DTO alone cannot establish current access to issuer-linked evidence — cost if wrong: one explicit composition boundary; Task6 must bind it to lease.user_id with current source checks, batch-loaded allowed.

Task4 implemented31ae5b6; /root/discovery_review4 pending diff342f65d..31ae5b6. Scout/cohort/contracts16, persistence2, budget3 pass; affectedsource strictcompileclean.

Task4 review needsfixes: provider-free existingreuse, primary-domain metadata loss, nonpersisted issuerduplicate merge, unresolved cohortacceptance. Fixround1 BASE31ae5b6.
Ruling: canUseExisting must validate current canonical identity/listing eligibility as well as evidence access before Scout reuses an existing identity without a provider call — resolves the reviewer finding while preserving the ban on trusting candidate identity fields — cost if wrong: Task6 callback has a stronger DB-validation contract; reuse is unavailable if verification fails.

Task4 fixround1/5 implemented31ae5b6..8dadd39; scout19/DB2/budget3 pass, strictsourcecompileclean. Scoped reviewer /root/discovery_review4_fix1 pending.

Task 4: complete (commits342f65d..8dadd39, reviewclean after1fixround). All4findings addressed, nonewbreakage. Task6 liveauthorization/canonicalcallback and cohort-before-research obligations retained.
Task5 inprogress BASE8dadd39 issuefra-jibi.5.

ReviewedTask4 checkpointpushed8dadd39. Task5agent/root/discovery_task5, Terraxhigh.

Ruling: Task5 may add typed validated-role checkpoint load/save context boundary and focused fenced assessment repository/storage — raw provider cache alone cannot establish normalized role checkpoint required by spec — cost if wrong: narrow extra persistent metadata and migration; must preserve stable request/packet identity and revalidation. CampaignModel already derives model_role, no duplicate input field or OperationRunner wrapper needed. Task5 owns transactional commitAssessment WorkerDeps implementation per companion, no independent snapshot attachment.

Task5 checkpoint: expanded assessment/metric/citation/control/selection edgecases green; realPG snapshot rollback and verifier path1pass. New discovery_quote_claims mapping lifecycle obligation carried toTask7. Pending compile/schema/sourcevisibility rollback/finalchecks.

Task5 DBvalidation environmentdiagnosis: DockerPG startup failed because initdb pg_wal No space left on device. No sharedcontainers/data deleted. Disposable diagnosticcontainer removed. Scoped /private/tmp/discovery-test-bin/docker adds tmpfs256MB only discovery-schema-* postgres15 containers. Outstanding0042upgrade test PASSED1/1 /private/tmp/discovery-task5-schema-upgrade-tmpfs.log; priorfirstschema log fresh+rollback2pass.
Ruling: Use ephemeral memory-backed PostgreSQL data directories for owned testcontainers while Docker disk is full — preserves realdatabase/schema checks without deleting sharedDockerdata — cost if wrong: consumes boundedRAM duringtests; does not validate disk-specific storage behavior.

Task5 implemented2c325eb; reviewer/root/discovery_review5 pending diff8dadd39..2c325eb. Report moved from accidentalrootlocation into canonicalSDDtask-5-report.md. Focused23+7+2/snapshot80/thesis19/realPG1pass;schema3 acrossruns; sourcecompile nonewdiagnostics existingtransitiveerrorsremain.

Task5 review needsfixes: quote same-tx document/source/hash identity, overlappingquoteambiguity, substringnumericsupport. Fixround1 from2c325eb originalagent. Review cross-task rankpersistence verified bycontroller in run-repo.ts104-120: livelease transaction checksuniqueranks1..10/candidatemembership thenallupdates+terminalstate. Task6 stillmust feedonlycommittedsealedassessments.

Resumed usercontinue afterinterruption duringTask5fixround1. Oldagent unavailable; /root/discovery_task5_resume Terraxhigh continues preserved7filefixdiff from2c325eb. InstalledSDDskill changedpath/version to openai-curated/superpowers/2f1a8948: separate spec thenquality reviews goingforward. CompletedTasks1-4 remainreviewedcomplete; no rerun. Task5 pendingfix will getspec recheck thenqualitygate.

Task5 fixround1 implemented2c325eb..241ed03 byresumeagent; focused20+realPG1pass, tscpreexistingdbhelperonly. Newinstalledworkflow: /root/discovery_spec5_fix1 checking3specgaps, then separatequalityreview. FullTask5package8dadd39..241ed03 available.

Task5 specfixround1: identity+overlap fixed; numeric remainsopen due unsupportedscientificnotation skipped and Number unsafeintegercollision. Fixround2 from241ed03 toresumeagent; exactlosslessboundedliteralcomparison required. NoDBchangesneeded. Qualitygate notstarted untilspecpass.

Task5 numericfixround2 committed85282ae; affectedassessment16pass, strictaffectedtscpass. Specscopechecking pending241ed03..85282ae, fullTask5package8dadd39..85282ae prepared.

Task5 specfixround2: scientific+unsafeintegerfixed; new1_000 splitfragmentfailopen. Fixround3 from85282ae toresumeagent, generalfailclosednumericcandidateboundary correction requested. Noqualityreviewyet.

Task5 fixround3 bd30daf, affectedassessment17pass/tscpass, spec recheckpending85282ae..bd30daf.

Task5 specfixround3: originalunderscorefixed butleadingunderscoreforms(_1_000,+_1_000,_.1_000) skipped beforeemptytokenreturn. FreshTerraxhigh /root/discovery_task5_numeric4 ownsround4 frombd30daf; generalfailclosedcandidate/preflight requested, noNLPscopeexpansion.

Usercontinue afterinterruption duringnumericround4; prioragent unavailable. /root/discovery_numeric4_resume Terraxhigh resumes2uncommittednumericfiles frombd30daf; lastRED extends++1/1+0, finaldigitcoverage approachrequested. No implementationrestart.

Task5 numericround4 committed7b431c5; digitcoverage invariant, affected17pass/tscpass. Specfixreview pendingbd30daf..7b431c5; fulltaskpackage8dadd39..7b431c5 prepared.

Task5 specgate PASS at7b431c5 (round4) no newfixbreakage. /root/discovery_quality5 separatequalitygate pending full8dadd39..7b431c5. Task5 notyetcomplete.

Task5 qualitygate needs2fixes: Analyst normalizedcheckpoint beforeSkeptic + read/resume; same-tx fact invalidation/supersession/identity check beforeseal. /root/discovery_task5_qualityfix Terraxhigh ownsfrom7b431c5. Numeric/quoteissuesreviewedclean retained. Minimal typedloadcheckpoint additions approved (existingrolecolumns), immutableoriginalpacket/hash preserved.

Task5 qualityfix committed92799f2 plusreport-indexcleanup c3c8bc2 (reportkeptignoredlocally). Runner/repo/contracts13pass +realPG2pass (discovery-campaigns-* tmpfs); tscnonewdiagnostics preexistingtransitives. Scopedqualityrereview pending7b431c5..c3c8bc2.

Task 5: complete (commits8dadd39..c3c8bc2, spec+qualitygatesclean). Specnumeric4fixrounds; quality1fixwave, noopenfindings. Task6inprogress BASEc3c8bc2 issuefra-jibi.6.

Resumed usercontinue: confirmed HEAD and origin atc3c8bc2; Task6 bead inprogress. Fresh /root/discovery_task6 Terra xhigh dispatched fromc3c8bc2, no implementation restart. Current SDD combined spec+quality task review applies goingforward.

Task6 progress: RED harness absence recorded; real DB/seal integration found missing minted claims at final seal. Implementer preserving immutable original model packet and fresh authorized seal packet. Task6 implementation/review pending.

Task6 implemented612c848; full discovery116/116 and focused post-suite recovery/terminal/auth/injection checks reported. Task6 review needsfixes: durable systemic provider failure classification; exact existing-lead provenance/current entitlement attestation; atomic or idempotently recovered cohort/assessment activity events. Minor: strengthen concurrent claim, runner operation_in_progress, exact-provenance/entitlement and postcommit-event tests. Fixround1/5 assigned originalimplementer from612c848.

Task6 fix round1/5: all I1/I2/I3/M1 addressed in2c6c4bf; full discovery129/129, PG repository+assessment20/20, recovery-event3/3, scoped rereview clean with no new Critical/Important.
Task 6: complete (commitsc3c8bc2..2c6c4bf, reviewclean after1fixround). Task7 inprogress BASE2c6c4bf issuefra-jibi.7.

Task7 implemented8f6d49c; discovery145/dev-api72active/lifecycle5/visibility4/openapi5 reported. Review needsfixes: persist secret-free model identity config at start; expose canonical metric options; strict malformed body/path400; complete OpenAPI response/error DTO schemas. Minors exact >90s worker-wait boundary and exact discovery namespace. Fixround1/5 assigned originalimplementer from8f6d49c.
Ruling: expose canonical metric registry through GET /v1/discovery/metric-options because the spec requires UI-readable options but does not name the endpoint — a small stable read route fits the existing API; cost if wrong: endpoint naming/versioning may need a compatibility alias later.
Ruling: campaign-created campaign_exact_quote claims are erased when their quote mapping is removed and they are no longer referenced by any remaining quote map, snapshot claim_refs, or event source_claim_ids — fulfills source-derived text erasure while preserving shared/reachable canonical evidence — cost if wrong: an unmodeled JSON/FK consumer could require expanding the reference check before deletion.

Task7 fix round2/5: closed response graph in1fba74a but Important4 remainsopen: executable contract misses schema primitive/nullability/enum/page/error semantics; campaign/run list cursor+limit undocumented and candidate state filter enum missing. No new breakage. Fixround3/5 assigned originalimplementer from1fba74a.

Task7 fix round3/5: route/page/error/major DTO semantics improved in95e5ba0, but Important4 remainsopen because reachable enum/const and primitive-array item schemas are not exhaustively asserted. No new breakage. Per breaker policy, fresh Terra xhigh implementer owns round4 from95e5ba0; explicit user model requirement prevents tier escalation.

Task7 fix round4/5: remaining Important4 addressed by exhaustive response-graph semantic manifest and mutation checks infa14bbe; scoped rereview clean, no new Critical/Important.
Task 7: complete (commits2c6c4bf..fa14bbe, reviewclean after4fixrounds). Task8 inprogress BASEfa14bbe issuefra-jibi.8.

Task8 implementedd45b5ba; focused11/fullweb606,typecheck/buildclean,lintpreexistingwarning. Review needsfixes: poll candidates/events with run; compare shortlist-to-shortlist; fence delayed start response on route change; validate source link scheme. Minors cancel pending state and complete keyboard tab semantics. Fixround1/5 assigned originalimplementer fromd45b5ba.

Task7 fix round1/5: Important1-3,Minor1-2 and lifecycle caveat addressed in08aac5d; Important4 open because OpenAPI success DTOs retain unrestricted object placeholders; no new breakage. Fixround2/5 assigned originalimplementer from08aac5d, scoped to exact browser-safe response schemas and contract assertions.

Task8 fixround1 committed41a5bf7; I2/I3/I4/M1/M2 addressed. I1 remained open at the terminal-poll boundary because only queued/running accepted polls refreshed candidates/events. Fixround2 assigned original implementer from41a5bf7.

Task8 fixround2 committed05bc893; every accepted poll including terminal transitions refreshes candidate groups and trail with existing abort/visibility/last-success guards. Focused16/16, typecheck/build pass, lint only known unrelated warning; prior full web614/614. Scoped rereview approved with no new Critical/Important breakage.
Task 8: complete (commitsfa14bbe..05bc893, reviewclean after2fixrounds). Task9 inprogress BASE05bc893 issuefra-jibi.9.

Task9 implementedc114aff; learning trail, cited export, Analyze/Agents handoffs and fresh authorization actions. Focused58/fullweb637, typecheck/build/lint green. Review needsfixes: cached export route/run privacy leak, non-shortlisted handoff falsely said shortlisted, and unsupported empty-condition financial explanation. Fixround1 assigned fresh Terra xhigh fromc114aff after original implementer capacity interruption.

Task9 fixround1 committedff70bcc; route/run export scoping and post-clipboard recheck, state-accurate handoff wording, neutral empty-condition copy. Focused32/fullweb642/typecheck/lint/build green. Scoped rereview left Critical open for direct same-route user switch because export state lacked userId; Important/Minor addressed. Fixround2 assigned original resume implementer fromff70bcc.

Task9 fixround2 committed766f46c; export cache bound to userId+campaignId+runId with pre-passive-cleanup account-switch regression. Focused33/typecheck/lint/build green; scoped rereview approved, no new Critical/Important breakage.
Task 9: complete (commits05bc893..766f46c, reviewclean after2fixrounds). Task10 inprogress BASE766f46c issuefra-jibi.10.

Ruling: Task10 repairs stale migration-test rollback setup to target schema versions 39 and 41 explicitly, plus a legacy fixture's current limits shape, rather than leaving a red release gate after 0043/0044 changed the number of later migrations. No migration SQL changes. Cost: narrow test maintenance, robust future migration coverage.
Ruling: Task10 adds the missing analyst-grids db-backed CI job because the CI inventory contract requires every package with a test script. Cost: increased CI duration, complete coverage.
Task10 verification: real full-path fixtures2/2, evaluation6/6, discovery HTTP7/7, worker CLI2/2, OpenAPI10/10, dev-shell11/11, CI contract9/9, analyst-grids103/103, DB57/57; LLM27/27 plus typecheck, Agents85 pass/3 skipped, Snapshot110/110, affected evidence/resolver/dev-api/analyze commands complete, web typecheck/build/lint exit0.
Task10 release gate: human evaluation table and operator instructions shipped; `DISCOVERY_ENABLED=false` remains pending human review.

Task10 fix round1 (review findings): strict fixture matcher now builds a concrete post-run ordered multiset from the recorded lead and rejects both a wrong candidate ID and duplicate call. Candidate fixtures now run raw recorded Brave hits through Scout, production canonical identity, production evidence/financial providers, the real worker and snapshot verifier; no `loadExisting` bypass. Fixture loader validates production brief/provider boundaries and review corpus has ten stable assessment inputs referenced by the Pending operator table. Identity attempts omit a pre-admission candidate FK while retaining deterministic operation keys. Actual malformed Analyst outputs traverse campaign-model repair and persist exactly two attempts per selected candidate; ranking repeats twelve permutations. RED/GREEN: E2E 4/4, evaluation 7/7, identity 3/3, serial full Discovery 167/167. An unconstrained parallel full command had 16 120-second PostgreSQL test cancellations (no assertion failures); every one passed in the serial authoritative gate. No Docker wrapper, prune, delete, stop, or shared `stockscreenclaude-*` action; no ENOSPC. Human gate remains pending and feature false.

Task10 fix round2 (rereview human-gate finding): replaced the metadata-only seven review rows with actual fixture candidates. Candidate-bearing fixtures now hold exactly 3+3+4 distinct Scout-selected web leads, canonical identities, two primary source documents/excerpts, role outcomes, financial responses, expected terminal state/rank, candidate-specific operations, and stable assessment IDs. The harness parses the exact Pending operator table and proves each row maps one-to-one to an executed candidate, unique identity, persisted assessment, and sealed snapshot containing that candidate's own primary/counter sources. RED was absent-method E2E 2pass/2fail; GREEN E2E4/4, evaluation7/7, identity3/3, latest serial full Discovery167/167 (363.1s). Feature remains false; human review has not been fabricated.

Task10 fix round3 (rereview exact-bijection finding): the prior presence assertion used source containment and did not prove distinct sealed snapshots or structurally parse the operator table. RED: E2E invoked missing `assertRecordedAssessmentBijection`, 2 pass/2 fail. GREEN: the harness requires the exact ten-row Pending table schema and ordered deep equality with fixture rows, then proves per executable fixture the equal distinct sets of runtime/persisted candidate IDs, persisted decision `candidate_id` identities, and sealed snapshot IDs. Each seal must contain exactly its row's primary/counter source IDs and document IDs and pass the production verifier; no candidate, assessment, snapshot, or table row can be reused. Final focused E2E4/4 (25.8s) and evaluation7/7 (20.4s) passed. The 167/167 serial Discovery gate remains authoritative and was not rerun because round3 changes only the E2E harness and release evidence. Feature false; human gate Pending.

Task10 fix round4 (rereview corpus-bijection finding): the 3/3/4 local assertions used fresh databases and could not observe cross-fixture reuse. RED: a shared-database test executed the three candidate-bearing fixtures then called missing `assertRecordedAssessmentCorpus`, 0 pass/1 fail. GREEN: three separate completed campaigns now share one temporary PostgreSQL database, and the corpus query derives all ten actual records from their durable run IDs. It requires exact global ten-way uniqueness/equality for runtime and persisted candidate IDs, canonical issuers, persisted decision IDs, snapshot IDs, and parsed Pending table rows. Every seal is equality-checked against that candidate's ordered primary/counter source and document pair without deduplication; global repeated table rows, sources, documents, or pairs fail. The shared execution exposed four Supply fixture-document hashes duplicated from Industrial under the real global document-content unique index; those four hashes now uniquely identify their recorded texts. Final focused E2E5/5 (33.4s) and evaluation7/7 (21.1s) passed; prior serial Discovery167/167 remains authoritative because only fixtures/harness/release evidence changed. Feature false; human gate Pending.

Task 10: complete (commits766f46c..3950336, review clean after4 fix rounds). All ten implementation tasks are complete; final whole-branch review pending. Human release evaluation remains Pending and `DISCOVERY_ENABLED=false`.

Final integration fix pass: RED — `TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx --test src/discovery/CampaignPage.test.tsx src/discovery/useCampaignRun.test.tsx` exposed three failures: User A campaign/brief/candidate/event content painted during deferred same-route User B loads, and `useCampaignRun` returned User A's same-run value/error for User B. `node --experimental-strip-types --test test/thesis-evaluator.test.ts test/thesis-types.test.ts` exposed unsupported exact operators and rejected bounded decimal thresholds; Discovery financial/assessment/service tests exposed PostgreSQL numeric rounding, `0.1 * 3 <= 0.3` exclusion, and repository run creation while model/search/reference readiness was missing. The authenticated HTTP regression returned 500 rather than 503. GREEN — all named focused tests pass after user-qualified render identities, bounded exact decimal coefficient/scale comparisons, retained numeric strings, and complete run-readiness preflight. Feature remains disabled; human release evaluation remains Pending.

Final re-review 1 fix: RED — a faithful thesis packet-loader regression demonstrated that the only remaining production `numeric::float8` projection converted `0.1000000000000000000001 × 3 <= 0.3` to supported and rounded unsafe `9007199254740993` to unresolved; OpenAPI contract assertions found the stale two-operator enum and numeric-only threshold. GREEN — `loadThesisPacket` now explicitly returns both PostgreSQL numerics as text to the shared exact evaluator; the two results are challenged/supported as intended. A complete evaluator-path audit found the existing Discovery financial adapter is the only other loader and already preserves text. DiscoveryMetricCheck now publishes all five operators and a legacy-number or bounded decimal-string threshold; mutation tests protect enum, union type, and string pattern. Dev-api1/1, Agents22/22, Discovery22/22, OpenAPI11/11, web typecheck/build passed. Feature false; human gate Pending.
