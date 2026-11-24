## PR Workflow 
### Before pushing / opening a PR
- Run the FULL local test suite, including workflow/CI tests (e.g. tests that check .github/workflows). Never push workflow YAML changes without running those tests locally.
- Do not invent action version tags (e.g. setup-uv@v10). Check that the tag exists with `gh api repos/<owner>/<repo>/git/refs/tags/<tag>` first.
- Before pushing, self-review the diff for the bug classes reviewers keep finding here: swallowed exceptions or overly broad `except`, race conditions on first claim or lease, circuit breakers or state that can never reset, platform-specific exceptions (Windows ValueError), and missing imports.

### Known bug classes here
Backend lint runs in CI: `npm --prefix lint run lint`. Typed rules read every service's imports, so first run `npm ci` in `lint`, `db` and each service, as the CI `lint` job does. Errors fail CI; warnings mark existing hits to fix, and a rule moves to error when its hits reach zero.
Each class has come back in several modules (closed issues cited). Check the diff against every one that applies.
- **Prose read by regex or keyword rules** (narrative guard #137-#302, keyword router #398, #749, #750). A new or changed rule ships with a corpus diff in the PR body: every real input whose reading changed. A rule that changes no real reading is not added. Synthetic-only edge cases go in a follow-up issue. Check: `services/evidence/test/reader-corpus.test.ts` (`npm run corpus:update` in services/evidence rewrites the expected files), and CI fails a PR that changes a reader without changing its corpus (expected file or new inputs). Add each review round's sentences to `services/evidence/test/reader-corpus/release-figure-sentences.tsv`, or the corpus will not catch them next time.
- **Periods matched by label** (#344, #474, #479, #541). Key, group and compare periods by end date and period kind. A fiscal label is for display. Check: `Period` type (#769).
- **Results that depend on arrival order** (#333, #334, #756). Reduce filings in filed date and accession order, never download or insert order. Add a test that feeds the inputs in every order and expects identical stored rows, proofs included. Lint: `require-array-sort-compare` (warn until its existing hits are fixed).
- **Missing or failed data that asserts something** (#381, #695, #744, #763). A missing figure carries no scope, basis or label of its own, and a failure never reads as "not available" or "no claims".
- **"ok" with nothing stored** (#399, #665, #688). Success means rows written. A failure keeps its cause. Check: `Outcome` type (#769).
- **Values that lose their unit or precision** (#539, #544, #749). A change in a percent is in percentage points. Rounding tolerance comes from the printed decimals, never `String(value)`.
- **Wall clock in logic** (#259, #611, #614). Take the date as an input. Date a market event by its trading session, not UTC. Lint: `no-restricted-syntax` on argument-less `new Date()` and `Date.now()` in `services/*/src` (warn for now).

## PR Review Workflow
### Addressing PR review comments
- For each bot or human thread: verify the finding, write a test that fails on the current code when applicable, fix it, then reply on the thread with the REAL commit SHA (never a placeholder).
- After fixing a round, look for sibling cases of the same bug elsewhere in the diff before pushing, so the next review round doesn't flag the gap.
- After pushing, request re-review (`@codex review`) and poll CI and reviews. If gh returns a transient 401 or connection error, retry once before reporting failure.
- When Codex is at its usage limit, Devin's PR review is the bot gate. Devin reviews a PR once and does not re-review fix pushes, so commits pushed after its review get an independent review of those commits before merge.
- Stop rule: when a review round finds only synthetic edge cases with no real input, file them in an issue and stop the review loop. The merge gate still holds: CI green, and any commit pushed after the bot review has its independent review. When rounds keep reopening the same rule, the design is brittle; redesign instead of adding a rule.


## Environment & Conventions
### Environment & facts
- Avoid `source`/`nvm` and `rm -rf` (blocked by safety hooks).
- Do one feature per git worktree. Never `git checkout` a commit hash (it detaches HEAD); use `git switch` with a branch.
- Before stating facts in READMEs, issues or PR comments (versions, schedules, behavior), verify them against the code or config and cite the file.
