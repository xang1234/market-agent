# Analyze memo with SEC evidence

From a symbol page, a user opens Analyze and generates a memo on that subject that cites SEC evidence.

## Sub-features

- `analyze-entry` carries the subject from the symbol page to Analyze.
- `memo-generate` generates a memo from a seeded template.
- `memo-evidence` cites stored 8-K claims rather than reporting insufficient evidence.

## How to get to it (user POV)

Open `/symbol/listing:<id>/overview`, choose Analyze (`data-testid=analyze-this-subject`), then choose the `Generate memo` button on `/analyze?subject=...`.

## Driving it with scripts/verify

Preconditions: the baseline. `up` hydrates AAPL, MSFT and GOOGL, so this works before an import.

- **Evidence first.** Run `$V backfill-8k AAPL`. It reports filings ingested or already present.
- **Generate.** Run `$V memo AAPL`. It exits 0 and prints a report with `generated: true` and `insufficient_evidence: false`.
- **Proof.** Open `2-result.png` and `page.txt` in the printed `evidence` folder. Confirm the subject is AAPL and the claims cite 8-Ks.

## Gotchas

- Without the backfill the memo still generates but reports insufficient evidence, and `$V memo` fails. That is the intended result.
- On this stack the memo comes from dev-api's local runtime (`services/dev-api/src/local-runtime.ts`), with no LLM. A pass proves the subject, templates and evidence reach the memo, not the quality of any model's writing.
- On a `Generate failed` message, read `page.txt` and `.dev/logs/dev-api.log`.
