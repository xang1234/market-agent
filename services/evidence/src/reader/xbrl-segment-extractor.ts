export type XbrlQName = {
  name: string;
  prefix: string | null;
  local_name: string;
};

export type XbrlSegmentAxis = XbrlQName & {
  kind: "business" | "geography";
};

export type XbrlSegmentMember = XbrlQName & {
  label: string;
  is_extension: boolean;
};

export type XbrlSegmentDefinitionItem = {
  item_type: "xbrl_segment_definition";
  axis: XbrlSegmentAxis;
  segment_id: string;
  segment_name: string;
  member: XbrlSegmentMember;
  definition_as_of: string;
  source_id: string;
};

export type XbrlSegmentFactItem = {
  item_type: "xbrl_segment_fact";
  concept: XbrlQName;
  metric_key?: string;
  context_ref: string;
  axis: XbrlSegmentAxis;
  member: XbrlSegmentMember;
  period_start: string | null;
  period_end: string;
  definition_as_of: string;
  unit_ref?: string;
  unit?: string;
  currency?: string;
  scale: number;
  decimals?: string;
  value_num: number;
  source_id: string;
  as_of: string;
  is_extension_concept: boolean;
};

export type XbrlExtensionFactItem = {
  item_type: "xbrl_extension_fact";
  concept: XbrlQName;
  context_ref: string;
  axis?: XbrlSegmentAxis;
  member?: XbrlSegmentMember;
  period_start: string | null;
  period_end: string;
  definition_as_of?: string;
  unit_ref?: string;
  unit?: string;
  currency?: string;
  scale: number;
  decimals?: string;
  value_num: number;
  source_id: string;
  as_of: string;
};

export type XbrlExtractionItem =
  | XbrlSegmentDefinitionItem
  | XbrlSegmentFactItem
  | XbrlExtensionFactItem;

export type ExtractXbrlExtensionSegmentsInput = {
  xbrl: string;
  source_id: string;
  as_of: string;
  definition_as_of?: string;
};

export type ExtractXbrlExtensionSegmentsResult = {
  items: ReadonlyArray<XbrlExtractionItem>;
};

type XbrlContext = {
  id: string;
  period_start: string | null;
  period_end: string | null;
  dimensions: ReadonlyArray<{
    axis: XbrlSegmentAxis;
    member: XbrlSegmentMember;
  }>;
};

type XbrlFact = {
  concept: XbrlQName;
  context_ref: string;
  unit_ref?: string;
  scale: number;
  decimals?: string;
  value_num: number | null;
};

const STANDARD_TAXONOMY_PREFIXES = new Set([
  "country",
  "dei",
  "iso4217",
  "srt",
  "us-gaap",
  "xbrldi",
  "xbrli",
  "xlink",
]);

const CONCEPT_TO_METRIC_KEY: Readonly<Record<string, string>> = {
  RevenueFromContractWithCustomerExcludingAssessedTax: "revenue",
  SalesRevenueNet: "revenue",
  Revenues: "revenue",
  CostOfGoodsAndServicesSold: "cost_of_revenue",
  CostOfRevenue: "cost_of_revenue",
  GrossProfit: "gross_profit",
  OperatingExpenses: "operating_expenses",
  OperatingIncomeLoss: "operating_income",
  NetIncomeLoss: "net_income",
  ProfitLoss: "net_income",
};

