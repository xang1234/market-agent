export type AnalyzePlaybookSection = {
  section_id: string;
  title: string;
  required: boolean;
  block_hint: "rich_text" | "metric_row" | "table" | "line_chart" | "section";
};

export type AnalyzePlaybook = {
  playbook_id: string;
  version: number;
  name: string;
  description: string;
  default_instructions: string;
  default_source_categories: ReadonlyArray<string>;
  sections: ReadonlyArray<AnalyzePlaybookSection>;
};

export type AnalyzePlaybookRunRequest = {
  playbook_id: string;
  instructions?: string;
  source_categories?: ReadonlyArray<string>;
};

export type ResolvedAnalyzePlaybookRequest = {
  playbook: AnalyzePlaybook;
  instructions: string;
  source_categories: ReadonlyArray<string>;
  prompt: string;
};

export class AnalyzePlaybookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyzePlaybookError";
  }
}

export const ANALYZE_PLAYBOOKS: ReadonlyArray<AnalyzePlaybook> = Object.freeze([
  Object.freeze({
    playbook_id: "earnings_quality",
    version: 1,
    name: "Earnings quality",
    description: "Assess revenue quality, margins, cash conversion, and management commentary.",
    default_instructions: "Assess revenue quality, margins, cash conversion, and management commentary.",
    default_source_categories: Object.freeze(["filings", "transcripts", "news"]),
    sections: Object.freeze([
      section("summary", "Summary", true, "rich_text"),
      section("quality_of_revenue", "Quality of revenue", true, "metric_row"),
      section("revenue_trend", "Revenue trend", false, "line_chart"),
      section("analyst_overview", "Analyst overview", false, "section"),
      section("price_targets", "Price targets", false, "section"),
      section("margin_bridge", "Margin bridge", true, "table"),
      section("cash_conversion", "Cash conversion", true, "metric_row"),
      section("management_tone", "Management tone", true, "rich_text"),
      section("watch_items", "Watch items", true, "table"),
    ]),
  }),
  Object.freeze({
    playbook_id: "variant_view",
    version: 1,
    name: "Variant view",
    description: "Compare the market narrative with evidence-backed counterpoints.",
    default_instructions: "Compare the market narrative with evidence-backed counterpoints.",
    default_source_categories: Object.freeze(["filings", "news", "transcripts"]),
    sections: Object.freeze([
      section("summary", "Variant summary", true, "rich_text"),
      section("consensus_view", "Consensus view", true, "rich_text"),
      section("counter_evidence", "Counter-evidence", true, "table"),
      section("disconfirming_signals", "Disconfirming signals", true, "table"),
      section("decision_points", "Decision points", true, "table"),
    ]),
  }),
  Object.freeze({
    playbook_id: "peer_comparison",
    version: 1,
    name: "Peer comparison",
    description: "Compare a subject against peers on fundamentals, estimates, and evidence-backed risks.",
    default_instructions:
      "Compare the subject against peers on growth, margins, valuation, estimates, and evidence-backed risks.",
    default_source_categories: Object.freeze(["filings", "news", "peers"]),
    sections: Object.freeze([
      section("summary", "Comparison summary", true, "rich_text"),
      section("peer_table", "Peer table", true, "table"),
      section("relative_strengths", "Relative strengths", true, "table"),
      section("relative_risks", "Relative risks", true, "table"),
    ]),
  }),
  Object.freeze({
    playbook_id: "investment_memo",
    version: 1,
    name: "Investment memo",
    description:
      "Full investment memo: thesis, financial health, growth, risks, ownership, and a final verdict with rating and conviction.",
    default_instructions:
      "Write a complete investment memo. Lead with the investment thesis. Cover financial health and profitability, growth drivers, downside risks, and ownership signals (institutional holders, insider activity). Close with a final verdict: rating (Buy/Hold/Sell), conviction (low/medium/high), and the investor profile the position suits.",
    default_source_categories: Object.freeze(["filings", "transcripts", "news"]),
    sections: Object.freeze([
      section("investment_thesis", "Investment thesis", true, "rich_text"),
      section("financial_health", "Financial health & profitability", true, "metric_row"),
      section("revenue_trend", "Revenue trend", false, "line_chart"),
      section("growth_drivers", "Growth drivers", true, "rich_text"),
      section("downside_risks", "Downside risks", true, "table"),
      section("ownership_signals", "Ownership & insider signals", true, "rich_text"),
      section("analyst_overview", "Analyst overview", false, "section"),
      section("price_targets", "Price targets", false, "section"),
      section("final_verdict", "Final verdict", true, "metric_row"),
    ]),
  }),
]);

export function resolveAnalyzePlaybookRequest(
  input: AnalyzePlaybookRunRequest,
): ResolvedAnalyzePlaybookRequest {
  const playbook = ANALYZE_PLAYBOOKS.find((item) => item.playbook_id === input.playbook_id);
  if (!playbook) throw new AnalyzePlaybookError("playbook_id is unknown");

  const instructions = normalizeText(input.instructions) ?? playbook.default_instructions;
  const sourceCategories = normalizeSourceCategories(input.source_categories) ?? playbook.default_source_categories;

  return Object.freeze({
    playbook,
    instructions,
    source_categories: Object.freeze([...sourceCategories]),
    prompt: [
      `${playbook.name}: ${playbook.description}`,
      `Instructions: ${instructions}`,
      `Required sections: ${playbook.sections.map((section) => section.title).join("; ")}`,
      `Source categories: ${sourceCategories.join(", ")}`,
    ].join("\n"),
  });
}

function section(
  section_id: string,
  title: string,
  required: boolean,
  block_hint: AnalyzePlaybookSection["block_hint"],
): AnalyzePlaybookSection {
  return Object.freeze({ section_id, title, required, block_hint });
}

function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function normalizeSourceCategories(value: unknown): ReadonlyArray<string> | null {
  if (!Array.isArray(value)) return null;
  const categories = value
    .filter((item): item is string => typeof item === "string" && item.trim() !== "")
    .map((item) => item.trim());
  return categories.length === 0 ? null : Object.freeze([...new Set(categories)]);
}
