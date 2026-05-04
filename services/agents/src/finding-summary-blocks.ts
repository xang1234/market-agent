import { assertSubjectRef, type SubjectRef } from "../../resolver/src/subject-ref.ts";
import type { FindingSeverity } from "./severity-scorer.ts";

export type FindingCardBlock = {
  id: string;
  kind: "finding_card";
  snapshot_id: string;
  data_ref: {
    kind: "finding_card";
    id: string;
  };
  source_refs: ReadonlyArray<string>;
  as_of: string;
  finding_id: string;
  headline: string;
  severity: FindingSeverity;
  subject_refs?: ReadonlyArray<SubjectRef>;
};

export type FindingSummaryBlocksInput = {
  finding_id: string;
  snapshot_id: string;
  headline: string;
  severity: FindingSeverity;
  subject_refs?: ReadonlyArray<SubjectRef>;
  source_refs: ReadonlyArray<string>;
  as_of: string;
};

export class FindingSummaryBlockValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FindingSummaryBlockValidationError";
  }
}

const FINDING_SEVERITIES: ReadonlySet<string> = new Set(["low", "medium", "high", "critical"]);
const DATE_TIME_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/;

export function buildFindingSummaryBlocks(
  input: FindingSummaryBlocksInput,
): ReadonlyArray<FindingCardBlock> {
  assertFindingSummaryBlocksInput(input);

  const block: FindingCardBlock = {
    id: `finding-card-${input.finding_id}`,
    kind: "finding_card",
    snapshot_id: input.snapshot_id,
    data_ref: { kind: "finding_card", id: input.finding_id },
    source_refs: [...input.source_refs],
    as_of: input.as_of,
    finding_id: input.finding_id,
    headline: input.headline.trim(),
    severity: input.severity,
  };

  if (input.subject_refs !== undefined) {
    block.subject_refs = input.subject_refs.map((ref) => ({ ...ref }));
  }

  return Object.freeze([Object.freeze(block)]);
}

function assertFindingSummaryBlocksInput(input: FindingSummaryBlocksInput): void {
  assertUuidString(input.finding_id, "finding_id");
  assertUuidString(input.snapshot_id, "snapshot_id");
  assertNonEmptyString(input.headline, "headline");
  if (!FINDING_SEVERITIES.has(input.severity)) {
    throw new FindingSummaryBlockValidationError("severity must be low, medium, high, or critical");
  }
  if (!Array.isArray(input.source_refs)) {
    throw new FindingSummaryBlockValidationError("source_refs must be an array");
  }
  input.source_refs.forEach((sourceRef, index) => assertUuidString(sourceRef, `source_refs[${index}]`));
  assertDateTimeString(input.as_of, "as_of");
  input.subject_refs?.forEach((subjectRef, index) => {
    try {
      assertSubjectRef(subjectRef, `subject_refs[${index}]`);
    } catch (error) {
      throw new FindingSummaryBlockValidationError(
        (error as Error).message,
      );
    }
  });
}

function assertUuidString(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      value,
    )
  ) {
    throw new FindingSummaryBlockValidationError(`${field} must be a UUID`);
  }
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new FindingSummaryBlockValidationError(`${field} must be a non-empty string`);
  }
}

function assertDateTimeString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !DATE_TIME_WITH_OFFSET.test(value) || Number.isNaN(Date.parse(value))) {
    throw new FindingSummaryBlockValidationError(`${field} must be an ISO date-time string`);
  }
}
