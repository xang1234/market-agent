import { evaluateThesisMetrics } from "../../agents/src/thesis-evaluator.ts";
import type { ThesisCondition } from "../../agents/src/thesis-types.ts";
import type { EvidencePacket } from "./ports.ts";
import { buildAssessmentMessages } from "./assessment-prompts.ts";
import { normalizeRoleCitations, validateAnalystOutput, validateSkepticOutput } from "./assessment-validation.ts";
import { requestHash } from "./scout-support.ts";
import type { AnalystOutput, Brief, CandidateDecision, Citation, CriterionOutcome, Dimension, Level, RawCitation, SkepticOutput } from "./types.ts";
import type { AssessmentContext, AssessmentQuoteRequest, ValidatedRoleCheckpoint } from "./ports.ts";

const LEVEL_ORDER: Record<Level, number> = { strong: 3, mixed: 2, weak: 1, unknown: 0 };
type Role = "analyst" | "skeptic";
type RawRoleOutput = AnalystOutput<RawCitation> | SkepticOutput<RawCitation>;
type NormalizedRoleOutput = AnalystOutput<Citation> | SkepticOutput<Citation>;
type RoleRequest = AssessmentQuoteRequest & { messages: ReturnType<typeof buildAssessmentMessages> };

export async function assessCompany(context: AssessmentContext): Promise<CandidateDecision> {
  const progress = await context.loadValidatedRoles();
  if (progress.analyst === null && progress.skeptic !== null) {
    throw new Error("Skeptic checkpoint cannot exist without an Analyst checkpoint");
  }
  const analyst = await resolveRole(context, "analyst", progress.analyst);
  // The durable normalized Analyst checkpoint is saved before this independent
  // request, so an in-progress or failed Skeptic can be resumed alone.
  const skeptic = await resolveRole(context, "skeptic", progress.skeptic);
  const packet = await reloadAssessmentPacket(context);
  const validatedAnalyst = revalidateNormalizedRole("analyst", analyst.output, context, packet) as AnalystOutput<Citation>;
  const validatedSkeptic = revalidateNormalizedRole("skeptic", skeptic.output, context, packet) as SkepticOutput<Citation>;
  return decideCandidate(context.brief, packet, validatedAnalyst, validatedSkeptic, context.as_of);
}

async function reloadAssessmentPacket(context: AssessmentContext): Promise<EvidencePacket> {
  const packet = await context.reloadPacket();
  if (packet.candidate_id !== context.packet.candidate_id || packet.identity.issuer_id !== context.packet.identity.issuer_id) {
    throw new Error("reloaded evidence packet no longer matches the assessed candidate");
  }
  return packet;
}

function roleRequest(context: AssessmentContext, role: Role): RoleRequest {
  const messages = buildAssessmentMessages({ role, brief: context.brief, packet: context.packet, as_of: context.as_of });
  const request_packet_hash = requestHash(context.packet);
  const request_hash = requestHash({ kind: "campaign-assessment-v1", role, run_id: context.run_id, candidate_id: context.packet.candidate_id, brief: context.brief, packet: context.packet, messages });
  const operation_key = `${context.run_id}/research/${context.packet.candidate_id}/${role}`;
  return Object.freeze({ role, operation_key, request_hash, request_packet_hash, messages });
}

async function resolveRole(context: AssessmentContext, role: Role, stored: ValidatedRoleCheckpoint | null): Promise<ValidatedRoleCheckpoint> {
  const request = roleRequest(context, role);
  if (stored !== null) return refreshStoredRole(context, role, request, stored);
  const raw = await completeRole(context, role, request);
  const visiblePacket = await reloadAssessmentPacket(context);
  // A model response is raw evidence only. It must pass against current
  // packet visibility before it can create a source-linked quote claim.
  validateRole(role, raw, context, visiblePacket);
  const { messages: _messages, ...quoteRequest } = request;
  const citations = await context.persistQuotes(raw, visiblePacket, quoteRequest);
  const normalized = normalizeRole(role, raw, citations);
  const authorizedPacket = await reloadAssessmentPacket(context);
  const output = revalidateNormalizedRole(role, normalized, context, authorizedPacket);
  const saved = checkpoint(role, request, requestHash(authorizedPacket), output);
  await context.saveValidatedRole(saved);
  return saved;
}

