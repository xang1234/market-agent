// Comparative assertions (#208, slice 3): a high or low, a ranking, or a trend,
// bound to a typed operation over the complete eligible evidence and checked
// against the figures before it can render. Citing every right number does
// not make a wrong winner, an endpoint passed off as the low, a subset that
// drops a peer or a period, or a reversed or falsely steady trend pass.
//
// Eligible evidence: over time, every period shown of one company's metric;
// across companies, every company with that metric shown (one figure each),
// with companies that have none named, never silently left out. Quarters and
// years are never compared with each other, nor is a partial period.
//
// ponytail: values are compared as the user sees them, each displayed value
// standing for the interval its rounding covers ("74.4%" is 74.35-74.45). Two
// values are ordered only when their intervals do not overlap, so rounding
// cannot make a false winner; values too close to separate at the precision
// shown are a tie. Upgrade path: carry each fact's unrounded value in the packet.

import type { EvidencePacket, PacketFigure } from "./evidence-packet.ts";

export const COMPARISON_OPS = ["highest", "lowest", "order", "trend"] as const;
export type ComparisonOp = (typeof COMPARISON_OPS)[number];
export const TREND_RESULTS = ["rose", "fell", "flat", "rose_throughout", "fell_throughout", "rebounded", "pulled_back"] as const;
export type TrendResult = (typeof TREND_RESULTS)[number];

export type CheckedComparison = {
  op: ComparisonOp;
  axis: "time" | "cohort";
  metric: string;
  // Over time: chronological. Across companies: highest first for an order,
  // otherwise as cited.
  figures: ReadonlyArray<PacketFigure>;
  // The high or low claimed (highest/lowest).
  winner?: PacketFigure;
  // every_step: it moved the net way in every period, with none missing.
  // ends_at: the last period is strictly the window's high or low.
  trend?: { result: TrendResult; net: Direction; every_step: boolean; turn?: PacketFigure; ends_at?: "high" | "low" };
  // Across companies, those the turn covers with no figure for the metric;
  // over time, the periods its figure is a gap for.
  not_shown: ReadonlyArray<string>;
};

type Direction = -1 | 0 | 1;

