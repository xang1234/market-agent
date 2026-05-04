import { assertSubjectRef, type SubjectRef } from "../../resolver/src/subject-ref.ts";
import type { FindingSeverity } from "./severity-scorer.ts";

export type AlertRule = {
  rule_id: string;
  subject?: SubjectRef;
  severity_at_least?: FindingSeverity;
  headline_contains?: string;
  claim_cluster_id_in?: ReadonlyArray<string>;
  channels: ReadonlyArray<string>;
};

export type AlertFindingInput = {
  finding_id: string;
  subject_refs: ReadonlyArray<SubjectRef>;
  claim_cluster_ids: ReadonlyArray<string>;
  severity: FindingSeverity;
  headline: string;
};

export type AlertTriggerRef =
  | { kind: "finding"; id: string }
  | { kind: "subject"; subject: SubjectRef }
  | { kind: "claim_cluster"; id: string };

export type AlertRuleEvaluation =
  | {
      matched: true;
      trigger_refs: ReadonlyArray<AlertTriggerRef>;
      unmet_predicates: ReadonlyArray<never>;
    }
  | {
      matched: false;
      trigger_refs: ReadonlyArray<never>;
      unmet_predicates: ReadonlyArray<string>;
    };

export type CompiledAlertRule = {
  rule: AlertRule;
  rule_id: string;
  channels: ReadonlyArray<string>;
  evaluateFinding(finding: AlertFindingInput): AlertRuleEvaluation;
};

export class AlertRuleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlertRuleValidationError";
  }
}

const ALLOWED_FIELDS = new Set([
  "rule_id",
  "subject",
  "severity_at_least",
  "headline_contains",
  "claim_cluster_id_in",
  "channels",
]);
const PRIVATE_FIELD_NAMES = new Set([
  "raw_blob_url",
  "raw_blob_id",
  "raw_bytes",
  "raw_html",
  "raw_pdf",
  "raw_text",
  "raw_transcript",
  "raw_content",
  "document_bytes",
]);
const SEVERITY_RANK: Record<FindingSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export function compileAlertRule(rawRule: unknown): CompiledAlertRule {
  assertAlertRule(rawRule);
  const rule = freezeAlertRule(rawRule);

  return Object.freeze({
    rule,
    rule_id: rule.rule_id,
    channels: rule.channels,
    evaluateFinding(finding: AlertFindingInput): AlertRuleEvaluation {
      assertFindingInput(finding);
      const unmet: string[] = [];
      const triggerRefs: AlertTriggerRef[] = [{ kind: "finding", id: finding.finding_id }];

      if (rule.subject) {
        const matchedSubject = finding.subject_refs.find((ref) => sameSubjectRef(ref, rule.subject));
        if (matchedSubject) {
          triggerRefs.push({ kind: "subject", subject: matchedSubject });
        } else {
          unmet.push("subject");
        }
      }

      if (
        rule.severity_at_least &&
        SEVERITY_RANK[finding.severity] < SEVERITY_RANK[rule.severity_at_least]
      ) {
        unmet.push("severity_at_least");
      }

      if (
        rule.headline_contains &&
        !finding.headline.toLocaleLowerCase("en-US").includes(rule.headline_contains.toLocaleLowerCase("en-US"))
      ) {
        unmet.push("headline_contains");
      }

      if (rule.claim_cluster_id_in && rule.claim_cluster_id_in.length > 0) {
        const allowed = new Set(rule.claim_cluster_id_in);
        const matchedClusters = finding.claim_cluster_ids.filter((id) => allowed.has(id));
        if (matchedClusters.length === 0) {
          unmet.push("claim_cluster_id_in");
        } else {
          matchedClusters.sort().forEach((id) => triggerRefs.push({ kind: "claim_cluster", id }));
        }
      }

      if (unmet.length > 0) {
        return Object.freeze({
          matched: false,
          trigger_refs: Object.freeze([]),
          unmet_predicates: Object.freeze(unmet),
        });
      }

      return Object.freeze({
        matched: true,
        trigger_refs: Object.freeze(triggerRefs),
        unmet_predicates: Object.freeze([]),
      });
    },
  });
}

