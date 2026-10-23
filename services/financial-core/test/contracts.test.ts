import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import planSchema from "../../../spec/financial_plan_schema.json" with { type: "json" };
import resultSchema from "../../../spec/financial_result_schema.json" with { type: "json" };
import {
  COMPARISONS,
  FEATURE_MODES,
  FISCAL_PERIODS,
  GAP_DISPOSITIONS,
  OPERATION_KINDS,
  PARENT_KINDS,
  PUBLICATION_UNIT_KINDS,
  REASON_CODES,
  REPORTING_BASES,
  SURFACES,
  UNIT_KINDS,
} from "../src/contracts.ts";
import { PRECISION_CLASSES, SOURCE_CLASSES } from "../src/evidence-vocabulary.ts";
import {
  FinancialContractError,
  createRuntimeAuthority,
  validateBoundInput,
  validateDraftResult,
  validateFinalizedResult,
  validateFinancialPlan,
  type ValidationResult,
} from "../src/validate.ts";
import { authorityFixture, ISSUER_A, mutable, planFixture } from "./fixtures.ts";

function issueCodes(result: ValidationResult<unknown>): string[] {
  assert.equal(result.ok, false, "expected validation to fail");
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

test("a well-formed plan validates into a deep-frozen copy", () => {
  const input = planFixture();
  const result = validateFinancialPlan(input);
  assert.equal(result.ok, true, JSON.stringify(!result.ok && result.issues));
  if (!result.ok) return;
  assert.notEqual(result.value, input);
  assert.ok(Object.isFrozen(result.value));
  assert.ok(Object.isFrozen(result.value.operations[0]));
  assert.throws(() => {
    (result.value.thresholds[0] as { value: string }).value = "0.1";
  }, TypeError);
});

test("plan JSON cannot carry authority, ownership, or verification", () => {
  for (const [field, value] of [
    ["user_id", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    ["owner_user_id", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    ["verified", true],
    ["authority", authorityFixture()],
    ["mode", "enforce"],
    ["lease", { epoch: 9, fence_token: "x" }],
    ["approval_state", "approved"],
  ] as const) {
    const plan = mutable(planFixture());
    plan[field] = value;
    const result = validateFinancialPlan(plan);
    assert.deepEqual(issueCodes(result), ["unknown_field"], field);
    assert.equal(!result.ok && result.issues[0]!.path, `$.${field}`);
  }
});

test("nested verification and disposition claims are rejected", () => {
  const withVerifiedOutput = mutable(planFixture());
  withVerifiedOutput.outputs[0].verified = true;
  assert.deepEqual(issueCodes(validateFinancialPlan(withVerifiedOutput)), ["unknown_field"]);

  const withDisposition = mutable(planFixture());
  withDisposition.operations[4].disposition = "verified";
  assert.equal(validateFinancialPlan(withDisposition).ok, false);
});

test("arbitrary SQL, expressions, and unknown operations are rejected before acquisition", () => {
  const withSql = mutable(planFixture());
  withSql.operations[0].sql = "select value_num from facts";
  assert.equal(validateFinancialPlan(withSql).ok, false);

  const sqlInMetricKey = mutable(planFixture());
  sqlInMetricKey.metric_definitions[0].metric_key = "revenue'; drop table facts; --";
  assert.equal(validateFinancialPlan(sqlInMetricKey).ok, false);

  const withExpression = mutable(planFixture());
  withExpression.operations[4].expression = "numerator / revenue * 100";
  assert.equal(validateFinancialPlan(withExpression).ok, false);

  const unknownOperation = mutable(planFixture());
  unknownOperation.operations[4].operation = "divide";
  assert.equal(validateFinancialPlan(unknownOperation).ok, false);

  const formulaSource = mutable(planFixture());
  formulaSource.operations.push({ node_id: "js", operation: "javascript", operation_version: "v1", source: "process.exit()" });
  assert.equal(validateFinancialPlan(formulaSource).ok, false);
});

test("duplicate node IDs and other duplicate identities are rejected", () => {
  const duplicateNode = mutable(planFixture());
  duplicateNode.operations[1].node_id = "a_rev";
  assert.ok(issueCodes(validateFinancialPlan(duplicateNode)).includes("duplicate_node_id"));

  const duplicateSubject = mutable(planFixture());
  duplicateSubject.subjects.members[1].subject_ref.id = ISSUER_A.toUpperCase();
  assert.ok(issueCodes(validateFinancialPlan(duplicateSubject)).includes("duplicate_subject_ref"));

  const duplicateOutput = mutable(planFixture());
  duplicateOutput.outputs[1].output_id = "out_a_rev";
  assert.ok(issueCodes(validateFinancialPlan(duplicateOutput)).includes("duplicate_output_id"));
});

test("references must resolve to declared subjects, metrics, nodes, thresholds, and units", () => {
  const undeclaredSubject = mutable(planFixture());
  undeclaredSubject.operations[0].subject_slot = "c";
  assert.deepEqual(issueCodes(validateFinancialPlan(undeclaredSubject)), ["undeclared_subject"]);

  const undeclaredMetric = mutable(planFixture());
  undeclaredMetric.operations[0].metric_key = "ebitda";
  assert.deepEqual(issueCodes(validateFinancialPlan(undeclaredMetric)), ["undeclared_metric"]);

  const unknownNode = mutable(planFixture());
  unknownNode.operations[4].numerator = "missing_node";
  assert.deepEqual(issueCodes(validateFinancialPlan(unknownNode)), ["unknown_node"]);

  const unknownThreshold = mutable(planFixture());
  unknownThreshold.operations[6].threshold_id = "other";
  assert.deepEqual(issueCodes(validateFinancialPlan(unknownThreshold)), ["unknown_threshold"]);

  const unknownUnit = mutable(planFixture());
  unknownUnit.outputs[0].unit_id = "elsewhere";
  assert.deepEqual(issueCodes(validateFinancialPlan(unknownUnit)), ["unknown_publication_unit"]);

  const emptyUnit = mutable(planFixture());
  emptyUnit.publication_units.push({ unit_id: "unused", kind: "chat_section" });
  assert.deepEqual(issueCodes(validateFinancialPlan(emptyUnit)), ["empty_publication_unit"]);
});

test("subject counts must disclose omitted subjects consistently", () => {
  const hiddenOmission = mutable(planFixture());
  hiddenOmission.subjects.requested_count = 4;
  assert.deepEqual(issueCodes(validateFinancialPlan(hiddenOmission)), ["subject_count_mismatch"]);

  const disclosed = mutable(planFixture());
  disclosed.subjects.requested_count = 4;
  disclosed.subjects.omitted_count = 2;
  assert.equal(validateFinancialPlan(disclosed).ok, true);
});

test("plans cannot escalate execution budgets beyond the versioned defaults", () => {
  for (const [field, value] of [
    ["max_subjects", 26],
    ["max_periods_per_subject", 21],
    ["max_operations", 513],
    ["max_outputs", 2001],
    ["max_input_candidates", 10001],
    ["max_concurrent_evidence_tasks", 5],
  ] as const) {
    const plan = mutable(planFixture());
    plan.limits[field] = value;
    assert.equal(validateFinancialPlan(plan).ok, false, field);
  }
});

test("financial amounts must be canonical decimal strings, never JSON numbers", () => {
  for (const value of [0.4, "0.40", "-0", "+0.4", ".4", "4e-1", "NaN", " 0.4"]) {
    const plan = mutable(planFixture());
    plan.thresholds[0].value = value;
    assert.equal(validateFinancialPlan(plan).ok, false, String(value));
  }
  const negative = mutable(planFixture());
  negative.thresholds[0].value = "-12.5";
  assert.equal(validateFinancialPlan(negative).ok, true);
});

test("cutoff and time zone must be real", () => {
  const impossible = mutable(planFixture());
  impossible.time.knowledge_cutoff = "2023-02-30T00:00:00Z";
  assert.deepEqual(issueCodes(validateFinancialPlan(impossible)), ["invalid_cutoff"]);

  const noOffset = mutable(planFixture());
  noOffset.time.knowledge_cutoff = "2024-01-15T12:00:00";
  assert.equal(validateFinancialPlan(noOffset).ok, false);

  const zone = mutable(planFixture());
  zone.time.cutoff_timezone = "Mars/Olympus_Mons";
  assert.deepEqual(issueCodes(validateFinancialPlan(zone)), ["invalid_timezone"]);
});

test("runtime authority is constructed only from validated server input", () => {
  const authority = createRuntimeAuthority(authorityFixture());
  assert.ok(Object.isFrozen(authority));
  assert.ok(Object.isFrozen(authority.parent));

  const escalated = mutable(authorityFixture());
  escalated.feature.mode = "god";
  assert.throws(() => createRuntimeAuthority(escalated), FinancialContractError);

  const disabled = mutable(authorityFixture());
  disabled.feature.mode = "off";
  assert.throws(() => createRuntimeAuthority(disabled), FinancialContractError, "the engine has no off mode");

  const extra = mutable(authorityFixture());
  extra.verified = true;
  assert.throws(() => createRuntimeAuthority(extra), FinancialContractError);
});

const RESULT_ID = "55555555-5555-4555-8555-555555555555";
const HASH = "a".repeat(64);

function draftValue(): any {
  return {
    schema_version: "financial_result.v1",
    result_id: RESULT_ID,
    output_id: "out_a_gm",
    node_id: "a_gm",
    unit_id: "section",
    dependencies: ["a_gp", "a_rev"],
    state: "draft",
    disposition: "computed",
    payload: { kind: "value", value: "0.4375", unit: { kind: "ratio" }, exact: true, rounding: null },
  };
}

test("draft results cannot award verification", () => {
  assert.equal(validateDraftResult(draftValue()).ok, true);

  const selfVerified = draftValue();
  selfVerified.disposition = "verified";
  assert.equal(validateDraftResult(selfVerified).ok, false);

  const finalizedClaim = draftValue();
  finalizedClaim.state = "finalized";
  assert.equal(validateDraftResult(finalizedClaim).ok, false);

  const numericValue = draftValue();
  numericValue.payload.value = 0.4375;
  assert.equal(validateDraftResult(numericValue).ok, false);
});

test("gaps carry reason codes instead of zero or fabricated values", () => {
  const gap = draftValue();
  gap.disposition = "undefined";
  gap.payload = { kind: "gap", reason_code: "zero_denominator", explanation: "Revenue is zero for FY2023." };
  assert.equal(validateDraftResult(gap).ok, true);

  const gapWithValue = draftValue();
  gapWithValue.disposition = "missing";
  assert.equal(validateDraftResult(gapWithValue).ok, false);

  const successWithGap = draftValue();
  successWithGap.payload = gap.payload;
  assert.equal(validateDraftResult(successWithGap).ok, false);

  const unknownReason = mutable(gap);
  unknownReason.payload.reason_code = "model_guess";
  assert.equal(validateDraftResult(unknownReason).ok, false);
});

test("finalized results require a result hash", () => {
  const finalized = { ...draftValue(), state: "finalized", disposition: "verified", result_hash: HASH };
  assert.equal(validateFinalizedResult(finalized).ok, true);
  const { result_hash: _hash, ...withoutHash } = finalized;
  assert.equal(validateFinalizedResult(withoutHash).ok, false);
});

function boundInput(): any {
  return {
    schema_version: "financial_bound_input.v1",
    input_slot: "a_rev",
    fact_id: "66666666-6666-4666-8666-666666666666",
    subject_ref: { kind: "issuer", id: ISSUER_A },
    metric: { metric_key: "revenue", definition_version: "revenue.v1" },
    source: { source_id: "77777777-7777-4777-8777-777777777777", document_id: null, source_version_hash: HASH, locator: "us-gaap:Revenues" },
    numeric: { raw_token: "383285000000", token_proof_hash: HASH, value: "383285", scale: "1000000", native_value: "383285000000" },
    unit: { kind: "currency", currency: "USD" },
    period: { kind: "duration", start: "2022-09-25", end: "2023-09-30", fiscal_year: 2023, fiscal_period: "FY", calendar_version: "fiscal-calendar.v1" },
    dimensions: { scope: "consolidated", members: [] },
    basis: { reporting: "as_reported", adjustment: "unadjusted", share_basis: "not_applicable" },
    publication: {
      attestation_id: "88888888-8888-4888-8888-888888888888",
      available_no_later_than: "2023-11-03T23:59:59.999-04:00",
      precision: "date",
      source_timezone: "America/New_York",
    },
    observed_at: "2024-02-01T00:00:00Z",
    precision_status: "source_token_preserved",
    eligibility: { selection_policy_version: "selection.v1", promotion_status: "authoritative", candidate_set_digest: HASH },
  };
}

test("bound inputs require proven precision and publication evidence", () => {
  assert.equal(validateBoundInput(boundInput()).ok, true);

  const legacy = boundInput();
  legacy.precision_status = "legacy_unverified";
  assert.equal(validateBoundInput(legacy).ok, false);

  const noAttestation = boundInput();
  delete noAttestation.publication;
  assert.equal(validateBoundInput(noAttestation).ok, false);

  const estimated = boundInput();
  estimated.eligibility.promotion_status = "estimated";
  assert.equal(validateBoundInput(estimated).ok, false);

  const oversizedToken = boundInput();
  oversizedToken.numeric.raw_token = "9".repeat(257);
  assert.equal(validateBoundInput(oversizedToken).ok, false);
});

test("a derived input carries its derivation, whose terms are filed values of the year's first three quarters or the year (#481)", () => {
  const term = (sign: string, span: string, fiscal_period: string, start: string, end: string, filed: string) => ({
    sign, span, fiscal_year: 2023, fiscal_period, start, end, raw_token: "1", token_proof_hash: HASH,
    source: { source_id: "77777777-7777-4777-8777-777777777777", accession: `0000320193-23-${fiscal_period}`, form: "10-Q", filed, locator: "us-gaap:NetCashProvidedByUsedInOperatingActivities" },
  });
  const yearToDate = term("+", "year_to_date", "Q2", "2022-09-25", "2023-04-01", "2023-05-05");
  const firstQuarter = term("-", "quarter", "Q1", "2022-09-25", "2022-12-31", "2023-02-03");
  const derived = boundInput();
  derived.precision_status = "derived_from_source_tokens";
  derived.derivation = { version: "period_difference.v1", concept: "NetCashProvidedByUsedInOperatingActivities", unit: "USD", terms: [yearToDate, firstQuarter] };
  assert.equal(validateBoundInput(derived).ok, true);
  for (const tampered of [{ ...firstQuarter, fiscal_period: "Q4" }, { ...firstQuarter, sign: "*" }, { ...firstQuarter, value: "1" }]) {
    derived.derivation.terms = [yearToDate, tampered];
    assert.equal(validateBoundInput(derived).ok, false, JSON.stringify(tampered));
  }
  derived.derivation.terms = [yearToDate];
  assert.equal(validateBoundInput(derived).ok, false, "a derivation has at least two terms");
});

test("a bound input carries a derivation exactly when its precision status is derived_from_source_tokens (#481)", () => {
  const derivation = { version: "period_difference.v1" as const, concept: "Revenues", unit: "USD", terms: [1, 2].map((n) => ({
    sign: n === 1 ? ("+" as const) : ("-" as const), span: "quarter" as const, fiscal_year: 2023, fiscal_period: "Q1" as const, start: "2023-01-01", end: "2023-03-31", raw_token: "1", token_proof_hash: HASH,
    source: { source_id: "77777777-7777-4777-8777-777777777777", accession: `acc-${n}`, form: "10-Q", filed: "2023-05-05", locator: "loc" },
  })) };
  const derivedWithout = boundInput();
  derivedWithout.precision_status = "derived_from_source_tokens";
  assert.equal(validateBoundInput(derivedWithout).ok, false, "a derived status needs its derivation");
  assert.equal(validateBoundInput({ ...derivedWithout, derivation }).ok, true);
  const tokenWith = boundInput();
  assert.equal(validateBoundInput(tokenWith).ok, true);
  assert.equal(validateBoundInput({ ...tokenWith, derivation }).ok, false, "only a derived status carries a derivation");
});

// ---------------------------------------------------------------------------
// Schema <-> TypeScript agreement

function enumAt(schema: { $defs: Record<string, any> }, ...path: string[]): string[] {
  let node: any = schema.$defs;
  for (const segment of path) node = node[segment];
  return node.enum ?? [node.const];
}

test("schema enums agree with TypeScript discriminated unions", () => {
  const plan = planSchema as { $defs: Record<string, any> };
  const result = resultSchema as { $defs: Record<string, any> };

  const operations = plan.$defs.OperationNode.oneOf.flatMap((ref: { $ref: string }) => {
    const def = ref.$ref.replace("#/$defs/", "");
    return enumAt(plan, def, "properties", "operation");
  });
  assert.deepEqual([...operations].sort(), [...OPERATION_KINDS].sort());
  assert.deepEqual(enumAt(plan, "Comparison"), [...COMPARISONS]);
  assert.deepEqual(enumAt(plan, "ReportingBasis"), [...REPORTING_BASES]);
  assert.deepEqual(enumAt(plan, "FiscalPeriod"), [...FISCAL_PERIODS]);
  assert.deepEqual(enumAt(plan, "Surface"), [...SURFACES]);
  assert.deepEqual(enumAt(plan, "FinancialRuntimeAuthorityV1", "properties", "egress_channel"), [...SURFACES, "api"]);
  assert.deepEqual(enumAt(plan, "FinancialRuntimeAuthorityV1", "properties", "parent", "properties", "kind"), [...PARENT_KINDS]);
  assert.deepEqual(enumAt(plan, "PublicationUnit", "properties", "kind"), [...PUBLICATION_UNIT_KINDS]);
  assert.deepEqual(
    enumAt(plan, "FinancialRuntimeAuthorityV1", "properties", "feature", "properties", "mode"),
    [...FEATURE_MODES],
  );
  assert.deepEqual(enumAt(plan, "FinancialRuntimeAuthorityV1", "properties", "allowed_source_classes", "items"), [...SOURCE_CLASSES]);
  const units = plan.$defs.FinancialUnit.oneOf.flatMap((branch: any) => branch.properties.kind.enum);
  assert.deepEqual([...units].sort(), [...UNIT_KINDS].sort());
  assert.deepEqual(enumAt(result, "BoundFactInputV1", "properties", "precision_status"), PRECISION_CLASSES.filter((precision) => precision !== "legacy_unverified"));
  assert.deepEqual(enumAt(result, "GapDisposition"), [...GAP_DISPOSITIONS]);
  assert.deepEqual(enumAt(result, "ReasonCode"), [...REASON_CODES]);
});

test("the database admits exactly the engine's parent kinds and publication unit kinds", async () => {
  const schema = await readFile(new URL("../../../spec/finance_research_db_schema.sql", import.meta.url), "utf8");
  const admitted = (column: string) => {
    const list = new RegExp(`${column} text not null check \\(${column} in \\(([^)]*)\\)\\)`, "u").exec(schema)?.[1];
    assert.ok(list, `the schema declares ${column}'s check`);
    return list.split(",").map((value) => value.trim().replace(/^'|'$/gu, ""));
  };
  assert.deepEqual(admitted("parent_kind"), [...PARENT_KINDS]);
  assert.deepEqual(admitted("unit_kind"), [...PUBLICATION_UNIT_KINDS]);
});

test("measure_defaults is optional and records each cited family exactly (#517)", () => {
  const withDefaults = (measureDefaults: unknown) => ({ ...mutable(planFixture()), measure_defaults: measureDefaults });
  assert.equal(validateFinancialPlan(planFixture()).ok, true);
  const valid = withDefaults([
    { family: "profit", table_version: "measure-defaults.v1", period: "default" },
    { family: "revenue", table_version: "measure-defaults.v1", period: "requested", requested_period: { kind: "latest", period_type: "quarterly", offset: 0 } },
  ]);
  const accepted = validateFinancialPlan(valid);
  assert.equal(accepted.ok, true, JSON.stringify(!accepted.ok && accepted.issues));
  assert.deepEqual(accepted.ok && accepted.value.measure_defaults, valid.measure_defaults);

  for (const [name, measureDefaults] of [
    ["empty list", []],
    ["unknown period", [{ family: "profit", table_version: "measure-defaults.v1", period: "latest" }]],
    ["requested without its period", [{ family: "profit", table_version: "measure-defaults.v1", period: "requested" }]],
    ["default with a period", [{ family: "profit", table_version: "measure-defaults.v1", period: "default", requested_period: { kind: "at_cutoff" } }]],
    ["missing version", [{ family: "profit", period: "default" }]],
    ["extra field", [{ family: "profit", table_version: "measure-defaults.v1", period: "default", metrics: ["net_income"] }]],
    ["malformed family", [{ family: "Profit!", table_version: "measure-defaults.v1", period: "default" }]],
    ["malformed period", [{ family: "revenue", table_version: "measure-defaults.v1", period: "requested", requested_period: { kind: "latest", period_type: "monthly", offset: 0 } }]],
  ] as const) {
    assert.equal(validateFinancialPlan(withDefaults(measureDefaults)).ok, false, name);
  }
});