export function checkComparison(
  item: { op?: unknown; result?: unknown },
  figureIds: ReadonlyArray<string>,
  packet: EvidencePacket,
): { error: string } | { comparison: CheckedComparison } {
  const fail = (reason: string) => ({ error: `comparison: ${reason}` });
  if (!COMPARISON_OPS.includes(item.op as ComparisonOp)) return fail(`unknown op ${JSON.stringify(item.op)}`);
  const op = item.op as ComparisonOp;
  const companyOf = (figure: PacketFigure) => figure.company ?? packet.companies[0] ?? "";
  // What a cohort ranks: companies, or one company's segments.
  const memberOf = (figure: PacketFigure) => figure.segment ?? companyOf(figure);
  // The same fact shown in two blocks counts once.
  const keyOf = (figure: PacketFigure) => figure.fact_id ?? `${companyOf(figure)}|${figure.segment ?? ""}|${figure.metric}|${periodKey(figure.period)}`;
  const cited = unique(figureIds.flatMap((id) => packet.figures.filter((figure) => figure.id === id)), keyOf);
  const unavailable = cited.find((figure) => figure.gap !== undefined);
  if (unavailable) return fail(`${unavailable.id} is not available, so it is not compared`);
  // "F1" twice, or two ids showing one fact, is one figure: nothing to compare.
  if (cited.length < 2) return fail("a comparison needs two or more distinct figures");
  const metric = cited[0]!.metric;
  // A segment's revenue and the company's are not one metric.
  const segmented = cited[0]!.segment !== undefined;
  if (cited.some((figure) => figure.metric !== metric || (figure.segment !== undefined) !== segmented)) return fail("a comparison is of one metric");
  if (segmented && new Set(cited.map(companyOf)).size > 1) return fail("segments are ranked within one company");
  if (cited.some((figure) => quarterly(figure) !== quarterly(cited[0]!))) return fail("a comparison does not set an annual figure against a quarterly one");
  const companies = new Set(cited.map(memberOf));
  const axis = companies.size === 1 ? "time" : "cohort";
  if (op === "trend" && axis !== "time") return fail("a trend is one company's metric over time");
  const sameMetric = packet.figures.filter((figure) =>
    figure.gap === undefined && figure.metric === metric && (figure.segment !== undefined) === segmented && (!segmented || companyOf(figure) === companyOf(cited[0]!)) &&
    comparablePeriods(figure, cited[0]!)
  );

  let eligible: PacketFigure[];
  if (axis === "time") {
    const company = [...companies][0]!;
    if (cited.some((figure) => figure.period === undefined)) return fail("every figure over time names its period");
    eligible = unique(sameMetric.filter((figure) => memberOf(figure) === company && figure.period !== undefined), keyOf);
    const order = chronological(eligible);
    if (!order) return fail("the periods shown cannot be put in order");
    eligible = order;
  } else {
    const perCompany = new Map<string, PacketFigure[]>();
    for (const figure of unique(sameMetric, keyOf)) perCompany.set(memberOf(figure), [...(perCompany.get(memberOf(figure)) ?? []), figure]);
    if (cited.length !== companies.size) return fail("a ranking compares one figure per company");
    // A company shown for several periods: every company at one period, so
    // no company's best period is picked against another's. A change is
    // compared over one span whatever else is shown.
    const periods = new Set(cited.map((figure) => cohortPeriod(figure.period)));
    if (periods.size > 1 && [...periods].some((period) => period.startsWith("span:"))) return fail("changes across companies are compared over one span");
    const severalPeriods = [...perCompany.values()].some((figures) => figures.length > 1);
    if (severalPeriods && periods.size > 1) return fail("companies shown for several periods are compared at one period");
    eligible = [...perCompany.values()].flatMap((figures) =>
      figures.length === 1 ? figures : figures.filter((figure) => periods.has(cohortPeriod(figure.period)))
    );
  }
  const citedKeys = new Set(cited.map(keyOf));
  const omitted = eligible.find((figure) => !citedKeys.has(keyOf(figure)));
  if (omitted) {
    return fail(`leaves out ${axis === "time" ? periodText(omitted.period!) : memberOf(omitted)}, which shows ${metricLabel(metric)} too`);
  }
  // The cited figure stands for its fact, so the model's id is the one named.
  const figures = eligible.map((figure) => cited.find((entry) => keyOf(entry) === keyOf(figure))!);
  const values = figures.map((figure) => interval(figure.value));
  if (values.some((value) => value === undefined) || new Set(values.map((value) => value!.kind)).size > 1) {
    return fail("the values are in different units or currencies");
  }
  const valueOf = new Map(figures.map((figure, i) => [figure, values[i]!] as const));
  const cmp = (a: PacketFigure, b: PacketFigure) => compareIntervals(valueOf.get(a)!, valueOf.get(b)!);
  const label = (figure: PacketFigure) => `${figure.id} (${figure.value})`;
  // A result id names its fact, whichever of its copies the model wrote.
  const resolve = (id: unknown) => {
    const named = cited.find((figure) => figure.id === id) ?? packet.figures.find((figure) => figure.id === id && figureIds.includes(figure.id));
    return named && figures.find((figure) => keyOf(figure) === keyOf(named));
  };
  const not_shown = axis === "time"
    ? [...new Set(packet.figures.filter((figure) =>
      figure.gap !== undefined && figure.period !== undefined && figure.metric === metric && memberOf(figure) === memberOf(cited[0]!) &&
      (figure.segment !== undefined) === segmented && comparablePeriods(figure, cited[0]!)
    ).map((figure) => periodText(figure.period!)))]
    : segmented ? [] : packet.companies.filter((company) => !figures.some((figure) => companyOf(figure) === company));
  const base = { op, axis, metric, not_shown } as const;

  if (op === "highest" || op === "lowest") {
    const winner = resolve(item.result);
    if (typeof item.result !== "string" || !winner) return fail("the result is not one of the cited figures");
    const sign = op === "highest" ? 1 : -1;
    for (const other of figures.filter((figure) => figure !== winner)) {
      const order = cmp(winner, other);
      if (order === 0) return fail(`${label(winner)} and ${label(other)} cannot be told apart at the precision shown`);
      if (order !== sign) return fail(`${label(other)} is ${op === "highest" ? "higher" : "lower"} than ${label(winner)}`);
    }
    return { comparison: { ...base, figures, winner } };
  }

  if (op === "order") {
    const listed = Array.isArray(item.result) ? item.result.map(resolve) : [];
    if (listed.length !== figures.length || listed.some((figure) => !figure) || new Set(listed).size !== figures.length) {
      return fail("the order lists each cited figure once");
    }
    const ranked = listed as PacketFigure[];
    for (let i = 1; i < ranked.length; i++) {
      const order = cmp(ranked[i - 1]!, ranked[i]!);
      if (order === 0) return fail(`${label(ranked[i - 1]!)} and ${label(ranked[i]!)} cannot be told apart at the precision shown`);
      if (order < 0) return fail(`${label(ranked[i]!)} is higher than ${label(ranked[i - 1]!)}`);
    }
    return { comparison: { ...base, figures: ranked } };
  }

  // A trend, over the window in chronological order.
  if (!TREND_RESULTS.includes(item.result as TrendResult)) return fail(`unknown trend result ${JSON.stringify(item.result)}`);
  const result = item.result as TrendResult;
  if (figures.length < 2) return fail("a trend needs two or more periods");
  const first = figures[0]!;
  const last = figures.at(-1)!;
  const net = cmp(last, first);
  const name = metricLabel(metric);
  const moved = net === 1 ? "rose" : net === -1 ? "fell" : "was about the same";
  const netError = fail(net === 0
    ? `${name} was about the same at ${first.value} and ${last.value}, at the precision shown`
    : `${name} ${moved} from ${first.value} to ${last.value}`);
  const steps = figures.slice(1).map((figure, i) => cmp(figure, figures[i]!));
  const interior = figures.slice(1, -1);
  let turn: PacketFigure | undefined;
  switch (result) {
    case "rose":
    case "fell":
    case "flat":
      if (net !== { rose: 1, fell: -1, flat: 0 }[result]) return netError;
      break;
    case "rose_throughout":
    case "fell_throughout": {
      const direction = result === "rose_throughout" ? 1 : -1;
      if (steps.some((step) => step !== direction)) return fail(`${name} did not ${direction === 1 ? "rise" : "fall"} in every period`);
      const gap = missingPeriod(figures);
      if (gap) return fail(`a period is missing between ${gap}, so every-period movement is not shown`);
      break;
    }
    case "rebounded":
    case "pulled_back": {
      // A low (high) inside the window, below (above) where it started, that
      // the end recovered from (fell back from).
      const direction = result === "rebounded" ? -1 : 1;
      const turns = interior.filter((figure) => cmp(figure, first) === direction && cmp(last, figure) === -direction);
      turn = turns.reduce<PacketFigure | undefined>((best, figure) =>
        best === undefined || (valueOf.get(figure)!.mid - valueOf.get(best)!.mid) * direction > 0 ? figure : best, undefined);
      if (!turn) {
        return fail(`${name} has no ${direction === -1 ? "low" : "high"} inside the window that it ${direction === -1 ? "recovered from" : "fell back from"}`);
      }
      break;
    }
  }
  const every_step = net !== 0 && steps.every((step) => step === net) && !missingPeriod(figures);
  const endsAt = (direction: Direction) => figures.slice(0, -1).every((figure) => cmp(last, figure) === direction);
  // Two periods' end, or one reached in every period, is the high or low by its direction alone.
  const ends_at = figures.length < 3 || result === "rose_throughout" || result === "fell_throughout" ? undefined : endsAt(1) ? "high" : endsAt(-1) ? "low" : undefined;
  return { comparison: { ...base, figures, trend: { result, net, every_step, ...(turn ? { turn } : {}), ...(ends_at ? { ends_at } : {}) } } };
}

