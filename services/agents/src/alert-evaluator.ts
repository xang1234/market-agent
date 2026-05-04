import type { JsonValue } from "../../observability/src/types.ts";
import type { QueryExecutor } from "./agent-repo.ts";
import {
  compileAlertRule,
  type AlertRule,
  type AlertTriggerRef,
} from "./alert-rule-compiler.ts";
import type { FindingRow } from "./finding-generator.ts";

export type AlertFiredStatus = "pending_notification" | "notified" | "failed" | "acknowledged";

export type AlertFiredRow = {
  alert_fired_id: string;
  agent_id: string;
  run_id: string;
  rule_id: string;
  finding_id: string;
  channels: ReadonlyArray<string>;
  trigger_refs: ReadonlyArray<AlertTriggerRef>;
  status: AlertFiredStatus;
  fired_at: string;
};

export type EvaluateAgentAlertsInput = {
  agent_id: string;
  run_id: string;
  alert_rules: ReadonlyArray<unknown>;
  findings: ReadonlyArray<FindingRow>;
};

export type EvaluateAgentAlertsResult = {
  evaluated_rules: number;
  evaluated_findings: number;
  fired: ReadonlyArray<AlertFiredRow>;
};

type AlertFiredDbRow = {
  alert_fired_id: string;
  agent_id: string;
  run_id: string;
  rule_id: string;
  finding_id: string;
  channels: unknown;
  trigger_refs: unknown;
  status: AlertFiredStatus;
  fired_at: Date | string;
};

const SELECT_COLUMNS = `alert_fired_id::text as alert_fired_id,
       agent_id::text as agent_id,
       run_id::text as run_id,
       rule_id,
       finding_id::text as finding_id,
       channels,
       trigger_refs,
       status,
       fired_at`;

export class AlertEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlertEvaluationError";
  }
}

export async function evaluateAgentAlerts(
  db: QueryExecutor,
  input: EvaluateAgentAlertsInput,
): Promise<EvaluateAgentAlertsResult> {
  assertUuidString(input.agent_id, "agent_id");
  assertUuidString(input.run_id, "run_id");
  if (!Array.isArray(input.alert_rules)) {
    throw new AlertEvaluationError("alert_rules must be an array");
  }
  if (!Array.isArray(input.findings)) {
    throw new AlertEvaluationError("findings must be an array");
  }
  input.findings.forEach((finding, index) => {
    if (finding.agent_id !== input.agent_id) {
      throw new AlertEvaluationError(`findings[${index}].agent_id must match agent_id`);
    }
  });

  const compiledRules = input.alert_rules.map((rule) => compileAlertRule(rule));
  const fired: AlertFiredRow[] = [];

  for (const rule of compiledRules) {
    for (const finding of input.findings) {
      const evaluation = rule.evaluateFinding(finding);
      if (!evaluation.matched) continue;
      fired.push(
        await insertAlertFiring(db, {
          agent_id: input.agent_id,
          run_id: input.run_id,
          rule: rule.rule,
          finding_id: finding.finding_id,
          trigger_refs: evaluation.trigger_refs,
        }),
      );
    }
  }

  return Object.freeze({
    evaluated_rules: compiledRules.length,
    evaluated_findings: input.findings.length,
    fired: Object.freeze(fired),
  });
}

async function insertAlertFiring(
  db: QueryExecutor,
  input: {
    agent_id: string;
    run_id: string;
    rule: AlertRule;
    finding_id: string;
    trigger_refs: ReadonlyArray<AlertTriggerRef>;
  },
): Promise<AlertFiredRow> {
  const { rows } = await db.query<AlertFiredDbRow>(
    `insert into alerts_fired
       (agent_id, run_id, rule_id, finding_id, channels, trigger_refs, status)
     values ($1::uuid, $2::uuid, $3, $4::uuid, $5::jsonb, $6::jsonb, 'pending_notification')
     on conflict (agent_id, run_id, rule_id, finding_id)
     do update set status = alerts_fired.status
     returning ${SELECT_COLUMNS}`,
    [
      input.agent_id,
      input.run_id,
      input.rule.rule_id,
      input.finding_id,
      JSON.stringify(input.rule.channels),
      JSON.stringify(input.trigger_refs),
    ],
  );
  return rowFromDb(rows[0]);
}

function rowFromDb(row: AlertFiredDbRow | undefined): AlertFiredRow {
  if (!row) throw new AlertEvaluationError("alerts_fired insert did not return a row");
  return Object.freeze({
    alert_fired_id: row.alert_fired_id,
    agent_id: row.agent_id,
    run_id: row.run_id,
    rule_id: row.rule_id,
    finding_id: row.finding_id,
    channels: freezeStringArray(row.channels, "channels"),
    trigger_refs: freezeJsonArray(row.trigger_refs, "trigger_refs") as ReadonlyArray<AlertTriggerRef>,
    status: row.status,
    fired_at: row.fired_at instanceof Date ? row.fired_at.toISOString() : row.fired_at,
  });
}

function freezeStringArray(value: unknown, field: string): ReadonlyArray<string> {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new AlertEvaluationError(`alerts_fired row ${field} must be a string array`);
  }
  return Object.freeze([...value]);
}

function freezeJsonArray(value: unknown, field: string): ReadonlyArray<JsonValue> {
  if (!Array.isArray(value)) {
    throw new AlertEvaluationError(`alerts_fired row ${field} must be an array`);
  }
  return Object.freeze(value.map((item) => deepFreezeJson(item as JsonValue)));
}

function deepFreezeJson<T extends JsonValue>(value: T): T {
  if (Array.isArray(value)) {
    value.forEach((item) => deepFreezeJson(item));
    return Object.freeze(value) as T;
  }
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach((item) => deepFreezeJson(item));
    return Object.freeze(value) as T;
  }
  return value;
}

function assertUuidString(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new AlertEvaluationError(`${label} must be a UUID`);
  }
}
