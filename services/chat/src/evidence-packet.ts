// The evidence an answer is written from (#207): the turn's route and cutoff,
// each figure shown with a short packet id bound to its source, which
// companies have figures and which do not, what could not be shown, and the
// bounds the readers applied. An analyst turn's figures are its price chart's
// alone, market data outside the engine (#398 D2); an engine answer's are its
// results (enginePacket). Never built from raw tool results.
//
// The model sees short ids ("F1", "C1"); the fact, claim and source ids stay
// here, so the prompt stays compact (#181) and an assertion citing one can be
// bound back to its record (#208).
//
// Claims are the route's selection (claimSelection, loaded with the turn's
// cutoff): repeats already counted once, each placed by its stored polarity,
// with any stored contradiction between them named.

import { dependencyClosure, type FinancialAnswerContent, type FinancialPlanV1 } from "../../financial-core/src/index.ts";
import { returnLabel } from "../../market/src/perf-points.ts";
import type { ResearchScope } from "./research-scope.ts";
import { isRecord } from "../../shared/src/http.ts";

type Block = Record<string, unknown>;

// A figure an answer may cite: its company (in a comparison), metric, period
// and value. A recorded packet (answer-lab traces) also holds the reported
// facts, segments and derived figures chat once showed; no turn makes them now.
export type PacketFigure = {
  id: string;
  company?: string;
  // A business segment's revenue: metric "Revenue", for the segment named here.
  segment?: string;
  metric: string;
  period?: string;
  period_end?: string;
  value: string;
  // The block it is shown in, by title.
  shown_in?: string;
  // The fact the value cites; never sent to the model.
  fact_id?: string;
  // A price return's chart line, by its sealed series (#317); never sent to the model.
  series_ref?: string;
  // The engine result it shows (enginePacket); never sent to the model.
  result_id?: string;
  // Why the engine computed no value: the figure is unavailable, never a number.
  gap?: string;
  // An engine ranking, whose value is its sentence ("Q4 FY2026 has the highest revenue of the 8 quarters ranked").
  ranking?: true;
  source_ids: ReadonlyArray<string>;
  // A figure computed from two others: their ids, [current, prior].
  derived_from?: readonly [string, string];
  // A lead's two companies, [left, right]: it is the difference of their figures.
  lead_of?: readonly [string, string];
};

/** A price return the chart shows: one line's last point, credited to its company. */
export type PerfFigure = {
  company: string;
  metric: "Price return";
  // The window drawn.
  period?: string;
  value: string;
  shown_in?: string;
  // The chart showing it, for the evidence packet; never sent to the model.
  block_id?: string;
  // The line's sealed series (#317); never sent to the model.
  series_ref?: string;
};

/** Each price chart line's return over the window drawn, so the answer can cite it as a figure of the chart. */
export function perfFigures(blocks: ReadonlyArray<Block>): PerfFigure[] {
  return blocks.flatMap((block): PerfFigure[] => {
    if (block.kind !== "perf_comparison") return [];
    const series = (block.series ?? []) as ReadonlyArray<{ name?: string; points?: ReadonlyArray<{ y?: number }> }>;
    const seriesRefs = (block.data_ref as { params?: { series_refs?: unknown } } | undefined)?.params?.series_refs;
    const period = typeof block.default_range === "string" ? { period: block.default_range } : {};
    const shownIn = {
      ...(typeof block.title === "string" ? { shown_in: block.title } : {}),
      ...(typeof block.id === "string" ? { block_id: block.id } : {}),
    };
    return series.flatMap((line, index) => {
      const last = line.points?.at(-1)?.y;
      // Line i is drawn from series_refs[i].
      const seriesRef = Array.isArray(seriesRefs) && typeof seriesRefs[index] === "string" ? { series_ref: seriesRefs[index] as string } : {};
      return line.name && typeof last === "number" ? [{ company: line.name, metric: "Price return" as const, ...period, value: returnLabel(last), ...shownIn, ...seriesRef }] : [];
    });
  });
}

