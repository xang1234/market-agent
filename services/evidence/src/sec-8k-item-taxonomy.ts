// SEC 8-K Item-number → event taxonomy (deterministic; no LLM in v1 — that is
// the separate fra-ajvd.6 enrichment). Two ingest paths feed this with items
// from different sources (verified against live EDGAR):
//   - the daily crawl reads the full-submission .txt header, where items appear
//     as "ITEM INFORMATION:\t<description>" (no numbers) → classify8kHeader;
//   - the per-issuer backfill reads the submissions API's recent.items, already a
//     comma-joined list of numeric codes ("2.02,9.01") → classify8kItems.
// Both produce Item8kClassification[] via the shared classifyCode, so the rows
// persisted are consistent across paths.
import type { EventType } from "./event-repo.ts";

export type Item8kClassification = {
  // Numeric Item code ("5.02"), or null when only an unrecognized header
  // description was available (the crawl path can't always resolve a code).
  itemCode: string | null;
  // The raw header title, carried ONLY for an unrecognized item (null otherwise)
  // so the persisted payload is auditable instead of stringly-typed.
  itemDescription: string | null;
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

// Recognized-but-untyped codes (and unknown ones) → a generic, claimable material
// event (graceful: never a silent drop; severity refinement is fra-ajvd.6).
const UNKNOWN_ITEM: { eventType: EventType; claimable: boolean } = {
  eventType: "material_event",
  claimable: true,
};

// Distinctive normalized prefixes of the official Form 8-K item titles, for the
// crawl path (header carries titles, not codes). Prefix (not exact) matching
// tolerates SEC's trailing-clause variants/truncation, e.g. 5.02's
// "…; Compensatory Arrangements of Certain Officers" suffix. Codes not in
// ITEM_TAXONOMY (7.01, 8.01, …) still classify via UNKNOWN_ITEM, but resolving
// them to a real code here keeps the crawl- and backfill-path payloads identical.
const ITEM_DESCRIPTION_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["entry into a material definitive agreement", "1.01"],
  ["termination of a material definitive agreement", "1.02"],
  ["bankruptcy or receivership", "1.03"],
  ["completion of acquisition or disposition", "2.01"],
  ["results of operations and financial condition", "2.02"],
  ["creation of a direct financial obligation", "2.03"],
  ["costs associated with exit or disposal", "2.05"],
  ["material impairments", "2.06"],
  ["notice of delisting", "3.01"],
  ["unregistered sales of equity securities", "3.02"],
  ["material modification to rights of security holders", "3.03"],
  ["changes in registrant's certifying accountant", "4.01"],
  ["non-reliance on previously issued financial statements", "4.02"],
  ["departure of directors", "5.02"],
  ["amendments to articles of incorporation or bylaws", "5.03"],
  ["submission of matters to a vote of security holders", "5.07"],
  ["regulation fd disclosure", "7.01"],
  ["other events", "8.01"],
  ["financial statements and exhibits", "9.01"],
];

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function classifyCode(code: string): { eventType: EventType; claimable: boolean } {
  return ITEM_TAXONOMY[code] ?? UNKNOWN_ITEM;
}

// Map an "ITEM INFORMATION" header description to its numeric code, or null when
// the title is not one we recognize.
export function itemCodeForDescription(description: string): string | null {
  const normalized = normalize(description);
  for (const [prefix, code] of ITEM_DESCRIPTION_PREFIXES) {
    if (normalized.startsWith(prefix)) return code;
  }
  return null;
}

// Backfill path: classify numeric item codes (from the submissions feed).
// De-dupes repeats, preserving first-seen order.
export function classify8kItems(codes: ReadonlyArray<string>): Item8kClassification[] {
  const seen = new Set<string>();
  const out: Item8kClassification[] = [];
  for (const raw of codes) {
    const itemCode = raw.trim();
    if (itemCode === "" || seen.has(itemCode)) continue;
    seen.add(itemCode);
    out.push({ itemCode, itemDescription: null, ...classifyCode(itemCode) });
  }
  return out;
}

// Crawl path: classify items from a full-submission .txt SGML header. Each
// "ITEM INFORMATION:\t<title>" line resolves to a code when recognized; an
// unrecognized title is recorded honestly with a null code + its raw text (a
// generic material event), never dropped. De-dupes, preserving order.
export function classify8kHeader(submissionTxt: string): Item8kClassification[] {
  const seen = new Set<string>();
  const out: Item8kClassification[] = [];
  const re = /ITEM INFORMATION:\s*(.+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(submissionTxt)) !== null) {
    const description = match[1].trim();
    if (description === "") continue;
    const code = itemCodeForDescription(description);
    const key = code ?? `desc:${normalize(description)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      code !== null
        ? { itemCode: code, itemDescription: null, ...classifyCode(code) }
        : { itemCode: null, itemDescription: description, ...UNKNOWN_ITEM },
    );
  }
  return out;
}
