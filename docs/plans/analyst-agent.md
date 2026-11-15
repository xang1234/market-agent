# Analyst agent plan

Market-agent's chat certifies financial numbers, but it knows nothing about the businesses behind them.
This program puts one analyst agent behind chat, Analyze, and the Agents page.
The agent is an LLM tool loop whose tools are subagents for certified financials, the company profile, claims, peers, and consensus.
Background knowledge comes only from stored sources. The model's own knowledge is never allowed, even labelled.
The agent's final answer is the existing assertions list over the packet it gathered, so every number carries an F id and every business fact carries a C id.
The PRs, in stack order, are AA1, AA2, AA3, AA4, AA5, AA6, AA7, and AA8.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `/Users/admin/.claude/plugins/cache/t3-pstack/t3-pstack/2.0.0-rc.2/skills/poteto-mode/playbooks/autopilot-stack.md`. The work is coupled, and the operator reviews and lands. Owners never merge. The root appends each verified PR to one linear stack on `main`, and the operator lands it bottom-up. AA5, AA6, and AA8 change an interaction, so they stop at stack-ready until the operator reviews them in chat.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] Read these at program start. Re-read them at every tick.
  - [ ] `cat <plugin root>/skills/poteto-mode/playbooks/autopilot-stack.md`
  - [ ] `cat <plugin root>/skills/poteto-mode/playbooks/autopilot-full.md`, which autopilot-stack builds on.
  - [ ] `cat <plugin root>/skills/swarm/SKILL.md`
  - [ ] `cat /Users/admin/Documents/Work/market-agent/.claude/skills/verify-market-agent/SKILL.md`
  - [ ] `cat <plugin root>/skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `cat <plugin root>/skills/poteto-mode/playbooks/shipping.md`, for the patch-id rule.
  - [ ] `cat <plugin root>/skills/how/SKILL.md`, before AA2, AA5, and AA8.
  - [ ] `cat <plugin root>/skills/interrogate/SKILL.md`, before every PR.
  - [ ] `cat <plugin root>/skills/show-me-your-work/SKILL.md`
  - [ ] `cat <plugin root>/skills/deslop/SKILL.md` and `cat <plugin root>/skills/no-comments/SKILL.md`
- [ ] On the operator's go, arm the audit tick as an hourly schedule_task bound to this thread with the tick prompt below. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from disk. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names. Owners report STACK-READY, never merge, never rebase onto trunk, and never retarget.
- [ ] Follow this dependency graph. Each dependent owner branches from its parent's branch, because the execution playbook stacks.
  - [ ] AA1, AA2, AA3, and AA7 are independent and first. Each branches from `main`.
  - [ ] AA4 after AA3. Its owner branches from AA3's branch.
  - [ ] AA5 after AA1, AA2, and AA4. Its owner branches from AA4's branch once the root has chained AA1, AA2, AA3, and AA4 in that order.
  - [ ] AA6 after AA5. Its owner branches from AA5's branch.
  - [ ] AA8 after AA6 and AA7. The root appends AA7 above AA6, and AA8's owner branches from AA7's branch.
- [ ] Hold the file boundaries.
  - [ ] AA1 touches only `services/llm/**`.
  - [ ] AA2 touches only `services/chat/src/financial-runtime.ts` and `services/chat/test/**`.
  - [ ] AA3 touches only `services/evidence/**`.
  - [ ] AA4 touches only `services/chat/**` and `services/evidence/src/local-runtime-evidence.ts` with its tests.
  - [ ] AA5 touches only `services/chat/**`, `services/tools/test/**`, `spec/finance_research_tool_registry.json`, and `.claude/skills/verify-market-agent/features/chat-cases.json`.
  - [ ] AA6 touches only `services/dev-api/**`, `services/analyze/**`, `services/chat/src/analyst-agent.ts`, and the verify skill's memo files.
  - [ ] AA7 touches only `services/agents/**` and `services/dev-api/**`.
  - [ ] AA8 touches only `services/dev-api/src/thesis-*.ts`, `services/agents/src/thesis-evaluator.ts`, `web/src/**`, their tests, and the verify skill.
- [ ] Hold the review gate. AA5, AA6, and AA8 change an interaction. They wait for the operator's review in chat with screenshots and a video before the operator lands them.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`; if `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.
- [ ] Open the PR ready, never draft, per **Opening a PR**. Use the run's built-in PR tool when it has one, else `origin pr create --status open --base <base-branch>` or `gh pr create --base <base-branch>` according to the resolved forge. A stack child targets its parent branch.
- [ ] Run the full suite and `npm run typecheck` of every touched service on Node 22.18 once before the PR-facing push. A change under `services/chat` also runs `cd services/financial-engine && npm run typecheck`. A change under `web` runs `cd web && npm test && npm run typecheck`. Push with hooks on.
- [ ] Before each push, self-review the diff for swallowed exceptions, races on a first claim, state that never resets, platform-specific exceptions, and missing imports, per the repo's `CLAUDE.md`.
- [ ] Run `/deslop` before each commit and `/no-comments` before review.
- [ ] After each push, comment `@codex review` and poll for the review. On a Codex usage limit, review with a Sonnet agent and say so in the PR.
- [ ] Triage every Bugbot and security-reviewer comment per `../references/bugbot-triage.md`.
- [ ] The root rebases the chain onto current trunk before the code-ready report and babysit. Owners keep that merge base in fix rounds. The root rebases again only at landing prep, on a `git merge-tree` conflict with trunk, or on a CI failure that comes from a change on trunk.

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head. Another full swarm runs only for new behavior, a redesign, or a large new diff. A rebase, a merge-conflict resolution, or a minor fix gets a single verifier at the new head. Run each full swarm per `<plugin root>/skills/swarm/SKILL.md`. One gates lane. The ten live lanes from the PR's **Verify, live** block. The perf lane from its **Verify, perf** block. Two or more audit lanes, each with its own focus, that read the diff and the receipts and distrust the PR body. The root audits the receipts in the stack-ready report before the verdict.
- [ ] Clean only when every lane is `PASS`. Findings go back to the owner, including a defect that a lane filed as a note. A new head gets a fresh verdict, except for results that stay valid under the patch-id rule in `playbooks/shipping.md`.
- [ ] The root appends each clean PR in dependency order with `gh pr edit <pr> --base <parent-branch>`. After any chain rebase, the root compares `git patch-id` at the verdict SHA and the new head, link by link, per `playbooks/shipping.md` step 3. The operator lands the stack bottom-up. Nobody else writes to the chain once landing starts.

### Boot recipe, for every live lane

Each live lane runs in its own worktree at the PR head. Drive through the control skill above. `$V` is `.claude/skills/verify-market-agent/scripts/verify`, run from inside the lane's worktree.

- [ ] `git fetch origin <head-branch>`, then `git worktree add -b swarm-<pr-id>-<n> /tmp/swarm-<pr-id>/wt-<n> <head SHA>`. The repo forbids checking out a bare SHA, so the lane gets a branch.
- [ ] Run `$V init-env <offset>` with an offset no other stack uses, such as `1000 + 100*n`. Then run `$V up analyst` in the foreground on Node 22.18, so turn traces and `[llm]` lines exist. From AA5 on, set `CHAT_ANALYST_AGENT=1` in the lane's `.env.dev` before `up`, unless the lane says flag off.
- [ ] Run `$V doctor`. Ready means exit 0, no FAIL line, and the printed commit equals the head SHA. Run `$V import` on a fresh database, with a 30-minute timeout.
- [ ] From AA4 on, load the three committed 10-K fixtures with AA3's CLI, `node --experimental-strip-types --env-file=.env.dev services/evidence/src/sec-10k-claims-cli.ts --file services/evidence/test/fixtures/sec-10k/<ticker>.htm --ticker <TICKER>`. The CLI reads the local file and sends no SEC request.
- [ ] Deliver input only through `$V chat`, `$V scorecard`, `$V memo`, `$V agents` from AA8 on, the CLIs a PR's Build block creates, and T3's `preview_*` tools for a screen the skill does not drive. The read-only diagnostics are `$V doctor`, `$V sql`, `.dev/logs/chat.log`, and `.dev/verify/`.
- [ ] Save every screenshot and CLI transcript to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` or `<slug>.txt` and return the paths with the report. Then run `$V down --volumes`.

## Add tool calling to the LLM layer (AA1)

**Depends on.** None.

**Files.**

- [ ] Edit `services/llm/src/router.ts`.
- [ ] Edit `services/llm/src/pi-adapter.ts`.
- [ ] Edit `services/llm/src/channel-config.ts`.
- [ ] Create `services/llm/src/tool-loop.ts`.
- [ ] Create `services/llm/src/tool-loop-cli.ts`, the probe the live lanes drive.
- [ ] Edit `services/llm/test/pi-adapter.test.ts` and `services/llm/test/channel-config.test.ts`.
- [ ] Create `services/llm/test/tool-loop.test.ts`.

**Build.**

- [ ] In `router.ts`, give `LlmChatRequest` an optional `tools` list of `{ name, description, parameters }`. Add an assistant tool-call turn and a `toolResult` turn to its messages. Give `LlmRouterResult` a `toolCalls` list of `{ id, name, arguments }`.
- [ ] In `pi-adapter.ts`, send `tools` as pi-ai's `Context.tools`, an assistant tool-call turn as `ToolCall` content, and a `toolResult` turn as a `ToolResultMessage`. Read `ToolCall` blocks out of the reply into `toolCalls`. Today the adapter keeps only `text` blocks. A request with no `tools` builds the same context as today.
- [ ] In `channel-config.ts`, add `"agent"` to `LlmPurpose`. The `agent` purpose leads with `settings.agentModel`, which `AGENT_LITELLM_MODEL` sets and nothing reads today. With the variable unset, it leads with the primary model.
- [ ] In `tool-loop.ts`, write `runToolLoop({ router, request, execute, policy, maxSteps })`. Each step calls the router with purpose `agent`. Each tool call goes through `policy.checkToolCall`, and an accepted call through `policy.recordAcceptedToolCall`, the methods of the `TurnToolPolicy` that `services/tools` `createTurnToolPolicy` returns. A refused call goes back to the model as a `toolResult` error. The loop returns the transcript and a stop reason of `final`, `step_cap`, or `budget`.
- [ ] Type `policy` structurally in `tool-loop.ts`, so `services/llm` gains no import of `services/tools`.
- [ ] In `tool-loop-cli.ts`, run `runToolLoop` on the configured channel with a stub `certified_financials` tool that returns a fixed packet. Accept `--max-steps`, `--budget-high`, and `--tool-error`. Print one line per step and a last line of the form `stop=<reason> steps=<n> tool_calls=<n> refused=<n>`.

**You see.**

- [ ] From `services/llm`, `node --experimental-strip-types --env-file=../../.env.dev src/tool-loop-cli.ts "Compare NVDA and MU revenue"` prints a step with `tool=certified_financials` and ends with `stop=final`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `services/llm/test/pi-adapter.test.ts` gains four cases. A request with `tools` puts them in `Context.tools`. A `toolResult` turn becomes a `ToolResultMessage` with the call's id. A reply with a `ToolCall` block returns `toolCalls` with the literal name and arguments. A request without `tools` builds a context equal to a literal copy of today's.
- [ ] `services/llm/test/channel-config.test.ts` gains two cases. A set `AGENT_LITELLM_MODEL` leads the `agent` purpose. An unset one leads with the primary model.
- [ ] `services/llm/test/tool-loop.test.ts` drives a scripted router. A final reply at step 2 stops with `final`. A model that always calls a tool stops at `step_cap` with `maxSteps` 3. A budget of one high-cost call refuses the second, and the model receives an error `toolResult`. An unknown tool name returns an error result.
- [ ] Run `cd services/llm && npm test && npm run typecheck` on Node 22.18.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claudeAgent/claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `$V scorecard --cases=aapl-gross-margin,nvda-amd-ytd` at trunk and head. Trunk lacks tool calling, so record that and gate the probe of lane 2 plus an unchanged chat reply. Save `aa1-scorecard.png`. Pass when both sides exit 0 and `report.json` lists the same tools per turn.
- [ ] Lane 2. Run the CLI on "Compare NVDA and MU revenue" over the Anthropic channel. Save `aa1-probe-final.txt`. Pass when a step shows `tool=certified_financials` with `NVDA` and `MU` in its arguments and the last line reads `stop=final`.
- [ ] Lane 3. Run the CLI with `--max-steps=1` on the same question. Save `aa1-step-cap.txt`. Pass when the last line reads `stop=step_cap steps=1`.
- [ ] Lane 4. Run the CLI with `--budget-high=1` on "Get revenue for NVDA, then separately for MU". Save `aa1-budget.txt`. Pass when the last line shows `refused=1` and a step shows the error `toolResult` the model received.
- [ ] Lane 5. Run the CLI with `--tool-error`. Save `aa1-tool-error.txt`. Pass when the transcript shows an error `toolResult` and the loop still ends with `stop=final`.
- [ ] Lane 6. With `LLM_SETTINGS_ENV_FILE` blanked so the shell's model keys count (`settings-loader.ts` drops them otherwise), set `AGENT_LITELLM_MODEL` to an Anthropic model that differs from both the primary and the settings file's agent model, then run lane 2's command. Save `aa1-agent-model.txt`. Pass when the `[llm]` line names that model.
- [ ] Lane 7. The same, with `AGENT_LITELLM_MODEL` unset. Save `aa1-agent-fallback.txt`. Pass when the `[llm]` line names the primary model.
- [ ] Lane 8. Run `$V chat "What was CSCO's net income last quarter?"` at head. Save `aa1-text-path.png`. Pass when the turn saves within 240s and the `[llm]` call count equals the same run at trunk.
- [ ] Lane 9. Run `$V scorecard --cases=nvda-amd-ytd` at head. Save `aa1-judge.png`. Pass when `report.json` has non-null judge verdicts for each turn, as at trunk.
- [ ] Lane 10. Run the CLI on "Get revenue for NVDA, MU, and AMD". Save `aa1-parallel.txt`. Pass when every `toolResult` id matches a `ToolCall` id and the last line reads `stop=final`.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Turn wall-clock as the scorecard's `saved` time, and LLM calls per turn, on `aapl-gross-margin` and `nvda-amd-ytd`, at trunk and head. The diff-added work is the loop overhead per step, the CLI's step wall-clock minus the `[llm]` latency of that step.
- [ ] Probe. Run `$V scorecard --cases=aapl-gross-margin,nvda-amd-ytd --runs=1` five times per side, alternating trunk and head stacks. Then run lane 2's command five times at head.
- [ ] Baseline. Record the trunk median `saved` time and calls per turn first.
- [ ] Rule. Fail when the head median `saved` time exceeds trunk by more than 10%, or when calls per turn differ. Fail when the loop overhead exceeds 20 ms per step, or when the two-step probe exceeds 30 s.

**Review gate.** None. AA1 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] The root rebased the chain after the verdict, and `git patch-id` is unchanged.
- [ ] The root appends AA1 to the base-branch stack, and the operator lands it bottom-up.

## Extract a structured certified-financials call (AA2)

**Depends on.** None.

**Files.**

- [ ] Edit `services/chat/src/financial-runtime.ts`.
- [ ] Edit `services/chat/test/financial-runtime.test.ts`.
- [ ] Leave `services/chat/test/golden-conversation.test.ts` and `services/chat/test/golden-plans.test.ts` unchanged. Their diff is empty at the PR head.

**Build.**

- [ ] Extract `certifiedFinancials({ subjects, metrics or plan choice, period, authority, requestKey, persistParent })` from `run()` in `createChatFinancialRuntime`. It wraps `publishRequest` and `planTurn` and returns `{ content, packet, run_id }`, where `packet` is `enginePacket(...)` from `services/chat/src/evidence-packet.ts`.
- [ ] Make `run()` call `certifiedFinancials` with `requestKey` equal to the bare `turnId`, the key it passes to `publishRequest` today. Stored `financial_runs` rows keep their key, and a retry resumes as before.
- [ ] Export `requestKeyFor(turnId, n)`, which returns `turn:<turnId>:<n>`. Two calls in one turn get two keys, so `reserveRun` in `services/financial-engine/src/request.ts` never answers `request_conflict` between them.
- [ ] Add no import that reaches `services/llm` from a file the financial-engine typecheck follows.

**You see.**

- [ ] `$V chat "Compare QCOM and TXN operating margins last fiscal year"` renders the same `financial_answer` block as trunk. `$V sql "select request_key from financial_runs order by created_at desc limit 1"` returns the bare turn id.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `services/chat/test/financial-runtime.test.ts` gains four cases. `certifiedFinancials` returns content, a packet with F ids, and a `run_id` for a literal NVDA revenue request. Calls keyed `turn:t1:1` and `turn:t1:2` with different plans both succeed. One key with two different plans returns `request_conflict`. The chat lane's key is the bare turn id.
- [ ] `golden-conversation.test.ts`, `golden-plans.test.ts`, and `engine-packet.test.ts` pass unchanged. Run `cd services/chat && npm test`.
- [ ] Run `cd services/chat && npm run typecheck` and `cd services/financial-engine && npm run typecheck`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claudeAgent/claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run the full `$V scorecard` at trunk and head. Save `aa2-scorecard.png`. Pass when every case has the same result and the same tools on both sides.
- [ ] Lane 2. Run `$V scorecard --cases=aapl-gross-margin` at trunk and head. Save `aa2-aapl-gm.png`. Pass when the figure lines in both `page.txt` files match.
- [ ] Lane 3. Run `$V scorecard --cases=peer-followup-asks-add-or-alone`. Save `aa2-peer-followup.png`. Pass when all three turns pass their expectations.
- [ ] Lane 4. Run `$V scorecard --cases=call-aapl-scenarios`. Save `aa2-call.png`. Pass when the case passes and the scenario block renders.
- [ ] Lane 5. Run `$V scorecard --cases=hd-trend-offered-period`. Save `aa2-trend.png`. Pass when the trend block and the Analysis card from #655 both render.
- [ ] Lane 6. Run lane 2's case, then `$V sql "select request_key from financial_runs order by created_at desc limit 1"`. Save `aa2-request-key.txt`. Pass when the key has no `turn:` prefix.
- [ ] Lane 7. Run `$V scorecard --cases=followup-keeps-metric`. Save `aa2-followup.png`. Pass when both turns pass and `financial_runs` holds one row per turn with distinct keys.
- [ ] Lane 8. Run `$V scorecard --cases=msft-pe`. Save `aa2-msft-pe.png`. Pass when the case passes.
- [ ] Lane 9. Run `$V scorecard --cases=ticker-it-is-gartner`. Save `aa2-it.png`. Pass when the stored subject is Gartner.
- [ ] Lane 10. Run `$V scorecard --cases=nvda-amd-ytd`. Save `aa2-analyst-path.png`. Pass when its tools and judge verdicts are non-null, as at trunk.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Turn wall-clock as the scorecard's `saved` time, and `financial_runs` rows per turn, over the full case file at trunk and head.
- [ ] Probe. Run `$V scorecard --runs=1` three times per side, alternating trunk and head stacks. Count rows per turn with `$V sql` after each run.
- [ ] Baseline. Record the trunk median `saved` time per case and the rows per turn first.
- [ ] Rule. Fail when any case's head median `saved` time exceeds trunk by more than 10%, or when rows per turn differ.

**Review gate.** None. AA2 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] The root rebased the chain after the verdict, and `git patch-id` is unchanged.
- [ ] The root appends AA2 to the base-branch stack, and the operator lands it bottom-up.

## Extract 10-K business and risk claims (AA3)

**Depends on.** None. One operator gate opens this PR.

- [ ] Operator gate. Ask the owner to approve fetching three 10-K primary documents, for NVDA, MU, and AAPL, from SEC EDGAR as committed test fixtures. A standing rule says SEC requests need explicit owner approval. Record the approval message in the PR body. Fetch nothing before it.

**Files.**

- [ ] Create `services/evidence/test/fixtures/sec-10k/nvda.htm`, `mu.htm`, and `aapl.htm`, fetched once after the gate.
- [ ] Create `services/evidence/src/sec-10k-sections.ts`.
- [ ] Create `services/evidence/src/sec-10k-claims.ts`.
- [ ] Create `services/evidence/src/sec-10k-claims-cli.ts`.
- [ ] Create `services/evidence/test/sec-10k-sections.test.ts` and `services/evidence/test/sec-10k-claims.test.ts`.

**Build.**

- [ ] In `sec-10k-sections.ts`, write `tenKSections(html)`. It runs `canonicalText` from `sec-earnings-release-extraction.ts`, skips the table of contents, and returns the text of Item 1 and Item 1A. A missing item returns a typed `section_not_found` for that item.
- [ ] In `sec-10k-claims.ts`, write `extract10kClaims`. It sends each section to the `extraction` purpose and parses the reply into `{ predicate, quote, competitors }`. The predicates are `business.description`, `business.products`, `business.customers`, `business.competition`, and `risk.factor`.
- [ ] Keep a claim only when its quote is found verbatim in the section's canonical text, the rule `verifyStatement` applies in `sec-earnings-release-extraction.ts`. Count the dropped claims.
- [ ] Store the document with `document-repo.ts` and each claim with `claim-repo.ts`, with a `claim_arguments` row of role `subject` for the filer. Resolve each named competitor through an injected `resolveCompetitor`, which the CLI wires to `resolveByNameCandidate` in `services/resolver/src/lookup.ts`, and store it with `createClaimArgument` and role `competitor`. An unresolved name stores no row.
- [ ] Key each claim on the document, the predicate, and the quote, so a rerun on one document adds no rows.
- [ ] In `sec-10k-claims-cli.ts`, read `--file` and `--ticker`, extract, and print `extracted=<n> dropped_unquoted=<n> competitors=<resolved>/<named> missing=<items> ms=<n> llm_calls=<n>`. The CLI reads a local file only. A backfill across all issuers is a separate operator gate outside this PR.

**You see.**

- [ ] The CLI on `nvda.htm` prints `extracted=` above 0. `$V sql "select predicate, count(*) from claims group by predicate"` lists all five predicates.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `services/evidence/test/sec-10k-sections.test.ts` asserts that each fixture's Item 1 and Item 1A open with their literal headings. A copy of `mu.htm` with Item 1A removed returns `section_not_found` for 1A.
- [ ] `services/evidence/test/sec-10k-claims.test.ts` drives a scripted LLM that returns one real quote and one invented quote. It keeps one claim and drops one. A stub resolver maps "Advanced Micro Devices" to a literal issuer id, and the test reads a `competitor` row for it. A second run adds no rows.
- [ ] Run `$V suite services/evidence` and `cd services/evidence && npm run typecheck`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claudeAgent/claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `$V backfill-8k AAPL` then `$V memo AAPL` at trunk and head. Trunk lacks 10-K extraction, so record that and gate the head's extraction of the three fixtures plus a passing memo. Save `aa3-memo.png`. Pass when the memo exits 0 on both sides and lanes 2 to 4 pass.
- [ ] Lane 2. Run the CLI on `nvda.htm`. Save `aa3-nvda.txt`. Pass when all five predicates have at least one NVDA claim in `$V sql`.
- [ ] Lane 3. Run the CLI on `mu.htm`. Save `aa3-mu.txt`. Pass when all five predicates have at least one MU claim.
- [ ] Lane 4. Run the CLI on `aapl.htm`. Save `aa3-aapl.txt`. Pass when all five predicates have at least one AAPL claim.
- [ ] Lane 5. After lane 2, read 20 random NVDA quotes with `$V sql`. Save `aa3-quotes.txt`. Pass when a script finds each quote in the canonical text of `nvda.htm`, 20 of 20.
- [ ] Lane 6. After lane 2, read the `competitor` rows on NVDA's `business.competition` claims. Save `aa3-competitors.txt`. Pass when every row resolves to an issuer whose name appears in its claim's quote.
- [ ] Lane 7. Run lane 2 twice. Save `aa3-idempotent.txt`. Pass when the NVDA claim count is equal after both runs.
- [ ] Lane 8. Run the CLI on a temporary copy of `mu.htm` with Item 1A removed. Save `aa3-missing-1a.txt`. Pass when it exits 0, prints `missing=1A`, and stores only `business.*` claims.
- [ ] Lane 9. After lanes 2 to 4, run `$V scorecard --cases=aapl-gross-margin,nvda-amd-ytd`. Save `aa3-chat.png`. Pass when both cases pass, as at trunk.
- [ ] Lane 10. After lane 3, compare the CLI's `competitors=<resolved>/<named>` with the `competitor` rows in `$V sql`. Save `aa3-unresolved.txt`. Pass when the row count equals the resolved count.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Trunk and head both produce the `$V backfill-8k AAPL` wall-clock. The diff-added work is the extraction wall-clock and the LLM calls per 10-K, from the CLI's `ms=` and `llm_calls=`.
- [ ] Probe. Alternate `$V backfill-8k AAPL` on the trunk and head stacks three times each. Run the CLI on each fixture three times at head.
- [ ] Baseline. Record the trunk median backfill wall-clock first.
- [ ] Rule. Fail when the head backfill median exceeds trunk by more than 10%. Fail when any 10-K takes over 120 s or over 12 LLM calls.

**Review gate.** None. AA3 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] The root rebased the chain after the verdict, and `git patch-id` is unchanged.
- [ ] The root appends AA3 to the base-branch stack, and the operator lands it bottom-up.

## Serve the company profile, claims, peers, and consensus tools (AA4)

**Depends on.** AA3.

**Files.**

- [ ] Create `services/chat/src/analyst-tools.ts`.
- [ ] Create `services/chat/src/analyst-tools-cli.ts`, the probe the live lanes drive.
- [ ] Edit `services/chat/src/local-runtime.ts`.
- [ ] Edit `services/chat/src/evidence-packet.ts`.
- [ ] Edit `services/evidence/src/local-runtime-evidence.ts`.
- [ ] Create `services/chat/test/analyst-tools.test.ts`. Edit `services/chat/test/evidence-packet.test.ts`.

**Build.**

- [ ] In `analyst-tools.ts`, write executors for the registry tools `get_company_profile`, `get_claims`, `get_peer_set`, and `get_analyst_consensus`, which `spec/finance_research_tool_registry.json` defines and `services/tools/src/registry.ts` loads.
- [ ] `get_company_profile` and `get_claims` read `business.*` and `risk.*` claims. `get_claims` takes a role, so a company named as a competitor in another filer's claim is readable. Today `local-runtime-evidence.ts` filters to `ca.role = 'subject'` behind the `$10` flag at line 234. Expose that flag as an option.
- [ ] `get_peer_set` calls `createSqlPeerSetResolver` from `services/fundamentals/src/peer-set-resolver.ts`.
- [ ] `get_analyst_consensus` reads `consensus_captures` and labels each value as an attributed analyst expectation with its capture date, per ADR 0005 and ADR 0006.
- [ ] Each executor returns a typed empty result, such as `no_business_claims` or `no_consensus`, when no stored source exists. It never returns model text.
- [ ] In `evidence-packet.ts`, turn each result into `PacketClaim`s with C ids.
- [ ] In `local-runtime.ts`, make the `executeTool` of `createRegistryBackedAnalystToolRuntime` dispatch these four names to their executors. Other names keep today's evidence read.
- [ ] In `analyst-tools-cli.ts`, run one executor by name for a ticker against the stack database and print its `PacketClaim`s, one per line.

**You see.**

- [ ] `node --experimental-strip-types --env-file=.env.dev services/chat/src/analyst-tools-cli.ts get_company_profile NVDA` prints `business.description` and `business.products` claims, each with a C id and its quote.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `services/chat/test/analyst-tools.test.ts` asserts literal results for each executor over a fake query. A profile returns the filer's claims. A `competitor` read of AMD returns NVDA's competition claim, labelled as NVDA's. Consensus returns the attributed label and capture date. A ticker with no claims returns `no_business_claims`.
- [ ] `services/chat/test/evidence-packet.test.ts` asserts that two runs over the same claims produce the same C ids.
- [ ] Run `cd services/chat && npm test && npm run typecheck`, `cd services/financial-engine && npm run typecheck`, and `$V suite services/evidence`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claudeAgent/claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run the full `$V scorecard` at trunk and head. Trunk lacks these executors, so record that and gate lanes 2 to 9 plus an unchanged scorecard. Save `aa4-scorecard.png`. Pass when every case has the same result on both sides.
- [ ] Lane 2. Run the CLI with `get_company_profile NVDA`. Save `aa4-profile.txt`. Pass when every printed quote is in `nvda.htm`'s canonical text and every line has a C id.
- [ ] Lane 3. Run the CLI with `get_claims NVDA --predicate risk.factor`. Save `aa4-risks.txt`. Pass when it prints at least five claims and only `risk.factor`.
- [ ] Lane 4. Run the CLI with `get_claims AMD --role competitor`. Save `aa4-competitor.txt`. Pass when it prints NVDA's competition claim, labelled as NVDA's.
- [ ] Lane 5. Run the CLI with `get_peer_set MU`. Save `aa4-peers.txt`. Pass when the peers equal what `createSqlPeerSetResolver` reads for MU through `$V sql`.
- [ ] Lane 6. Run the CLI with `get_analyst_consensus AAPL`. Save `aa4-consensus.txt`. Pass when its rows equal `$V sql "select * from consensus_captures"` for AAPL, each labelled attributed, or it prints `no_consensus` on an empty table.
- [ ] Lane 7. Run the CLI with `get_company_profile KO`, which has no loaded 10-K. Save `aa4-empty.txt`. Pass when it prints `no_business_claims` and exits 0.
- [ ] Lane 8. Run the CLI with `get_claims NVDA --as-of 2000-01-01`. Save `aa4-as-of.txt`. Pass when it prints no claims.
- [ ] Lane 9. Run lane 2 twice. Save `aa4-stable-ids.txt`. Pass when both runs print the same C ids.
- [ ] Lane 10. Run `$V scorecard --cases=nvda-amd-ytd` with the fixtures loaded. Save `aa4-analyst-path.png`. Pass when the case passes and its judge verdicts are non-null.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Trunk and head both produce the scorecard's `saved` time on `nvda-amd-ytd`. The diff-added work is each executor's wall-clock per call, timed by the CLI.
- [ ] Probe. Run `$V scorecard --cases=nvda-amd-ytd --runs=1` five times per side, alternating trunk and head stacks. Run each executor ten times at head.
- [ ] Baseline. Record the trunk median `saved` time first.
- [ ] Rule. Fail when the head median `saved` time exceeds trunk by more than 10%. Fail when any executor's median exceeds 300 ms.

**Review gate.** None. AA4 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] The root rebased the chain after the verdict, and `git patch-id` is unchanged.
- [ ] The root appends AA4 to the base-branch stack, and the operator lands it bottom-up.

## Answer chat with the analyst agent behind a flag (AA5)

**Depends on.** AA1, AA2, and AA4.

**Files.**

- [ ] Create `services/chat/src/analyst-agent.ts`.
- [ ] Edit `services/chat/src/coordinator.ts`.
- [ ] Edit `services/chat/src/evidence-packet.ts`.
- [ ] Edit `spec/finance_research_tool_registry.json`.
- [ ] Create `services/chat/test/analyst-agent.test.ts`. Edit `services/chat/test/coordinator.test.ts` and `services/tools/test/registry.test.ts`.
- [ ] Edit `.claude/skills/verify-market-agent/features/chat-cases.json`.

**Build.**

- [ ] In the registry JSON, add the `certified_financials` tool and an `analyst_agent` bundle holding it with `get_company_profile`, `get_claims`, `get_peer_set`, and `get_analyst_consensus`.
- [ ] In `analyst-agent.ts`, write `analystAgentRunner`. It runs `runToolLoop` with purpose `agent` and a policy from `createTurnToolPolicy` on the `analyst_agent` bundle. `certified_financials` calls `certifiedFinancials` with `requestKeyFor(turnId, n)`. The other tools call AA4's executors.
- [ ] Add `mergePackets` to `evidence-packet.ts`. The turn's packet holds the F ids of every certified call and the C ids of every claim.
- [ ] Make the final step emit the assertions list of `services/chat/src/assertions.ts` over the merged packet, never free text. Render it with `render-assertions.ts` and judge it with `inference-judge.ts`, as `answerTurn` does in `answer-trace.ts`. A final reply that is not a valid assertions list is rejected, and the turn answers with the certified blocks alone.
- [ ] Save once. Call `claimAnswerSave` from `services/chat/src/turn-stop.ts` once, after the judge, so the turn stays stoppable through every tool step.
- [ ] The saved message holds one `financial_answer` block per certified call plus the Analysis card from #655.
- [ ] In `coordinator.ts`, put `analystAgentRunner` in the seat of `financialAwareRunner` in the runner chain at line 399 when `CHAT_ANALYST_AGENT=1`. With the flag off, the chain is unchanged.
- [ ] Build the agent's router with `purpose: "agent"`. A unit test asserts the purpose, because a router built with the default purpose silently runs the agent on the primary model (AA1 swarm audit A, issue 3).
- [ ] Wrap the agent's router so every step calls `withDeadlines(ANSWER_DEADLINES)` afresh, as `llm-runtime.ts` does for answers. `runToolLoop` passes no controls, and `withDeadlines` fixes `endsAt` when it is created (AA1 swarm audit A, issue 4).
- [ ] Capture each certified call's whole sealed block (`snapshot_id`, `presentation_hash`, `data_ref`), not only `content`. Widen `certifiedFinancials`'s published result to return `block` if that is the cleanest seam (AA2 swarm audit A, issue 2).
- [ ] Number certified calls so `requestKeyFor(turnId, n)` gives the same `n` for the same ask on every retry of a turn. A reused key resumes the stored plan and reports `published` or `existing` for the old ask, with nothing showing the ask changed (AA2 swarm audit A, issue 3).
- [ ] A retried turn whose certified call returns `existing` has no figures to render, because the sealed block lives only in memory on the first attempt. Show that call as a typed gap and answer from what remains. Prove it with a unit test that replays a turn (AA2 swarm audit A, issue 1).
- [ ] Build a fresh context for each certified call: that call's own ask as `userIntent`, and no `clarificationAnswer`. A planner-model call made to map the ask counts toward the turn's LLM call limit (AA2 swarm audit A, issue 5).
- [ ] Wire `certifiedFinancials`'s deps (`pool`, `planningModel`, `evidence`, `clock`) and `chatAuthority` through `services/chat/src/local-runtime.ts` and `runtime.ts`. Both are inside AA5's `services/chat/**` boundary (AA2 swarm audit A, issue 4).
- [ ] If a lane or golden needs replayed tool calls, `services/llm/src/replay-client.ts` returns only text today. Extending it is the one allowed edit outside AA5's boundary, and the PR body must name it (AA1 swarm audit A, issue 5).
- [ ] Add agent cases to `chat-cases.json` for the asks in lanes 2 to 10, with expectations observed at the head and `budget_ms.saved` of 60000.

**You see.**

- [ ] With the flag on, "Compare NVDA and MU revenue, and what each sells" renders a `financial_answer` block and an Analysis card whose takeaways cite F and C ids. The trace lists `certified_financials` and `get_company_profile`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `services/chat/test/analyst-agent.test.ts` drives a scripted router. Two certified calls give two blocks keyed `turn:t:1` and `turn:t:2`. A free-text final reply is rejected. An assertion that cites a number outside the packet is rejected. A stop before the save leaves no message.
- [ ] `services/chat/test/coordinator.test.ts` asserts that the flag-off chain equals trunk's.
- [ ] `services/tools/test/registry.test.ts` asserts the `analyst_agent` bundle's literal tool list.
- [ ] Run `cd services/chat && npm test && npm run typecheck`, `cd services/financial-engine && npm run typecheck`, and `cd services/tools && npm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claudeAgent/claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run the full `$V scorecard` at trunk and at head with the flag off. Trunk lacks the agent, so record that and gate lanes 2 to 10 at head with the flag on. Save `aa5-flag-off.png`. Pass when every pre-existing case has the same result on both sides.
- [ ] Lane 2. Ask "Compare NVDA and MU revenue, and what each sells". Save `aa5-compare.png`. Pass when the judge rejects no assertion and every number in the Analysis card appears in a `financial_answer` block.
- [ ] Lane 3. Ask "Compare NVDA and MU revenue", the prototype's question. Save `aa5-prototype.png`. Pass when the reply holds no difference or ratio that is absent from the certified blocks.
- [ ] Lane 4. Ask "NVDA revenue and MU gross margin last fiscal year". Save `aa5-two-blocks.png`. Pass when two `financial_answer` blocks render and `financial_runs` holds keys `turn:<id>:1` and `turn:<id>:2`.
- [ ] Lane 5. Ask "What does MU sell?". Save `aa5-products.png`. Pass when every sentence cites a `business.products` or `business.description` C id.
- [ ] Lane 6. Ask "What does KO sell?" with no KO 10-K loaded. Save `aa5-no-source.png`. Pass when the reply says no stored source covers it and states no product.
- [ ] Lane 7. Ask lane 2's question and press stop during a tool step through `preview_*`. Save `aa5-stop.png`. Pass when the turn shows stopped and `chat_messages` has no assistant row for it.
- [ ] Lane 8. After lane 5, ask "What are its main risks?". Save `aa5-follow-up.png`. Pass when the stored scope stays MU and every cited claim is `risk.factor`.
- [ ] Lane 9. Ask "Who does NVDA compete with?". Save `aa5-competitors.png`. Pass when the reply cites `business.competition` C ids and labels the peer set as peers.
- [ ] Lane 10. Ask "What do analysts expect for AAPL?". Save `aa5-consensus.png`. Pass when each figure is labelled attributed with its capture date, or the reply says none is stored, and no stance word such as Buy, Hold, or Sell appears.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Trunk and head with the flag off both produce the scorecard's `saved` time and LLM calls per turn on the pre-existing cases. The diff-added work is the agent cases' `saved` time, first text time, and LLM calls per turn.
- [ ] Probe. Run `$V scorecard --runs=1` three times per side, alternating trunk and the flag-off head. Then run the agent cases with `--runs=3` at head with the flag on.
- [ ] Baseline. Record the trunk median `saved` time and calls per turn first.
- [ ] Rule. Fail when the flag-off head exceeds trunk by more than 10% on any case, or calls per turn differ. Fail when an agent case's median `saved` time exceeds 60 s, its first text exceeds 20 s, or it makes more than 8 LLM calls per turn.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2, 4, 6, and 7 screenshots into `.dev/verify/review/aa5-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change on a lane VM. Save it as `.dev/verify/review/aa5-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] The root rebased the chain after the verdict, and `git patch-id` is unchanged.
- [ ] The root appends AA5 to the base-branch stack, and the operator lands it bottom-up.

## Produce Analyze sections with the analyst agent (AA6)

**Depends on.** AA5.

**Files.**

- [ ] Create `services/dev-api/src/analyze-agent.ts`.
- [ ] Edit `services/dev-api/src/local-runtime.ts`, `services/dev-api/src/runtime.ts`, and `services/dev-api/src/analyze-adapter.ts`.
- [ ] Edit `services/chat/src/analyst-agent.ts`.
- [ ] Edit `services/analyze/src/playbook.ts`.
- [ ] Create `services/dev-api/test/analyze-agent.test.ts`. Edit `services/dev-api/test/analyze-run-sections.test.ts`, `services/dev-api/test/analyze-financial-wiring.test.ts`, and `services/analyze/test/playbook.test.ts`.
- [ ] Edit `.claude/skills/verify-market-agent/scripts/memo-flow.mjs` and `.claude/skills/verify-market-agent/features/analyze-memo.md`.

**Build.**

- [ ] Export a section mode from `analyst-agent.ts`. It takes a subject and a section goal and returns the section's rendered assertions and packet.
- [ ] In `analyze-agent.ts`, produce `investment_thesis`, `growth_drivers`, `downside_risks`, and a new `competitive_position` with that mode. Wire it as the runtime module's Analyze workflow in `runtime.ts` and `analyze-adapter.ts`.
- [ ] Delete `runAnalyzeWorkflow` and `analyzeMemoText` from `services/dev-api/src/local-runtime.ts`, the writer that dumps the prompt into the memo.
- [ ] In `services/analyze/src/playbook.ts`, remove the Buy, Hold, and Sell rating and the conviction verdict from the `investment_memo` instruction, because ADR 0005 forbids stance wording. Add the `competitive_position` section.
- [ ] Update `memo-flow.mjs` to require the four sections and to fail on stance words. Update `analyze-memo.md`, which today says the memo comes with no LLM.

**You see.**

- [ ] `$V memo NVDA` exits 0. Its `page.txt` has four section headings, the competitive section cites a `business.competition` claim, and no stance word appears.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `services/dev-api/test/analyze-agent.test.ts` drives a scripted router. It asserts the four section ids, each with at least one F or C ref, and a typed empty section for a subject with no sources.
- [ ] `services/analyze/test/playbook.test.ts` asserts that the `investment_memo` instruction has no "Buy", "Hold", "Sell", or "conviction", and that `competitive_position` is a section.
- [ ] Run `cd services/dev-api && npm test && npm run typecheck`, `cd services/analyze && npm test && npm run typecheck`, and `cd services/chat && npm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claudeAgent/claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `$V backfill-8k AAPL` then `$V memo AAPL` at trunk and head. Trunk writes the prompt dump, so record that and gate the four agent sections. Save `aa6-memo.png`. Pass when the head memo exits 0 and every section cites an F or C ref.
- [ ] Lane 2. Run `$V memo NVDA`. Save `aa6-competitive.png`. Pass when `competitive_position` cites a `business.competition` C id.
- [ ] Lane 3. Read lane 2's `page.txt`. Save `aa6-no-stance.txt`. Pass when "Buy", "Hold", "Sell", "rating", and "conviction" are all absent.
- [ ] Lane 4. Read lane 2's investment thesis. Save `aa6-thesis.png`. Pass when every number in it appears in a certified block of the memo.
- [ ] Lane 5. Read lane 2's downside risks table. Save `aa6-risks.png`. Pass when each row cites a `risk.factor` C id.
- [ ] Lane 6. Run `$V memo KO` with no KO 10-K loaded. Save `aa6-no-source.png`. Pass when the business sections say no stored source covers them.
- [ ] Lane 7. Generate the NVDA memo twice through `preview_*`. Save `aa6-history.png`. Pass when the run history lists both runs with the same four sections.
- [ ] Lane 8. Share the NVDA memo to chat through `preview_*`. Save `aa6-share.png`. Pass when the shared memo renders in the chat thread.
- [ ] Lane 9. Start the Analyze-to-Agent handoff from the NVDA memo. Save `aa6-handoff.png`. Pass when the Agents page opens with the thesis editor filled.
- [ ] Lane 10. Run the agent cases from AA5 with `$V scorecard`. Save `aa6-chat.png`. Pass when every agent case passes.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Trunk and head both produce the memo wall-clock from the Generate click to the rendered sections, from `memo-flow.mjs`'s report. Trunk writes no LLM text, so the diff-added work is the head's memo wall-clock and LLM calls per memo.
- [ ] Probe. Alternate `$V memo AAPL` on the trunk and head stacks three times each. Run `$V memo NVDA` three times at head.
- [ ] Baseline. Record the trunk median memo wall-clock first.
- [ ] Rule. Do not compare the two sides as a ratio. Fail when a head memo takes over 180 s or over 30 LLM calls.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1, 2, 3, and 6 screenshots into `.dev/verify/review/aa6-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change on a lane VM. Save it as `.dev/verify/review/aa6-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] The root rebased the chain after the verdict, and `git patch-id` is unchanged.
- [ ] The root appends AA6 to the base-branch stack, and the operator lands it bottom-up.

## Schedule agent runs and expand universes (AA7)

**Depends on.** None.

**Files.**

- [ ] Create `services/agents/src/scheduler.ts`.
- [ ] Create `services/dev-api/src/agent-scheduler.ts`.
- [ ] Edit `services/dev-api/src/dev.ts`.
- [ ] Edit `services/dev-api/src/local-runtime.ts`.
- [ ] Create `services/agents/test/scheduler.test.ts` and `services/dev-api/test/agent-scheduler.test.ts`.

**Build.**

- [ ] In `scheduler.ts`, write `dueAgentRuns(agents, lastRuns, now)`. It compiles each enabled agent's cadence with `compileAgentCadence` and returns the agents whose `nextDueAt` is at or before `now`. The `on-filing` cadence is event-driven, so the interval scheduler skips it.
- [ ] Derive each run id from the agent id and the due time. Two ticks that see one due run send one run id, and `handleAgentRunMessage` short-circuits the duplicate.
- [ ] In `agent-scheduler.ts`, every `AGENT_SCHEDULER_INTERVAL_MS`, read due runs and call `handleAgentRunMessage` from `services/agents/src/queue-runner.ts` with the thesis stages from `createThesisAgentLoopStages`. Today nothing outside its test calls it. Start the loop in `dev.ts`.
- [ ] In `local-runtime.ts`, replace `subjectRefsFromUniverse` with `resolveUniverse` from `services/analyst-grids/src/universe.ts`, so screen, watchlist, and portfolio universes expand into companies. Delete `subjectRefsFromUniverse`.

**You see.**

- [ ] With `AGENT_SCHEDULER_INTERVAL_MS=10000`, an hourly agent last run two hours ago gets a new `agent_run_logs` row within 20 s, and the dev-api log prints its `next_due_at`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `services/agents/test/scheduler.test.ts` asserts literal due lists. An hourly agent last run 61 minutes ago is due. One run 59 minutes ago is not. A disabled agent is never due. An `on-filing` agent is never due. Two calls at one `now` return the same run id.
- [ ] `services/dev-api/test/agent-scheduler.test.ts` asserts that two ticks over one due agent call `handleAgentRunMessage` with one run id, and that a screen universe resolves to its companies' subject refs.
- [ ] Run `cd services/agents && npm test && npm run typecheck` and `cd services/dev-api && npm test && npm run typecheck`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claudeAgent/claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Create a thesis agent and run it now through `preview_*` at trunk and head. Trunk has no scheduler, so record that and gate lane 2's scheduled run. Save `aa7-run-now.png`. Pass when both sides write one `agent_run_logs` row with the same status.
- [ ] Lane 2. Create an hourly agent and set its last run two hours back. Save `aa7-scheduled.txt`. Pass when a new `agent_run_logs` row appears within two ticks with no click.
- [ ] Lane 3. Create an hourly agent that ran ten minutes ago. Save `aa7-not-due.txt`. Pass when no row appears over three ticks.
- [ ] Lane 4. Start a second scheduler loop against the same database. Save `aa7-dedupe.txt`. Pass when each due run has exactly one row.
- [ ] Lane 5. Create a daily agent. Save `aa7-daily.txt`. Pass when the logged `next_due_at` is 24 hours after its last run.
- [ ] Lane 6. Create an `on-filing` agent. Save `aa7-on-filing.txt`. Pass when the scheduler writes no row for it.
- [ ] Lane 7. Create an agent on a saved screen. Save `aa7-screen.png`. Pass when the run's subject refs equal the screen's result companies in `$V sql`.
- [ ] Lane 8. Create an agent on a watchlist. Save `aa7-watchlist.png`. Pass when the run's subject refs equal the watchlist members' issuers.
- [ ] Lane 9. Create an agent on a portfolio. Save `aa7-portfolio.png`. Pass when the run's subject refs equal the holdings' issuers.
- [ ] Lane 10. Disable a due agent. Save `aa7-disabled.txt`. Pass when no row appears over three ticks.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Trunk and head both produce the run-now wall-clock from the click to the `agent_run_logs` row. The diff-added work is the scheduler tick wall-clock with 100 agents and the universe expansion wall-clock for a 50-company screen.
- [ ] Probe. Alternate run-now on the trunk and head stacks five times each. At head, seed 100 agents and log ten ticks, then time ten expansions of the screen.
- [ ] Baseline. Record the trunk median run-now wall-clock first.
- [ ] Rule. Fail when the head run-now median exceeds trunk by more than 10%. Fail when a tick exceeds 500 ms or an expansion exceeds 2 s.

**Review gate.** None. AA7 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] The root rebased the chain after the verdict, and `git patch-id` is unchanged.
- [ ] The root appends AA7 to the base-branch stack above AA6, and the operator lands it bottom-up.

## Monitor the analyst on the Agents page (AA8)

**Depends on.** AA6 and AA7.

**Files.**

- [ ] Edit `services/dev-api/src/thesis-runtime.ts` and `services/dev-api/src/thesis-evidence.ts`.
- [ ] Edit `services/agents/src/thesis-evaluator.ts`.
- [ ] Edit `web/src/analyze/thesisHandoff.ts`.
- [ ] Edit `web/src/pages/AgentsPage.tsx` and `web/src/agents/ThesisHistory.tsx`.
- [ ] Create `.claude/skills/verify-market-agent/scripts/agents-flow.mjs` and `.claude/skills/verify-market-agent/features/agents-monitor.md`. Edit `scripts/verify` and `features/README.md`.
- [ ] Edit `services/agents/test/thesis-evaluator.test.ts`, `services/dev-api/test/thesis-evidence.test.ts`, `web/src/analyze/thesisHandoff.test.ts`, and `web/src/agents/ThesisPanel.test.tsx`.

**Build.**

- [ ] In `thesis-runtime.ts` and `thesis-evidence.ts`, gather each run's evidence with the analyst agent's tools, `certifiedFinancials` from AA2 and `get_claims` from AA4 for `business.*` claims.
- [ ] In `thesis-evaluator.ts`, make `evaluateThesis` assess each condition over those F and C ids. Store the refs with each row in `agent_thesis_assessments`. A condition with no sourced evidence is assessed as not enough evidence.
- [ ] In `thesisHandoff.ts`, make `analyzeThesisHandoff` carry the memo's `investment_thesis` section text, not the prompt dump.
- [ ] In `AgentsPage.tsx` and `ThesisHistory.tsx`, show each condition's assessments over time, newest first, with the cited refs.
- [ ] Add `$V agents [TICKER]` with `agents-flow.mjs`. It drives Analyze to the handoff, creates the agent, runs it, and writes `report.json` and screenshots.

**You see.**

- [ ] After two runs, the Agents page shows each condition with two dated assessments, each citing F or C refs.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `services/agents/test/thesis-evaluator.test.ts` asserts that a condition backed by a `business.*` claim stores its C id and that a condition with no evidence stores the not-enough-evidence verdict.
- [ ] `services/dev-api/test/thesis-evidence.test.ts` asserts that a run's evidence holds both certified F ids and claim C ids.
- [ ] `web/src/analyze/thesisHandoff.test.ts` asserts that the handoff carries the literal thesis section text.
- [ ] `web/src/agents/ThesisPanel.test.tsx` asserts that two assessments render per condition in date order.
- [ ] Run `cd services/agents && npm test && npm run typecheck`, `cd services/dev-api && npm test && npm run typecheck`, and `cd web && npm test && npm run typecheck`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claudeAgent/claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run the Analyze-to-Agent handoff on NVDA at trunk and head. Trunk carries the prompt dump, so record that and gate the head's thesis text and assessment history. Save `aa8-handoff.png`. Pass when the head's thesis editor holds the memo's thesis section.
- [ ] Lane 2. Run `$V agents NVDA`. Save `aa8-drafted.png`. Pass when the drafted conditions come from the thesis section.
- [ ] Lane 3. Run the agent now. Save `aa8-assessed.png`. Pass when every condition shows an assessment with F or C refs.
- [ ] Lane 4. Run the agent a second time. Save `aa8-history.png`. Pass when each condition shows two dated assessments, newest first.
- [ ] Lane 5. Add a condition on NVDA's products. Save `aa8-business.png`. Pass when its assessment cites a `business.products` C id.
- [ ] Lane 6. Add a condition no stored source covers. Save `aa8-no-evidence.png`. Pass when it shows not enough evidence and no model statement.
- [ ] Lane 7. Set the agent hourly with `AGENT_SCHEDULER_INTERVAL_MS=10000` and its last run two hours back. Save `aa8-scheduled.png`. Pass when a third assessment appears with no click.
- [ ] Lane 8. Resize the page to 390 px wide through `preview_resize`. Save `aa8-narrow.png`. Pass when the history reads with no horizontal scroll.
- [ ] Lane 9. Move through the conditions with the keyboard only. Save `aa8-keyboard.png`. Pass when focus reaches each condition and Enter opens its history.
- [ ] Lane 10. Run the agent cases from AA5 with `$V scorecard`. Save `aa8-chat.png`. Pass when every agent case passes.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Trunk and head both produce the Agents page time from navigation to the first rendered agent row. The diff-added work is the thesis run wall-clock and LLM calls per run for a three-condition thesis, and the time to a rendered history.
- [ ] Probe. Alternate the page load on the trunk and head stacks five times each through `preview_*`. Run `$V agents NVDA` three times at head.
- [ ] Baseline. Record the trunk median page time first.
- [ ] Rule. Fail when the head median page time exceeds trunk by more than 10%. Fail when a run exceeds 120 s or 15 LLM calls, or the history takes over 2 s to render.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1, 3, 4, and 6 screenshots into `.dev/verify/review/aa8-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change on a lane VM. Save it as `.dev/verify/review/aa8-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] The root rebased the chain after the verdict, and `git patch-id` is unchanged.
- [ ] The root appends AA8 to the base-branch stack, and the operator lands it bottom-up.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with the report the execution playbook names. Catch the operator up per the **ketchup** skill, with links to the stack root and tip, a one-line verdict per link, and anything parked or excluded with the reason.

## Appendix A. Prototype evidence

Tool calling works through pi-ai on the Anthropic channel. A prototype proved it on 2026-11-14.

- The script is `/private/tmp/claude-501/-Users-admin-Documents-Work-market-agent/9fc39c23-eecf-4e3d-b291-2bf572dcea63/scratchpad/tool-proto.mjs`. It ran against the installed `@earendil-works/pi-ai` in `services/llm/node_modules` with model `claude-sonnet-5-5`.
- The model returned stopReason `toolUse` with `{"name":"certified_financials","arguments":{"tickers":["NVDA","MU"],"metric":"revenue"}}`.
- After a `toolResult`, the model answered. It also computed uncertified numbers in free prose, such as "about $42B higher, roughly 1.8 times". That result is why AA5's final answer is the assertions list, not free text.
- The script is a scratch file, so it has no branch or SHA.

Whether 10-K Items 1 and 1A can be found and extracted reliably stays unproven.

- The local dev database has 10,031 issuers, 0 documents, and 0 claims, measured with `select count(*)` on the dev stack's Postgres.
- The repo has no 10-K fixture.
- So AA3's first box is the operator gate to fetch three fixtures. Every PR that reads business knowledge depends on data that a later backfill gate must load.

## Appendix B. Alternatives rejected

- Separate qualitative endpoints, option B, duplicate chat and Analyze. Their output never meets the certified numbers.
- Model background knowledge with a label, option C, is unverifiable. The owner rejected it.
- Making the Agents page the main agent fails because the Agents page is a monitor pipeline, not a tool loop.
- Letting the agent write free prose fails because the prototype showed it invents uncertified arithmetic.

## Appendix C. Risks

- SEC data stays sparse until the owner approves the backfill gate. AA4, AA5, AA6, and AA8 answer "no stored source" for most companies until then. Each owner checks that this empty answer is typed and never model text.
- A non-standard 10-K can defeat section parsing. AA3's owner watches the `missing=` count and the `section_not_found` path.
- Several tools per turn raise judge cost and latency. AA5's perf block caps LLM calls at 8 per turn, and its owner reports any case near the cap.
- `claimAnswerSave` in `services/chat/src/turn-stop.ts` makes a turn unstoppable after its first save. AA5 saves once, after the judge, and lane 7 proves a stop mid-tool.
- The financial-engine typecheck follows chat files, and no import may reach `services/llm` from them. AA2 and AA5 run `cd services/financial-engine && npm run typecheck`.
- The verify skill drives no Agents page. AA7 and AA8 lanes use T3's `preview_*` tools until AA8 adds `$V agents`.
- Discovery's analyst and skeptic are off by default. A competitive assessment could reuse them later. That is out of scope.
- Valuation through the Call layer of ADR 0005 and ADR 0006 is a later program.

## Appendix D. Links and reading list

- Read `CONTEXT.md`, `docs/architecture.md`, and `.claude/skills/verify-market-agent/SKILL.md` before editing.
- Read ADR 0001 in both files that carry the number, `docs/adr/0001-frontend-state-management.md` and `docs/adr/0001-universe-issuer-expansion-for-agent-evidence.md`. AA7 and AA8 rely on the second.
- Read `docs/adr/0003-filing-extraction-boundary.md` before AA3, and `docs/adr/0005-the-call-opinion-layer.md` and `docs/adr/0006-valuation-model-for-the-call.md` before AA4 and AA6.
- AA2, AA5, and AA8 run `<plugin root>/skills/how/SKILL.md` before code.
- Every PR runs `<plugin root>/skills/interrogate/SKILL.md` before it opens.
- Keep the decision trail per `<plugin root>/skills/show-me-your-work/SKILL.md`. Commit it, since the program is long and multi-phase.
