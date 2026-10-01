# Research-quality eval (#124)

Tests prove the plumbing works. They don't show whether an answer helps an analyst. This eval is ten questions that
the owner scores by hand, so answer quality can be compared from one run to the next.

- **Questions and rubric:** `scripts/research-quality-questions.ts`. Every question runs on the frozen golden dataset:
  NVDA, AMD and AAPL, with quarterly and annual income metrics, quotes and ten daily price bars. Nothing else is
  seeded, so the missing-data questions have one honest answer: "not available".
- **Rubric:** six criteria, each scored 0–2, with fixed meanings for 0, 1 and 2:
  1. correct companies;
  2. comparable periods;
  3. figures match sources;
  4. conclusions justified;
  5. counterarguments;
  6. no invented numbers.
  Each question carries an `expect` note (what a good answer does, and the trap), so the scorer doesn't have to work it
  out from the data.
- **Coverage:** single company, margin trend, what changed, peer comparison (two and three companies), a
  mismatched-fiscal-year trap, two missing-data questions, a three-turn follow-up, and a thread opened from a ticker
  page.

## Running and scoring

The runner is the remaining part of #124 and waits on analyst mode (#123). It will:
- send each question's turns through analyst mode (a live model on the frozen data);
- write a dated report with each answer and links to its blocks and sources;
- keep the owner's scores beside the answers.

Then:
- a score of **0 on `no_invented_numbers`** becomes a regression test;
- the first scored run is the baseline.