// The companies a figure is about: a lead's two, a derived figure's sides', else its own, else the only company's.
export function figureCompanies(figure: PacketFigure, packet: EvidencePacket): Array<string | undefined> {
  if (figure.lead_of) return [...figure.lead_of];
  const sides = figure.derived_from ? packet.figures.filter((side) => figure.derived_from!.includes(side.id)) : [];
  return sides.length > 0 ? sides.map((side) => side.company ?? packet.companies[0]) : [figure.company ?? packet.companies[0]];
}

// A claim as the evidence loader returns it (local-runtime-evidence.ts).
export type ClaimRecord = {
  claim_id: string;
  source_id: string;
  text_canonical: string;
  predicate: string;
  polarity: string;
  effective_time: string | null;
  published_at: string | null;
  subject_id?: string;
};

export type ClaimEvidence = {
  claims: ReadonlyArray<ClaimRecord>;
  truncated?: boolean;
  contradictions?: ReadonlyArray<readonly [string, string]>;
  // The claims read failed: they are unavailable, never "none on file".
  unavailable?: boolean;
};

export type PacketClaim = {
  id: string;
  text: string;
  predicate: string;
  // Placed only by the claim's stored polarity: positive supports the
  // company's case, negative challenges it, mixed is unclassified.
  stance: "supporting" | "challenging" | "neutral" | "unclassified";
  company?: string;
  effective_time?: string;
  published_at?: string;
  claim_id: string;
  source_id: string;
};

export type EvidencePacket = {
  route: string;
  cutoff: string;
  companies: ReadonlyArray<string>;
  figures: ReadonlyArray<PacketFigure>;
  // Each company the turn covers: shown when the answer has a figure for it.
  coverage: ReadonlyArray<{ company: string; status: "shown" | "not_shown" }>;
  // What could not be shown, as the gap notes say it.
  gaps: ReadonlyArray<string>;
  query_bounds: Readonly<Record<string, string>>;
  claims: ReadonlyArray<PacketClaim>;
  // Claims that may disagree, by packet id, and why.
  disagreements: ReadonlyArray<{ claims: readonly [string, string]; basis: string }>;
  claims_status: "available" | "none" | "unavailable";
  claims_truncated: boolean;
  // Metrics the question asked for that no reader serves (#206): named gaps
  // no other figure may stand in for (#208).
  unavailable_metrics?: ReadonlyArray<string>;
};

// The claims a route reads first (#207): its predicate families, from the
// start of the period it covers. Others still fill any room left, newest first.
// Management's own explanations (management.explanation.*, verbatim from
// earnings releases) come first on every route: they are the only causes an
// answer may state. Not management's other claims (management.tone, from IR
// pages), which are no explanation.
const ROUTE_PREDICATES: Partial<Record<ResearchScope["reads"], ReadonlyArray<string>>> = {
  latest_quarter: ["management.explanation.", "guidance.", "kpi."],
  trend: ["management.explanation.", "guidance.", "kpi."],
  derived_margin: ["management.explanation.", "guidance.", "kpi."],
  comparison: ["management.explanation.", "guidance.", "kpi."],
  segments: ["management.explanation.", "segment.", "guidance."],
  statements: ["management.explanation.", "guidance.", "kpi."],
};
const PRICE_PREDICATES = ["material_event.", "guidance."];

