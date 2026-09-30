# Agent Instructions

This project tracks work in **GitHub Issues** (`xang1234/market-agent`, a public repo) using the `gh` CLI.
Beads (`bd`) is no longer used; its full history lives in git (see the last commit touching `.beads/issues.jsonl`).

## Quick Reference

```bash
gh issue list --label chat-recovery          # Current focus
gh issue list --search "no:assignee"         # Unclaimed work
gh issue view <n>                            # Details, sub-issues, blocked-by
gh issue edit <n> --add-assignee @me         # Claim work
gh issue create --title "..." --label P2 --body-file body.md
gh issue close <n> --comment "Done in #<pr>" # Complete work (or "Closes #<n>" in the PR body)
```

- Labels: `P1`/`P2`/`P3` for priority, plus area labels such as `chat-recovery`.
- Epics are issues with **sub-issues**; ordering uses GitHub's **blocked-by** relationships.
  Check `gh issue view <n>` for open blockers before starting.
- Issues are public: no secrets, credentials, or private data in titles, bodies, or comments.
- Durable design decisions go in `docs/adr/`; working notes for agents go in `docs/engineering/design-notes.md`.

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - `gh issue create` for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished issues, comment progress on in-flight ones
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
