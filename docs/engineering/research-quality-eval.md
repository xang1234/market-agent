# Research-quality eval (#124)

Tests prove the plumbing works. They don't show whether an answer helps an analyst. This eval is twelve questions that
the owner scores by hand, so answer quality can be compared from one run to the next.

- **Questions and rubric:** `scripts/research-quality-questions.ts`. Every question runs on the frozen golden dataset:
  NVDA, AMD and AAPL, with quarterly and annual income metrics, quotes and ten daily price bars, plus NVDA's
  business-segment revenue for its latest quarter, and one filed claim: AMD's explanation of its Q2 2025 margin drop,
  quoted from its earnings release (8-K exhibit 99.1, #282). Nothing else is seeded, so the missing-data questions have
  one honest answer: "not available", and only AMD's Q2 2025 has a cause in evidence.
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
- **Coverage:** single company, margin trend, what changed (cause not in evidence), a cause in evidence, a segment drill-down, peer comparison (two and three
  companies), a mismatched-fiscal-year trap, two missing-data questions, a three-turn follow-up, and a thread opened
  from a ticker page.

## Running and scoring

1. Start analyst mode (a live model on the frozen data; every model call is billed to your keys):
   `DEV_PROFILE=chat DEV_MODE=analyst ./scripts/dev-shell.sh up`.
2. Run the questions: `node --experimental-strip-types scripts/research-quality-eval.ts run [base URL]`. It writes three
   files to `docs/eval-runs/research-quality/`, named by the run's UTC time:
   - `<run>.md`, the report. It opens with the run's provenance. For each question it shows the expectation, every
     turn's answer and a link to the thread. Prose is shown in full with cited figures in bold, the engine's answer as
     its labelled results, gaps with their reason, tables and series, and other blocks by their title and figures.
     Each turn shows its outcome (`completed`, `timeout`, `provider_error`, `missing_answer` or `skipped`), elapsed
     time, answering model, and assertions accepted and rejected by check. Open the thread for charts and sources.
   - `<run>.scores.json`, the scores. Every score starts as `null`; not-applicable criteria are already set to `"n/a"`.
   - `<run>.run.json`, the run record: provenance plus every turn's answer blocks and facts, for pairing two runs
     (below). It holds no environment values, headers, prompts or provider payloads.
3. Score each question 0, 1 or 2 in `<run>.scores.json`, with notes, and commit both files.
4. Run `node --experimental-strip-types scripts/research-quality-eval.ts summary`. It prints one line per run (total and
   per criterion, leaving out N/A and unscored), so trends show from run to run. It also lists every 0 on
   `no_invented_numbers`, and each of those becomes a regression test.

The first scored run is the baseline. Each run records the primary model from the LLM settings, since a model change
alone can move scores. If the settings can't be read, the run stops before sending anything; set
`EVAL_MODEL=<channel/model>` to name the model yourself (it only names the run; the app still falls back as configured).
When fallbacks are configured, or unknown because the settings couldn't be read, the run is labelled with them; each
turn shows the model chat recorded as answering it (#183). The report is saved after each question, so an error late in
a run keeps the answers before it.

Provenance (#220) is the evaluated stack's commit and whether its tracked files differ from it, a digest of the
questions and rubric, and a digest of the frozen dataset's inputs (`DATASET_INPUTS` in the runner: what
`npm run seed:golden` loads). When the stack runs from another checkout than the runner, pass `--stack-dir <checkout>`
(or `EVAL_STACK_DIR`) so the commit and dataset are read from there. A field an older run didn't record shows `unknown`.

## Held-out traps (#221)

The owner-scored questions are the usefulness baseline, not a machine check. Beside them,
`services/chat/test/holdout.integration.test.ts` runs a fixed, versioned set of research traps in CI, on the frozen
data with recorded answers (no model, provider or credentials). The cases are in
`services/chat/test/holdout/cases.ts`: three-company ordering, a mismatched fiscal year, a cause not in evidence,
missing cash flow, a restated quarter, a redefined segment, an ambiguous follow-up, a low inside a window with its
rebound, a follow-up that keeps its YTD scope, a cause in evidence, plus ties, negatives, rounding and missing
quarters on explicit values.

Each case declares what the turn must establish (companies, period or window, blocks or a named gap, whether it asks
instead of answering) and is checked against the persisted answer, its research scope and the turn's assertion report.
Its known-good recorded answer passes in full. Each mutation changes one thing (another company's figure, the wrong
year, a dropped or duplicated reference, a stated cause, a superseded value, a wrong winner, an endpoint passed off as
the low) and must fail one named check (the rejection's `check`, typed in `services/chat/src/assertions.ts`). The
cases' digest is pinned with their version, so changing a case means a new version. Causal quality stays with the
owner's scoring: no LLM judge or machine prose score.

Rejected assertions in the reports above are counted by the check they failed, so a wrong number or citation
(`binding`) reads apart from a wrong ranking or trend (`comparative`).
