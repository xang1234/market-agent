// Controlled rendering of evidence-bound assertions (#208): the answer written
// from the assertions that passed the check, each in a fixed template, with
// every value and attributed claim a sealed ref segment rather than free text.
// An observation states only its figures (company, metric, value, period, from
// the packet); a management attribution quotes its claim, dated; an unknown
// cause says the figures do not show why; an inference is labelled. The
// model's own wording survives only there, in an inference the check has bound
// to the observations it rests on, writing no figure, so every figure shown is
// a template's value from the packet. A comparison states the high or low,
// ranking or trend its check derived, never the model's wording of it, and an
// inference resting on comparisons carries their checked results in its label.

import type { Assertion } from "./assertions.ts";
import { checkComparison, metricLabel, periodText as quarterText, type CheckedComparison, type TrendResult } from "./comparisons.ts";
import { periodCoverage, type EvidencePacket, type PacketFigure } from "./evidence-packet.ts";
import { createSealer, type Sealer, type Segment } from "./prose-refs.ts";

type Block = Record<string, unknown>;

export type RenderedAssertion = {
  index: number;
  // A value with no fact to seal (a price return read off its chart) is the
  // packet's value as plain text.
  segments: ReadonlyArray<Segment>;
  // The packet ids of the figures it writes.
  figure_ids: ReadonlyArray<string>;
  // The fact bindings and sources its refs need to seal.
  fact_bindings: ReadonlyArray<Record<string, unknown>>;
  source_refs: ReadonlyArray<string>;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// accepted: the answer's accepted assertions, which an inference's supports index.
export function renderAssertion(
  assertion: Assertion & { index: number },
  packet: EvidencePacket,
  factBlocks: ReadonlyArray<Block>,
  accepted: ReadonlyArray<Assertion & { index: number }> = [],
): RenderedAssertion {
  const seal = createSealer(factBlocks);
  const figure_ids: string[] = [];
  const segments = templateSegments(assertion, packet, accepted, {
    value: (figure) => {
      figure_ids.push(figure.id);
      return seal.value(figure);
    },
    quote: seal.quote,
  });
  const { fact_bindings, source_refs } = seal.sealed();
  return { index: assertion.index, segments, figure_ids, fact_bindings, source_refs };
}

type Writes = Pick<Sealer, "value" | "quote">;

function templateSegments(
  assertion: Assertion & { index: number },
  packet: EvidencePacket,
  accepted: ReadonlyArray<Assertion & { index: number }>,
  { value, quote }: Writes,
): Segment[] {
  const figures = assertion.evidence.flatMap((id) => packet.figures.filter((figure) => figure.id === id));
  const claims = assertion.evidence.flatMap((id) => packet.claims.filter((claim) => claim.id === id));
  const owner = (figure: PacketFigure) => ownerOf(figure, packet);
  const segments: Segment[] = [];
  const text = (value: string) => segments.push({ type: "text", text: value });
  switch (assertion.kind) {
    case "observation": {
      // One clause per company and period, its period said once: "NVDA's
      // gross margin was 74.4%, operating margin 64.9% and ... in Q4 2026".
      const groups = new Map<string, PacketFigure[]>();
      for (const figure of figures) {
        const key = `${owner(figure)}|${figure.period ?? ""}|${figure.period_end ?? ""}|${periodCoverage(figure) ?? ""}`;
        groups.set(key, [...(groups.get(key) ?? []), figure]);
      }
      [...groups.values()].forEach((group, g) => {
        group.forEach((figure, i) => {
          const joiner = i === 0 ? "" : i === group.length - 1 ? " and " : ", ";
          text(i === 0 ? `${g === 0 ? "" : "; "}${capitalize(`${owner(figure)}${figureLabel(figure)}`)} was ` : `${joiner}${figureLabel(figure)} `);
          segments.push(value(figure));
        });
        text(periodPhrase(group[0]!));
      });
      text(".");
      break;
    }
    case "management_attribution":
      claims.forEach((claim, i) => {
        // Dated by its publication; an effective date that differs is its own.
        const published = claim.published_at ? monthYear(claim.published_at) : undefined;
        const effective = claim.effective_time ? monthYear(claim.effective_time) : undefined;
        const dated = published ? `a source dated ${published}${effective && effective !== published ? `, effective ${effective}` : ""}` : `a source${effective ? `, effective ${effective}` : ""}`;
        text(`${i === 0 ? "" : " "}According to ${dated}${claim.company ? ` on ${claim.company}` : ""}: `);
        segments.push(quote(claim));
      });
      break;
    case "comparison": {
      const checked = checkComparison(assertion, assertion.evidence, packet);
      // Accepted assertions passed this check; a failure here renders nothing.
      if ("comparison" in checked) comparisonSegments(checked.comparison, { text, value, owner, push: (segment) => segments.push(segment) });
      break;
    }
    case "unknown_cause": {
      const changed = [...new Set(figures.map((figure) => `${owner(figure)}${metricLabel(figure.metric)}`))];
      text(`The figures do not show why ${changed.join(" and ")} changed.`);
      break;
    }
    case "analyst_inference": {
      // Words only: the check rejected any figure or reference in it.
      const label = checkedResults(assertion, packet, accepted);
      // A one-company answer's subject goes without saying.
      const on = assertion.subject && packet.companies.length > 1 ? ` on ${assertion.subject}` : "";
      text(`> **Analyst inference${on}${label.length > 0 ? `** (${label.join("; ")}):` : ":**"} ${assertion.text}`);
      break;
    }
  }
  return segments;
}

// What an inference's comparisons checked, for its label, from their results.
// One company highest on several metrics is one clause.
export function checkedResults(
  assertion: Assertion,
  packet: EvidencePacket,
  accepted: ReadonlyArray<Assertion & { index: number }>,
): string[] {
  const clauses = new Map<string, string[]>();
  for (const n of assertion.supports ?? []) {
    const entry = accepted.find((candidate) => candidate.index === n && candidate.kind === "comparison");
    const result = entry && checkComparison(entry, entry.evidence, packet);
    if (!result || !("comparison" in result)) continue;
    const [clause, metric] = resultClause(result.comparison, (figure) => ownerOf(figure, packet));
    clauses.set(clause, [...(clauses.get(clause) ?? []), ...(metric ? [metric] : [])]);
  }
  return [...clauses].map(([clause, metrics]) => (metrics.length > 0 ? `${clause} ${new Intl.ListFormat("en").format(metrics)}` : clause));
}

// "NVDA's ": a figure's company as its possessive, the only company's when it names none.
function ownerOf(figure: PacketFigure, packet: EvidencePacket): string {
  const company = figure.company ?? (packet.companies.length === 1 ? packet.companies[0] : undefined);
  return company ? `${company}'s ` : "";
}

type Writer = {
  text: (value: string) => void;
  value: (figure: PacketFigure) => Segment;
  owner: (figure: PacketFigure) => string;
  push: (segment: Segment) => void;
};

// A comparison in its template: the derived result, with every value it
// names a fact ref. Across companies, every company's value and period is
// listed, so the basis (and any period mismatch) is on the page.
function comparisonSegments(comparison: CheckedComparison, out: Writer): void {
  const { figures, metric } = comparison;
  const first = figures[0]!;
  const last = figures.at(-1)!;
  const subject = (figure: PacketFigure) => capitalize(`${out.owner(figure)}${metricLabel(metric)}`);
  const at = (figure: PacketFigure) => {
    out.push(out.value(figure));
    if (figure.period) out.text(` in ${periodText(figure.period)}`);
  };
  // Across companies, each value's period; one period they all share is said once.
  const datedAs = (figure: PacketFigure) => (figure.period ? ` (${periodText(figure.period)}${figure.period_end ? `, ended ${monthYear(figure.period_end)}` : ""})` : "");
  const shared = new Set(figures.map(datedAs)).size === 1;
  const list = (label: (figure: PacketFigure) => string) => {
    figures.forEach((figure, i) => {
      out.text(`${i === 0 ? "" : ", "}${label(figure)} `);
      out.push(out.value(figure));
      if (comparison.axis === "cohort" && !shared) out.text(datedAs(figure));
    });
    if (comparison.axis === "cohort" && shared) out.text(datedAs(first));
  };
  const companyOf = (figure: PacketFigure) => figure.segment ?? figure.company ?? "";
  // A segment cohort is one company's segments.
  const segmented = first.segment !== undefined;
  if (comparison.op === "highest" || comparison.op === "lowest") {
    if (comparison.axis === "time") {
      out.text(`${subject(comparison.winner!)} was ${comparison.op} in ${periodText(comparison.winner!.period!)}, at `);
      out.push(out.value(comparison.winner!));
      out.text(`, of the periods from ${periodText(first.period!)} to ${periodText(last.period!)}.`);
    } else {
      out.text(segmented
        ? `Of ${out.owner(first)}segments, ${comparison.winner!.segment} ${metricLabel(metric)} was ${comparison.op}: `
        : `Of ${new Intl.ListFormat("en").format(figures.map(companyOf))}, ${subject(comparison.winner!)} was ${comparison.op}: `);
      list(companyOf);
      const { lead } = comparison;
      if (lead) out.text(`, ${lead.gap} percentage points ${comparison.op === "highest" ? "above" : "below"} ${new Intl.ListFormat("en").format(lead.over.map(companyOf))}`);
      out.text(".");
    }
  } else if (comparison.op === "order") {
    out.text(comparison.axis === "time" ? `${subject(first)}, highest first: ` : `By ${metricLabel(metric)}, highest first: `);
    list((figure) => (comparison.axis === "time" ? periodText(figure.period!) : companyOf(figure)));
    out.text(".");
  } else {
    const { result, net, every_step, turn, ends_at } = comparison.trend!;
    const atLast = () => {
      at(last);
      if (ends_at) out.text(`, its ${ends_at === "high" ? "highest" : "lowest"} of the periods compared`);
    };
    const where = net === 1 ? "above where it started" : net === -1 ? "below where it started" : "about where it started";
    out.text(`${subject(first)} `);
    if (result === "rose_throughout" || result === "fell_throughout") {
      out.text(`${result === "rose_throughout" ? "rose" : "fell"} in every period from ${periodText(first.period!)} (`);
      out.push(out.value(first));
      out.text(`) to ${periodText(last.period!)} (`);
      out.push(out.value(last));
      out.text(").");
    } else if (result === "rebounded" || result === "pulled_back") {
      const rebound = result === "rebounded";
      out.text(`${rebound ? "fell" : "rose"} from `);
      at(first);
      out.text(` to a ${rebound ? "low" : "high"} of `);
      at(turn!);
      out.text(`, then ${rebound ? "rebounded" : "pulled back"} to `);
      atLast();
      out.text(`, ${(rebound ? net === -1 : net === 1) ? "still " : ""}${where}.`);
    } else {
      out.text(result === "flat" ? "was little changed, from " : `${result} from `);
      at(first);
      out.text(" to ");
      atLast();
      out.text(result !== "flat" && !every_step ? ", though not in every period." : ".");
    }
  }
  if (comparison.not_shown.length > 0) {
    out.text(` No ${metricLabel(metric)} is shown for ${new Intl.ListFormat("en").format(comparison.not_shown)}.`);
  }
}

// A comparison's checked result in a few words, for an inference's label:
// "NVDA highest on gross margin", "NVDA's revenue rose in every period". A
// company's high or low comes with its metric apart, to be listed with others.
function resultClause(comparison: CheckedComparison, owner: (figure: PacketFigure) => string): readonly [string, string?] {
  const { op, axis, figures, metric } = comparison;
  const first = figures[0]!;
  const member = (figure: PacketFigure) => figure.segment ?? figure.company ?? "";
  const subject = `${owner(first)}${metricLabel(metric)}`;
  const segmented = first.segment !== undefined;
  if (op === "highest" || op === "lowest") {
    if (axis === "time") return [`${subject} ${op} in ${periodText(comparison.winner!.period!)}`];
    return segmented
      ? [`${member(comparison.winner!)} ${op} of ${owner(first)}segments by ${metricLabel(metric)}`]
      : [`${member(comparison.winner!)} ${op} on`, metricLabel(metric)];
  }
  if (op === "order") {
    const names = figures.map((figure) => (axis === "time" ? periodText(figure.period!) : member(figure)));
    return [`${axis === "time" ? subject : metricLabel(metric)} highest first: ${names.join(", ")}`];
  }
  const moved: Record<TrendResult, string> = {
    rose: "rose",
    fell: "fell",
    flat: "was little changed",
    rose_throughout: "rose in every period",
    fell_throughout: "fell in every period",
    rebounded: "fell, then rebounded",
    pulled_back: "rose, then pulled back",
  };
  return [`${subject} ${moved[comparison.trend!.result]}`];
}

// Figures set side by side across companies whose periods end in different
// months: one period name ("FY2026" ending Jan and Dec), or one comparison's
// members whatever their names (NVDA's FY2026 against AMD's FY2025). Said once
// for the whole answer, naming each such company's period and its end month.
export function calendarNote(assertions: ReadonlyArray<Assertion>, packet: EvidencePacket): string | undefined {
  const shown = assertions.flatMap((assertion) => packet.figures.filter((figure) => assertion.evidence.includes(figure.id)));
  const compared = assertions.flatMap((assertion) => {
    if (assertion.kind !== "comparison") return [];
    const checked = checkComparison(assertion, assertion.evidence, packet);
    return "comparison" in checked && checked.comparison.axis === "cohort" ? [checked.comparison.figures] : [];
  });
  const apart = (a: PacketFigure, b: PacketFigure) =>
    a.company !== undefined && b.company !== undefined && a.company !== b.company &&
    a.period_end !== undefined && b.period_end !== undefined && a.period_end.slice(0, 7) !== b.period_end.slice(0, 7);
  const pairs = [
    ...shown.flatMap((a) => shown.filter((b) => a.period !== undefined && a.period === b.period && apart(a, b)).map((b) => [a, b])),
    ...compared.flatMap((members) => members.flatMap((a) => members.filter((b) => apart(a, b)).map((b) => [a, b]))),
  ];
  const named = [...new Set(pairs.flat().map((figure) =>
    `${figure.company}'s ${figure.period ? periodText(figure.period) : "period"} ended ${monthYear(figure.period_end!)}`
  ))];
  return named.length === 0
    ? undefined
    : `The periods compared end at different times, so they do not line up: ${new Intl.ListFormat("en").format(named)}.`;
}

// The text a rendered assertion reads as, each value as displayed.
export function plainText(segments: ReadonlyArray<Segment>): string {
  return segments.map((segment) => (segment.type === "text" ? segment.text : segment.format)).join("");
}

// A segment's figure is its revenue: "Data Center revenue".
function figureLabel(figure: PacketFigure): string {
  return figure.segment ? `${figure.segment} ${metricLabel(figure.metric)}` : metricLabel(figure.metric);
}

// A stored quarter ("Q42026") reads as "Q4 2026", and a window's dates by
// month and year, never the day.
function periodText(period: string): string {
  return quarterText(period).replace(/\d{4}-\d{2}-\d{2}/g, (date) => monthYear(date));
}

// The end month is said, since fiscal calendars differ (#180), and a period
// not fully covered (#302). A quote has no period: its date says how current it is.
function periodPhrase(figure: PacketFigure): string {
  const coverage = periodCoverage(figure);
  const notes = [
    ...(figure.period_end ? [`ended ${monthYear(figure.period_end)}`] : []),
    ...(coverage ? [coverage === "partial" ? "partial period" : `${coverage} coverage`] : []),
  ];
  const quoted = !figure.period && figure.displayed === false && figure.as_of
    ? ` as of ${new Date(figure.as_of).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`
    : "";
  return `${figure.period ? ` in ${periodText(figure.period)}` : quoted}${notes.length > 0 ? ` (${notes.join(", ")})` : ""}`;
}

function capitalize(text: string): string {
  return text ? `${text[0]!.toUpperCase()}${text.slice(1)}` : text;
}

function monthYear(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}
