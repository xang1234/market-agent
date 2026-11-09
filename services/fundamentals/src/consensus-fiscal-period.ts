// Finviz says "this Y", "next Y" and "next Q" and never names the fiscal period.
// The period follows from the issuer's latest reported periods only while the
// period after them is certainly still under way on the capture date: until
// then no later period can have ended and gone unreported, so Finviz cannot
// have rolled past it. The windows are the shortest a fiscal year (52 weeks)
// and a fiscal quarter (12 weeks, as Costco's) can last. Outside them the
// label stays unnamed rather than guessed.

import type { FiscalPeriod } from "./statement.ts";

export type ConsensusPeriod = "next_q" | "this_y" | "next_y";

export type ReportedPeriod = { fiscal_year: number; fiscal_period: FiscalPeriod; period_end: string };

export type ReportedPeriods = {
  annual: ReportedPeriod | null;
  quarter: ReportedPeriod | null;
};

export type ConsensusFiscalPeriod = { fiscal_period: string; fiscal_period_basis: string };

const SHORTEST_YEAR_DAYS = 364;
const SHORTEST_QUARTER_DAYS = 84;
const QUARTERS: ReadonlyArray<FiscalPeriod> = ["Q1", "Q2", "Q3", "Q4"];

export function consensusFiscalPeriod(
  period: ConsensusPeriod,
  reported: ReportedPeriods,
  capturedOn: string,
): ConsensusFiscalPeriod | null {
  return period === "next_q" ? nextQuarter(reported, capturedOn) : fiscalYear(period, reported.annual, capturedOn);
}

function fiscalYear(period: "this_y" | "next_y", annual: ReportedPeriod | null, capturedOn: string): ConsensusFiscalPeriod | null {
  if (!annual) return null;
  const days = daysBetween(annual.period_end, capturedOn);
  if (days <= 0 || days > SHORTEST_YEAR_DAYS) return null;
  const year = annual.fiscal_year + (period === "this_y" ? 1 : 2);
  const which = period === "this_y" ? '"this Y" read as the fiscal year' : '"next Y" read as the second fiscal year';
  return {
    fiscal_period: `FY${year}`,
    fiscal_period_basis:
      `Finviz ${which} after FY${annual.fiscal_year}, the latest annual period on file (ended ${annual.period_end}). ` +
      `Captured ${days} days after it ended, so FY${annual.fiscal_year + 1} is still under way: a fiscal year lasts at least 52 weeks.`,
  };
}

function nextQuarter(reported: ReportedPeriods, capturedOn: string): ConsensusFiscalPeriod | null {
  // An annual period ends on its fourth quarter's last day, so it reports that quarter too.
  const closedByAnnual = reported.annual !== null && (reported.quarter === null || reported.annual.period_end >= reported.quarter.period_end);
  const latest: ReportedPeriod | null = closedByAnnual ? { ...reported.annual!, fiscal_period: "Q4" } : reported.quarter;
  if (!latest) return null;
  const days = daysBetween(latest.period_end, capturedOn);
  if (days <= 0 || days > SHORTEST_QUARTER_DAYS) return null;
  const index = QUARTERS.indexOf(latest.fiscal_period);
  const next = index === 3 ? `FY${latest.fiscal_year + 1} Q1` : `FY${latest.fiscal_year} ${QUARTERS[index + 1]}`;
  const closing = closedByAnnual ? `, closing the FY${latest.fiscal_year} annual period` : "";
  return {
    fiscal_period: next,
    fiscal_period_basis:
      `Finviz "next Q" read as the quarter after FY${latest.fiscal_year} ${latest.fiscal_period}, the latest quarter on file (ended ${latest.period_end}${closing}). ` +
      `Captured ${days} days after it ended, so ${next} is still under way: a fiscal quarter lasts at least 12 weeks.`,
  };
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
