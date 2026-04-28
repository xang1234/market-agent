import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  writeEvalRunResult,
  type EvalRunResultRow,
} from "./eval-run.ts";
import type { JsonObject, JsonValue, QueryExecutor } from "./types.ts";

export const GOLDEN_EVAL_CATEGORIES = Object.freeze([
  "ticker_name_disambiguation",
  "issuer_listing_confusion",
  "themes_macro_topics",
  "fiscal_calendar_alignment",
  "corporate_actions",
  "restatements",
  "segment_redefinitions",
  "low_analyst_coverage",
  "delisted_acquired_names",
  "multi_entity_documents",
  "candidate_authoritative_fact_promotion",
  "social_rumor_handling",
  "block_choice_correctness",
  "snapshot_transform_correctness",
] as const);

export type GoldenEvalCategory = (typeof GOLDEN_EVAL_CATEGORIES)[number];

export type GoldenEvalCase = {
  id: string;
  category: GoldenEvalCategory;
  prompt: string;
  expected?: JsonObject;
};

export type GoldenEvalCaseResult = {
  id: string;
  category: GoldenEvalCategory;
  passed: boolean;
  actual?: JsonValue;
  error?: string;
};

export type GoldenEvalCategorySummary = {
  category: GoldenEvalCategory;
  case_count: number;
  passed: number;
  failed: number;
};

export type GoldenEvalRunResultJson = {
  suite_name: string;
  model_version: string;
  prompt_version: string;
  summary: {
    case_count: number;
    passed: number;
    failed: number;
  };
  categories: ReadonlyArray<GoldenEvalCategorySummary>;
  cases: ReadonlyArray<GoldenEvalCaseResult>;
};

export type GoldenEvalEvaluator = (
  testCase: GoldenEvalCase,
) =>
  | {
      passed: boolean;
      actual?: JsonValue;
      error?: string;
    }
  | Promise<{
      passed: boolean;
      actual?: JsonValue;
      error?: string;
    }>;

export type RunGoldenEvalSuiteInput = {
  suite_name: string;
  model_version: string;
  prompt_version: string;
  cases: ReadonlyArray<GoldenEvalCase>;
  evaluate: GoldenEvalEvaluator;
};

export type RunGoldenEvalSuiteResult = {
  row: EvalRunResultRow;
  result_json: GoldenEvalRunResultJson;
};

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_GOLDEN_EVAL_CASES_DIR = resolve(
  MODULE_DIR,
  "../../../evals/golden/cases",
);

const CATEGORY_SET = new Set<string>(GOLDEN_EVAL_CATEGORIES);

export function loadGoldenEvalCases(casesDir: string): ReadonlyArray<GoldenEvalCase> {
  if (!existsSync(casesDir)) {
    throw new Error(`Golden eval cases directory does not exist: ${casesDir}`);
  }

  const cases = readdirSync(casesDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort()
    .flatMap((fileName) =>
      parseGoldenEvalCaseFile(
        readFileSync(resolve(casesDir, fileName), "utf8"),
        resolve(casesDir, fileName),
      ),
    );

  if (cases.length === 0) {
    throw new Error(`Golden eval cases directory has no JSON cases: ${casesDir}`);
  }

  return Object.freeze(cases);
}

export function assertGoldenEvalCategoryCoverage(
  cases: ReadonlyArray<GoldenEvalCase>,
): void {
  const present = new Set(cases.map((testCase) => testCase.category));
  const missing = GOLDEN_EVAL_CATEGORIES.filter((category) => !present.has(category));

  if (missing.length > 0) {
    throw new Error(
      `Golden eval cases missing categories: ${missing.join(", ")}`,
    );
  }
}

export async function runGoldenEvalSuite(
  db: QueryExecutor,
  input: RunGoldenEvalSuiteInput,
): Promise<RunGoldenEvalSuiteResult> {
  assertGoldenEvalCategoryCoverage(input.cases);

  const cases: GoldenEvalCaseResult[] = [];
  for (const testCase of input.cases) {
    cases.push(await evaluateCase(testCase, input.evaluate));
  }

  const result_json = buildRunResultJson(input, cases);
  const row = await writeEvalRunResult(db, {
    suite_name: input.suite_name,
    model_version: input.model_version,
    prompt_version: input.prompt_version,
    result_json,
  });

  return Object.freeze({
    row,
    result_json,
  });
}

function parseGoldenEvalCaseFile(
  raw: string,
  sourceLabel: string,
): ReadonlyArray<GoldenEvalCase> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${sourceLabel}: invalid JSON: ${message}`);
  }

  if (!Array.isArray(parsed)) {
    return Object.freeze([parseGoldenEvalCase(parsed, sourceLabel)]);
  }

  return Object.freeze(
    parsed.map((item, index) =>
      parseGoldenEvalCase(item, `${sourceLabel}[${index}]`),
    ),
  );
}

function parseGoldenEvalCase(value: unknown, label: string): GoldenEvalCase {
  const raw = record(value, label);
  const id = nonEmptyString(raw.id, `${label}.id`);
  const category = categoryValue(raw.category, `${label}.category`);
  const prompt = nonEmptyString(raw.prompt, `${label}.prompt`);
  const expected =
    raw.expected === undefined
      ? undefined
      : record(raw.expected, `${label}.expected`);

  return Object.freeze({
    id,
    category,
    prompt,
    ...(expected === undefined ? {} : { expected: Object.freeze(expected) }),
  });
}

async function evaluateCase(
  testCase: GoldenEvalCase,
  evaluate: GoldenEvalEvaluator,
): Promise<GoldenEvalCaseResult> {
  try {
    const result = await evaluate(testCase);
    return Object.freeze({
      id: testCase.id,
      category: testCase.category,
      passed: result.passed,
      ...(result.actual === undefined ? {} : { actual: result.actual }),
      ...(result.error === undefined ? {} : { error: result.error }),
    });
  } catch (error) {
    return Object.freeze({
      id: testCase.id,
      category: testCase.category,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function buildRunResultJson(
  input: RunGoldenEvalSuiteInput,
  cases: ReadonlyArray<GoldenEvalCaseResult>,
): GoldenEvalRunResultJson {
  const passed = cases.filter((testCase) => testCase.passed).length;
  const categories = GOLDEN_EVAL_CATEGORIES.map((category) => {
    const categoryCases = cases.filter((testCase) => testCase.category === category);
    const categoryPassed = categoryCases.filter((testCase) => testCase.passed).length;
    return Object.freeze({
      category,
      case_count: categoryCases.length,
      passed: categoryPassed,
      failed: categoryCases.length - categoryPassed,
    });
  });

  return Object.freeze({
    suite_name: input.suite_name,
    model_version: input.model_version,
    prompt_version: input.prompt_version,
    summary: Object.freeze({
      case_count: cases.length,
      passed,
      failed: cases.length - passed,
    }),
    categories: Object.freeze(categories),
    cases: Object.freeze([...cases]),
  });
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}: must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}: must be a non-empty string`);
  }
  return value;
}

function categoryValue(value: unknown, label: string): GoldenEvalCategory {
  if (typeof value !== "string" || !CATEGORY_SET.has(value)) {
    throw new Error(
      `${label}: must be one of ${GOLDEN_EVAL_CATEGORIES.join(", ")}`,
    );
  }
  return value as GoldenEvalCategory;
}