export function claimSelection(
  scope: ResearchScope | undefined,
  cutoff: string,
): ClaimSelection {
  if (!scope) return { predicate_prefixes: [], effective_from: null, effective_until: null, fiscal_year: null };
  const route = ROUTE_PREDICATES[scope.reads] ?? [];
  // Management's explanation of what the question asks about comes before its
  // other explanations: one release can hold more of them than the claim limit.
  const metrics = explainedMetrics(scope);
  const family = (prefix: string) => (entry: string | ReadonlyArray<string>) =>
    typeof entry === "string" ? `${prefix}${entry}` : entry.map((metric) => `${prefix}${metric}`);
  // Whatever the figures' route: management's explanation is how a metric no
  // reader serves is answered.
  // A route without predicates of its own (a metric no reader serves) reads
  // every explanation next: one a release files as "other" (EBITDA) too.
  let explained: Array<string | ReadonlyArray<string>> = [
    ...metrics.map(family("management.explanation.")),
    ...(route.length === 0 && scope.metrics.length > 0 ? ["management.explanation."] : []),
  ];
  // A question asking for guidance reads it first, before any other
  // explanation: for the metrics it names, then any; whatever the figures'
  // route (a metric no reader serves included). A turn asking why as well
  // ("why did revenue fall, and what guidance?") reads management's
  // explanation of those metrics at the same priority, so it gets both.
  let asked: Array<string | ReadonlyArray<string>> = scope.guidance ? [...metrics.map(family("guidance.")), "guidance."] : [];
  if (scope.guidance && scope.explains && metrics.length > 0) {
    const [guidance, ...guidanceRest] = asked;
    const [explanation, ...explanationRest] = explained;
    asked = [[guidance!, explanation!].flat(), ...guidanceRest];
    explained = explanationRest;
  }
  // A price window adds the events that move a price, whatever else is read.
  const prefixes = [...new Set([...asked, ...explained, ...route, ...(scope.price_window ? PRICE_PREDICATES : [])])];
  return {
    predicate_prefixes: prefixes,
    effective_from: periodStart(scope, cutoff, route.length > 0),
    // A fiscal year's window ends a quarter after it (its last release); a
    // later release's explanation is of another period. The loader dates it by
    // the issuer's own fiscal year where its facts do; these calendar bounds
    // are the fallback.
    effective_until: scope.fiscal_year !== null ? `${scope.fiscal_year + 1}-04-01T00:00:00.000Z` : null,
    fiscal_year: scope.fiscal_year,
  };
}

type ClaimSelection = {
  // In priority order; a group's prefixes share one.
  predicate_prefixes: ReadonlyArray<string | ReadonlyArray<string>>;
  effective_from: string | null;
  effective_until: string | null;
  fiscal_year: number | null;
};

// The metrics, in earnings-release terms (sec-earnings-release-extraction.ts),
// whose explanations answer the question: margins first when it asks about
// them, then each metric it names (a qualified one, "free cash flow margin",
// by the metric it qualifies).
// A group shares one priority.
const EXPLAINED_BY: Readonly<Record<string, ReadonlyArray<string | ReadonlyArray<string>>>> = {
  // Its own explanations, then either component's alike.
  free_cash_flow: ["free_cash_flow", ["operating_cash_flow", "capex"]],
  operating_cash_flow: ["operating_cash_flow"],
  capex: ["capex"],
  eps_diluted: ["eps"],
  eps_basic: ["eps"],
  // An adjusted income figure names neither by itself.
  non_gaap_income: [["operating_income", "net_income"]],
  // Operating income, net income and expenses are read as the income statement
  // too, so no one of its explanations comes before the others.
  income_statement: [["revenue", "gross_margin", "operating_expenses", "operating_income", "net_income"]],
};

// A release explains an operating or net margin by the income it divides.
const MARGIN_INCOME: Readonly<Record<string, string>> = { operating_margin: "operating_income", net_margin: "net_income" };

function explainedMetrics(scope: ResearchScope): Array<string | ReadonlyArray<string>> {
  const margins = scope.margins || scope.reads === "derived_margin";
  // What the question asks about shares the top priority, so none crowds out
  // another: the income-statement items it names and each metric's own
  // explanations. Then what stands in for them: the margins, a metric's
  // components, and the rest of the income statement.
  const named = (scope.income_items ?? []).map((item) => MARGIN_INCOME[item] ?? item);
  const top: string[] = [...named];
  const after: Array<string | ReadonlyArray<string>> = margins ? [["gross_margin", "operating_income", "net_income"]] : [];
  for (const requested of scope.metrics) {
    // In a margin question, the income statement it names is the margin.
    if (margins && requested.metric_key === "income_statement") continue;
    const base = Object.keys(EXPLAINED_BY).find((key) => requested.metric_key === key || requested.metric_key.startsWith(`${key}_`));
    if (!base) continue;
    const [own, ...components] = EXPLAINED_BY[base]!;
    // The whole income statement stands in for the items the question names.
    if (base === "income_statement" && named.length > 0) after.push(own!, ...components);
    else {
      top.push(...(typeof own === "string" ? [own] : own!));
      after.push(...components);
    }
  }
  // Revenue's explanations include its segments' and products' ("Gaming
  // revenue"), which a release files as "other".
  if (top.includes("revenue")) top.push("other");
  const asked = [...new Set(top)];
  const metrics = [...(asked.length > 1 ? [asked] : asked), ...after];
  // Each once, at its first and highest priority.
  const seen = new Set<string>();
  return metrics.filter((entry) => {
    const members = typeof entry === "string" ? [entry] : entry;
    if (members.every((metric) => seen.has(metric))) return false;
    members.forEach((metric) => seen.add(metric));
    return true;
  });
}

