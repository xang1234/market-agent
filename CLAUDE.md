## PR Workflow 
### Before pushing / opening a PR
- Run the FULL local test suite, including workflow/CI tests (e.g. tests that check .github/workflows). Never push workflow YAML changes without running those tests locally.
- Do not invent action version tags (e.g. setup-uv@v10). Check that the tag exists with `gh api repos/<owner>/<repo>/git/refs/tags/<tag>` first.
- Before pushing, self-review the diff for the bug classes reviewers keep finding here: swallowed exceptions or overly broad `except`, race conditions on first claim or lease, circuit breakers or state that can never reset, platform-specific exceptions (Windows ValueError), and missing imports. 

## PR Review Workflow
### Addressing PR review comments
- For each bot or human thread: verify the finding, write a test that fails on the current code when applicable, fix it, then reply on the thread with the REAL commit SHA (never a placeholder).
- After fixing a round, look for sibling cases of the same bug elsewhere in the diff before pushing, so the next review round doesn't flag the gap.
- After pushing, request re-review (`@codex review`) and use ScheduleWakeup to poll CI and reviews. If gh returns a transient 401 or connection error, retry once before reporting failure.


## Environment & Conventions
### Environment & facts
- Avoid `source`/`nvm` and `rm -rf` (blocked by safety hooks).
- Do one feature per git worktree. Never `git checkout` a commit hash (it detaches HEAD); use `git switch` with a branch.
- Before stating facts in READMEs, issues or PR comments (versions, schedules, behavior), verify them against the code or config and cite the file.
