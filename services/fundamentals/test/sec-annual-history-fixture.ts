// Twelve years of 10-Ks for one made-up calendar-year filer, in companyfacts
// form (#610). The repo's real companyfacts fixtures each hold one fiscal year,
// which no backtest can run on. FY y ends Dec 31 and its 10-K is filed on
// Feb 15 of y+1, with that year and the prior one as comparatives:
//
// - operating cash flow 1,200M + 100M a year from FY2016; PP&E capex 200M;
// - stock-based compensation 50M; cash 500M; long-term debt 300M;
// - a cover count dated Feb 1 of y+1: 100M shares, 200M after the 2-for-1
//   split on 2020-06-01;
// - the FY2018 10-K restates FY2017 operating cash flow to 1,350M.

export const HISTORY_CIK = 990610;
export const HISTORY_SPLIT = { execution_date: "2020-06-01", split_from: "1", split_to: "2" } as const;
export const HISTORY_YEARS = { first: 2015, last: 2026 } as const;

export const operatingCashFlow = (year: number): number => 1_200_000_000 + 100_000_000 * (year - 2016);
const RESTATED_FY2017_OCF = 1_350_000_000;

type Filing = { accn: string; fy: number; fp: "FY"; form: "10-K"; filed: string };

export function tenK(year: number): Filing {
  return { accn: `0000990610-${String(year + 1).slice(2)}-000001`, fy: year, fp: "FY", form: "10-K", filed: `${year + 1}-02-15` };
}

function entry(filing: Filing, value: number, end: string, start?: string) {
  return { ...(start === undefined ? {} : { start }), end, val: value, val_token: String(value), ...filing };
}

function concept(values: (year: number) => number, kind: "duration" | "instant", restated?: { year: number; filedIn: number; value: number }) {
  const entries = [];
  for (let year = HISTORY_YEARS.first; year <= HISTORY_YEARS.last; year += 1) {
    const filing = tenK(year);
    for (const reported of [year - 1, year]) {
      const value = restated && restated.year === reported && restated.filedIn === year ? restated.value : values(reported);
      entries.push(kind === "duration" ? entry(filing, value, `${reported}-12-31`, `${reported}-01-01`) : entry(filing, value, `${reported}-12-31`));
    }
  }
  return { label: "", description: "", units: { USD: entries } };
}

export function annualHistoryCompanyFacts() {
  const shares = [];
  for (let year = HISTORY_YEARS.first; year <= HISTORY_YEARS.last; year += 1) {
    const coverDate = `${year + 1}-02-01`;
    shares.push(entry(tenK(year), coverDate > HISTORY_SPLIT.execution_date ? 200_000_000 : 100_000_000, coverDate));
  }
  return {
    cik: HISTORY_CIK,
    entityName: "History Corp",
    facts: {
      "us-gaap": {
        Revenues: concept((year) => 5_000_000_000 + 250_000_000 * (year - 2016), "duration"),
        NetCashProvidedByUsedInOperatingActivities: concept(operatingCashFlow, "duration", { year: 2017, filedIn: 2018, value: RESTATED_FY2017_OCF }),
        PaymentsToAcquirePropertyPlantAndEquipment: concept(() => 200_000_000, "duration"),
        ShareBasedCompensation: concept(() => 50_000_000, "duration"),
        CashAndCashEquivalentsAtCarryingValue: concept(() => 500_000_000, "instant"),
        LongTermDebtNoncurrent: concept(() => 300_000_000, "instant"),
      },
      dei: { EntityCommonStockSharesOutstanding: { label: "", description: "", units: { shares: shares } } },
    },
  };
}