// The months of claims a route reads: the eight quarters an overview charts (company-overview.ts).
const ROUTE_MONTHS = 24;

// ponytail: calendar approximations of the route's periods; a fiscal year is
// widened by a year so one ending mid-year still covers its claims. One window
// for every predicate: the route's period, which covers a year-to-date window.
function periodStart(scope: ResearchScope, cutoff: string, routed: boolean): string | null {
  // A named quarter's claims from the year before it, as a fiscal year's (#290).
  const year = scope.fiscal_quarter?.fiscal_year ?? scope.fiscal_year;
  if (year !== null) return `${year - 1}-01-01T00:00:00.000Z`;
  if (scope.price_window && !routed) return `${cutoff.slice(0, 4)}-01-01T00:00:00.000Z`;
  const start = new Date(cutoff);
  if (Number.isNaN(start.getTime())) return null;
  start.setUTCMonth(start.getUTCMonth() - ROUTE_MONTHS);
  return start.toISOString();
}

export function buildEvidencePacket(input: {
  scope?: ResearchScope;
  factBlocks: ReadonlyArray<Block>;
  cutoff: string;
  claims?: ClaimEvidence;
}): EvidencePacket {
  const blockSources = new Map(input.factBlocks.flatMap((block) =>
    typeof block.id === "string" ? [[block.id, sourceIds(block)] as const] : []
  ));
  const figures: PacketFigure[] = perfFigures(input.factBlocks).map(({ block_id, ...figure }, index) => ({
    id: `F${index + 1}`,
    ...figure,
    source_ids: (block_id && blockSources.get(block_id)) || [],
  }));
  // Every company the scope covers, whether or not a block shows it. An
  // auto-selected peer carries no label in the scope: the comparison names it,
  // and without one it is still covered, by issuer.
  const blockLabels = new Map(input.factBlocks.flatMap((block) => {
    const subjects = Array.isArray(block.subjects) ? block.subjects : [];
    const labels = Array.isArray(block.subject_labels) ? block.subject_labels : [];
    return subjects.flatMap((subject, index) =>
      isRecord(subject) && isString(subject.id) && isString(labels[index]) ? [[subject.id, labels[index]] as const] : []
    );
  }));
  const scopeLabels = new Map((input.scope?.companies ?? []).map((company) => [
    company.issuer_id,
    company.label ?? blockLabels.get(company.issuer_id) ?? `issuer:${company.issuer_id.slice(0, 8)}`,
  ]));
  const companies = unique([
    ...scopeLabels.values(),
    ...input.factBlocks.flatMap((block) => Array.isArray(block.subject_labels) ? block.subject_labels.filter(isString) : []),
  ]);
  const shown = (company: string) => figures.some((figure) => figure.company === company);
  return {
    route: input.scope?.route ?? "unknown",
    cutoff: input.cutoff,
    companies,
    figures,
    coverage: companies.map((company) => ({ company, status: shown(company) ? "shown" : "not_shown" })),
    gaps: input.factBlocks.flatMap((block) =>
      block.kind === "rich_text" && Array.isArray(block.segments)
        ? block.segments.flatMap((segment) => (isRecord(segment) && isString(segment.text) ? [segment.text] : []))
        : []
    ),
    query_bounds: {
      ...(input.scope ? queryBounds(input.scope) : {}),
      ...(input.claims ? { claims: claimBounds(input.scope, input.cutoff) } : {}),
    },
    // A claim names its company as coverage does; one matched outside the
    // scope by the block's label.
    ...packetClaims(input.claims, (issuer) => scopeLabels.get(issuer) ?? blockLabels.get(issuer)),
    ...(input.scope?.metrics.some((metric) => !metric.available)
      ? { unavailable_metrics: input.scope.metrics.filter((metric) => !metric.available).map((metric) => metric.label) }
      : {}),
  };
}

