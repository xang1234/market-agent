# Analyze memo by the analyst agent

From a symbol page, a user opens Analyze, picks the Investment memo playbook, and generates a memo whose narrative sections the analyst agent writes from stored sources.

## Sub-features

- `analyze-entry` carries the subject from the symbol page to Analyze.
- `memo-generate` generates an Investment memo from a seeded template.
- `memo-sections` shows the agent's four sections: Investment thesis, Growth drivers, Competitive position and Downside risks. Each cites certified figures (F ids) or 10-K claims (C ids), or says no stored source covers it.
- `memo-no-stance` keeps Buy, Hold, Sell, rating, conviction, upside, overweight, underweight, outperform, underperform, recommend and expected return out of the agent's words.

## How to get to it (user POV)

Open `/symbol/listing:<id>/overview`, choose Analyze (`data-testid=analyze-this-subject`), pick `Investment memo` in the Playbook menu, then choose the `Generate memo` button on `/analyze?subject=...`.

## Driving it with scripts/verify

Preconditions: a stack with a model configured, listings imported (`$V import`), and the company's 10-K fixture loaded with AA3's CLI (the boot recipe in `docs/plans/analyst-agent.md`). A company with no 10-K on file still generates, with each business section saying no stored source covers it.

- **Generate.** Run `$V memo NVDA`. It exits 0 and prints a report with `generated: true`, the four `sections` each `shown` with their claim predicates, figures and sources or `empty: true`, `competitive_cites_competition: true`, `risks_cite_only_risk_factors: true`, and an empty `stance_words`.
- **No 10-K.** Run `$V memo KO` with no KO 10-K loaded. It exits 0 with the business sections `empty`. The competitive section may list KO's industry peers, which cite the industry source on file.
- **Proof.** Open `2-result.png`, `page.txt` and `run.json` in the printed `evidence` folder. `memo_ms` is the time from the Generate click to the rendered sections. `llm_calls` counts the `[llm]` lines dev-api logged meanwhile, so it needs `LLM_USAGE_LOG=true` in `.env.dev`.

## Gotchas

- The memo's figures come from facts on file. Analyze fetches nothing for the agent, so a company with no stored SEC facts shows the engine's gap note in the thesis. A chat question about the company fetches them through chat's auto-fetch.
- With no analyst model configured, Generate fails with "the analyst agent's model is not configured" and saves nothing. A section the agent could not write (`unwritten: true`, such as when every model call fails) fails the run, since it is not a statement about the sources. The verdict is `scripts/memo-verdict.ts`, which `services/dev-api/test/memo-verdict.test.ts` checks.
- Closing or reloading the tab mid-Generate stops the memo. It makes no further model call and saves nothing. Moving to another page inside the app keeps the request open, so the memo still saves.
- A memo reads as of its cutoff, and a rerun keeps the original's, so a company with no 10-K then says it "had no 10-K on file as of" that day.
- `stance_words` reads the memo canvas with quoted 10-K claims taken out, since a filing's own words are quoted as stored. `page_stance_words` reads the whole page, quotes included.
- Other playbooks get one note saying the agent writes only the Investment memo's sections. `$V memo` always picks the Investment memo.
- On a `Generate failed` message, read `page.txt` and `.dev/logs/dev-api.log`.
