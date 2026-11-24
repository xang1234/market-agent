# Standout findings on a ten-year NVDA dataset (#773)

## Why

The blind eval in #773 ran on frozen dataset 8fe68201, which holds two fiscal years and no cash flow, so every
detector declined and the eval said nothing about the feature. This run gives NVDA ten fiscal years of annual
statements with cash flow, so the branch arm sees a finding, then repeats the paired comparison.

## Dataset a28c268f

- NVDA's annual rows are FY2017-FY2026, each from its own original 10-K, taken from one SEC companyfacts
  download (2026-11-24, sha256 `19ef503a...`). They cover revenue, gross profit, operating income, net income,
  operating cash flow and stock-based compensation for all ten years. Capex is filed for FY2024-FY2026 only, as
  PaymentsToAcquireProductiveAssets, with the scope flag SEC ingestion stores. Consolidated net income equals net
  income, since NVDA files none of the 19 noncontrolling-interest concepts that ingestion checks.
- AMD, AAPL, the quarters and the segments are unchanged. NVDA's FY2026 annual figures are now the filed ones
  (revenue $215.9B), while the golden quarters still sum to $209.9B.
- Commit f0500d6c (`services/chat/test/golden/dataset.ts`). The dataset revision moved from 8fe68201 to a28c268f.
- Two questions were added: `standout-annual` ("What stands out in NVIDIA's latest annual results?") and
  `history-analysis` ("How does NVIDIA's latest fiscal year compare with its own history?"). Question set bf84b34e,
  14 questions and 16 turns. The judge prompt is unchanged.

Before the eval, one chat turn on the branch stack called `get_findings`, which returned:

> NVIDIA Corporation's cash conversion (operating cash flow / net income) was 0.86x in FY2026 (ended 2026-01-25),
> the lowest of its last 10 fiscal years.

Operating margin declined as within range (FY2026 ranks 2 of 10, behind FY2025). SBC / free cash flow declined
as `tag_change`, as in the live runs.

## Method

| arm | checkout | runs (2026-11-24, UTC) |
|---|---|---|
| main | origin/main 74528a99 + f0500d6c cherry-picked = 97520ee7 | 163431, 164312, 165210, 170112, 170920 |
| branch | feat/standout-findings 07e15c97 + f0500d6c | 163904, 164726, 165637, 170526, 171327 |

- Two stacks ran in analyst mode at once (port offsets 700 and 660). The runs were interleaved main then branch,
  all from the branch checkout's runner with `--blind`.
- Every run was complete (16 of 16 turns completed), clean, on dataset a28c268f, answered by
  anthropic/claude-sonnet-5-5.
- Main's chat source differs from the branch's base only by two lint `void`s (#768).
- Pairings 171758, 171803, 171807, 171811 and 171816 pair main run i with branch run i.
- I scored all 70 pairs myself on three criteria before opening any key, then revealed with `--incomplete`.
  The per-pair notes are in each `pairs.scores.json`.

**What unblinds the branch arm.** On NVDA questions the branch's answer shows the findings plan block
(SBC / free cash flow gaps, "has the lowest cash conversion ... of the 10 fiscal years ranked"). Four AMD
margin-trend answers carry the branch's "no standout finding" note. Main cannot rank ten years at all. So the
scoring is blind on most AMD, AAPL and peer questions, and not blind on the four NVDA single-company questions.

## Results

Branch minus main, per pairing in order 171758 to 171816.

| criterion | main | branch | per-pairing deltas | total |
|---|---|---|---|---|
| counterarguments | 60/120 | 72/120 | -1, +3, +5, +2, +3 | +12 |
| conclusions_justified | 74/120 | 95/120 | +2, +4, +6, +3, +6 | +21 |
| no_invented_numbers | 125/140 | 125/140 | 0, 0, 0, 0, 0 | 0 |

NVDA-findings questions only (`standout-annual`, `history-analysis`, 10 pairs):

| criterion | main | branch | per-pairing deltas | total |
|---|---|---|---|---|
| counterarguments | 14/20 | 20/20 | 0, +2, +1, +1, +2 | +6 |
| conclusions_justified | 15/20 | 20/20 | 0, +2, +1, 0, +2 | +5 |
| no_invented_numbers | 20/20 | 20/20 | 0, 0, 0, 0, 0 | 0 |

Where the gain comes from, summed over five pairings (counterarguments, conclusions_justified):

- **The finding's questions.** `single-latest-quarter` (+6, +4), `history-analysis` (+3, +3) and `standout-annual`
  (+3, +2), with `follow-up-memory` at (+1, -2). The branch cites the cash-conversion low in 5 of 5 runs on each of
  these four; main never does. Its typical use is as the case against the strong-margin takeaway. Main's history
  answers use FY2023-FY2026 trends only, and 3 of 5 draw no conclusion. Two main answers call cash conversion
  strong or very high while operating cash flow sits below net income.
- **Questions the feature does not touch.**
  - `peer-two` (+4, +2), `ticker-page-compare` (+4, +2) and `margin-trend-loss-quarter` (0, +3).
  - `peer-three` (-6, +5): main hit its model-call limit there in 5 of 5 runs and the branch in 0 of 5. The
    truncated answers drop a company and carry a caveat (counterarguments up, conclusions down).
  - `cause-in-evidence` (-3, 0).
  - Over these questions, counterarguments sum to -1 and conclusions_justified to +14.
- **no_invented_numbers is equal.** Both arms lose the same points on the two segment questions, which show total
  revenue without the seeded segments and without saying so, and on the AMD margin trend, which never shows Q2
  FY2025's loss.

## What limits these numbers

- **I scored both arms, and the findings block names the branch on NVDA questions.** The NVDA-findings rows are
  the least blind part of the table.
- **The questions were written knowing the finding.** Their expectations name it. Main cannot rank ten years, so
  on `history-analysis` it can only answer from four years of trends. The NVDA rows measure "can the agent find and
  use this finding" more than general answer quality.
- **The NVDA rows hit the ceiling.** The branch scored 20/20 on both criteria. Ten pairs per arm is small, and
  two pairings show 0 delta.
- **The run-to-run spread is as large as the per-question effect on unrelated questions.**
  - Unrelated questions moved conclusions_justified by +2 to +4 per pairing, and counterarguments by -2 to +2,
    against main.
  - The overall totals mix that drift with the feature, so the overall +21 is not attributable to findings.
  - I can't tell whether main's 5-of-5 call-limit hits on `peer-three` are the feature or noise. Main logged 21
    call-limit notes in all to the branch's 11.
- **One company, one finding type, one model.** Only cash conversion fired. Operating margin was within range and
  SBC / FCF was refused by its concept scope, so two of three detectors are still untested with a finding.
- **The dataset is part real, part illustrative.** NVDA's FY2026 quarters do not sum to its filed year.

## Conclusion

- **Where a finding exists, the branch uses it.** On NVDA it cites the ten-year cash-conversion low in every run
  and turns it into a grounded counterpoint, and it invents nothing more than main.
- **The gain on the finding's questions is consistent but small and unblinded:** +6 counterarguments and +5
  conclusions_justified over 10 pairs, never negative.
- **The overall gain cannot be credited to findings.** Most of it comes from questions the feature does not reach,
  and it sits inside the noise.
- **A blind re-score of the NVDA rows by someone else** would settle the scorer question.

## Files

- Pairings: `pairs/2026-11-24T171758`, `171803`, `171807`, `171811`, `171816` (packets, scores, reveals, run copies).
- Aggregation: per-arm totals and deltas are summed from each pairing's key and `pairs.scores.json`.