/**
 * A published engine answer as the evidence its commentary is written from:
 * each value, ranking or gap result in the answer's order, a gap with its
 * reason, and a lead with the two companies its plan reads it from. Without
 * the plan nothing says what a ranking or a lead is derived from, so neither
 * is in the packet. Only an answer about several companies names each
 * figure's, by the ticker the turn gave its slot, else the engine's label for it.
 */
export function enginePacket(content: FinancialAnswerContent, tickers: ReadonlyMap<string, string>, plan: FinancialPlanV1 | null): EvidencePacket {
  const subjects = Object.values(content.labels).flatMap((label) => label.kind === "subject" ? [label] : []);
  const companyOf = new Map(subjects.map((label) => [`subject:${label.slot_id}`, tickers.get(label.slot_id) ?? label.text]));
  const companies = [...companyOf.values()];
  const leads = leadCompanies(plan, content.unit_id, companyOf);
  // A window's ranking is its company's; a peer ranking, or a value no one company's that is no lead, stays out.
  const shown = content.results.filter(({ output_id, presented, subject_label_id }) => presented.kind === "ranking"
    ? subject_label_id !== null && plan !== null
    : presented.kind !== "predicate" && (subject_label_id !== null || leads.has(output_id)));
  const figures = shown.map(({ result_id, output_id, subject_label_id, measure_label_id, period_label_id, presented }, index) => {
    const company = companies.length > 1 && subject_label_id !== null ? companyOf.get(subject_label_id) : undefined;
    const lead = leads.get(output_id);
    return {
      id: `F${index + 1}`,
      ...(company === undefined ? {} : { company }),
      metric: content.labels[measure_label_id]!.text,
      period: content.labels[period_label_id]!.text,
      value: presented.text,
      ...(presented.kind === "gap" ? { gap: presented.text } : {}),
      ...(presented.kind === "ranking" ? { ranking: true as const } : {}),
      ...(lead === undefined ? {} : { lead_of: lead }),
      result_id,
      source_ids: [],
    };
  });
  return {
    route: "financial_engine",
    cutoff: content.knowledge_cutoff,
    companies,
    figures,
    coverage: companies.map((company) => ({ company, status: "shown" })),
    gaps: [],
    query_bounds: {},
    claims: [],
    disagreements: [],
    claims_status: "none",
    claims_truncated: false,
  };
}

// Each lead's companies, by its output: the one company each side's inputs are reported for.
function leadCompanies(plan: FinancialPlanV1 | null, unitId: string, companyOf: ReadonlyMap<string, string>): ReadonlyMap<string, readonly [string, string]> {
  if (plan === null) return new Map();
  const nodes = new Map(plan.operations.map((node) => [node.node_id, node]));
  const companyOfSide = (nodeId: string) => {
    const [slot, ...others] = new Set([...dependencyClosure(plan, [nodeId])].flatMap((id) => {
      const node = nodes.get(id);
      return node?.operation === "reported_metric" ? [node.subject_slot] : [];
    }));
    return slot === undefined || others.length > 0 ? undefined : companyOf.get(`subject:${slot}`);
  };
  return new Map(plan.outputs.filter((output) => output.unit_id === unitId).flatMap((output) => {
    const node = nodes.get(output.node_id);
    if (node?.operation !== "spread") return [];
    const [left, right] = [companyOfSide(node.left), companyOfSide(node.right)];
    return left === undefined || right === undefined ? [] : [[output.output_id, [left, right] as const]];
  }));
}

