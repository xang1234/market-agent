# Research-quality eval (#124)

Tests prove the plumbing works. They don't show whether an answer helps an analyst. This eval is twelve questions that
the owner scores by hand, so answer quality can be compared from one run to the next.

- **Questions and rubric:** `scripts/research-quality-questions.ts`. Every question runs on the frozen golden dataset:
  NVDA, AMD and AAPL, with quarterly and annual income metrics, quotes and daily price bars from 2025-12-01, plus NVDA's
  business-segment revenue for its latest quarter, and one filed claim: AMD's explanation of its Q2 2025 margin drop,
  quoted from its earnings release (8-K exhibit 99.1, #282). Nothing else is seeded, so the missing-data questions have
  one honest answer: "not available", and only AMD's Q2 2025 has a cause in evidence.
- **Rubric:** seven criteria, each scored 0–2, with fixed meanings for 0, 1 and 2:
  1. correct companies;
  2. comparable periods;
  3. figures match sources;
  4. conclusions justified;
  5. counterarguments;
  6. no invented numbers;
  7. decision useful: could a portfolio manager act on it, and does it name the figure, threshold or event in the data
     that would change a view of the stock?
  The first six check accuracy and reasoning; the seventh checks whether the answer helps someone decide. It differs
  from counterarguments, which asks what cuts the other way, by asking what to watch. It never rewards a buy, sell or
  hold call, a price target or advice wording, since the product forbids them (#201, #224). The missing-data questions
  mark it N/A: an honest "not available" has nothing to act on.
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
   `no_invented_numbers`, and each of those becomes a regression test. A run scored before a criterion joined the
   rubric (every run before `decision_useful`) shows it `not scored`, and its total leaves it out (only a criterion marked `addedLater` in `RUBRIC`; any
   other criterion missing from a file is unscored); the summary names
   those runs, since their totals cover fewer criteria and don't compare with later ones.

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

1. Start each stack from its own checkout and run
   `node --experimental-strip-types scripts/research-quality-eval.ts run [base URL] --stack-dir <that checkout> --blind`
   against it, so each run records the stack's own commit and dataset, and its report and run.json go to
   `.dev/eval-runs/research-quality/` (gitignored) where a scorer browsing `docs/` won't see which arm is which.
2. `node --experimental-strip-types scripts/research-quality-pairs.ts pair <baseline.run.json> <candidate.run.json> [--seed N]`.
   It refuses a run not made with `--blind` (its run.json lacks `"blind": true`), and two runs whose question-set
   digest or dataset revision differ, or whose question set isn't the current runner's. The digest covers the rubric,
   so runs made before `decision_useful` pair only from the runner revision that ran them. The pairing is named by its
   UTC stamp, so a second pairing in the same second is refused. It writes `pairs.md` and a blank `pairs.scores.json`
   to `docs/eval-runs/research-quality/pairs/<pairing>/`, and the key to `.dev/eval-keys/<pairing>.key.json`,
   gitignored under `.dev/`. The packet shuffles question order and A/B per question from the seed (a whole number below 2^32,
   random unless given; the key records it). It shows each question, its expectation and N/A rules, the rubric and
   both answers, never the run, revision or model. Each cited figure carries a number, and a list after the answer
   says what it points at: the engine result's company, measure, period and value, or the fact's period, unit and
   cutoff. Each block's sources are named S1, S2... per answer in the order they appear, since source ids are minted
   per stack and would tell the answers apart. An answer with a turn that didn't complete is shown as no answer and its
   cells start `"n/a"`. A question one run never asked (it stopped early) is left out of the packet, which names it.
3. Score both answers per criterion in `pairs.scores.json` and add failure labels: `wrong_subject`, `wrong_period`,
   `unsupported_figure`, `invented_figure`, `weak_conclusion`, `missing_counterpoint`, `unstated_gap`. The reveal adds
   `operational_failure` wherever an arm gave no answer.
4. `node --experimental-strip-types scripts/research-quality-pairs.ts reveal <pairs dir> [key file] [--incomplete]`. The
   key defaults to the one named by the pairs folder, and a key or scores from another pairing, or from another
   pairing's folder, are refused before anything is written. It refuses while an
   applicable cell is `null`; `--incomplete` reveals anyway and names the review incomplete. It writes `reveal.md`
   once: the mapping, each arm's totals per criterion over its own scored cells, per-criterion deltas as `+N over K
   pairs`, per-question deltas, what wasn't compared, unscored cells, each turn's outcome and model, failure-label
   counts, and each question's labels and notes. A pairing made before a criterion joined the rubric (its key records
   the question set every committed pairing ran, `4593f805…`, and no cell has the criterion) reveals with it `not scored` and says so above the
   totals. Only a criterion marked `addedLater` in `RUBRIC` can read that way; any other missing cell is unscored. Only pairs both arms answered are compared. A compared pair is
   confounded when a turn names a different model in each arm, or an arm's record lacks the field: its deltas are shown
   apart and left out of the attributed delta. A turn no model wrote (chat omits `answered_by` for an engine answer
   without commentary or a fixed reply) confounds nothing, since a model against no model is the change measured. There is no single overall score. Notes show on their question's line. Before
   writing `reveal.md`, every reveal, `--incomplete` included, copies both runs' reports and run.json into the pairs
   folder.

   Those copies already tell the arms apart, so before the first one the reveal writes a digest of the scores to
   `.reveal-scores-digest` in the pairs folder, and `reveal.md` ends with the same digest. Commit both. Running reveal
   again with the same scores finishes a reveal that stopped partway, copies any run file missing from the pairs
   folder, and refuses a copy that differs from its run, before copying anything. With changed scores it refuses,
   whether or not `reveal.md` was written, because scores entered after the mapping may have been seen aren't blind.
   That includes a complete reveal after an `--incomplete` one, so reveal incomplete only when the review stops there.
   A reveal refused for an unscored cell locks nothing.

## Bare arm and figure check (#781)

The bare arm asks the same questions of the same model with no chat pipeline. The model gets the frozen golden
dataset as a document in its system prompt and answers in markdown. A blinded pair of an app run and a bare run
shows what the pipeline adds. The figure check marks every number an answer states as right, wrong or not checkable.

To run the bare arm:

1. Set `LLM_ANTHROPIC_API_KEY` to the app's anthropic channel key.
2. Run `node --experimental-strip-types scripts/research-quality-bare.ts run [--model anthropic/<model>]`. The model
   defaults to `anthropic/claude-sonnet-5-5`. Each question is one conversation, and its turns go in order to the
   Messages API.
3. Pair it with an app run made with `--blind` from a checkout at the same commit:
   `node --experimental-strip-types scripts/research-quality-pairs.ts pair <app.run.json> <bare.run.json>`.

The run writes `<run>.run.json`, `<run>.md` and `<run>.scores.json` to `.dev/eval-runs/research-quality/`, with
`"blind": true`. Its provenance is this checkout's commit, question set and dataset revision. Each answer is one
`rich_text` block. Each turn records the answering model as chat does (`anthropic/claude-sonnet-5-5`), so the pair
tool doesn't count the pair as confounded. The record also holds `"arm": "bare"` and the `request` settings. The
pairing packet shows neither.

The system prompt is the analyst instructions, the page the conversation opened from when a question has one, and
the data brief. `dataBrief()` in `scripts/research-quality-bare.ts` writes the brief from the exports of
`services/chat/test/golden/dataset.ts`. It holds every value the seed loads: statements, segments, quotes, daily bars
and AMD's filed explanation. The request sets `max_tokens` to 8192 and streams. It sends no `thinking`, effort,
temperature or tools, so the API defaults apply. On Claude Sonnet 5.5 the default runs adaptive thinking, and each
turn records its `thinkingBlocks`. A turn is retried once on a 429, a 5xx, an overloaded stream or a dropped
connection, then recorded as `provider_error`. A refused key, model or request stops the run.

To check figures, run
`node --experimental-strip-types scripts/research-quality-figures.ts check <run.json>...` with the same key. It reads
app runs and bare runs alike. Each completed turn is rendered with `renderBlock`, as the report shows it.

1. Code finds every numeral: amounts with B, M or K, percentages, points, basis points, multiples, negatives and
   ISO dates.
2. One call per turn to `anthropic/claude-opus-5-5` labels each numeral by id. A label is a year, a quarter, a date,
   a count or part of a name. A figure names the values on file it states (`reported`) or is computed from
   (`derived`, with a margin, growth, difference, ratio or share of total and its operands). The labeller's prompt
   lists what is on file but no values.
3. Code gives the verdict, with the figure check in `services/financial-core/src/figure-check.ts` that chat shares
   (#800). A reported figure is `matched` when it equals the data at the precision it shows. A
   derived figure is `derived_ok` when its recomputed value does. Otherwise it is `wrong`. A figure that points at
   nothing on file, or that the labeller skipped, is `not_checkable`, with its reason.

A whole number's trailing zeros count as rounding, so `$60B` matches 62.1 billion. Only a minus sign makes a number
negative. Parentheses don't, because in prose they hold an aside such as "previous close ($176.10)". A difference is
compared by size, since its sign follows the operand order the labeller picks. Two operands can't express a sum, so
a trailing-four-quarter total is `not_checkable`.

The check writes `<run>.figures.json` beside the run, with each numeral's span, label and verdict per turn. It prints
one line per run with the counts, then each wrong figure with its sentence. After a change to the verdict code, run
`node --experimental-strip-types scripts/research-quality-figures.ts rejudge <figures.json>...`. It judges the saved
labels again without a model call, and it refuses a turn whose numerals the enumerator no longer finds in the same
places.

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
