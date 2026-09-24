import type { Coverage, Limits, Resource } from "./types.ts";

export const POLICY_VERSION = "discovery-v1";
export const ATTEMPT_LIMITS: Record<Resource, number> = { search: 80, document: 150, identity: 120, financial: 50, model: 64 };
export const SEARCH_PHASE_LIMITS = Object.freeze({ discovery: 20, research: 50, verification: 10 });
export const DEFAULT_LIMITS: Limits = Object.freeze({ candidates: 100, research: 25, shortlist: 10, attempts: ATTEMPT_LIMITS, input_chars: 64_000, output_tokens: 10_000, request_timeout_ms: 30_000, run_timeout_ms: 2_700_000 });
export const EMPTY_COVERAGE: Coverage = Object.freeze({ searches_planned: 0, searches_completed: 0, hits_truncated: 0, leads_overflow: 0, extraction_batches_skipped: 0, unresolved: 0, discovered: 0, selected: 0, assessed: 0, not_selected: 0, mechanisms: [], gaps: [] });
export const EMPTY_CHECKPOINT = Object.freeze({ version: 1 as const, stage: "queued" as const, cohort: [], next_company: 0, completed_operation_keys: [] });
export const EMPTY_USAGE: Record<Resource, number> = Object.freeze({ search: 0, document: 0, identity: 0, financial: 0, model: 0 });
export const EMPTY_PHASE_USAGE = Object.freeze({ search: { discovery: 0, research: 0, verification: 0 } });