function packetClaims(
  evidence: ClaimEvidence | undefined,
  companyOf: (issuer: string) => string | undefined,
): Pick<EvidencePacket, "claims" | "disagreements" | "claims_status" | "claims_truncated"> {
  const records = evidence?.claims ?? [];
  const label = (issuer: string | undefined) => (issuer === undefined ? undefined : companyOf(issuer));
  const claims: PacketClaim[] = records.map((record, index) => {
    const company = label(record.subject_id);
    return {
      id: `C${index + 1}`,
      text: record.text_canonical,
      predicate: record.predicate,
      stance: STANCE[record.polarity] ?? "unclassified",
      ...(company ? { company } : {}),
      ...(record.effective_time ? { effective_time: record.effective_time } : {}),
      ...(record.published_at ? { published_at: record.published_at } : {}),
      claim_id: record.claim_id,
      source_id: record.source_id,
    };
  });
  const packetId = new Map(claims.map((claim) => [claim.claim_id, claim.id]));
  // Only a stored relation: a claim records no metric or value, so opposite
  // directions ("raised revenue guidance", "lowered EPS guidance") can both be
  // true. Each pair in packet order (C1 before C2), however it is listed.
  const byIndex = (x: string, y: string) => Number(x.slice(1)) - Number(y.slice(1));
  const disagreements = [...new Map((evidence?.contradictions ?? []).flatMap(([a, b]) => {
    const ids = [packetId.get(a), packetId.get(b)];
    if (!ids[0] || !ids[1] || ids[0] === ids[1]) return [];
    const pair = (ids as string[]).sort(byIndex) as [string, string];
    return [[pair.join(), { claims: pair as readonly [string, string], basis: "a stored relation marks them as contradicting" }] as const];
  })).values()];
  return {
    claims,
    disagreements,
    claims_status: evidence?.unavailable ? "unavailable" : claims.length > 0 ? "available" : "none",
    claims_truncated: evidence?.truncated === true,
  };
}

const STANCE: Readonly<Record<string, PacketClaim["stance"]>> = {
  positive: "supporting",
  negative: "challenging",
  neutral: "neutral",
};

function claimBounds(scope: ResearchScope | undefined, cutoff: string): string {
  const { predicate_prefixes: prefixes, effective_from: from, effective_until: until } = claimSelection(scope, cutoff);
  // Named by family ("management", not each metric's explanation).
  const families = [...new Set(prefixes.flat().map((prefix) => prefix.split(".")[0]!))];
  const route = prefixes.length > 0
    ? `${new Intl.ListFormat("en").format(families)} claims${from ? ` from ${from.slice(0, 10)}` : ""}${until ? ` until ${until.slice(0, 10)}` : ""} first, then the most recent others`
    : "the most recent claims";
  return `${route}, published by the ${cutoff.slice(0, 10)} cutoff; a claim repeated by several sources or copies counts once`;
}

// The packet as the model sees it: short ids only, no fact, series or source ids.
export function packetForModel(packet: EvidencePacket): Record<string, unknown> {
  return {
    route: packet.route,
    cutoff: packet.cutoff,
    figures: packet.figures.map((figure) => {
      const { fact_id: _factId, result_id: _resultId, series_ref: _seriesRef, source_ids: _sourceIds, ...shown } = figure;
      if (shown.gap === undefined) return shown;
      const { value: _value, ...unavailable } = shown;
      return unavailable;
    }),
    ...(packet.coverage.length > 0 ? { coverage: packet.coverage } : {}),
    ...(packet.gaps.length > 0 ? { gaps: packet.gaps } : {}),
    ...(Object.keys(packet.query_bounds).length > 0 ? { query_bounds: packet.query_bounds } : {}),
    ...(packet.claims.length > 0
      ? { claims: packet.claims.map(({ claim_id: _claimId, source_id: _sourceId, ...claim }) => claim) }
      : {}),
    ...(packet.disagreements.length > 0 ? { disagreements: packet.disagreements } : {}),
    ...(packet.claims_status === "unavailable" ? { claims_status: "unavailable" } : {}),
    ...(packet.claims_truncated ? { claims_truncated: true } : {}),
  };
}

// The window the price chart was asked for, so the answer can say what it covers.
function queryBounds(scope: ResearchScope): Record<string, string> {
  return scope.price_window ? { price_window: `year to date, to the ${scope.price_window.cutoff.slice(0, 10)} cutoff` } : {};
}

function sourceIds(block: Block): string[] {
  const refs = Array.isArray(block.source_refs) ? block.source_refs : [];
  return unique(refs.flatMap((ref) => isString(ref) ? [ref] : isRecord(ref) && isString(ref.id) ? [ref.id] : []));
}

function unique(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
