// SEC 8-K Item-number → event taxonomy (deterministic; no LLM in v1 — that is
// the separate fra-ajvd.6 enrichment). Two ingest paths feed this with item
// codes from different sources (verified against live EDGAR):
//   - the daily crawl reads the full-submission .txt header, where items appear
//     as "ITEM INFORMATION:\t<description>" (no numbers) → extract8kItemCodesFromHeader;
//   - the per-issuer backfill reads the submissions API's recent.items, which is
//     already a comma-joined list of numeric codes ("2.02,9.01").
// Both converge on classify8kItems(codes).
import type { EventType } from "./event-repo.ts";

export type Item8kClassification = {
  itemCode: string;
  eventType: EventType;
  claimable: boolean;
};

// Recognized item codes → event type. claimable=false means the item is recorded
// as a timeline event but is not surfaced to agents as a claim (Q2 materiality):
// 9.01 (Financial Statements & Exhibits) is exhibit boilerplate, not a signal.
const ITEM_TAXONOMY: Readonly<Record<string, { eventType: EventType; claimable: boolean }>> = {
  "1.01": { eventType: "material_agreement", claimable: true },
  "1.02": { eventType: "material_agreement", claimable: true },
  "1.03": { eventType: "bankruptcy", claimable: true },
  "2.01": { eventType: "m_and_a", claimable: true },
  "2.02": { eventType: "guidance_update", claimable: true },
  "3.01": { eventType: "delisting", claimable: true },
  "4.01": { eventType: "auditor_change", claimable: true },
  "4.02": { eventType: "restatement", claimable: true },
  "5.02": { eventType: "officer_change", claimable: true },
  "9.01": { eventType: "material_event", claimable: false },
};

// Unrecognized-but-real items still surface as a generic, claimable material event
// (graceful degradation — never a silent drop; severity refinement is fra-ajvd.6).
const UNKNOWN_ITEM: { eventType: EventType; claimable: boolean } = {
  eventType: "material_event",
  claimable: true,
};

// Distinctive normalized prefixes of the official Form 8-K item titles. Prefix
// (not exact) matching tolerates SEC's trailing-clause variants/truncation, e.g.
// 5.02's "…; Compensatory Arrangements of Certain Officers" suffix.
const ITEM_DESCRIPTION_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["entry into a material definitive agreement", "1.01"],
  ["termination of a material definitive agreement", "1.02"],
  ["bankruptcy or receivership", "1.03"],
  ["completion of acquisition or disposition", "2.01"],
  ["results of operations and financial condition", "2.02"],
  ["notice of delisting", "3.01"],
  ["changes in registrant's certifying accountant", "4.01"],
  ["non-reliance on previously issued financial statements", "4.02"],
  ["departure of directors", "5.02"],
  ["financial statements and exhibits", "9.01"],
];

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

// Map an "ITEM INFORMATION" header description to its numeric code, or null when
// the title is not one we classify (the caller keeps a sentinel so the item is
// still recorded as a generic material event).
export function itemCodeForDescription(description: string): string | null {
  const normalized = normalize(description);
  for (const [prefix, code] of ITEM_DESCRIPTION_PREFIXES) {
    if (normalized.startsWith(prefix)) return code;
  }
  return null;
}

// Classify item codes into events. Unknown / sentinel codes → generic material
// event. De-dupes repeats, preserving first-seen order.
export function classify8kItems(codes: ReadonlyArray<string>): Item8kClassification[] {
  const seen = new Set<string>();
  const out: Item8kClassification[] = [];
  for (const raw of codes) {
    const itemCode = raw.trim();
    if (itemCode === "" || seen.has(itemCode)) continue;
    seen.add(itemCode);
    const entry = ITEM_TAXONOMY[itemCode] ?? UNKNOWN_ITEM;
    out.push({ itemCode, eventType: entry.eventType, claimable: entry.claimable });
  }
  return out;
}

// Read item codes from a full-submission .txt SGML header (the daily-crawl path).
// Each "ITEM INFORMATION:\t<description>" line maps to a code; an unrecognized
// description becomes an `unknown:<slug>` sentinel so it is still recorded rather
// than dropped. De-dupes, preserving order.
export function extract8kItemCodesFromHeader(submissionTxt: string): string[] {
  const seen = new Set<string>();
  const codes: string[] = [];
  const re = /ITEM INFORMATION:\s*(.+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(submissionTxt)) !== null) {
    const description = match[1].trim();
    if (description === "") continue;
    const code = itemCodeForDescription(description) ?? `unknown:${slug(description)}`;
    if (seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }
  return codes;
}

function slug(text: string): string {
  return normalize(text).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
