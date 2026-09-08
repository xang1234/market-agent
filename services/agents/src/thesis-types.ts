export type ThesisCondition = {
  condition_id: string;
  statement: string;
  falsifier: string;
  horizon: string;
  metric?: {
    metric_key: string;
    unit: string;
    period_kind: "point" | "fiscal_q" | "fiscal_y" | "ttm";
    operator: "gte" | "lte";
    threshold: number;
    max_age_days: number;
  };
};

type ThesisMetric = NonNullable<ThesisCondition["metric"]>;

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
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) {
    throw new ThesisValidationError("conditions must contain between 1 and 5 items");
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
      ) as ThesisMetric["period_kind"];
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

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ThesisValidationError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new ThesisValidationError(`${label} must be a UUID`);
  }
  return value;
}

function requireTrimmedString(
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