function assertAlertRule(value: unknown): asserts value is AlertRule {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AlertRuleValidationError("alert rule must be an object");
  }
  rejectPrivateFields(value, "rule");
  for (const field of Object.keys(value)) {
    if (!ALLOWED_FIELDS.has(field)) {
      throw new AlertRuleValidationError(`unsupported alert rule field "${field}"`);
    }
  }
  const rule = value as Partial<AlertRule>;
  assertNonEmptyString(rule.rule_id, "rule_id");
  if (rule.subject !== undefined) {
    try {
      assertSubjectRef(rule.subject, "subject");
    } catch (error) {
      throw new AlertRuleValidationError(error instanceof Error ? error.message : String(error));
    }
  }
  if (rule.severity_at_least !== undefined && !(rule.severity_at_least in SEVERITY_RANK)) {
    throw new AlertRuleValidationError("severity_at_least must be low, medium, high, or critical");
  }
  if (rule.headline_contains !== undefined) {
    assertNonEmptyString(rule.headline_contains, "headline_contains");
  }
  if (rule.claim_cluster_id_in !== undefined) {
    assertUuidArray(rule.claim_cluster_id_in, "claim_cluster_id_in");
  }
  assertChannelArray(rule.channels, "channels");
}

function assertFindingInput(finding: AlertFindingInput): void {
  assertUuidString(finding.finding_id, "finding_id");
  if (!Array.isArray(finding.subject_refs)) {
    throw new AlertRuleValidationError("subject_refs must be an array");
  }
  finding.subject_refs.forEach((ref, index) => {
    try {
      assertSubjectRef(ref, `subject_refs[${index}]`);
    } catch (error) {
      throw new AlertRuleValidationError(error instanceof Error ? error.message : String(error));
    }
  });
  assertUuidArray(finding.claim_cluster_ids, "claim_cluster_ids");
  if (!(finding.severity in SEVERITY_RANK)) {
    throw new AlertRuleValidationError("severity must be low, medium, high, or critical");
  }
  assertNonEmptyString(finding.headline, "headline");
}

function assertChannelArray(value: unknown, label: string): asserts value is ReadonlyArray<string> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AlertRuleValidationError(`${label} must be a non-empty array`);
  }
  value.forEach((channel, index) => assertNonEmptyString(channel, `${label}[${index}]`));
}

function assertUuidArray(value: unknown, label: string): asserts value is ReadonlyArray<string> {
  if (!Array.isArray(value)) {
    throw new AlertRuleValidationError(`${label} must be an array`);
  }
  value.forEach((id, index) => assertUuidString(id, `${label}[${index}]`));
}

function assertUuidString(value: unknown, label: string): asserts value is string {
  assertNonEmptyString(value, label);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new AlertRuleValidationError(`${label} must be a UUID`);
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AlertRuleValidationError(`${label} must be a non-empty string`);
  }
}

function sameSubjectRef(left: SubjectRef, right: SubjectRef): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function freezeAlertRule(rule: AlertRule): AlertRule {
  return Object.freeze({
    ...rule,
    ...(rule.subject ? { subject: Object.freeze({ ...rule.subject }) } : {}),
    ...(rule.claim_cluster_id_in
      ? { claim_cluster_id_in: Object.freeze([...rule.claim_cluster_id_in].sort()) }
      : {}),
    channels: Object.freeze([...rule.channels]),
  });
}

function rejectPrivateFields(value: unknown, path: string): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectPrivateFields(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (PRIVATE_FIELD_NAMES.has(key)) {
      throw new AlertRuleValidationError(`${path}.${key} is not allowed in alert rules`);
    }
    rejectPrivateFields(child, `${path}.${key}`);
  }
}
