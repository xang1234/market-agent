# Chat scorecard

A user asks the analyst a conversation of questions in one thread. Each reply should resolve the right companies, call the right tools, render quickly and without jank, and spend a sane number of model calls.

## Sub-features

- `chat-subjects` keeps the companies a conversation is about across follow-ups and clarification answers (#623).
- `chat-tools` answers from the tools the question needs.
- `chat-timing` streams the first answer text, saves the reply and renders it within the case's budget.

## How to get to it (user POV)

Open `/chat`, type into the composer (`#chat-composer`) and press Enter. Each reply renders as `[data-role="assistant"]` with its `data-message-id`; while it runs, the turn is `[data-testid="pending-turn"]` and then `[data-testid="streaming-turn"]`.

## Driving it with scripts/verify

Preconditions: the baseline, on a stack started with `$V up analyst`. A `data` stack writes no turn traces and no `[llm]` lines, so `tools` expectations fail with "no trace" and `llm` is null.

- **Run.** `$V scorecard` runs every case once. `--cases=margins-clarify-all` picks cases, `--runs=3` repeats each in new threads for medians, and `--file=PATH` reads another case file.
- **Read.** It prints `summary.md`: one row per case with its result, median first text, saved and rendered times per turn, and model calls and tokens per run, then every failure. `report.json` holds each turn in full.
- **Proof.** Exit 0 means every expectation and budget held. Open a failing turn's `turn-N.png` and `messages.json` under `<case>/run-<n>/`.

## Case file

`chat-cases.json` is an array of cases:

```json
{"id": "margins-clarify-all", "note": "#623", "budget_ms": {"first_text": 8000, "saved": 60000},
 "turns": [{"ask": "...", "expect": {"subjects": ["AAPL"], "not_subjects": ["ALL"], "text": [], "not_text": ["No research claims"], "tools": ["get_quote"]}}]}
```

Every `expect` key and budget is optional, and an unknown one stops the run with exit 2.

| Key | Passes when |
|---|---|
| `subjects` | each label is among the stored scope's companies (`chat_messages.research_scope`). A clarification stores no scope, so it fails there. |
| `not_subjects` | no label is among them. |
| `text` | each string is in the rendered reply. |
| `not_text` | no string is. |
| `tools` | each tool was called, per the turn trace. |
| `budget_ms.first_text`, `budget_ms.saved` | every turn's time from Enter stays within it. |

Write only expectations you observed on main. A case that catches a bug keeps its correct expectation and fails until the fix lands.

## Gotchas

- Every turn calls live models, so cases cost money and vary run to run. `--runs` caps at 5.
- Model calls are attributed by `.dev/logs/chat.log`'s size before Enter and after the reply renders. Another user of the same stack inflates a turn's counts.
- Only the analyst path streams text and writes a trace. A clarification or a financial-engine answer appears whole when it is saved, so its first text and render times match and its `tools` and `judge` are null. Put `tools` only on a turn the analyst answers, such as `nvda-amd-ytd`.
- `saved` is polled every 250ms, so it can read up to 250ms after `rendered`.
- The same question can take a different path from run to run: `What drives AAPL's margins?` gets a clarification or a refusal. Expect only what every path must hold.
