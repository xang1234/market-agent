# Research-quality eval (#124)

Tests prove the plumbing works. They don't show whether an answer helps an analyst. This eval is eleven questions that
the owner scores by hand, so answer quality can be compared from one run to the next.

- **Questions and rubric:** `scripts/research-quality-questions.ts`. Every question runs on the frozen golden dataset:
  NVDA, AMD and AAPL, with quarterly and annual income metrics, quotes and ten daily price bars, plus NVDA's
  business-segment revenue for its latest quarter. Nothing else is seeded, so the missing-data questions have one
  honest answer: "not available".
- **Rubric:** six criteria, each scored 0–2, with fixed meanings for 0, 1 and 2:
  1. correct companies;
  2. comparable periods;
  3. figures match sources;
  4. conclusions justified;
  5. counterarguments;
  6. no invented numbers.
  Each question carries an `expect` note (what a good answer does, and the trap), so the scorer doesn't have to work it
  out from the data. A question can mark criteria `notApplicable`. Those are scored N/A and left out of totals, so an
  honest "not available" answer isn't penalized for having no figures to judge.
- **Coverage:** single company, margin trend, what changed, a segment drill-down, peer comparison (two and three
  companies), a mismatched-fiscal-year trap, two missing-data questions, a three-turn follow-up, and a thread opened
  from a ticker page.

## Running and scoring

1. Start analyst mode (a live model on the frozen data; every model call is billed to your keys):
   `DEV_PROFILE=chat DEV_MODE=analyst ./scripts/dev-shell.sh up`.
2. Run the questions: `node --experimental-strip-types scripts/research-quality-eval.ts run [base URL]`. It writes two
   files to `docs/eval-runs/research-quality/`, named by the run's UTC time:
   - `<run>.md`, the report. For each question it shows the expectation, every turn's answer and a link to the thread.
     Prose is shown in full with cited figures in bold, comparison tables as tables, and other blocks by their title and
     figures. Open the thread for charts and sources.
   - `<run>.scores.json`, the scores. Every score starts as `null`; not-applicable criteria are already set to `"n/a"`.
3. Score each question 0, 1 or 2 in `<run>.scores.json`, with notes, and commit both files.
4. Run `node --experimental-strip-types scripts/research-quality-eval.ts summary`. It prints one line per run (total and
   per criterion, leaving out N/A and unscored), so trends show from run to run. It also lists every 0 on
   `no_invented_numbers`, and each of those becomes a regression test.

The first scored run is the baseline. Each run records the primary model from the LLM settings, since a model change
alone can move scores.
