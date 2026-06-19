// SEC 13F information-table extractor — dependency-free. The full-submission .txt
// holds two XML documents: the cover (carries <periodOfReport> in MM-DD-YYYY) and
// the informationTable of <infoTable> holding rows. Values are reported in whole
// USD for filings on/after 2023-01-01 and in thousands before — normalization is
// the handler's job (it knows the filing date); this returns the raw value.
import { tagText, requireTagText, iterateBlocks } from "./sec-xml.ts";

export type Form13fHolding = {
  nameOfIssuer: string;
  cusip: string; // 9-char, uppercased
  valueRaw: number; // as reported (whole USD post-2023; thousands pre-2023)
  shares: number;
  sshPrnamtType: string; // SH (shares) | PRN (principal amount)
  // "Put" | "Call" for option positions; null for a direct holding. Option rows
  // also use SH share amounts, so consumers must exclude them from common-share
  // holdings (the handler does).
  putCall: string | null;
};

// The 13F-HR/A amendment kinds we model (cover <amendmentInfo><amendmentType>):
// RESTATEMENT replaces the whole portfolio; NEW HOLDINGS is supplemental (add-only). The
// restate-vs-supplement distinction is what stops a supplemental amendment from being
// mis-read as the whole portfolio (false exits) — fra-kb2p.
export const KNOWN_13F_AMENDMENT_TYPES = ["RESTATEMENT", "NEW HOLDINGS"] as const;
export type Known13fAmendmentType = (typeof KNOWN_13F_AMENDMENT_TYPES)[number];

// Narrow a raw cover amendmentType to a kind we model, or null if absent/unmodeled. The
// handler keeps the raw value (Form13fFiling.amendmentType) for its skip diagnostic and
// refuses to guess an unmodeled type; this narrowing makes the handler's branch
// comparisons compiler-checked.
export function classify13fAmendment(raw: string | null): Known13fAmendmentType | null {
  return raw !== null && (KNOWN_13F_AMENDMENT_TYPES as readonly string[]).includes(raw)
    ? (raw as Known13fAmendmentType)
    : null;
}

export type Form13fFiling = {
  periodOfReport: string; // YYYY-MM-DD (reporting quarter end)
  // Raw 13F-HR/A cover <amendmentInfo><amendmentType>, uppercased + trimmed; null on an
  // original 13F-HR (no amendmentInfo). Kept raw for diagnostics — the handler narrows it
  // via classify13fAmendment and logs the raw value when it can't be classified.
  amendmentType: string | null;
  holdings: Form13fHolding[];
};

export function parse13fInfoTable(submissionTxt: string): Form13fFiling {
  const periodOfReport = normalizePeriod(requireTagText(submissionTxt, "periodOfReport", "13F cover"));
  // Collapse internal whitespace (incl. line breaks) before matching, so a cover that
  // wraps the value (e.g. "NEW\n   HOLDINGS") still classifies (the handler compares on
  // exact token equality).
  const amendmentType = tagText(submissionTxt, "amendmentType")?.replace(/\s+/g, " ").trim().toUpperCase() ?? null;

  const holdings: Form13fHolding[] = [];
  for (const row of iterateBlocks(submissionTxt, "infoTable")) {
    holdings.push({
      nameOfIssuer: requireTagText(row, "nameOfIssuer", "infoTable"),
      cusip: requireTagText(row, "cusip", "infoTable").toUpperCase(),
      valueRaw: parseNonNegativeNumber(requireTagText(row, "value", "infoTable"), "value"),
      shares: parseNonNegativeNumber(requireTagText(row, "sshPrnamt", "infoTable"), "sshPrnamt"),
      sshPrnamtType: tagText(row, "sshPrnamtType") ?? "SH",
      putCall: tagText(row, "putCall"),
    });
  }
  return { periodOfReport, amendmentType, holdings };
}

// EDGAR's 13F cover reports the period as MM-DD-YYYY; normalize to ISO. Tolerate
// an already-ISO value defensively.
function normalizePeriod(raw: string): string {
  const trimmed = raw.trim();
  const us = /^(\d{2})-(\d{2})-(\d{4})$/.exec(trimmed);
  const iso = us ? `${us[3]}-${us[1]}-${us[2]}` : /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
  // Validate the calendar date (not just the shape) so e.g. "13-99-2026" fails at
  // the parse boundary instead of surfacing as a bad date in later DB operations.
  if (iso !== null) {
    const d = new Date(`${iso}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso) return iso;
  }
  throw new Error(`parse13fInfoTable: unrecognized or invalid periodOfReport "${raw}"`);
}

function parseNonNegativeNumber(raw: string, label: string): number {
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`parse13fInfoTable: invalid ${label} "${raw}" (expected a non-negative number)`);
  }
  return n;
}
