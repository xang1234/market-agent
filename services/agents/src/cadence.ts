export const AGENT_CADENCES = ["hourly", "daily", "on-filing"] as const;
export type AgentCadence = (typeof AGENT_CADENCES)[number];

export type IntervalAgentSchedule = {
  cadence: Extract<AgentCadence, "hourly" | "daily">;
  kind: "interval";
  interval_ms: number;
};

export type EventAgentSchedule = {
  cadence: Extract<AgentCadence, "on-filing">;
  kind: "event";
  event: "filing_ingested";
};

export type AgentSchedule = IntervalAgentSchedule | EventAgentSchedule;

export class CadenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CadenceValidationError";
  }
}

export function compileAgentCadence(cadence: string): AgentSchedule {
  if (cadence === "hourly") {
    return Object.freeze({
      cadence,
      kind: "interval",
      interval_ms: 60 * 60 * 1000,
    });
  }
  if (cadence === "daily") {
    return Object.freeze({
      cadence,
      kind: "interval",
      interval_ms: 24 * 60 * 60 * 1000,
    });
  }
  if (cadence === "on-filing") {
    return Object.freeze({
      cadence,
      kind: "event",
      event: "filing_ingested",
    });
  }
  throw new CadenceValidationError(
    `cadence: must be one of ${AGENT_CADENCES.join(", ")}`,
  );
}

export function nextDueAt(schedule: AgentSchedule, lastRunAt: string | Date): string | null {
  if (schedule.kind === "event") return null;
  const lastRunMs = lastRunAt instanceof Date ? lastRunAt.getTime() : Date.parse(lastRunAt);
  if (!Number.isFinite(lastRunMs)) {
    throw new CadenceValidationError("lastRunAt: must be a valid date");
  }
  return new Date(lastRunMs + schedule.interval_ms).toISOString();
}
