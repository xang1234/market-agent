# Checked prose against the app and plain Sonnet (#800)

## Why

On 2026-11-25, plain Sonnet with the whole golden dataset in its prompt matched the app's accuracy and beat it on
analysis, but none of its figures linked to a source (2026-11-25-bare-arm.md). The checked-prose lane (#800) is meant to
keep that analysis and the app's provenance. The analyst agent writes free prose. A labeller ties each figure to the
evidence packet, code recomputes it, and a relation check reads how the prose relates the figures. One rewrite fixes
what fails, what still fails shows struck, and every figure that passes links to its source.

## Method

| arm | what answers | runs (UTC) |
|---|---|---|
| lane | analyst-mode stack at b0ee9f28 (#819's head), `CHAT_ANALYST_AGENT=1`, `CHAT_CHECKED_PROSE=1`, answers by `anthropic/claude-sonnet-5-5`, labeller and relation check by `CHECK_LITELLM_MODEL=anthropic/claude-sonnet-5-5` | 2026-11-28: 090113, 092215, 092744, 093231, 093742 |
| app | a second stack at the same revision and models, with the lane off | 2026-11-28: 090115, 091335, 092215, 092744, 093231 |
| plain Sonnet | the 11-25 bare runs, `scripts/research-quality-bare.ts` | 2026-11-25: 011555, 013902, 014547, 015253, 035542 |

- Every run used dataset 9714d6e9 and question set 2a1d31d1: 12 questions, 14 turns.
- **Off the record.**
  - 091332 tried Haiku 5.5 as the checker. It linked 170 of 192 figures (88.5%) and labelled 22 derived figures as not
    in the packet, so the five lane runs keep Sonnet as the checker.
  - One earlier lane run hit the key's spend cap on every call. Its files are named `INVALID-spend-cap-*`.
- **Figure check.** `scripts/research-quality-figures.ts` labelled every lane run with Opus 5.5 and judged each figure in
  code, apart from the lane's own check.
- **Blind scoring.** Ten pairings, each written as app run with other run:
  - lane: 095026 (090115 with 090113), 095027 (091335 with 092215), 095028 (092215 with 092744), 095029 (092744 with
    093231), 095030 (093231 with 093742)
  - plain Sonnet: 095037 (090115 with 011555), 095038 (091335 with 013902), 095039 (092215 with 014547), 095040 (092744
    with 015253), 095041 (093231 with 035542)
- **Reviewers.** Five Claude Opus 5.5 reviewers at high effort scored two pairings each.
  - The ten pairings were shuffled, so a reviewer could not tell a lane pairing from a plain-Sonnet one.
  - The 11-25 scores came from Gemini reviewers. The plain-Sonnet runs were scored again here, so all three arms sit on
    one reviewer scale. Do not compare raw scores across the two write-ups.

## Figures

The golden check found no wrong figure in the lane's five runs:

| runs | figures | per turn | matched | derived | near | wrong | not checkable |
|---|---|---|---|---|---|---|---|
| 5 | 1,395 | 19.9 | 622 | 694 | 78 | 0 | 1 |

On 11-25 the app stated 11.3 figures per turn and plain Sonnet 38.9.

The lane's own check over the same 70 turns, as the answers render:

- 878 figures were found in the final text.
- 806 linked (91.8%): 652 matched, 131 near and 23 derived.
- 72 did not link:
  - 52 were differences written as one operand, `{add: [A], subtract: [B]}`, which `derive()` refused. The labeller
    prompt asks for two operands.
  - 19 the labeller traced to nothing in the packet.
  - 1 was a difference of two amounts written in points.
- 14 turns got a rewrite request, for 19 untraced figures and 12 relation findings.
- 11 relation findings were still there after the rewrite and show struck, with the correction beside them. Each relates
  right figures wrongly, the class the 11-25 write-up said neither check measured:
  - Four say the margin gap widens down the income statement, where it narrows at net income.
  - "AMD has the lowest margins", where its gross margin is above AAPL's.
  - "NVDA leads on both scale ... and margins", where AAPL leads on revenue.

`derive()` now reads a one-operand difference as its two operands (#821). Rejudged offline against these 70 turns, the
52 come out 14 derived and 38 near, none wrong, and linking rises to 858 of 878 (97.7%). No run has been made with the
fix.

## Blind scores

Each total is over an arm's five pairings, at up to 2 points an answer. `correct_companies` and `no_invented_numbers`
score all 12 questions. The rest leave out missing-cash-flow and missing-segments, which the rubric scores on those two alone.

| criterion | lane | app (vs lane) | plain Sonnet | app (vs plain Sonnet) |
|---|---|---|---|---|
| correct_companies | 118/120 | 115/120 | 119/120 | 115/120 |
| comparable_periods | 97/100 | 77/100 | 99/100 | 76/100 |
| figures_match_sources | 76/100 | 100/100 | 50/100 | 100/100 |
| conclusions_justified | 89/100 | 55/100 | 96/100 | 52/100 |
| counterarguments | 94/100 | 47/100 | 95/100 | 51/100 |
| no_invented_numbers | 118/120 | 101/120 | 120/120 | 102/120 |
| decision_useful | 46/100 | 31/100 | 79/100 | 32/100 |

Failure labels across the five pairings:

| arm | labels |
|---|---|
| lane | weak_conclusion ×9 |
| app (vs lane) | weak_conclusion ×28, unstated_gap ×17, missing_counterpoint ×13, operational_failure ×10, wrong_period ×2 |
| plain Sonnet | weak_conclusion ×3 |
| app (vs plain Sonnet) | weak_conclusion ×27, unstated_gap ×17, operational_failure ×11, missing_counterpoint ×10, wrong_period ×3 |

The app's operational failures are turns that answered "Commentary is unavailable".

## Against the success rule in #800

| condition | result | holds |
|---|---|---|
| Linked figures are at least 95% of figures stated | 91.8%; 97.7% rejudged with #821 | no; yes with #821, offline |
| `figures_match_sources` within 10% of the app's | 76 against 100 | no |
| Real misstatements after repair at most 0.1% of checked figures | 0 of 1,394 | yes |
| `conclusions_justified` within 10% of plain Sonnet | 89 against 96 (0.93) | yes |
| `counterarguments` within 10% of plain Sonnet | 94 against 95 (0.99) | yes |
| `decision_useful` within 10% of plain Sonnet | 46 against 79 (0.58) | no |

The lane does not pass. It keeps plain Sonnet's accuracy and nearly all of its reasoning, and beats the app on every
criterion but `figures_match_sources`. It falls short on linking and on usefulness.

## Why usefulness falls short

On `decision_useful` the lane scored 1 of 2 on 46 of its 50 answers and 0 on the other 4. Plain Sonnet scored 2 on 29.
The reviewers' notes name what the lane's answers lacked, and in each case the lane's evidence packet never held it:

- **cause-in-evidence.** No lane answer cites AMD's filed attribution, the MI308 export-control charges.
- **margin-trend-loss-quarter.** The lane's answers held two of AMD's eight quarters and missed the Q2 FY2025 loss
  quarter. They said they could not cover eight quarters.
- **segment-drill-down.** No lane answer gives NVIDIA's segment split.

Plain Sonnet had the whole 42 KB dataset in its prompt. The lane reads through the analyst agent's tools, so this is a
retrieval gap, not a cost of the check. #783 covers the segment tool and the four medium-cost reads a turn. The quarters
and the claim sit behind tools the agent already has (`certified_financials`, `get_claims`), and why it did not read them
is not traced yet.

## Cost and latency

From the `[llm]` usage lines in each stack's `.dev/logs/chat.log`, per 14-turn run:

| arm | cost | median turn | p90 turn |
|---|---|---|---|
| lane, Sonnet checker | $1.00–1.04 | 21–26 s | 28–32 s |
| lane, Haiku checker (091332) | $0.84 | | |
| app | $0.78 | 15–20 s | 21–24 s |

The #800 prototype cost about $10 a run because it checked with Opus over the whole dataset.

## What this run does not test

1. **The fix live.** The 97.7% rejudge reuses the saved labels. A labeller that writes two operands, or a new run, can
   move it.
2. **Retrieval.** All three arms answer from the same three-company dataset, which plain Sonnet held in full. At the
   app's scale no arm can.
3. **Breadth.** All the answers and checks come from one model family, and so do the scores.

The run files and `<run>.figures.json` stay under `.dev/eval-runs/research-quality/` in the eval-800-lane and
eval-800-base checkouts, as in the 11-25 write-up.
