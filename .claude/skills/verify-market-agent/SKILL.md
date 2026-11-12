---
name: verify-market-agent
description: Launch market-agent's dev stack and prove behavior on it with scripted checks of issuer identity, CIK discovery, the weekly reference import, the 8-K backfill, the Analyze memo flow, and a browser scorecard of chat conversations, and run a package's test suite with per-file logs. Use when verifying a resolver, ingestion, evidence, Analyze, or chat change on the real stack, or when a long local suite needs progress you can read.
---

# Verify market-agent

Every command is `scripts/verify` in this skill. **Run it from inside the checkout you are verifying**: it reads that checkout's `.env.dev`, ports, and Compose project. Below, `$V` means `.claude/skills/verify-market-agent/scripts/verify`.

## Launch

```bash
$V init-env 100                # First time in a worktree. Shifts every port by 100 and takes the main checkout's keys.
$V up                          # DEV_MODE=data on Node 22.18. Takes minutes on a fresh checkout.
$V up analyst                  # DEV_MODE=analyst: also writes chat turn traces and [llm] usage lines, which the scorecard reads.
$V doctor                      # Ready means exit 0 and no FAIL line.
$V import                      # Fresh database only: seeds about 10,000 listings.
```

`up` needs live keys in `.env.dev` for data mode, and it stops with the missing name if one is absent. Pick an offset no other stack uses, since `up` refuses a port that is taken. `doctor` prints the checkout and commit, so check them before trusting a stack.

## Doctor

`$V doctor` is read-only and exits non-zero on any `FAIL`. It checks that this checkout's processes own the web, resolver, dev-api, fundamentals and evidence ports, then probes Postgres, the analyze templates, the resolver's API, and the evidence bucket. Run it first whenever something looks off.

## Drive

| Command | What it does |
|---|---|
| `$V resolve NVDA SPY` | Resolves through the resolver HTTP API, then prints the stored listing, issuer, and CIK. |
| `$V identity save before`, then `$V identity diff before` | Fingerprints which instrument each listing and which issuer each instrument belongs to, plus duplicates. `diff` exits non-zero if anything moved. CIK fills don't count as moves. |
| `$V import [--force]` | Runs the reference import. **Exits 3 when the run was skipped**, since the import itself exits 0 with `ingested=0`. |
| `$V backfill-8k AAPL` | Resolves the ticker, then backfills its 8-Ks. |
| `$V restatements AAPL GE` | After a backfill: each ticker's later-filing rows by relation, how many equal or sit within 0.1% of the figure they replaced, the largest and smallest percent change, and the five smallest changes. Read those five: rounding stored as a restatement is a bug. |
| `$V memo [AAPL]` | Drives symbol page → Analyze → Generate memo in a real browser. Exits 1 unless the memo generates on that subject and cites 8-K claims, so backfill first. |
| `$V scorecard [--cases=ID,ID] [--runs=N] [--file=PATH]` | Drives each conversation in `features/chat-cases.json` (or `--file`) in a new thread per run, N runs (1 to 5, default 1), in a real browser. Per turn it records subjects, tools, judge verdicts, time to first answer text, to the saved row and to the rendered reply, long tasks, layout shift, console errors, and model calls and tokens. Exits 1 on a failed expectation, a blown budget, or a reply not saved within 240s. Writes `report.json` and `summary.md`, and prints the summary. Tools, judge and usage need `$V up analyst`; see [chat-scorecard.md](features/chat-scorecard.md). |
| `$V chat "AAPL bear 20x, base 25x, bull 30x" "what if base were 22x?"` | The scorecard on one ad-hoc case with no expectations: the questions in one new thread. Exits 1 unless every turn saves within 240s. |
| `$V scroll THREAD_ID [messages.json]` | Opens the thread at heights 700 to 1300 and flags each one where the list never settles (React's "Maximum update depth exceeded"). Then, at 4x CPU throttle and `HISTORY_HEIGHT` (default 800), it wheels from the end to the top and counts content jumps: frames where a visible message moves by something other than the wheel. Last it asks `ASK` at the end, scrolls up mid-stream, and checks that the view holds and that following the end resumes. Prints `report.json`. A `messages.json` from a chat run replaces the thread's history and skips the live question. |
| `$V sql "select ..."` | Read stored state. |
| `$V suite services/resolver [test/x.test.ts]` | Runs tests on Node 22.19 with `REQUIRE_DOCKER=1`, one log and one timeout per file (`SUITE_FILE_TIMEOUT`, default 600s), then lists the slowest. Check the `skipped` count too, since a file that skips everything still exits 0. Use it instead of piping `npm test` through a filter. |

Feature recipes are in [`features/README.md`](features/README.md). A proof that drives one entry point is incomplete when the feature's file lists others.

## Evidence

Everything goes to `.dev/verify/` in the checkout: identity states, import logs, suite logs, for each memo run `report.json`, `page.txt`, and screenshots, and for each scorecard or chat run `report.json`, `summary.md`, and per case and run `turn-N.png`, `page.txt`, and `messages.json`.

Proof standards:
- Use the real path: the resolver's HTTP API and the browser, not internal functions.
- Show the action and the stored result. A 200 is not proof, so follow `resolve` or `import` with the row or identity state.
- Report what the stack can't show. See the gotcha on Polygon calls below.

## Cleanup

```bash
$V down             # stops what this checkout started; data stays
$V down --volumes   # also deletes this stack's database and blobs
```

Neither removes `.dev/verify/`. Copy evidence out before removing a worktree. Never stop services by process name, because other worktrees run the same ones.

## Gotchas

- **Polygon calls can't be seen live.** The resolver logs only failed discoveries, so call limits and cooldowns are proven by tests, not by this skill.
- **A stack dies with the background task that started it.** Run `$V up` in the foreground, and only long steps like `$V import` in the background. An empty answer from the resolver usually means the stack is gone, so run `$V doctor`.
- **A fresh import takes 8 to 30 minutes** and `--force` about 11, depending on machine load, so give them a long timeout. A killed import leaves partial rows and no ledger entry, so rerunning `$V import` completes it.
- **The Docker test suites compete for the machine.** Rerun a failing file alone with `$V suite` before calling it a real failure.
- **Run on Node 22.** `up`, `memo`, `chat` and `scorecard` use 22.18 (arm64) and `suite` uses 22.19 (CI's version). Both must be installed under nvm, and `suite` needs `timeout` from coreutils.
- **Don't symlink `node_modules`.** `dev-shell up` runs `npm ci`, which empties the target of a symlink.
