// Research-quality eval (#124): questions the owner scores by hand, because
// tests prove plumbing, not whether an answer is useful to an analyst.
//
// Every question runs against the frozen golden dataset
// (services/chat/test/golden/dataset.ts): NVDA, AMD and AAPL with eight
// quarters and two fiscal years of revenue, gross profit, operating income and
// net income, a quote, and ten daily bars, plus NVDA's business-segment revenue
// for its latest quarter (#157). Nothing else is seeded (no AMD/AAPL segments,
// cash flow, guidance or filings text), which several questions rely on: the
// honest answer there is "not available", never a number.
//
// ponytail: the runner that sends these through analyst mode and writes the
// dated report waits on #123 (analyst mode, PR #149); scoring is manual.

export type CriterionId =
  | "correct_companies"
  | "comparable_periods"
  | "figures_match_sources"
  | "conclusions_justified"
  | "counterarguments"
  | "no_invented_numbers";

export type Criterion = Readonly<{
  id: CriterionId;
  question: string;
  // What 0, 1 and 2 mean, so scores are comparable run to run.
  anchors: readonly [string, string, string];
}>;

/**
 * Scored 0–2 per answer, or N/A where a question lists the criterion as not
 * applicable (N/A is left out of totals). A 0 on `no_invented_numbers` becomes
 * a regression test.
 */
export const RUBRIC: ReadonlyArray<Criterion> = [
  {
    id: "correct_companies",
    question: "Does the answer cover exactly the companies asked about?",
    anchors: ["Wrong or missing company", "Right companies, one only partly covered", "Every company asked about, and only those"],
  },
  {
    id: "comparable_periods",
    question: "Are the periods named and comparable (or the mismatch stated)?",
    anchors: ["Periods unnamed or silently mismatched", "Periods named, mismatch not called out", "Periods named; any fiscal-calendar mismatch stated"],
  },
  {
    id: "figures_match_sources",
    question: "Does every figure match a displayed value and its source?",
    anchors: ["A figure differs from its source", "Figures right but some lack a link to source", "Every figure matches and links to its source"],
  },
  {
    id: "conclusions_justified",
    question: "Do the conclusions follow from the figures shown?",
    anchors: ["Conclusion contradicts or ignores the data", "Plausible but thinly supported", "Each conclusion traced to shown figures"],
  },
  {
    id: "counterarguments",
    question: "Does it note what cuts the other way or what could change the view?",
    anchors: ["One-sided", "A caveat, but generic", "A specific counterpoint grounded in the data"],
  },
  {
    id: "no_invented_numbers",
    question: "Is missing data stated honestly, with no invented numbers?",
    // 0 only for a number that is wrong, since every 0 becomes a regression test;
    // a gap merely left unstated is a 1.
    anchors: [
      "A number not in the data, or one misrepresented (e.g. net income passed off as free cash flow)",
      "No invented numbers, but a data gap left unstated or glossed over",
      "Gaps stated plainly; every number is from the data",
    ],
  },
];

export type EvalQuestion = Readonly<{
  id: string;
  kind: string;
  // Sent in order on one thread; subjectText mimics a thread opened from a ticker page.
  turns: ReadonlyArray<Readonly<{ message: string; subjectText?: string }>>;
  // What a good answer does, and the trap, so the scorer need not re-derive it.
  expect: string;
  // Criteria that cannot apply to a correct answer (an honest "not available"
  // has no figures or periods to judge); scored N/A, not 0.
  notApplicable?: ReadonlyArray<CriterionId>;
}>;

// A correct missing-data answer is a plain "not available": judge only whether
// it names the right company and invents nothing.
const MISSING_DATA_NA: ReadonlyArray<CriterionId> = [
  "comparable_periods",
  "figures_match_sources",
  "conclusions_justified",
  "counterarguments",
];

export const QUESTIONS: ReadonlyArray<EvalQuestion> = [
  {
    id: "single-latest-quarter",
    kind: "single company",
    turns: [{ message: "Analyze NVDA's latest quarter." }],
    expect: "Q4 FY2026 (ended 2026-01-25): revenue, gross/operating/net income, margins, with the quarter-over-quarter direction. NVDA only.",
  },
  {
    id: "margin-trend-loss-quarter",
    kind: "margin trend",
    turns: [{ message: "How have AMD's operating margins trended over the last eight quarters?" }],
    expect: "Eight quarters Q3 FY2024–Q2 FY2026 in order. Must not hide Q2 FY2025's operating loss (-$134M) or describe the trend as uninterrupted.",
  },
  {
    id: "what-changed-gross-margin",
    kind: "what changed",
    turns: [{ message: "What changed in NVDA's gross margin in Q1 fiscal 2026?" }],
    expect: "Gross margin fell sharply in Q1 FY2026 (~60.5% vs ~73% the quarter before) and recovered after. The cause is not in the data: it must say so, not invent one.",
  },
  {
    id: "peer-two",
    kind: "peer comparison",
    turns: [{ message: "Compare NVDA with AMD." }],
    expect: "Side-by-side latest fiscal year plus price performance; each figure attributed to the right company; scale difference stated in words, not computed ratios.",
  },
  {
    id: "peer-three",
    kind: "peer comparison",
    turns: [{ message: "Compare NVDA, AMD and AAPL on revenue and margins." }],
    expect: "All three companies, revenue and margins each. AAPL is in a different industry (consumer electronics); a good answer notes the comparison's limits.",
  },
  {
    id: "fiscal-year-trap",
    kind: "trap: mismatched fiscal years",
    turns: [{ message: "Compare NVDA's and AAPL's fiscal 2025 revenue." }],
    expect: "NVDA FY2025 ends 2025-01-26, AAPL FY2025 ends 2025-09-27: eight months apart. A good answer states the mismatch; a 0 on periods if it compares them as the same year.",
  },
  {
    id: "segment-drill-down",
    kind: "segment drill-down",
    turns: [{ message: "Break down NVDA's revenue by segment." }],
    expect: "Q4 FY2026 segments from cited facts: Data Center $55.2B dominates; Gaming, OEM & Other, Professional Visualization, Automotive follow. Should note how concentrated revenue is in Data Center.",
  },
  {
    id: "missing-segments",
    kind: "missing data",
    turns: [{ message: "Break down AMD's revenue by segment." }],
    expect: "AMD segment data is not seeded. Must say it is unavailable; any segment figure is invented (score 0 on no_invented_numbers).",
    notApplicable: MISSING_DATA_NA,
  },
  {
    id: "missing-cash-flow",
    kind: "missing data",
    turns: [{ message: "What is AMD's free cash flow?" }],
    expect: "Cash flow is not seeded. Must say so; net income is not free cash flow and must not be passed off as it.",
    notApplicable: MISSING_DATA_NA,
  },
  {
    id: "follow-up-memory",
    kind: "conversation",
    turns: [
      { message: "Analyze NVDA." },
      { message: "How does it compare with AMD?" },
      { message: "Explain the differences and show the evidence." },
    ],
    expect: "Turn 2 keeps NVDA and adds AMD; turn 3 keeps both and cites facts from each. Scored on the last turn, with companies judged across all three.",
  },
  {
    id: "ticker-page-compare",
    kind: "explicit subject",
    turns: [{ subjectText: "AAPL", message: "Compare with NVDA." }],
    expect: "Opened from the AAPL page: AAPL primary, NVDA added (#138). Fiscal calendars differ (Sep vs Jan year ends); a good answer says so.",
  },
];
