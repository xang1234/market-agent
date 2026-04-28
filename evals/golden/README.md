# Golden Evals

Tracking bead: `fra-6al.8.6`.

This directory contains the committed golden-eval case set. PX.1 executes
these cases through the observability golden runner and persists summaries to
`eval_run_results`.

## Layout

- `cases/` stores versioned golden cases. The default smoke suite covers all
  14 required categories from `stock-agent-v2.md`.
- `results/` stores generated eval artifacts
- `case.schema.json` describes the starter case shape

The runner API lives in `services/observability/src/golden-eval-runner.ts`:

```ts
const cases = loadGoldenEvalCases(DEFAULT_GOLDEN_EVAL_CASES_DIR);
await runGoldenEvalSuite(db, {
  suite_name: "golden-smoke",
  model_version,
  prompt_version,
  cases,
  evaluate: async (testCase) => runCase(testCase),
});
```
