import { evaluateThesisMetrics } from "../../agents/src/thesis-evaluator.ts";
import type { ThesisCondition } from "../../agents/src/thesis-types.ts";
import type { EvidencePacket } from "./ports.ts";
import { buildAssessmentMessages } from "./assessment-prompts.ts";
import { normalizeRoleCitations, validateAnalystOutput, validateSkepticOutput } from "./assessment-validation.ts";
import { requestHash } from "./scout-support.ts";
import type { AnalystOutput, Brief, CandidateDecision, Citation, CriterionOutcome, Dimension, Level, RawCitation, SkepticOutput } from "./types.ts";
import type { AssessmentContext, ValidatedRoleCheckpoint } from "./ports.ts";

const LEVEL_ORDER: Record<Level, number> = { strong: 3, mixed: 2, weak: 1, unknown: 0 };

export async function assessCompany(context: AssessmentContext): Promise<CandidateDecision> {
  const analyst = await completeRole(context, "analyst");
  const skeptic = await completeRole(context, "skeptic");
  const visiblePacket = await reloadAssessmentPacket(context);
  // Cached raw role output is always revalidated against current source
  // visibility before it can mint a durable quote claim.
  validateAnalystOutput(analyst.raw, context.brief, visiblePacket);
  validateSkepticOutput(skeptic.raw, context.brief, visiblePacket);
  const analystCitations = await context.persistQuotes(analyst.raw, visiblePacket);
  const skepticCitations = await context.persistQuotes(skeptic.raw, visiblePacket);
  const normalizedAnalyst = normalizeRoleCitations(analyst.raw, analystCitations);
  const normalizedSkeptic = normalizeRoleCitations(skeptic.raw, skepticCitations);
  const packet = await reloadAssessmentPacket(context);
  const validatedAnalyst = validateAnalystOutput(normalizedAnalyst, context.brief, packet);
  const validatedSkeptic = validateSkepticOutput(normalizedSkeptic, context.brief, packet);
  const packet_hash = requestHash(packet);
  await context.saveValidatedRole(checkpoint("analyst", analyst.request_hash, packet_hash, validatedAnalyst));
  await context.saveValidatedRole(checkpoint("skeptic", skeptic.request_hash, packet_hash, validatedSkeptic));
  return decideCandidate(context.brief, packet, validatedAnalyst, validatedSkeptic, context.as_of);
}

async function reloadAssessmentPacket(context: AssessmentContext): Promise<EvidencePacket> {
  const packet = await context.reloadPacket();
  if (packet.candidate_id !== context.packet.candidate_id || packet.identity.issuer_id !== context.packet.identity.issuer_id) {
    throw new Error("reloaded evidence packet no longer matches the assessed candidate");
  }
  return packet;
}

async function completeRole(context: AssessmentContext, role: "analyst" | "skeptic"): Promise<{ raw: AnalystOutput | SkepticOutput; request_hash: string }> {
  const messages = buildAssessmentMessages({ role, brief: context.brief, packet: context.packet, as_of: context.as_of });
  const request_hash = requestHash({ kind: "campaign-assessment-v1", role, run_id: context.run_id, candidate_id: context.packet.candidate_id, brief: context.brief, packet: context.packet, messages });
  const operation_key = `${context.run_id}/research/${context.packet.candidate_id}/${role}`;
  const validate = (text: string): AnalystOutput | SkepticOutput => {
    if (text.length > 100_000) throw new Error(`${role} response exceeds the response size limit`);
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new Error(`${role} response is not valid JSON`); }
    return role === "analyst"
      ? validateAnalystOutput(value, context.brief, context.packet)
      : validateSkepticOutput(value, context.brief, context.packet);
  };
  const initial = await context.model.complete({ operation_key, request_hash, role, phase: "research", candidate_id: context.packet.candidate_id, model_initial: true, messages });
  try {
    return { raw: validate(initial.text), request_hash };
  } catch {
    const repaired = await context.model.complete({ operation_key, request_hash, attempt_number: 2, role, phase: "research", candidate_id: context.packet.candidate_id, model_initial: false, messages: repairMessages(messages) });
    return { raw: validate(repaired.text), request_hash };
  }
}

function repairMessages(messages: ReadonlyArray<{ role: "system" | "user" | "assistant"; content: string }>) {
  const system = messages[0];
  if (system === undefined) throw new Error("assessment prompt is missing its system message");
  return [{ ...system, content: `${system.content} Your prior response was invalid; return only the required JSON schema.` }, ...messages.slice(1)];
}

function checkpoint(role: "analyst" | "skeptic", request_hash: string, packet_hash: string, output: AnalystOutput | SkepticOutput): ValidatedRoleCheckpoint {
  return Object.freeze({ version: 1, role, request_hash, packet_hash, output });
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
