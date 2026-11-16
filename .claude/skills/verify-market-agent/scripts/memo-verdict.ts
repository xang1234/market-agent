type Segment = { type?: string; text?: string; ref_kind?: string };
type Block = {
  kind?: string;
  title?: string;
  data_ref?: { params?: { playbook_section_id?: string } };
  claim_refs?: string[];
  source_refs?: string[];
  segments?: Segment[];
  commentary?: Array<{ kind?: string; segments?: Segment[] }>;
  children?: Block[];
};
export type MemoRun = { run_id?: string; blocks?: Block[] } | null;

export const SECTIONS = ["investment_thesis", "growth_drivers", "competitive_position", "downside_risks"];
const EMPTY = /^No stored source covers this section/;
const UNWRITTEN = /^This section was not written|^The answer could not be written|^Commentary is unavailable/;
const CAPITALIZED_RATINGS = /\b(?:Buy|Hold|Sell)\b/g;
const STANCE_WORDS = /\b(?:ratings?|conviction|upside|overweight|underweight|outperform|underperform|upgrade|downgrade|recommend(?:s|ed|ations?)?|expected returns?)\b/gi;
// The guard's rating forms and price target actions (analyst-agent.ts statesStance), so this check is never the laxer.
const RATED = /\b(?:a|an|the|our|my|strong|rated?s?)\s+(?:strong\s+)?(?:buy|sell|hold)\b|\b(?:buy|sell|hold)\s+(?:rating|recommendation)s?\b|\brate[ds]?\s+(?:\S+\s+){0,3}?as\s+(?:a\s+|an\s+)?(?:strong\s+)?(?:buy|sell|hold)\b|\brecommend\w*\s+(?:buy|sell|hold)\w*|\b(?:rais|lift|lower|cut|set|reiterat|maintain|boost|trim|increas|reduc)\w*\s+(?:\S+\s+){0,3}?price targets?\b|\bprice targets?\s+(?:raise|cut|increase|hike|reduction)s?\b/gi;
const stanceIn = (text: string) => [CAPITALIZED_RATINGS, STANCE_WORDS, RATED].flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[0]));

const sectionsOf = (run: MemoRun) => (run?.blocks ?? []).filter((block) => block.kind === "section" && SECTIONS.includes(block.data_ref?.params?.playbook_section_id ?? ""));
const segmentsOf = (block: Block): Segment[] => [...(block.segments ?? []), ...(block.commentary ?? []).flatMap((part) => part.segments ?? []), ...(block.children ?? []).flatMap(segmentsOf)];

const themesOf = (block: Block): number => (block.commentary ?? []).filter((part) => part.kind === "inference").length + (block.children ?? []).reduce((sum, child) => sum + themesOf(child), 0);

// The judge's log line, as answer-trace.ts writes it.
const JUDGE_LINE = /^\[chat\] judge thread=(\S+) run=\S+ turn=(\S+)(?: on .+?)?: (\d+) shown, (\d+) unverified, of (\d+) inferences(?: \((.*)\))?$/gm;
function judgedIn(log: string, runId: string | undefined) {
  const bySection = new Map<string, { shown: number; of: number; reasons: string[] }>();
  for (const [, thread, section, shown, , of, reasons] of log.matchAll(JUDGE_LINE)) {
    if (thread !== runId) continue;
    const seen = bySection.get(section!) ?? { shown: 0, of: 0, reasons: [] };
    bySection.set(section!, { shown: seen.shown + Number(shown), of: seen.of + Number(of), reasons: [...seen.reasons, ...(reasons ? reasons.split("; ") : [])] });
  }
  return bySection;
}

export const claimIdsOf = (run: MemoRun) => [...new Set(sectionsOf(run).flatMap((section) => section.claim_refs ?? []))];

export function memoVerdict(seen: {
  run: MemoRun;
  unquotedArticle: string;
  page: string;
  url: string;
  listingId: string;
  predicates: ReadonlyMap<string, string>;
  failure: string | null;
  memoMs: number | null;
  llmCalls: number | null;
  log: string;
  evidence: string;
}) {
  const sections = sectionsOf(seen.run);
  const judged = judgedIn(seen.log, seen.run?.run_id);
  const report = {
    url: seen.url,
    subject_matches: new URL(seen.url).searchParams.get("subject") === `listing:${seen.listingId}`,
    generated: seen.page.includes("Memo generated"),
    memo_ms: seen.memoMs,
    llm_calls: seen.llmCalls,
    sections: SECTIONS.map((id) => {
      const section = sections.find((entry) => entry.data_ref?.params?.playbook_section_id === id);
      if (!section) return { id, shown: false as const };
      const segments = segmentsOf(section);
      const notes = segments.flatMap((segment) => (segment.type === "text" && segment.text !== undefined ? [segment.text] : []));
      return {
        id,
        title: section.title,
        shown: section.title !== undefined && seen.unquotedArticle.includes(section.title),
        claims: (section.claim_refs ?? []).map((claim) => seen.predicates.get(claim) ?? "unknown"),
        figures: segments.filter((segment) => segment.type === "ref" && segment.ref_kind === "result").length,
        sources: (section.source_refs ?? []).length,
        empty: notes.some((note) => EMPTY.test(note)),
        unwritten: notes.some((note) => UNWRITTEN.test(note)),
        themes_shown: themesOf(section),
        judge: judged.get(id) ?? null,
      };
    }),
    certified_blocks: (seen.run?.blocks ?? []).filter((block) => block.kind === "financial_answer").length,
    stance_words: stanceIn(seen.unquotedArticle),
    page_stance_words: stanceIn(seen.page),
    failure: seen.failure,
    evidence: seen.evidence,
  };
  const competitive = report.sections.find((section) => section.id === "competitive_position");
  const risks = report.sections.find((section) => section.id === "downside_risks");
  const verdict = {
    ...report,
    competitive_cites_competition: competitive?.shown === true && competitive.claims.includes("business.competition"),
    risks_cite_only_risk_factors: risks?.shown !== true || risks.claims.every((predicate) => predicate === "risk.factor"),
  };
  const competitionReadIfOnFile = claimIdsOf(seen.run).length === 0 || verdict.competitive_cites_competition;
  const passed =
    seen.failure === null && verdict.subject_matches && verdict.generated &&
    verdict.sections.every((section) => section.shown && !section.unwritten && (section.empty || section.claims.length > 0 || section.figures > 0 || section.sources > 0)) &&
    competitionReadIfOnFile &&
    verdict.risks_cite_only_risk_factors &&
    verdict.stance_words.length === 0;
  return { report: verdict, passed };
}