async function refreshStoredRole(context: AssessmentContext, role: Role, request: RoleRequest, stored: ValidatedRoleCheckpoint): Promise<ValidatedRoleCheckpoint> {
  if (stored.role !== role || stored.request_hash !== request.request_hash || stored.request_packet_hash !== request.request_packet_hash) {
    throw new Error(`stored ${role} checkpoint does not match the original assessment request`);
  }
  const packet = await reloadAssessmentPacket(context);
  const output = revalidateNormalizedRole(role, stored.output, context, packet);
  const refreshed = checkpoint(role, request, requestHash(packet), output);
  await context.saveValidatedRole(refreshed);
  return refreshed;
}

async function completeRole(context: AssessmentContext, role: Role, request: RoleRequest): Promise<RawRoleOutput> {
  const { messages, request_hash, operation_key } = request;
  const validate = (text: string): AnalystOutput | SkepticOutput => {
    if (text.length > 100_000) throw new Error(`${role} response exceeds the response size limit`);
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new Error(`${role} response is not valid JSON`); }
    return validateRole(role, value, context, context.packet);
  };
  const initial = await context.model.complete({ operation_key, request_hash, role, phase: "research", candidate_id: context.packet.candidate_id, model_initial: true, messages });
  try {
    return validate(initial.text);
  } catch {
    const repaired = await context.model.complete({ operation_key, request_hash, attempt_number: 2, role, phase: "research", candidate_id: context.packet.candidate_id, model_initial: false, messages: repairMessages(messages) });
    return validate(repaired.text);
  }
}

function repairMessages(messages: ReadonlyArray<{ role: "system" | "user" | "assistant"; content: string }>) {
  const system = messages[0];
  if (system === undefined) throw new Error("assessment prompt is missing its system message");
  return [{ ...system, content: `${system.content} Your prior response was invalid; return only the required JSON schema.` }, ...messages.slice(1)];
}

function validateRole(role: Role, value: unknown, context: AssessmentContext, packet: EvidencePacket): RawRoleOutput {
  return role === "analyst"
    ? validateAnalystOutput(value, context.brief, packet)
    : validateSkepticOutput(value, context.brief, packet);
}

function normalizeRole(role: Role, raw: RawRoleOutput, citations: ReadonlyMap<string, Citation>): NormalizedRoleOutput {
  return role === "analyst"
    ? normalizeRoleCitations(raw as AnalystOutput<RawCitation>, citations)
    : normalizeRoleCitations(raw as SkepticOutput<RawCitation>, citations);
}

function revalidateNormalizedRole(role: Role, value: unknown, context: AssessmentContext, packet: EvidencePacket): NormalizedRoleOutput {
  const validated = validateRole(role, value, context, packet);
  for (const citation of roleCitations(validated)) {
    if (citation.kind === "excerpt") throw new Error(`stored ${role} checkpoint contains an unpersisted excerpt citation`);
  }
  return validated as NormalizedRoleOutput;
}

function roleCitations(role: RawRoleOutput): RawCitation[] {
  return [
    ...role.exposure.citations,
    ...role.business_quality.citations,
    ...role.valuation_context.citations,
    ...role.criteria.flatMap((criterion) => criterion.citations),
    ...("counterarguments" in role ? role.counterarguments.flatMap((counterargument) => counterargument.citations) : []),
  ];
}

function checkpoint(role: Role, request: AssessmentQuoteRequest, packet_hash: string, output: NormalizedRoleOutput): ValidatedRoleCheckpoint {
  return Object.freeze({ version: 1, role, request_hash: request.request_hash, request_packet_hash: request.request_packet_hash, packet_hash, output });
}

