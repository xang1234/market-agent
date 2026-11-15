// memo-flow.mjs's verdict on what it saw, apart from the browser and the database, so a test can hand it a run.

type Segment = { type?: string; text?: string; ref_kind?: string };
type Block = {
  kind?: string;
  title?: string;
  data_ref?: { params?: { playbook_section_id?: string } };
  claim_refs?: string[];
  source_refs?: string[];
  segments?: Segment[];
  commentary?: Array<{ segments?: Segment[] }>;
  children?: Block[];
};
export type MemoRun = { blocks?: Block[] } | null;

export const SECTIONS = ["investment_thesis", "growth_drivers", "competitive_position", "downside_risks"];
const EMPTY = /^No stored source covers this section/;
const UNWRITTEN = /^This section was not written|^The answer could not be written|^Commentary is unavailable/;
// Case matters for Buy, Hold and Sell: a 10-K's "we sell" is not a Sell.
const stanceIn = (text: string) => [...text.matchAll(/\b(?:Buy|Hold|Sell)\b/g), ...text.matchAll(/\b(?:rating|conviction)\b/gi)].map((match) => match[0]);

const sectionsOf = (run: MemoRun) => (run?.blocks ?? []).filter((block) => block.kind === "section" && SECTIONS.includes(block.data_ref?.params?.playbook_section_id ?? ""));
const segmentsOf = (block: Block): Segment[] => [...(block.segments ?? []), ...(block.commentary ?? []).flatMap((part) => part.segments ?? []), ...(block.children ?? []).flatMap(segmentsOf)];

export const claimIdsOf = (run: MemoRun) => [...new Set(sectionsOf(run).flatMap((section) => section.claim_refs ?? []))];

export function memoVerdict(seen: {
  run: MemoRun;
  // The memo's article without its claim quotes, and the whole page.
  canvas: string;
  text: string;
  url: string;
  listingId: string;
  predicates: ReadonlyMap<string, string>;
  failure: string | null;
  memoMs: number | null;
  llmCalls: number | null;
  evidence: string;
}) {
  const sections = sectionsOf(seen.run);
  const report = {
    url: seen.url,
    subject_matches: new URL(seen.url).searchParams.get("subject") === `listing:${seen.listingId}`,
    generated: seen.text.includes("Memo generated"),
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
        shown: section.title !== undefined && seen.canvas.includes(section.title),
        claims: (section.claim_refs ?? []).map((claim) => seen.predicates.get(claim) ?? "unknown"),
        figures: segments.filter((segment) => segment.type === "ref" && segment.ref_kind === "result").length,
        // Industry peers and analyst consensus cite their stored source, not a claim row.
        sources: (section.source_refs ?? []).length,
        empty: notes.some((note) => EMPTY.test(note)),
        unwritten: notes.some((note) => UNWRITTEN.test(note)),
      };
    }),
    certified_blocks: (seen.run?.blocks ?? []).filter((block) => block.kind === "financial_answer").length,
    stance_words: stanceIn(seen.canvas),
    page_stance_words: stanceIn(seen.text),
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
  const passed =
    seen.failure === null && verdict.subject_matches && verdict.generated &&
    verdict.sections.every((section) => section.shown && !section.unwritten && (section.empty || section.claims.length > 0 || section.figures > 0 || section.sources > 0)) &&
    // A company with a 10-K on file has its competition read; one with none shows its peers at most.
    (claimIdsOf(seen.run).length === 0 || verdict.competitive_cites_competition) &&
    verdict.risks_cite_only_risk_factors &&
    verdict.stance_words.length === 0;
  return { report: verdict, passed };
}