export function extractXbrlExtensionSegments(
  input: ExtractXbrlExtensionSegmentsInput,
): ExtractXbrlExtensionSegmentsResult {
  if (typeof input.xbrl !== "string" || input.xbrl.length === 0) {
    throw new Error("extractXbrlExtensionSegments.xbrl: must be a non-empty string");
  }
  const contexts = parseContexts(input.xbrl);
  const units = parseUnits(input.xbrl);
  const facts = parseFacts(input.xbrl);
  const fallbackDefinitionAsOf =
    input.definition_as_of ??
    latestContextEnd(contexts) ??
    input.as_of.slice(0, 10);

  const definitions = new Map<string, XbrlSegmentDefinitionItem>();
  const items: XbrlExtractionItem[] = [];

  for (const fact of facts) {
    if (fact.value_num === null) continue;
    const context = contexts.get(fact.context_ref);
    if (!context || context.period_end === null) continue;
    const unit = fact.unit_ref ? units.get(fact.unit_ref) : undefined;
    const isExtensionConcept = isExtensionQName(fact.concept);
    for (const dimension of context.dimensions) {
      const definitionKey = `${dimension.axis.name}::${dimension.member.name}::${fallbackDefinitionAsOf}`;
      if (!definitions.has(definitionKey)) {
        definitions.set(definitionKey, {
          item_type: "xbrl_segment_definition",
          axis: dimension.axis,
          segment_id: dimension.member.name,
          segment_name: dimension.member.label,
          member: dimension.member,
          definition_as_of: fallbackDefinitionAsOf,
          source_id: input.source_id,
        });
      }

      const segmentFact: XbrlSegmentFactItem = {
        item_type: "xbrl_segment_fact",
        concept: fact.concept,
        context_ref: fact.context_ref,
        axis: dimension.axis,
        member: dimension.member,
        period_start: context.period_start,
        period_end: context.period_end,
        definition_as_of: fallbackDefinitionAsOf,
        scale: fact.scale,
        value_num: fact.value_num,
        source_id: input.source_id,
        as_of: input.as_of,
        is_extension_concept: isExtensionConcept,
      };
      const metricKey = CONCEPT_TO_METRIC_KEY[fact.concept.local_name];
      if (metricKey !== undefined) segmentFact.metric_key = metricKey;
      if (fact.unit_ref !== undefined) segmentFact.unit_ref = fact.unit_ref;
      if (unit?.unit !== undefined) segmentFact.unit = unit.unit;
      if (unit?.currency !== undefined) segmentFact.currency = unit.currency;
      if (fact.decimals !== undefined) segmentFact.decimals = fact.decimals;
      items.push(segmentFact);
    }

    if (isExtensionConcept) {
      const firstDimension = context?.dimensions[0];
      const extensionFact: XbrlExtensionFactItem = {
        item_type: "xbrl_extension_fact",
        concept: fact.concept,
        context_ref: fact.context_ref,
        period_start: context?.period_start ?? null,
        period_end: context?.period_end ?? fallbackDefinitionAsOf,
        scale: fact.scale,
        value_num: fact.value_num,
        source_id: input.source_id,
        as_of: input.as_of,
      };
      if (firstDimension) {
        extensionFact.axis = firstDimension.axis;
        extensionFact.member = firstDimension.member;
        extensionFact.definition_as_of = fallbackDefinitionAsOf;
      }
      if (fact.unit_ref !== undefined) extensionFact.unit_ref = fact.unit_ref;
      if (unit?.unit !== undefined) extensionFact.unit = unit.unit;
      if (unit?.currency !== undefined) extensionFact.currency = unit.currency;
      if (fact.decimals !== undefined) extensionFact.decimals = fact.decimals;
      items.push(extensionFact);
    }
  }

  return Object.freeze({
    items: Object.freeze([...definitions.values(), ...items]),
  });
}

function parseContexts(xbrl: string): Map<string, XbrlContext> {
  const contexts = new Map<string, XbrlContext>();
  const contextPattern = /<[\w.-]*:?context\b([^>]*)>([\s\S]*?)<\/[\w.-]*:?context>/gi;
  for (const match of xbrl.matchAll(contextPattern)) {
    const attrs = parseAttributes(match[1] ?? "");
    const id = attrs.id;
    if (!id) continue;
    const body = match[2] ?? "";
    const period_start = readFirstTagText(body, "startDate");
    const period_end = readFirstTagText(body, "endDate") ?? readFirstTagText(body, "instant");
    const dimensions = parseExplicitMembers(body);
    contexts.set(id, {
      id,
      period_start,
      period_end,
      dimensions: Object.freeze(dimensions),
    });
  }
  return contexts;
}

function parseExplicitMembers(contextBody: string): XbrlContext["dimensions"] {
  const dimensions: Array<{ axis: XbrlSegmentAxis; member: XbrlSegmentMember }> = [];
  const memberPattern = /<[\w.-]*:?explicitMember\b([^>]*)>([\s\S]*?)<\/[\w.-]*:?explicitMember>/gi;
  for (const match of contextBody.matchAll(memberPattern)) {
    const attrs = parseAttributes(match[1] ?? "");
    const dimension = attrs.dimension;
    const memberName = textContent(match[2] ?? "");
    if (!dimension || !memberName) continue;
    const axisQName = parseQName(dimension);
    const memberQName = parseQName(memberName);
    dimensions.push({
      axis: Object.freeze({
        ...axisQName,
        kind: classifyAxis(axisQName),
      }),
      member: Object.freeze({
        ...memberQName,
        label: labelFromQName(memberQName),
        is_extension: isExtensionQName(memberQName),
      }),
    });
  }
  return dimensions;
}

function parseUnits(xbrl: string): Map<string, { unit: string; currency?: string }> {
  const units = new Map<string, { unit: string; currency?: string }>();
  const unitPattern = /<[\w.-]*:?unit\b([^>]*)>([\s\S]*?)<\/[\w.-]*:?unit>/gi;
  for (const match of xbrl.matchAll(unitPattern)) {
    const id = parseAttributes(match[1] ?? "").id;
    if (!id) continue;
    const measure = readFirstTagText(match[2] ?? "", "measure");
    if (!measure) continue;
    const qname = parseQName(measure);
    if (qname.prefix === "iso4217") {
      units.set(id, { unit: "currency", currency: qname.local_name });
    } else {
      units.set(id, { unit: qname.local_name });
    }
  }
  return units;
}

function parseFacts(xbrl: string): XbrlFact[] {
  return [...parseInlineFacts(xbrl), ...parseRegularFacts(xbrl)];
}