export function decideCandidate(
  brief: Brief,
  packet: EvidencePacket,
  analyst: AnalystOutput,
  skeptic: SkepticOutput,
  asOf: string,
): CandidateDecision {
  const analystCriteria = criterionMap(analyst.criteria, brief);
  const skepticCriteria = criterionMap(skeptic.criteria, brief);
  const criteria = brief.criteria.map((criterion) => criterion.metric === undefined
    ? combineNarrativeCriterion(criterion.criterion_id, analystCriteria.get(criterion.criterion_id)!, skepticCriteria.get(criterion.criterion_id)!)
    : deterministicMetricCriterion(criterion, packet, asOf));
  const exposure = conservativeDimension(analyst.exposure, skeptic.exposure);
  const quality = conservativeDimension(analyst.business_quality, skeptic.business_quality);
  const valuation = conservativeDimension(analyst.valuation_context, skeptic.valuation_context);
  const primaryCitations = currentPrimaryCitations(packet, asOf, brief.lookback_months);
  const allCitations = uniqueCitations([
    ...analyst.exposure.citations, ...skeptic.exposure.citations,
    ...analyst.business_quality.citations, ...skeptic.business_quality.citations,
    ...analyst.valuation_context.citations, ...skeptic.valuation_context.citations,
    ...criteria.flatMap((criterion) => criterion.citations),
    ...skeptic.counterarguments.flatMap((item) => item.citations),
  ]);
  const exposureSupportedByBothRoles = [analyst.exposure, skeptic.exposure]
    .every((dimension) => dimension.citations.some((citation) => citation.kind === "claim" && primaryCitations.has(citation.id)));
  const evidence = evidenceStrength(packet, allCitations, asOf, brief.lookback_months);
  const reasonCodes: string[] = [];
  const mustCriteria = brief.criteria.filter((criterion) => criterion.importance === "must");
  if (criteria.some((criterion) => mustCriteria.some((must) => must.criterion_id === criterion.criterion_id) && criterion.outcome === "fail")) {
    reasonCodes.push("required_criterion_failed");
  } else {
    if (criteria.some((criterion) => mustCriteria.some((must) => must.criterion_id === criterion.criterion_id) && criterion.outcome === "unknown")) reasonCodes.push("required_criterion_unknown");
    if (!packet.counter_search_completed) reasonCodes.push("counter_search_incomplete");
    if (!exposureSupportedByBothRoles || primaryCitations.size === 0) reasonCodes.push("primary_exposure_missing");
    if (exposure.level !== "strong" && exposure.level !== "mixed") reasonCodes.push("exposure_not_confirmed");
  }
  const state = reasonCodes.includes("required_criterion_failed")
    ? "excluded"
    : reasonCodes.length > 0 ? "needs_evidence" : "eligible_not_shortlisted";
  return Object.freeze({
    candidate_id: packet.candidate_id,
    identity: packet.identity,
    state,
    dimensions: Object.freeze({
      theme_exposure: exposure,
      evidence_strength: evidence,
      business_quality: quality,
      valuation_context: valuation,
    }),
    criteria,
    counterarguments: skeptic.counterarguments.map((item) => ({ text: item.text, citations: toCitations(item.citations) })),
    unresolved_questions: uniqueStrings([...analyst.unresolved_questions, ...skeptic.unresolved_questions]),
    next_action: analyst.next_action,
    reason_codes: reasonCodes,
  });
}

function criterionMap(criteria: CriterionOutcome<RawCitation>[], brief: Brief): Map<string, CriterionOutcome<RawCitation>> {
  const map = new Map(criteria.map((criterion) => [criterion.criterion_id, criterion]));
  if (map.size !== brief.criteria.length || brief.criteria.some((criterion) => !map.has(criterion.criterion_id))) {
    throw new Error("role output must contain every brief criterion exactly once");
  }
  return map;
}

function combineNarrativeCriterion(id: string, analyst: CriterionOutcome<RawCitation>, skeptic: CriterionOutcome<RawCitation>): CriterionOutcome<Citation> {
  const agree = analyst.outcome === skeptic.outcome;
  const outcome = agree && analyst.outcome !== "unknown" ? analyst.outcome : "unknown";
  return Object.freeze({
    criterion_id: id,
    outcome,
    explanation: outcome === "unknown" ? "Independent narrative assessments did not confirm this criterion." : analyst.explanation,
    citations: outcome === "unknown" ? [] : uniqueCitations([...analyst.citations, ...skeptic.citations]),
  });
}

function deterministicMetricCriterion(criterion: Brief["criteria"][number], packet: EvidencePacket, asOf: string): CriterionOutcome<Citation> {
  const condition: ThesisCondition = {
    condition_id: criterion.criterion_id,
    statement: criterion.statement,
    falsifier: criterion.falsifier,
    horizon: "campaign horizon",
    metric: criterion.metric,
  };
  const facts = packet.facts.filter((fact) => fact.currency === packet.identity.currency);
  const result = evaluateThesisMetrics([condition], facts, asOf)[0];
  if (result === undefined) throw new Error("metric criterion evaluation did not return a result");
  return Object.freeze({
    criterion_id: criterion.criterion_id,
    outcome: result.status === "supported" ? "pass" : result.status === "challenged" ? "fail" : "unknown",
    explanation: result.reason,
    citations: result.fact_refs.map((id): Citation => ({ kind: "fact", id })),
  });
}

