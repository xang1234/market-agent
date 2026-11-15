import { randomUUID } from "node:crypto";

import { analyzeAuthority } from "../../analyze/src/financial-section.ts";
import type { AnalyzePlaybookSection } from "../../analyze/src/playbook.ts";
import { analystSectionRunner, meteredModels, type AnalystSection } from "../../chat/src/analyst-agent.ts";
import { isUnavailableRead, runRegisteredAnalystTool } from "../../chat/src/analyst-tools.ts";
import { noteBlock } from "../../chat/src/chat-ids.ts";
import type { ChatAnalystToolRuntimeToolCall } from "../../chat/src/coordinator.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import type { FinancialPool } from "../../financial-engine/src/ports.ts";
import type { LlmChatClient } from "../../llm/src/index.ts";
import type { SubjectRef } from "../../shared/src/subject-ref.ts";
import type { DevApiAnalyzeWorkflowInput, DevApiAnalyzeWorkflowResult } from "./analyze-adapter.ts";

const GOALS: Readonly<Record<string, (company: string) => string>> = {
  investment_thesis: (company) =>
    `What is the investment case for ${company} as its stored sources state it: what the business does and sells, and its latest fiscal year's revenue, gross margin and operating margin?`,
  growth_drivers: (company) =>
    `What drives ${company}'s growth as its 10-K states it (its products, markets and customers), and how did its revenue change over its latest two fiscal years?`,
  competitive_position: (company) =>
    `How does ${company} compete as its 10-K's competition claims (business.competition) state it, and which industry peers are on file?`,
  downside_risks: (company) =>
    `What are ${company}'s main downside risks as the risk factors in its 10-K (risk.factor claims) state them?`,
};

const NO_AGENT_SECTION = "The analyst agent writes no section of this playbook yet; it writes the Investment memo's narrative sections.";
const NO_COMPANY = "The memo's subject names no company on file, so no section is written from stored sources.";

type Company = Readonly<{ issuer_id: string; label: string }>;

export type AnalyzeAgentDeps = Readonly<{
  db: FinancialPool;
  env: NodeJS.ProcessEnv;
  logToolCalls: (calls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>) => Promise<void>;
  client?: () => Promise<LlmChatClient> | LlmChatClient;
}>;

export function analyzeAgentWorkflow(deps: AnalyzeAgentDeps): (input: DevApiAnalyzeWorkflowInput) => Promise<DevApiAnalyzeWorkflowResult> {
  const section = analystSectionRunner({
    financial: { pool: deps.db, evidence: createEvidenceFinancialPort },
    ...meteredModels(deps.env, deps.client),
    read: (name, args, turn) => runRegisteredAnalystTool(deps.db, name, args, turn).catch((reason: unknown) => {
      if (!isUnavailableRead(reason)) throw reason;
      console.warn(`[analyze] ${name} failed; the section is written without it`, reason);
      return { tool: name, status: "unavailable" as const, reason: "the read failed" };
    }),
    logToolCalls: deps.logToolCalls,
  });
  return async (input) => {
    const asOf = input.knowledgeCutoff ?? new Date().toISOString();
    const sections = (input.playbook?.sections ?? []).filter((entry) => Object.hasOwn(GOALS, entry.section_id));
    const company = sections.length === 0 ? null : await companyOf(deps.db, input.subjectRefs);
    if (company === null) {
      const note = noteBlock({ snapshotId: input.snapshotId, asOf }, "analyze:unwritten", sections.length === 0 ? NO_AGENT_SECTION : NO_COMPANY);
      return { blocks: [{ ...note, subject_refs: input.subjectRefs }] };
    }
    const authority = analyzeAuthority(input.userId, input.runId, input.template.template_id, input.template.version);
    const settled = await Promise.allSettled(sections.map((entry) => section({
      subject: company,
      goal: GOALS[entry.section_id]!(company.label),
      sectionId: entry.section_id,
      userId: input.userId,
      runId: input.runId,
      authority,
      snapshotId: input.snapshotId,
      asOf,
    })));
    // Every section settles before a failure fails the memo, so none runs on unawaited.
    const failures = settled.flatMap((result) => (result.status === "rejected" ? [result.reason as unknown] : []));
    if (failures.length > 0) throw failures.length === 1 ? failures[0] : new AggregateError(failures, "memo sections failed");
    const written = settled.map((result) => (result as PromiseFulfilledResult<AnalystSection>).value);
    return { blocks: sections.flatMap((entry, i) => sectionBlocks(entry, written[i]!, input.snapshotId, asOf)) };
  };
}

// A certified figure follows its section, not inside it, since it keeps its own engine snapshot.
function sectionBlocks(entry: AnalyzePlaybookSection, written: AnalystSection, snapshotId: string, asOf: string): Array<Record<string, unknown>> {
  const shown = written.blocks.filter((block) => block.kind !== "financial_answer");
  const refs = (key: string) => [...new Set(shown.flatMap((block) => (Array.isArray(block[key]) ? block[key] as string[] : [])))];
  const subjects = new Map(shown.flatMap((block) => (Array.isArray(block.subject_refs) ? block.subject_refs as SubjectRef[] : [])).map((ref) => [`${ref.kind}:${ref.id}`, ref]));
  return [
    {
      id: randomUUID(),
      kind: "section",
      snapshot_id: snapshotId,
      data_ref: { kind: "section", id: `analyze:${entry.section_id}`, params: { playbook_section_id: entry.section_id } },
      title: entry.title,
      as_of: asOf,
      subject_refs: [...subjects.values()],
      source_refs: refs("source_refs"),
      claim_refs: refs("claim_refs"),
      document_refs: refs("document_refs"),
      tool_call_ids: refs("tool_call_ids"),
      children: shown,
    },
    ...written.blocks.filter((block) => block.kind === "financial_answer"),
  ];
}

// The issuer the memo's financial sections compute for, else its first listing's.
async function companyOf(db: FinancialPool, refs: ReadonlyArray<SubjectRef>): Promise<Company | null> {
  const ref = refs.find((entry) => entry.kind === "issuer") ?? refs.find((entry) => entry.kind === "listing");
  if (!ref) return null;
  const { rows } = await db.query<{ issuer_id: string; label: string }>(
    ref.kind === "listing"
      ? `select n.issuer_id::text as issuer_id, l.ticker as label
           from listings l join instruments n on n.instrument_id = l.instrument_id
          where l.listing_id = $1::uuid`
      : `select i.issuer_id::text as issuer_id,
                coalesce((select l.ticker from listings l join instruments n on n.instrument_id = l.instrument_id
                           where n.issuer_id = i.issuer_id order by (l.active_to is null) desc, l.ticker limit 1), i.legal_name) as label
           from issuers i
          where i.issuer_id = $1::uuid`,
    [ref.id],
  );
  return rows[0] ?? null;
}