function parseInlineFacts(xbrl: string): XbrlFact[] {
  const facts: XbrlFact[] = [];
  const inlinePattern = /<[\w.-]*:?non(?:Fraction|Numeric)\b([^>]*)>([\s\S]*?)<\/[\w.-]*:?non(?:Fraction|Numeric)>/gi;
  for (const match of xbrl.matchAll(inlinePattern)) {
    const attrs = parseAttributes(match[1] ?? "");
    if (!attrs.name || !attrs.contextRef) continue;
    facts.push(freezeFact({
      concept: parseQName(attrs.name),
      context_ref: attrs.contextRef,
      unit_ref: attrs.unitRef,
      scale: scaleMultiplier(attrs.scale),
      decimals: attrs.decimals,
      value_num: numericText(match[2] ?? "", scaleMultiplier(attrs.scale), attrs.sign),
    }));
  }
  return facts;
}

function parseRegularFacts(xbrl: string): XbrlFact[] {
  const facts: XbrlFact[] = [];
  const factPattern = /<([A-Za-z_][\w.-]*:[A-Za-z_][\w.-]*)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  for (const match of xbrl.matchAll(factPattern)) {
    const tagName = match[1];
    if (
      !tagName ||
      tagName.startsWith("ix:") ||
      tagName.startsWith("xbrli:") ||
      tagName.startsWith("xbrldi:")
    ) {
      continue;
    }
    const attrs = parseAttributes(match[2] ?? "");
    if (!attrs.contextRef) continue;
    facts.push(freezeFact({
      concept: parseQName(tagName),
      context_ref: attrs.contextRef,
      unit_ref: attrs.unitRef,
      scale: scaleMultiplier(attrs.scale),
      decimals: attrs.decimals,
      value_num: numericText(match[3] ?? "", scaleMultiplier(attrs.scale)),
    }));
  }
  return facts;
}

function freezeFact(input: XbrlFact): XbrlFact {
  const fact: XbrlFact = {
    concept: input.concept,
    context_ref: input.context_ref,
    scale: input.scale,
    value_num: input.value_num,
  };
  if (input.unit_ref !== undefined) fact.unit_ref = input.unit_ref;
  if (input.decimals !== undefined) fact.decimals = input.decimals;
  return Object.freeze(fact);
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrPattern = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of raw.matchAll(attrPattern)) {
    const name = match[1];
    const value = match[2] ?? match[3] ?? "";
    attrs[name] = decodeXml(value);
    const localName = name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
    attrs[localName] = decodeXml(value);
  }
  return attrs;
}

function parseQName(raw: string): XbrlQName {
  const trimmed = raw.trim();
  const colon = trimmed.indexOf(":");
  const prefix = colon >= 0 ? trimmed.slice(0, colon) : null;
  const local_name = colon >= 0 ? trimmed.slice(colon + 1) : trimmed;
  return Object.freeze({ name: trimmed, prefix, local_name });
}

function isExtensionQName(qname: XbrlQName): boolean {
  return qname.prefix !== null && !STANDARD_TAXONOMY_PREFIXES.has(qname.prefix);
}

function classifyAxis(axis: XbrlQName): XbrlSegmentAxis["kind"] {
  return /geograph|geographic|region|country|area/i.test(axis.local_name) ? "geography" : "business";
}

function labelFromQName(qname: XbrlQName): string {
  let local = qname.local_name.replace(/(Member|Domain|Axis)$/u, "");
  local = local.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  local = local.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return local.replace(/\bI Phone\b/g, "iPhone").trim() || qname.local_name;
}

function readFirstTagText(xml: string, localName: string): string | null {
  const pattern = new RegExp(`<[\\w.-]*:?${localName}\\b[^>]*>([\\s\\S]*?)<\\/[\\w.-]*:?${localName}>`, "i");
  const match = xml.match(pattern);
  const value = match ? textContent(match[1] ?? "") : "";
  return value.length > 0 ? value : null;
}

function textContent(raw: string): string {
  return decodeXml(raw.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
}

function numericText(raw: string, scale: number, sign?: string): number | null {
  const text = textContent(raw);
  if (!text) return null;
  const negative = /^\(.*\)$/.test(text);
  const normalized = text.replace(/[,$%\s()]/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  if (sign === "-") return -Math.abs(parsed) * scale;
  return (negative ? -parsed : parsed) * scale;
}

function scaleMultiplier(raw: string | undefined): number {
  if (raw === undefined || raw.length === 0) return 1;
  const exponent = Number(raw);
  if (!Number.isInteger(exponent)) return 1;
  return 10 ** exponent;
}

function decodeXml(raw: string): string {
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function latestContextEnd(contexts: Map<string, XbrlContext>): string | null {
  const dates = [...contexts.values()]
    .map((context) => context.period_end)
    .filter((value): value is string => value !== null)
    .sort();
  return dates.at(-1) ?? null;
}