// "Q4 2026" and the stored "Q42026" are one period.
function periodKey(period: string | undefined): string {
  return (period ?? "").replace(/\s+/g, "");
}

// A change's period ("Q4 FY2026 vs Q4 FY2025") is one across companies by its
// span, a year here, since each company's quarters are its own fiscal
// calendar's; any other period by its name.
function cohortPeriod(period: string | undefined): string {
  const [current, prior, ...more] = (period ?? "").split(" vs ");
  const [from, to] = [periodIndex(prior), periodIndex(current)];
  const sameKind = /^Q/.test(periodKey(current)) === /^Q/.test(periodKey(prior));
  return more.length === 0 && from !== undefined && to !== undefined && sameKind ? `span:${to - from}` : periodKey(period);
}

function quarterly(figure: PacketFigure): boolean {
  return /^Q/.test(periodKey(figure.period));
}

export function comparablePeriods(a: PacketFigure, b: PacketFigure): boolean {
  return quarterly(a) === quarterly(b);
}

// A stored quarter ("Q42026") as prose writes it ("Q4 2026").
export function periodText(period: string): string {
  return period.replace(/^([QH][1-4])(\d{4})$/, "$1 $2");
}

// "Gross Margin" reads "gross margin" after a possessive; "EPS", "QoQ" and "YoY" stay.
export function metricLabel(metric: string): string {
  return metric.replace(/\b([A-Z])(?=[a-z]+\b)/g, (letter) => letter.toLowerCase());
}