function conservativeDimension(analyst: Dimension<RawCitation>, skeptic: Dimension<RawCitation>): Dimension<Citation> {
  const level = LEVEL_ORDER[analyst.level] <= LEVEL_ORDER[skeptic.level] ? analyst.level : skeptic.level;
  return Object.freeze({
    level,
    explanation: level === "unknown" ? "Independent assessments did not confirm this dimension." : analyst.explanation,
    citations: level === "unknown" ? [] : uniqueCitations([...analyst.citations, ...skeptic.citations]),
  });
}

function evidenceStrength(packet: EvidencePacket, citations: Citation[], asOf: string, lookbackMonths: number): Dimension<Citation> {
  const docs = new Map(packet.excerpts.map((excerpt) => [excerpt.document_id, excerpt]));
  const claims = new Map(packet.claims.map((claim) => [claim.claim_id, claim]));
  const citedDocs = citations.filter((citation) => citation.kind === "claim")
    .map((citation) => claims.get(citation.id)?.document_id)
    .filter((documentId): documentId is string => documentId !== undefined)
    .map((documentId) => docs.get(documentId))
    .filter((excerpt): excerpt is NonNullable<typeof excerpt> => excerpt !== undefined && currentSubstantive(excerpt, asOf, lookbackMonths));
  const familyKeys = new Set(citedDocs.map((excerpt) => excerpt.family_key));
  const hasPrimary = citedDocs.some((excerpt) => currentPrimary(excerpt, asOf, lookbackMonths));
  const level: Level = hasPrimary && familyKeys.size >= 2 ? "strong" : hasPrimary ? "mixed" : "unknown";
  return Object.freeze({
    level,
    explanation: level === "strong" ? "Independent substantive document families support the assessment." : level === "mixed" ? "One current primary document family supports the assessment." : "Current primary supporting evidence is missing.",
    citations: uniqueCitations(citations.filter((citation) => citation.kind === "claim" && citedDocs.some((excerpt) => excerpt.document_id === claims.get(citation.id)?.document_id))),
  });
}

function currentPrimaryCitations(packet: EvidencePacket, asOf: string, lookbackMonths: number): Set<string> {
  const currentDocuments = new Set(packet.excerpts.filter((excerpt) => currentPrimary(excerpt, asOf, lookbackMonths)).map((excerpt) => excerpt.document_id));
  return new Set(packet.claims.filter((claim) => currentDocuments.has(claim.document_id)).map((claim) => claim.claim_id));
}

function currentPrimary(excerpt: EvidencePacket["excerpts"][number], asOf: string, lookbackMonths: number): boolean {
  return excerpt.primary && excerpt.primary_eligible && currentSubstantive(excerpt, asOf, lookbackMonths);
}

function currentSubstantive(excerpt: EvidencePacket["excerpts"][number], asOf: string, lookbackMonths: number): boolean {
  const observedAt = Date.parse(excerpt.published_at ?? excerpt.retrieved_at);
  const observation = Date.parse(asOf);
  return Number.isFinite(observedAt) && Number.isFinite(observation) && observedAt <= observation && observation - observedAt <= lookbackMonths * 31 * 24 * 60 * 60 * 1_000;
}

function toCitations(citations: ReadonlyArray<Citation | { kind: "excerpt"; id: string; quote: string }>): Citation[] {
  return uniqueCitations(citations.map((citation) => {
    if (citation.kind === "excerpt") throw new Error("decideCandidate requires normalized quote citations");
    return citation;
  }));
}
function uniqueCitations(citations: ReadonlyArray<Citation | { kind: "excerpt"; id: string; quote: string }>): Citation[] {
  return toCitationsUnsafe(citations);
}
function toCitationsUnsafe(citations: ReadonlyArray<Citation | { kind: "excerpt"; id: string; quote: string }>): Citation[] {
  const result = new Map<string, Citation>();
  for (const citation of citations) {
    if (citation.kind === "excerpt") throw new Error("decideCandidate requires normalized quote citations");
    result.set(`${citation.kind}:${citation.id}`, citation);
  }
  return [...result.values()];
}
function uniqueStrings(values: string[]): string[] { return [...new Set(values)]; }
