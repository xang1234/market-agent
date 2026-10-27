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
   - `<run>.run.json`, the run record: provenance, the questions the run planned and whether it asked them all
     (`complete`), plus every turn's answer blocks and facts, for pairing two runs. It holds no environment values,
     headers, prompts or provider payloads. A run that stopped early says so at the top of its report.
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

Provenance (#220) is the evaluated stack's commit and whether its tracked files differ from it, the runner's own
commit, a digest of the questions and rubric, and a digest of the frozen dataset: its inputs (`DATASET_INPUTS` in the
runner: what `npm run seed:golden` loads) and the `FROZEN_AS_OF` cutoff in `services/chat/src/ytd-hydration.ts`. When
the stack runs from another checkout than the runner, pass `--stack-dir <checkout>` (or `EVAL_STACK_DIR`) so the commit,
dataset and turn traces (`CHAT_TRACE_DIR`, default `.dev/traces`) are read from there. The run refuses a directory that
isn't the top of a git checkout or lacks a dataset input. A field an older run didn't record shows `unknown`. A
completed turn with no answering model shows `none (no model wrote it)`: chat records `answered_by` only when a model
wrote the answer, so an engine answer without commentary or a fixed reply (a clarification, a segment gap) has none
(`services/chat/src/messages.ts`).

A run meant for a blinded pair (#222) takes `--blind`: its three files go to `.dev/eval-runs/research-quality/`, which
git ignores, so its report can't show the scorer which arm wrote which answer. Its run record says `"blind": true`.

## Blinded pairs (#222)

To compare a change against a baseline without knowing which answer is which, run the questions against both stacks
on the same frozen data, then pair the two run records:

1. Start each stack from its own checkout and run `run [base URL] --stack-dir <that checkout>` against it, so each run
   records the stack's own commit and dataset.
2. `node --experimental-strip-types scripts/research-quality-eval.ts pair <baseline.run.json> <candidate.run.json> [--seed N]`.
   It refuses two runs whose question-set digest or dataset revision differ. It writes `pairs.md` and a blank
   `pairs.scores.json` to `docs/eval-runs/research-quality/pairs/<stamp>/`, and the key to
   `.dev/eval-keys/<stamp>.key.json`, outside the repo. The packet shuffles question order and A/B per question from
   the seed (random unless given; the key records it). It shows each question, its expectation and N/A rules, the
   rubric and both answers, never the run, revision or model. An answer with a turn that didn't complete is shown as
   no answer; its cells start `"n/a"` and labelled `operational_failure`.
3. Score both answers per criterion in `pairs.scores.json` and add failure labels: `wrong_subject`, `wrong_period`,
   `unsupported_figure`, `invented_figure`, `weak_conclusion`, `missing_counterpoint`, `unstated_gap`,
   `operational_failure`.
4. `node --experimental-strip-types scripts/research-quality-eval.ts reveal <pairs dir> <key file> [--incomplete]`. It
   refuses while an applicable cell is `null`; `--incomplete` reveals anyway and names the review incomplete. It
   writes `reveal.md`: the mapping, totals per criterion for each arm, per-question deltas, what wasn't compared,
   unscored cells, each turn's outcome and model, and failure-label counts. A pair whose arms were answered by
   different models is confounded: its deltas are shown apart and left out of the attributed delta. There is no single
   overall score.

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
