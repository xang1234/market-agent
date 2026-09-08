// Browser-safe thesis contract shared by the editor, API, repository and evaluator.
export type ThesisPeriodKind = 'point' | 'fiscal_q' | 'fiscal_y' | 'ttm';
export type ThesisOperator = 'gte' | 'lte';
export type ThesisMetricCheck = {
  metric_key: string;
  unit: string;
  period_kind: ThesisPeriodKind;
  operator: ThesisOperator;
  threshold: number;
  max_age_days: number;
};

export type ThesisCondition = {
  condition_id: string;
  statement: string;
  falsifier: string;
  horizon: string;
  metric?: ThesisMetricCheck;
};

export const THESIS_TEXT_MIN = 8;
export const THESIS_TEXT_MAX = 4000;
export const THESIS_CONDITIONS_MAX = 5;
export const THESIS_REASON_MAX = 2000;

export type SaveThesisInput = {
  expected_version: number;
  thesis: string;
  conditions: ThesisCondition[];
};

export type ThesisMetricOption = {
  metric_key: string;
  label: string;
  unit: string;
  period_kind: ThesisPeriodKind;
};

export type ThesisHistory = {
  thesis: ThesisVersion | null;
  versions: ThesisVersion[];
  assessments: ThesisAssessment[];
};
export type ThesisHistoryResponse = ThesisHistory & { metrics: ThesisMetricOption[] };

export type ThesisVersion = {
  thesis_version_id: string;
  agent_id: string;
  version: number;
  thesis: string;
  subject_ref: { kind: "issuer"; id: string };
  conditions: ThesisCondition[];
  created_at: string;
};

export type ConditionAssessment = {
  condition_id: string;
  status: "supported" | "challenged" | "unresolved";
  reason: string;
  claim_refs: string[];
  fact_refs: string[];
  method: "metric" | "model" | "no_evidence";
};

export type ThesisAssessment = {
  assessment_id: string;
  thesis_version_id: string;
  run_id: string;
  snapshot_id: string;
  input_hash: string;
  results: ConditionAssessment[];
  model_version: string | null;
  prompt_version: string;
  assessed_at: string;
};

export class ThesisValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThesisValidationError";
  }
}

export class ThesisConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThesisConflictError";
  }
}

export class ThesisNotFoundError extends Error {
  constructor(message = "thesis agent not found") {
    super(message);
    this.name = "ThesisNotFoundError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERIOD_KINDS = new Set(["point", "fiscal_q", "fiscal_y", "ttm"]);
const OPERATORS = new Set(["gte", "lte"]);

export function parseThesisConditions(value: unknown): ThesisCondition[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > THESIS_CONDITIONS_MAX) {
    throw new ThesisValidationError(`conditions must contain between 1 and ${THESIS_CONDITIONS_MAX} items`);
  }

  const seenIds = new Set<string>();
  return value.map((item, index) => {
    const label = `conditions[${index}]`;
    const record = requireRecord(item, label);
    const conditionId = requireUuid(record.condition_id, `${label}.condition_id`);
    if (seenIds.has(conditionId)) {
      throw new ThesisValidationError(`${label}.condition_id must be unique`);
    }
    seenIds.add(conditionId);

    const condition: ThesisCondition = {
      condition_id: conditionId,
      statement: requireTrimmedString(record.statement, `${label}.statement`, 8, 500),
      falsifier: requireTrimmedString(record.falsifier, `${label}.falsifier`, 8, 500),
      horizon: requireTrimmedString(record.horizon, `${label}.horizon`, 1, 120),
    };

    if (record.metric !== undefined) {
      const metric = requireRecord(record.metric, `${label}.metric`);
      const periodKind = requireEnum(
        metric.period_kind,
        `${label}.metric.period_kind`,
        PERIOD_KINDS,
      ) as ThesisPeriodKind;
      const operator = requireEnum(
        metric.operator,
        `${label}.metric.operator`,
        OPERATORS,
      ) as "gte" | "lte";
      const threshold = requireFiniteNumber(metric.threshold, `${label}.metric.threshold`);
      const maxAgeDays = requireInteger(metric.max_age_days, `${label}.metric.max_age_days`, 1, 730);
      condition.metric = {
        metric_key: requireTrimmedString(metric.metric_key, `${label}.metric.metric_key`, 1, 100),
        unit: requireTrimmedString(metric.unit, `${label}.metric.unit`, 1, 100),
        period_kind: periodKind,
        operator,
        threshold,
        max_age_days: maxAgeDays,
      };
    }

    return condition;
  });
}

export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ThesisValidationError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function requireUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new ThesisValidationError(`${label} must be a UUID`);
  }
  return value;
}

export function requireTrimmedString(
  value: unknown,
  label: string,
  minLength: number,
  maxLength: number,
): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length < minLength ||
    value.length > maxLength
  ) {
    throw new ThesisValidationError(
      `${label} must be trimmed and between ${minLength} and ${maxLength} characters`,
    );
  }
  return value;
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ThesisValidationError(`${label} must be a finite number`);
  }
  return value;
}

function requireInteger(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ThesisValidationError(`${label} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function requireEnum(value: unknown, label: string, allowed: ReadonlySet<string>): string {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new ThesisValidationError(`${label} has an unsupported value`);
  }
  return value;
}

export function parseThesisText(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < THESIS_TEXT_MIN || value.trim().length > THESIS_TEXT_MAX) {
    throw new ThesisValidationError(`Thesis must be ${THESIS_TEXT_MIN}–${THESIS_TEXT_MAX} characters.`);
  }
  return value.trim();
}

export function parseThesisExpectedVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ThesisValidationError('expected_version must be a non-negative integer');
  }
  return value;
}

export function parseConditionAssessments(value: unknown): ConditionAssessment[] {
  if (!Array.isArray(value)) throw new ThesisValidationError("results must be an array");
  return value.map((item, index) => {
    const label = `results[${index}]`;
    const row = requireRecord(item, label);
    const conditionId = requireUuid(row.condition_id, `${label}.condition_id`);
    if (row.status !== "supported" && row.status !== "challenged" && row.status !== "unresolved") {
      throw new ThesisValidationError(`${label}.status is invalid`);
    }
    const reason = requireTrimmedString(row.reason, `${label}.reason`, 1, THESIS_REASON_MAX);
    const claimRefs = parseUuidArray(row.claim_refs, `${label}.claim_refs`);
    const factRefs = parseUuidArray(row.fact_refs, `${label}.fact_refs`);
    if (row.method !== "metric" && row.method !== "model" && row.method !== "no_evidence") {
      throw new ThesisValidationError(`${label}.method is invalid`);
    }
    return {
      condition_id: conditionId,
      status: row.status,
      reason,
      claim_refs: claimRefs,
      fact_refs: factRefs,
      method: row.method,
    };
  });
}

function parseUuidArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new ThesisValidationError(`${label} must be an array`);
  return value.map((item, index) => requireUuid(item, `${label}[${index}]`));
}