// The first figure for each key, in order.
function unique(figures: ReadonlyArray<PacketFigure>, keyOf: (figure: PacketFigure) => string): PacketFigure[] {
  const first = new Map<string, PacketFigure>();
  for (const figure of figures) if (!first.has(keyOf(figure))) first.set(keyOf(figure), figure);
  return [...first.values()];
}

// By period end, else by the period's own index; null when neither orders all.
function chronological(figures: ReadonlyArray<PacketFigure>): PacketFigure[] | null {
  if (figures.every((figure) => figure.period_end)) {
    return [...figures].sort((a, b) => a.period_end!.localeCompare(b.period_end!));
  }
  const indexed = figures.map((figure) => ({ figure, index: periodIndex(figure.period) }));
  if (indexed.some((entry) => entry.index === undefined)) return null;
  return indexed.sort((a, b) => a.index! - b.index!).map((entry) => entry.figure);
}

// A fiscal quarter or year as a count of its kind, so consecutive periods differ by one.
function periodIndex(period: string | undefined): number | undefined {
  // "Q42026" as stored, "Q4FY2026" as the engine labels it, "Q4FY2026(ended2026-01-25)" or "Q4FY2026(asof2026-01-25)" as it dates it.
  const key = periodKey(period).replace(/\((?:ended|asof)\d{4}-\d{2}-\d{2}\)$/, "");
  const quarter = /^Q([1-4])(?:FY)?(\d{4})$/.exec(key);
  if (quarter) return Number(quarter[2]) * 4 + Number(quarter[1]) - 1;
  const year = /^(?:FY)?(\d{4})$/.exec(key);
  return year ? Number(year[1]) : undefined;
}

// The first two neighbours with a period missing between them (or that cannot
// be shown consecutive), as "Q1 2025 and Q3 2025".
function missingPeriod(figures: ReadonlyArray<PacketFigure>): string | undefined {
  for (let i = 1; i < figures.length; i++) {
    const [a, b] = [periodIndex(figures[i - 1]!.period), periodIndex(figures[i]!.period)];
    const sameKind = /^Q/.test(periodKey(figures[i - 1]!.period)) === /^Q/.test(periodKey(figures[i]!.period));
    if (a === undefined || b === undefined || !sameKind || b - a !== 1) {
      return `${periodText(figures[i - 1]!.period!)} and ${periodText(figures[i]!.period!)}`;
    }
  }
  return undefined;
}

type Interval = { kind: string; low: number; high: number; mid: number };

const SCALES: Readonly<Record<string, number>> = { "": 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

// A displayed value ("-$1.7B", "74.4%", "CN¥3.1B", "12.8x", the engine's
// "USD -1,700,000,000.00") as the interval its rounding covers, with its kind:
// the currency prefix and whether it is a percent, a multiple or an amount.
// Undefined when it does not parse.
function interval(value: string): Interval | undefined {
  const match = /^([-−+]?)([^\d\-−+]*?)\s*([-−+]?)(\d[\d,]*)(?:\.(\d+))?\s*([KMBT%x]?)$/.exec(value.trim());
  if (!match) return undefined;
  const [, leading, prefix, inner, whole, fraction = "", suffix] = match;
  if (leading && inner) return undefined;
  const sign = leading || inner;
  const unit = suffix === "%" || suffix === "x" ? suffix : "";
  const scale = SCALES[unit ? "" : suffix!]!;
  const mid = (sign === "-" || sign === "−" ? -1 : 1) * Number(`${whole!.replace(/,/g, "")}.${fraction || "0"}`) * scale;
  const half = 0.5 * 10 ** -fraction.length * scale;
  return { kind: `${prefix!.trim()}|${unit}`, low: mid - half, high: mid + half, mid };
}

// Ordered only when the intervals do not overlap; a shared edge is two
// different displayed values, so it orders (within float error: 14.1% and
// 14.2% share 14.15%).
function compareIntervals(a: Interval, b: Interval): Direction {
  const epsilon = 1e-9 * Math.max(Math.abs(a.mid), Math.abs(b.mid), 1);
  if (a.low >= b.high - epsilon) return 1;
  if (a.high <= b.low + epsilon) return -1;
  return 0;
}
